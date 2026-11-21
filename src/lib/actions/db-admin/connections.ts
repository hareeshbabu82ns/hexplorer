"use server";

import { prisma } from "@/lib/prisma";
import { decryptUri, encryptUri } from "@/lib/db-admin/crypto";
import { DbAdminError } from "@/lib/db-admin/errors";
import {
  appConnection,
  closeClient,
  getClient,
  isConnected,
  ResolvedConnection,
  withTempClient,
} from "@/lib/db-admin/pool";
import { mutate, read } from "@/lib/db-admin/run";
import {
  APP_CONNECTION_ID,
  ConnectionSummary,
  TestConnectionResult,
} from "@/lib/db-admin/types";
import { describeUri } from "@/lib/db-admin/uri";
import type { MongoClient } from "mongodb";

function summarize(c: ResolvedConnection): ConnectionSummary {
  let d: ReturnType<typeof describeUri> = { hosts: [], username: null, defaultDb: null };
  try {
    d = describeUri(c.uri);
  } catch {}
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    builtIn: c.builtIn,
    hosts: d.hosts,
    username: d.username,
    defaultDb: d.defaultDb,
    connected: isConnected(c.id),
    lastUsedAt: c.lastUsedAt?.toISOString() ?? null,
  };
}

async function probe(client: MongoClient): Promise<TestConnectionResult> {
  const admin = client.db("admin");
  await admin.command({ ping: 1 });
  const info = await admin.command({ buildInfo: 1 });
  const dbs = await admin.admin().listDatabases({ nameOnly: true, authorizedDatabases: true });
  return { version: String(info.version), databases: dbs.databases.length };
}

export async function listConnections() {
  return read("Failed to list connections", async () => {
    const rows = await prisma.dbConnection.findMany({ orderBy: { name: "asc" } });
    const out: ConnectionSummary[] = [summarize(appConnection())];
    for (const r of rows) {
      let summary: ConnectionSummary;
      try {
        summary = summarize({
          id: r.id,
          name: r.name,
          uri: decryptUri(r.uriEnc),
          description: r.description,
          builtIn: false,
          lastUsedAt: r.lastUsedAt,
        });
      } catch {
        // undecryptable (secret changed): still list it so it can be edited / removed
        summary = {
          id: r.id,
          name: r.name,
          description: r.description,
          builtIn: false,
          hosts: [],
          username: null,
          defaultDb: null,
          connected: false,
          lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
        };
      }
      out.push(summary);
    }
    return out;
  });
}

export async function getConnection(id: string) {
  return read("Failed to load connection", async () => {
    const { conn } = await getClient(id);
    return summarize(conn);
  });
}

export async function testConnection(input: { uri: string } | { connectionId: string }) {
  return read("Connection test failed", async () => {
    if ("uri" in input) {
      const uri = (input.uri ?? "").trim();
      if (!uri) throw new DbAdminError("Connection string is required");
      return withTempClient(uri, probe);
    }
    const { client } = await getClient(input.connectionId);
    return probe(client);
  });
}

export async function saveConnection(input: {
  id?: string | null;
  name: string;
  uri?: string | null;
  description?: string | null;
}) {
  return mutate(
    (data?: ConnectionSummary) => ({
      action: input.id ? "connection.update" : "connection.create",
      connectionId: input.id || data?.id || null,
      target: input.name,
      details: { uriChanged: !!input.uri?.trim() },
    }),
    "Failed to save connection",
    async (actor) => {
      const name = (input.name ?? "").trim();
      if (!name) throw new DbAdminError("Name is required");
      if (name.length > 80) throw new DbAdminError("Name is too long");
      if (input.id === APP_CONNECTION_ID) throw new DbAdminError("The built-in connection cannot be edited");
      const uri = input.uri?.trim() || "";
      const description = input.description?.trim() || null;
      if (uri) await withTempClient(uri, probe); // test a new URI before saving

      if (input.id) {
        const existing = await prisma.dbConnection.findUnique({ where: { id: input.id } });
        if (!existing) throw new DbAdminError("Connection not found");
        const row = await prisma.dbConnection.update({
          where: { id: input.id },
          data: { name, description, ...(uri ? { uriEnc: encryptUri(uri) } : {}) },
        });
        if (uri) await closeClient(row.id); // reconnect with the new URI on next use
        return summaryOf(row, uri);
      }
      if (!uri) throw new DbAdminError("Connection string is required");
      const row = await prisma.dbConnection.create({
        data: { name, description, uriEnc: encryptUri(uri), createdById: actor.userId },
      });
      return summaryOf(row, uri);
    },
  );
}

function summaryOf(
  row: { id: string; name: string; description: string | null; lastUsedAt: Date | null; uriEnc: string },
  plainUri: string,
) {
  return summarize({
    id: row.id,
    name: row.name,
    description: row.description,
    builtIn: false,
    lastUsedAt: row.lastUsedAt,
    uri: plainUri || decryptUri(row.uriEnc),
  });
}

/** removes only the saved record: databases and backup files are not touched */
export async function deleteConnection(id: string) {
  return mutate({ action: "connection.delete", connectionId: id }, "Failed to remove connection", async () => {
    if (id === APP_CONNECTION_ID) throw new DbAdminError("The built-in connection cannot be removed");
    const row = await prisma.dbConnection.findUnique({ where: { id } });
    if (!row) throw new DbAdminError("Connection not found");
    await closeClient(id);
    await prisma.dbConnection.delete({ where: { id } });
    return { id };
  });
}

export async function disconnectConnection(id: string) {
  return mutate({ action: "connection.disconnect", connectionId: id }, "Failed to disconnect", async () => {
    return { closed: await closeClient(id) };
  });
}

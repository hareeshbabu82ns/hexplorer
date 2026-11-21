import { MongoClient } from "mongodb";
import { prisma } from "@/lib/prisma";
import { decryptUri } from "./crypto";
import { DbAdminError } from "./errors";
import { isSystemDatabase } from "./names";
import { APP_CONNECTION_ID } from "./types";
import { describeUri } from "./uri";

const IDLE_MS = 10 * 60 * 1000;
const LAST_USED_THROTTLE_MS = 60 * 1000;

export interface ResolvedConnection {
  id: string;
  name: string;
  uri: string;
  description: string | null;
  builtIn: boolean;
  lastUsedAt: Date | null;
}

interface PoolEntry {
  uri: string;
  client: MongoClient;
  ready: Promise<MongoClient>;
  lastUsed: number;
}

const g = globalThis as unknown as {
  _dbAdminPool?: Map<string, PoolEntry>;
  _dbAdminReaper?: ReturnType<typeof setInterval>;
  _dbAdminLastUsedWrite?: Map<string, number>;
};
const pool = (g._dbAdminPool ??= new Map());
const lastUsedWrite = (g._dbAdminLastUsedWrite ??= new Map());

export const CLIENT_OPTIONS = {
  serverSelectionTimeoutMS: 5000,
  connectTimeoutMS: 5000,
  appName: "hexplorer-db-admin",
} as const;

function appUri() {
  const uri = process.env.DATABASE_URL;
  if (!uri) throw new DbAdminError("DATABASE_URL is not set");
  return uri;
}

/** name of the app's own database (same rule as src/lib/db) */
export function appDatabaseName() {
  return describeUri(appUri()).defaultDb || "hexplorer";
}

export function appConnection(): ResolvedConnection {
  return {
    id: APP_CONNECTION_ID,
    name: "App database",
    uri: appUri(),
    description: "The database HExplorer itself runs on",
    builtIn: true,
    lastUsedAt: null,
  };
}

export async function resolveConnection(id: string): Promise<ResolvedConnection> {
  if (id === APP_CONNECTION_ID) return appConnection();
  if (!/^[0-9a-f]{24}$/i.test(id)) throw new DbAdminError("Connection not found");
  const row = await prisma.dbConnection.findUnique({ where: { id } });
  if (!row) throw new DbAdminError("Connection not found");
  return {
    id: row.id,
    name: row.name,
    uri: decryptUri(row.uriEnc),
    description: row.description,
    builtIn: false,
    lastUsedAt: row.lastUsedAt,
  };
}

function startReaper() {
  if (g._dbAdminReaper) return;
  g._dbAdminReaper = setInterval(() => {
    const now = Date.now();
    for (const [id, e] of pool) if (now - e.lastUsed > IDLE_MS) void closeClient(id);
  }, 60 * 1000);
  g._dbAdminReaper.unref?.();
}

function touch(id: string) {
  if (id === APP_CONNECTION_ID) return;
  const now = Date.now();
  if (now - (lastUsedWrite.get(id) ?? 0) < LAST_USED_THROTTLE_MS) return;
  lastUsedWrite.set(id, now);
  prisma.dbConnection
    .update({ where: { id }, data: { lastUsedAt: new Date(now) } })
    .catch(() => undefined);
}

/** pooled client for a connection id; reconnects when the stored URI changed */
export async function getClient(id: string): Promise<{ client: MongoClient; conn: ResolvedConnection }> {
  const conn = await resolveConnection(id);
  let entry = pool.get(id);
  if (entry && entry.uri !== conn.uri) {
    await closeClient(id);
    entry = undefined;
  }
  if (!entry) {
    const client = new MongoClient(conn.uri, CLIENT_OPTIONS);
    const ready = client.connect().catch(async (e) => {
      if (pool.get(id)?.client === client) pool.delete(id);
      await client.close().catch(() => undefined);
      throw e;
    });
    entry = { uri: conn.uri, client, ready, lastUsed: Date.now() };
    pool.set(id, entry);
    startReaper();
  }
  entry.lastUsed = Date.now();
  const client = await entry.ready;
  touch(id);
  return { client, conn };
}

export function isConnected(id: string) {
  return pool.has(id);
}

export async function closeClient(id: string) {
  const e = pool.get(id);
  if (!e) return false;
  pool.delete(id);
  await e.client.close().catch(() => undefined);
  return true;
}

/** close every pooled client (scripts must call this before exiting) */
export async function closeAllClients() {
  await Promise.all([...pool.keys()].map(closeClient));
  if (g._dbAdminReaper) clearInterval(g._dbAdminReaper);
  g._dbAdminReaper = undefined;
}

/** one-off client for testing a URI that is not saved yet */
export async function withTempClient<T>(uri: string, fn: (c: MongoClient) => Promise<T>): Promise<T> {
  describeUri(uri); // validates the format
  const client = new MongoClient(uri, CLIENT_OPTIONS);
  try {
    await client.connect();
    return await fn(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}

const sameHosts = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join(",").toLowerCase() === [...b].sort().join(",").toLowerCase();

/**
 * System databases, and the app's own database: through the built-in
 * connection, or through a saved connection that points at the same hosts.
 */
export function isProtectedDatabase(conn: ResolvedConnection, name: string) {
  if (isSystemDatabase(name)) return true;
  if (name !== appDatabaseName()) return false;
  if (conn.builtIn) return true;
  try {
    return sameHosts(describeUri(conn.uri).hosts, describeUri(appUri()).hosts);
  } catch {
    return false;
  }
}

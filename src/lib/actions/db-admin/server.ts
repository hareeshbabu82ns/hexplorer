"use server";

import { DbAdminError, isUnauthorizedError } from "@/lib/db-admin/errors";
import { isSystemDatabase, validateCollectionName, validateDatabaseName } from "@/lib/db-admin/names";
import { getClient, isProtectedDatabase } from "@/lib/db-admin/pool";
import { mutate, read } from "@/lib/db-admin/run";
import type { DatabaseInfo, DatabaseStats, ServerOverview } from "@/lib/db-admin/types";
import type { MongoClient } from "mongodb";

const num = (v: unknown): number => (v == null ? 0 : Number(v));

/** usersInfo works at all (for all dbs, or at least on the auth db) */
async function probeUsers(client: MongoClient): Promise<boolean> {
  try {
    await client.db("admin").command({ usersInfo: { forAllDBs: true } });
    return true;
  } catch {
    try {
      const status = await client.db("admin").command({ connectionStatus: 1 });
      const authDb = status.authInfo?.authenticatedUsers?.[0]?.db;
      if (!authDb) return false;
      await client.db(authDb).command({ usersInfo: 1 });
      return true;
    } catch {
      return false;
    }
  }
}

export async function getServerOverview(connectionId: string) {
  return read("Failed to load server info", async (): Promise<ServerOverview> => {
    const { client } = await getClient(connectionId);
    const admin = client.db("admin");
    const info = await admin.command({ buildInfo: 1 });
    let replicaSet: string | null = null;
    let uptimeSeconds: number | null = null;
    let connections: number | null = null;
    try {
      const s = await admin.command({ serverStatus: 1, metrics: 0, locks: 0, wiredTiger: 0 });
      uptimeSeconds = s.uptime != null ? num(s.uptime) : null;
      connections = s.connections?.current != null ? num(s.connections.current) : null;
      replicaSet = s.repl?.setName ?? null;
    } catch (e) {
      if (!isUnauthorizedError(e)) console.warn("[db-admin] serverStatus failed", e);
    }
    if (!replicaSet) {
      const hello = await admin.command({ hello: 1 }).catch(() => null);
      replicaSet = hello?.setName ?? null;
    }
    return {
      version: String(info.version),
      replicaSet,
      uptimeSeconds,
      connections,
      canListUsers: await probeUsers(client),
    };
  });
}

export async function listDatabases(connectionId: string) {
  return read("Failed to list databases", async (): Promise<DatabaseInfo[]> => {
    const { client, conn } = await getClient(connectionId);
    const res = await client.db("admin").admin().listDatabases({ authorizedDatabases: true });
    return res.databases
      .map((d) => ({
        name: d.name,
        sizeOnDisk: num(d.sizeOnDisk),
        empty: !!d.empty,
        system: isSystemDatabase(d.name),
        protected: isProtectedDatabase(conn, d.name),
      }))
      .sort((a, b) => Number(a.system) - Number(b.system) || a.name.localeCompare(b.name));
  });
}

/** MongoDB keeps a database only once it has a collection, so one is required */
export async function createDatabase(connectionId: string, name: string, firstCollection: string) {
  return mutate(
    { action: "database.create", connectionId, target: `${name}.${firstCollection}` },
    "Failed to create database",
    async () => {
      const db = validateDatabaseName(name);
      const coll = validateCollectionName(firstCollection);
      if (isSystemDatabase(db)) throw new DbAdminError(`"${db}" is a system database`);
      const { client } = await getClient(connectionId);
      const existing = await client.db(db).listCollections({}, { nameOnly: true }).toArray();
      if (existing.length) throw new DbAdminError(`Database "${db}" already exists`);
      await client.db(db).createCollection(coll);
      return { name: db };
    },
  );
}

export async function dropDatabase(connectionId: string, name: string, confirmName: string) {
  return mutate({ action: "database.drop", connectionId, target: name }, "Failed to drop database", async () => {
    if (confirmName !== name) throw new DbAdminError("Confirmation does not match the database name");
    const { client, conn } = await getClient(connectionId);
    if (isProtectedDatabase(conn, name))
      throw new DbAdminError(`"${name}" is protected and cannot be dropped`);
    await client.db(name).dropDatabase();
    return { name };
  });
}

export async function getDatabaseStats(connectionId: string, database: string) {
  return read("Failed to load database stats", async (): Promise<DatabaseStats> => {
    const { client } = await getClient(connectionId);
    const s = await client.db(validateDatabaseName(database)).stats();
    return {
      collections: num(s.collections),
      views: num(s.views),
      objects: num(s.objects),
      dataSize: num(s.dataSize),
      storageSize: num(s.storageSize),
      indexSize: num(s.indexSize),
    };
  });
}

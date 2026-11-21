"use server";

import type { CreateIndexesOptions, Db, IndexDirection } from "mongodb";
import { parseObject, toRelaxed } from "@/lib/db-admin/ejson";
import { DbAdminError } from "@/lib/db-admin/errors";
import { validateCollectionName, validateDatabaseName } from "@/lib/db-admin/names";
import { getClient } from "@/lib/db-admin/pool";
import { mutate, read } from "@/lib/db-admin/run";
import type { CollectionInfo, IndexInfo } from "@/lib/db-admin/types";

const numOrNull = (v: unknown) => (v == null ? null : Number(v));

async function collStats(db: Db, name: string) {
  const [s] = await db
    .collection(name)
    .aggregate([{ $collStats: { storageStats: {} } }])
    .toArray();
  return (s?.storageStats ?? null) as Record<string, any> | null;
}

async function dbOf(connectionId: string, database: string) {
  const { client } = await getClient(connectionId);
  return client.db(validateDatabaseName(database));
}

export async function listCollections(connectionId: string, database: string) {
  return read("Failed to list collections", async (): Promise<CollectionInfo[]> => {
    const db = await dbOf(connectionId, database);
    const infos = await db.listCollections({}, { authorizedCollections: true }).toArray();
    const out = await Promise.all(
      infos.map(async (info: any): Promise<CollectionInfo> => {
        const type = (info.type ?? "collection") as CollectionInfo["type"];
        const base: CollectionInfo = {
          name: info.name,
          type,
          count: null,
          size: null,
          storageSize: null,
          avgObjSize: null,
          indexCount: null,
          totalIndexSize: null,
          capped: !!info.options?.capped,
        };
        if (type === "view") {
          return { ...base, viewOn: info.options?.viewOn, pipeline: toRelaxed(info.options?.pipeline ?? []) };
        }
        try {
          const s = await collStats(db, info.name);
          if (!s) throw new Error("no stats");
          return {
            ...base,
            count: numOrNull(s.count),
            size: numOrNull(s.size),
            storageSize: numOrNull(s.storageSize),
            avgObjSize: numOrNull(s.avgObjSize),
            indexCount: numOrNull(s.nindexes),
            totalIndexSize: numOrNull(s.totalIndexSize),
            capped: !!s.capped || base.capped,
          };
        } catch {
          // $collStats denied (or unsupported): fall back to an estimate
          const count = await db
            .collection(info.name)
            .estimatedDocumentCount()
            .catch(() => null);
          return { ...base, count };
        }
      }),
    );
    return out.sort((a, b) => a.name.localeCompare(b.name));
  });
}

export async function createCollection(
  connectionId: string,
  database: string,
  name: string,
  opts: { capped?: boolean; size?: number | null; max?: number | null } = {},
) {
  return mutate(
    { action: "collection.create", connectionId, target: `${database}.${name}`, details: { ...opts } },
    "Failed to create collection",
    async () => {
      const db = await dbOf(connectionId, database);
      const coll = validateCollectionName(name);
      // only the keys that are set: the driver sends undefined as null
      const options: { capped?: boolean; size?: number; max?: number } = {};
      if (opts.capped) {
        const size = Number(opts.size);
        if (!Number.isFinite(size) || size <= 0) throw new DbAdminError("Capped collections need a size in bytes");
        options.capped = true;
        options.size = size;
        if (opts.max != null && String(opts.max) !== "") {
          const max = Number(opts.max);
          if (!Number.isFinite(max) || max <= 0) throw new DbAdminError("Max documents must be a positive number");
          options.max = max;
        }
      }
      await db.createCollection(coll, options);
      return { name: coll };
    },
  );
}

export async function renameCollection(connectionId: string, database: string, from: string, to: string) {
  return mutate(
    { action: "collection.rename", connectionId, target: `${database}.${from}`, details: { to } },
    "Failed to rename collection",
    async () => {
      const db = await dbOf(connectionId, database);
      const src = validateCollectionName(from);
      const dst = validateCollectionName(to);
      if (src === dst) throw new DbAdminError("The new name is the same as the old one");
      if ((await db.listCollections({ name: dst }, { nameOnly: true }).toArray()).length)
        throw new DbAdminError(`Collection "${dst}" already exists`);
      await db.collection(src).rename(dst, { dropTarget: false });
      return { name: dst };
    },
  );
}

export async function dropCollection(connectionId: string, database: string, name: string, confirmName: string) {
  return mutate(
    { action: "collection.drop", connectionId, target: `${database}.${name}` },
    "Failed to drop collection",
    async () => {
      if (confirmName !== name) throw new DbAdminError("Confirmation does not match the collection name");
      const db = await dbOf(connectionId, database);
      const ok = await db.collection(validateCollectionName(name)).drop();
      return { dropped: ok };
    },
  );
}

/** deleteMany({}): removes every document but keeps the indexes */
export async function clearCollection(connectionId: string, database: string, name: string, confirmName: string) {
  return mutate(
    (d?: { deletedCount: number }) => ({
      action: "collection.clear",
      connectionId,
      target: `${database}.${name}`,
      details: d ? { deletedCount: d.deletedCount } : {},
    }),
    "Failed to clear collection",
    async () => {
      if (confirmName !== name) throw new DbAdminError("Confirmation does not match the collection name");
      const db = await dbOf(connectionId, database);
      const res = await db.collection(validateCollectionName(name)).deleteMany({});
      return { deletedCount: res.deletedCount };
    },
  );
}

/* ---------------------------------------------------------------- indexes */

export async function listIndexes(connectionId: string, database: string, collection: string) {
  return read("Failed to list indexes", async (): Promise<IndexInfo[]> => {
    const db = await dbOf(connectionId, database);
    const name = validateCollectionName(collection, { allowSystem: true });
    const indexes = await db.collection(name).listIndexes().toArray();
    let sizes: Record<string, number> = {};
    try {
      sizes = (await collStats(db, name))?.indexSizes ?? {};
    } catch {
      try {
        const s = await db.command({ collStats: name });
        sizes = s.indexSizes ?? {};
      } catch {}
    }
    return indexes.map((ix: any) => ({
      name: ix.name,
      key: toRelaxed(ix.key),
      unique: !!ix.unique,
      sparse: !!ix.sparse,
      expireAfterSeconds: ix.expireAfterSeconds ?? null,
      partialFilterExpression: ix.partialFilterExpression ? toRelaxed(ix.partialFilterExpression) : null,
      size: sizes[ix.name] != null ? Number(sizes[ix.name]) : null,
    }));
  });
}

const KEY_TYPES = new Set(["text", "2dsphere", "2d", "hashed"]);

export async function createIndex(
  connectionId: string,
  database: string,
  collection: string,
  keysJson: string,
  opts: {
    name?: string | null;
    unique?: boolean;
    sparse?: boolean;
    expireAfterSeconds?: number | string | null;
    background?: boolean;
  } = {},
) {
  return mutate(
    (d?: { name: string }) => ({
      action: "index.create",
      connectionId,
      target: `${database}.${collection}`,
      details: { keys: keysJson, name: d?.name ?? opts.name ?? null, unique: !!opts.unique, sparse: !!opts.sparse },
    }),
    "Failed to create index",
    async () => {
      const db = await dbOf(connectionId, database);
      const keys = parseObject(keysJson, "index keys");
      if (!Object.keys(keys).length) throw new DbAdminError('Index keys are required, e.g. { "email": 1 }');
      for (const [k, v] of Object.entries(keys)) {
        const n = Number((v as { valueOf(): unknown })?.valueOf?.() ?? v);
        if (!(n === 1 || n === -1 || (typeof v === "string" && KEY_TYPES.has(v))))
          throw new DbAdminError(`Invalid direction for "${k}": use 1, -1, "text", "2dsphere", "2d" or "hashed"`);
        keys[k] = typeof v === "string" ? v : n;
      }
      // only the keys that are set: the driver sends undefined as null
      // ("expireAfterSeconds must be numeric, but received null")
      const options: CreateIndexesOptions = {};
      if (opts.name?.trim()) options.name = opts.name.trim();
      if (opts.unique) options.unique = true;
      if (opts.sparse) options.sparse = true;
      if (opts.background) options.background = true;
      if (opts.expireAfterSeconds != null && String(opts.expireAfterSeconds).trim() !== "") {
        const ttl = Number(opts.expireAfterSeconds);
        if (!Number.isInteger(ttl) || ttl < 0) throw new DbAdminError("TTL must be a whole number of seconds");
        options.expireAfterSeconds = ttl;
      }
      const name = await db
        .collection(validateCollectionName(collection))
        .createIndex(keys as Record<string, IndexDirection>, options);
      return { name };
    },
  );
}

export async function dropIndex(connectionId: string, database: string, collection: string, name: string) {
  return mutate(
    { action: "index.drop", connectionId, target: `${database}.${collection}`, details: { index: name } },
    "Failed to drop index",
    async () => {
      if (name === "_id_") throw new DbAdminError("The _id_ index cannot be dropped");
      const db = await dbOf(connectionId, database);
      await db.collection(validateCollectionName(collection)).dropIndex(name);
      return { name };
    },
  );
}

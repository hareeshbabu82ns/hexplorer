import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import readline from "readline";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { createGunzip, createGzip } from "zlib";
import { Db, MongoBulkWriteError, MongoClient, ObjectId } from "mongodb";
import { prisma } from "@/lib/prisma";
import { EJSON } from "./ejson";
import { DbAdminError } from "./errors";
import { isSystemDatabase, validateDatabaseName } from "./names";
import { getClient, isProtectedDatabase } from "./pool";
import type { BackupSummary, RestoreResult } from "./types";

export const BACKUP_FORMAT = "hexplorer-mongo-backup";
export const BACKUP_VERSION = 1;
const BATCH = 1000;

const g = globalThis as unknown as { _dbAdminProcessStart?: Date };
/** running records older than this were interrupted by a restart */
export const PROCESS_START = (g._dbAdminProcessStart ??= new Date());

export async function backupDir() {
  // runtime-configured folder: keep it out of build file tracing
  const dir = path.resolve(/*turbopackIgnore: true*/ process.env.DB_BACKUP_DIR || "./data/backups");
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

const FILE_RE = /^[0-9a-f]{24}\.ndjson\.gz$/;
export const fileNameFor = (id: string) => `${id}.ndjson.gz`;

/** path of a backup file, resolved only from the database record */
export async function backupFilePath(record: { id: string; fileName: string }) {
  if (!FILE_RE.test(record.fileName) || record.fileName !== fileNameFor(record.id))
    throw new DbAdminError("Invalid backup file name");
  return path.join(/*turbopackIgnore: true*/ await backupDir(), record.fileName);
}

export function toSummary(b: {
  id: string;
  connectionId: string;
  connectionName: string;
  database: string;
  name: string;
  description: string | null;
  collections: string[];
  documentCount: number;
  sizeBytes: number;
  status: string;
  source: string;
  error: string | null;
  createdAt: Date;
  completedAt: Date | null;
}): BackupSummary {
  return {
    id: b.id,
    connectionId: b.connectionId,
    connectionName: b.connectionName,
    database: b.database,
    name: b.name,
    description: b.description,
    collections: b.collections,
    documentCount: b.documentCount,
    sizeBytes: b.sizeBytes,
    status: b.status as BackupSummary["status"],
    source: b.source as BackupSummary["source"],
    error: b.error,
    createdAt: b.createdAt.toISOString(),
    completedAt: b.completedAt?.toISOString() ?? null,
  };
}

export async function markStaleBackups() {
  await prisma.dbBackup.updateMany({
    where: { status: "running", createdAt: { lt: PROCESS_START } },
    data: { status: "failed", error: "Interrupted (server restarted)", completedAt: new Date() },
  });
}

/* ------------------------------------------------------------------ write */

const line = (v: unknown) => EJSON.stringify(v, { relaxed: false }) + "\n";

interface CollectionMeta {
  name: string;
  kind: "collection" | "view" | "timeseries";
  options: Record<string, unknown>;
}

/** collections to back up: real collections first, views last; system.* skipped */
export async function backupTargets(db: Db, only?: string[] | null): Promise<CollectionMeta[]> {
  const infos = (await db.listCollections({}, { authorizedCollections: true }).toArray()) as any[];
  const wanted = only?.length ? new Set(only) : null;
  const metas = infos
    .filter((i) => !i.name.startsWith("system.") && (!wanted || wanted.has(i.name)))
    .map((i) => ({ name: i.name as string, kind: (i.type ?? "collection") as CollectionMeta["kind"], options: i.options ?? {} }));
  if (wanted) {
    const missing = [...wanted].filter((n) => !metas.some((m) => m.name === n));
    if (missing.length) throw new DbAdminError(`Collection(s) not found: ${missing.join(", ")}`);
  }
  return metas.sort((a, b) => Number(a.kind === "view") - Number(b.kind === "view") || a.name.localeCompare(b.name));
}

async function* backupLines(
  client: MongoClient,
  database: string,
  metas: CollectionMeta[],
  counts: { collections: number; documents: number },
) {
  const db = client.db(database);
  const info = await client.db("admin").command({ buildInfo: 1 });
  yield line({
    type: "header",
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    database,
    createdAt: new Date(),
    server: { version: String(info.version) },
  });
  for (const m of metas) {
    const indexes = m.kind === "view" ? [] : await db.collection(m.name).listIndexes().toArray().catch(() => []);
    yield line({ type: "collection", name: m.name, kind: m.kind, options: m.options, indexes });
    counts.collections++;
    if (m.kind === "view") continue;
    // unpromoted values keep Int32 / Long / Double distinct in the canonical output
    const cursor = db
      .collection(m.name)
      .find({}, { batchSize: BATCH, promoteValues: false, promoteLongs: false });
    try {
      for await (const d of cursor) {
        yield line({ type: "doc", c: m.name, d });
        counts.documents++;
      }
    } finally {
      await cursor.close();
    }
  }
  yield line({ type: "end", collections: counts.collections, documents: counts.documents });
}

/** the background job: cursor → generator → gzip → file, then mark the record */
export async function runBackup(backupId: string) {
  const rec = await prisma.dbBackup.findUnique({ where: { id: backupId } });
  if (!rec) return;
  const file = await backupFilePath(rec);
  const counts = { collections: 0, documents: 0 };
  try {
    const { client } = await getClient(rec.connectionId);
    const metas = await backupTargets(client.db(rec.database), rec.collections.length ? rec.collections : null);
    await pipeline(Readable.from(backupLines(client, rec.database, metas, counts)), createGzip(), fs.createWriteStream(file));
    const { size } = await fsp.stat(/*turbopackIgnore: true*/ file);
    await prisma.dbBackup.update({
      where: { id: backupId },
      data: {
        status: "completed",
        collections: metas.map((m) => m.name),
        documentCount: counts.documents,
        sizeBytes: size,
        completedAt: new Date(),
      },
    });
  } catch (e) {
    await fsp.rm(file, { force: true }).catch(() => undefined);
    await prisma.dbBackup
      .update({
        where: { id: backupId },
        data: { status: "failed", error: (e as Error)?.message || String(e), completedAt: new Date() },
      })
      .catch(() => undefined);
    throw e;
  }
}

/* ------------------------------------------------------------------- read */

/**
 * gunzip → readline. readline does not forward stream errors to its async
 * iterator, so a read or gunzip error (truncated / garbage file) closes the
 * reader and check() rethrows it after the loop.
 */
function lines(file: string) {
  const source = fs.createReadStream(file);
  const gunzip = createGunzip();
  let failure: Error | null = null;
  const rl = readline.createInterface({ input: gunzip, crlfDelay: Infinity });
  const fail = (e: Error) => {
    failure ??= e;
    rl.close();
  };
  source.on("error", fail);
  gunzip.on("error", fail);
  source.pipe(gunzip);
  return {
    rl,
    check() {
      if (failure) throw failure;
    },
    input: {
      destroy() {
        source.destroy();
        gunzip.destroy();
      },
    },
  };
}

export interface BackupFileInfo {
  database: string;
  createdAt: Date | null;
  collections: string[];
  documents: number;
}

/** gunzip, check the header, require the end line, count collections and documents */
export async function validateBackupFile(file: string): Promise<BackupFileInfo> {
  const { rl, input, check } = lines(file);
  let header: any = null;
  let ended = false;
  const collections: string[] = [];
  let documents = 0;
  try {
    for await (const raw of rl) {
      if (!raw.trim()) continue;
      if (ended) throw new DbAdminError("Data after the end line");
      let v: any;
      try {
        v = JSON.parse(raw);
      } catch {
        throw new DbAdminError("Corrupt line in backup file");
      }
      if (!header) {
        if (v?.type !== "header" || v.format !== BACKUP_FORMAT)
          throw new DbAdminError("Not a HExplorer MongoDB backup (bad header)");
        if (Number(v.version?.$numberInt ?? v.version) !== BACKUP_VERSION)
          throw new DbAdminError(`Unsupported backup version ${JSON.stringify(v.version)}`);
        header = v;
        continue;
      }
      if (v.type === "collection") collections.push(String(v.name));
      else if (v.type === "doc") documents++;
      else if (v.type === "end") {
        const n = Number(v.documents?.$numberInt ?? v.documents?.$numberLong ?? v.documents);
        if (n !== documents) throw new DbAdminError("Document count does not match the end line");
        ended = true;
      } else throw new DbAdminError(`Unknown line type "${v.type}"`);
    }
    check();
  } catch (e) {
    if (e instanceof DbAdminError) throw e;
    throw new DbAdminError(`Corrupt backup file: ${(e as Error).message}`);
  } finally {
    rl.close();
    input.destroy();
  }
  if (!header) throw new DbAdminError("Empty backup file");
  if (!ended) throw new DbAdminError("Backup file is truncated (no end line)");
  const created = header.createdAt?.$date;
  return {
    database: String(header.database),
    createdAt: created ? new Date(created.$numberLong ? Number(created.$numberLong) : created) : null,
    collections,
    documents,
  };
}

/* ---------------------------------------------------------------- restore */

function cleanOptions(opts: Record<string, unknown>) {
  const { uuid: _uuid, ...rest } = opts ?? {};
  return rest;
}

function cleanIndex(ix: Record<string, unknown>) {
  const { v: _v, ns: _ns, key, ...rest } = ix;
  return { key: key as Record<string, any>, options: rest };
}

function dupCount(e: unknown): { inserted: number; duplicates: number } | null {
  if (!(e instanceof MongoBulkWriteError)) return null;
  const errs = Array.isArray(e.writeErrors) ? e.writeErrors : e.writeErrors ? [e.writeErrors] : [];
  if (!errs.length || errs.some((w: any) => w.code !== 11000)) return null;
  return { inserted: e.insertedCount ?? e.result?.insertedCount ?? 0, duplicates: errs.length };
}

export async function restoreBackup(
  backupId: string,
  opts: { targetConnectionId: string; targetDatabase: string; collections?: string[] | null; mode: "drop" | "merge" },
): Promise<RestoreResult> {
  const rec = await prisma.dbBackup.findUnique({ where: { id: backupId } });
  if (!rec) throw new DbAdminError("Backup not found");
  if (rec.status !== "completed") throw new DbAdminError("Only completed backups can be restored");
  if (opts.mode !== "drop" && opts.mode !== "merge") throw new DbAdminError("Mode must be drop or merge");
  const target = validateDatabaseName(opts.targetDatabase);
  if (isSystemDatabase(target)) throw new DbAdminError(`Cannot restore into system database "${target}"`);
  const { client, conn } = await getClient(opts.targetConnectionId);
  if (opts.mode === "drop" && isProtectedDatabase(conn, target))
    throw new DbAdminError(`"${target}" is protected: it cannot be restored in Replace mode`);

  const file = await backupFilePath(rec);
  await fsp.access(file).catch(() => {
    throw new DbAdminError("Backup file is missing on disk");
  });
  const db = client.db(target);
  const wanted = opts.collections?.length ? new Set(opts.collections) : null;
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));

  const result: RestoreResult = { collections: 0, documents: 0, skipped: 0, warnings: [] };
  const views: { name: string; options: Record<string, any> }[] = [];
  let current: { name: string; indexes: any[]; skipped: number; active: boolean } | null = null;
  let batch: any[] = [];

  const flushBatch = async () => {
    if (!current?.active || !batch.length) return;
    const docs = batch;
    batch = [];
    try {
      const r = await db.collection(current.name).insertMany(docs, { ordered: false });
      result.documents += r.insertedCount;
    } catch (e) {
      const d = opts.mode === "merge" ? dupCount(e) : null;
      if (!d) throw e;
      result.documents += d.inserted;
      result.skipped += d.duplicates;
      current.skipped += d.duplicates;
    }
  };

  const finishCollection = async () => {
    if (!current?.active) return;
    await flushBatch();
    for (const ix of current.indexes) {
      if (ix.name === "_id_") continue;
      const { key, options } = cleanIndex(ix);
      try {
        await db.collection(current.name).createIndex(key, options);
      } catch (e) {
        result.warnings.push(`${current.name}: index ${ix.name} not restored (${(e as Error).message})`);
      }
    }
    if (current.skipped) result.warnings.push(`${current.name}: ${current.skipped} existing document(s) kept`);
  };

  const { rl, input, check } = lines(file);
  try {
    for await (const raw of rl) {
      if (!raw.trim()) continue;
      const v = EJSON.parse(raw, { relaxed: false }) as any;
      if (v.type === "collection") {
        await finishCollection();
        const name = String(v.name);
        const active = !wanted || wanted.has(name);
        current = { name, indexes: v.indexes ?? [], skipped: 0, active };
        if (!active) continue;
        if (v.kind === "view") {
          views.push({ name, options: v.options ?? {} });
          current.active = false;
          continue;
        }
        result.collections++;
        if (opts.mode === "drop" && existing.has(name)) {
          await db.collection(name).drop();
          existing.delete(name);
        }
        if (!existing.has(name)) {
          await db.createCollection(name, cleanOptions(v.options));
          existing.add(name);
        }
      } else if (v.type === "doc") {
        if (!current?.active || v.c !== current.name) continue;
        batch.push(v.d);
        if (batch.length >= BATCH) await flushBatch();
      }
    }
    check();
    await finishCollection();
  } finally {
    rl.close();
    input.destroy();
  }

  // views last: their source collections exist by now
  for (const view of views) {
    if (existing.has(view.name)) {
      if (opts.mode === "merge") {
        result.warnings.push(`${view.name}: view already exists, kept`);
        continue;
      }
      await db.collection(view.name).drop();
    }
    await db.createCollection(view.name, { viewOn: view.options.viewOn, pipeline: view.options.pipeline ?? [] });
    result.collections++;
  }
  return result;
}

export const newBackupId = () => new ObjectId().toHexString();

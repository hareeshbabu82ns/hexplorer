import { Collection, Db, MongoClient, ObjectId } from "mongodb";

export type ScanStatus = "idle" | "scanning" | "hashing" | "error";

export interface FolderDoc {
  _id: ObjectId;
  name: string;
  /** absolute path on disk */
  path: string;
  createdAt: Date;
  status: ScanStatus;
  statusMessage?: string | null;
  progress?: number;
  lastScanAt?: Date | null;
  lastScanDurationMs?: number | null;
  fileCount: number;
  dirCount: number;
  totalSize: number;
  /** set when the folder is an app-managed mount of a remote */
  mount?: {
    type: "sshfs" | "cifs";
    remoteId: ObjectId;
    remotePath: string;
    /** unmount after this many idle minutes (0 = never) */
    idleMinutes: number;
  } | null;
  /** last time the folder was accessed on disk (for idle unmount) */
  lastUsedAt?: Date | null;
}

export type RemoteType = "ssh" | "smb";
export type RemoteAuth = "key" | "password";

export interface RemoteDoc {
  _id: ObjectId;
  name: string;
  type?: RemoteType; // missing = "ssh" (older docs)
  /** hostname / IP, or ~/.ssh/config Host alias for ssh */
  host: string;
  user?: string | null;
  port?: number | null;
  auth?: RemoteAuth; // ssh only; smb always uses password (or guest)
  identityFile?: string | null;
  /** uploaded key (ssh_keys collection); takes precedence over identityFile */
  keyId?: ObjectId | null;
  /** encrypted with APP_SECRET, see lib/secrets.ts */
  passwordEnc?: string | null;
  /** smb only */
  domain?: string | null;
  smbVersion?: string | null;
  createdAt: Date;
}

export interface SshKeyDoc {
  _id: ObjectId;
  name: string;
  /** e.g. ED25519, RSA */
  keyType: string;
  bits?: number | null;
  /** SHA256:… */
  fingerprint: string;
  publicKey: string;
  comment?: string | null;
  /** unencrypted (passphrase stripped) private key, encrypted with APP_SECRET */
  privateKeyEnc: string;
  createdAt: Date;
}

export type BackupMode = "sync" | "mirror" | "snapshot";

export interface BackupDoc {
  _id: ObjectId;
  name: string;
  source: { folderId: ObjectId; dir: string };
  /** either a data folder (+ sub dir) or an absolute local path */
  dest: { folderId?: ObjectId | null; dir?: string; path?: string | null };
  mode: BackupMode;
  /** comma separated rsync exclude patterns */
  exclude?: string | null;
  /** rescan the destination data folder after a successful run */
  rescanDest: boolean;
  createdAt: Date;
  status: "idle" | "running" | "error" | "warning" | "success";
  progress?: number | null;
  lastRun?: {
    startedAt: Date;
    finishedAt?: Date | null;
    target?: string;
    message?: string | null;
  } | null;
}

export interface FileDoc {
  _id: ObjectId;
  folderId: ObjectId;
  name: string;
  nameLower: string;
  /** name normalised for "similar name" duplicate detection */
  nameNorm: string;
  ext: string;
  /** parent dir relative to folder root, posix style, "" for root */
  dir: string;
  /** path relative to folder root, posix style */
  relPath: string;
  isDirectory: boolean;
  size: number;
  birthDate: Date;
  modifiedDate: Date;
  hash?: string | null;
  scanId: string;
}

export interface SettingDoc {
  _id: ObjectId;
  domain: string;
  key: string;
  value: string;
  description?: string;
}

const globalForMongo = globalThis as unknown as {
  _client?: MongoClient;
  _mongoClient?: Promise<MongoClient>;
  _mongoIndexes?: Promise<void>;
};

/** shared driver instance; it connects lazily on first use (also used by better-auth) */
export function getMongoClient(): MongoClient {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  if (!globalForMongo._client) globalForMongo._client = new MongoClient(url);
  return globalForMongo._client;
}

export function getDbSync(): Db {
  const client = getMongoClient();
  return client.db(client.options.dbName || "hexplorer");
}

function getClient(): Promise<MongoClient> {
  if (!globalForMongo._mongoClient) {
    globalForMongo._mongoClient = getMongoClient()
      .connect()
      .catch((e) => {
        globalForMongo._mongoClient = undefined;
        throw e;
      });
  }
  return globalForMongo._mongoClient;
}

export async function getDb(): Promise<Db> {
  // database name is taken from the connection string path (defaults to "hexplorer")
  const client = await getClient();
  const db = client.db(client.options.dbName || "hexplorer");
  if (!globalForMongo._mongoIndexes) {
    globalForMongo._mongoIndexes = ensureIndexes(db).catch((e) => {
      globalForMongo._mongoIndexes = undefined;
      console.error("failed to create indexes", e);
    });
  }
  await globalForMongo._mongoIndexes;
  return db;
}

export async function ensureIndexes(db: Db) {
  const files = db.collection<FileDoc>("files");
  await Promise.all([
    files.createIndex({ folderId: 1, relPath: 1 }, { unique: true }),
    files.createIndex({ folderId: 1, dir: 1, isDirectory: -1, nameLower: 1 }),
    files.createIndex({ nameLower: 1 }),
    files.createIndex({ size: 1, nameLower: 1 }),
    files.createIndex({ size: 1, nameNorm: 1 }),
    files.createIndex({ hash: 1 }, { sparse: true }),
    files.createIndex({ modifiedDate: 1 }),
    files.createIndex({ folderId: 1, scanId: 1 }),
    db.collection<FolderDoc>("folders").createIndex({ path: 1 }, { unique: true }),
    db
      .collection<SettingDoc>("settings")
      .createIndex({ domain: 1, key: 1 }, { unique: true }),
  ]);
}

export async function collections(): Promise<{
  folders: Collection<FolderDoc>;
  files: Collection<FileDoc>;
  settings: Collection<SettingDoc>;
  remotes: Collection<RemoteDoc>;
  backups: Collection<BackupDoc>;
  sshKeys: Collection<SshKeyDoc>;
}> {
  const db = await getDb();
  return {
    folders: db.collection<FolderDoc>("folders"),
    files: db.collection<FileDoc>("files"),
    settings: db.collection<SettingDoc>("settings"),
    remotes: db.collection<RemoteDoc>("remotes"),
    backups: db.collection<BackupDoc>("backups"),
    sshKeys: db.collection<SshKeyDoc>("ssh_keys"),
  };
}

export function toObjectId(id: string): ObjectId {
  if (!ObjectId.isValid(id)) throw new Error(`invalid id: ${id}`);
  return new ObjectId(id);
}

export function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** normalise a relative dir: no leading/trailing slashes, no "." / ".." segments */
export function normDir(dir?: string | null) {
  const parts = (dir ?? "").split("/").filter((p) => p && p !== ".");
  if (parts.includes("..")) throw new Error(`invalid path: ${dir}`);
  return parts.join("/");
}

/** filter matching entries strictly below dir (all entries when dir is "") */
export function belowDir(dir: string): Record<string, unknown> {
  return dir ? { relPath: { $regex: `^${escapeRegex(dir)}/` } } : {};
}

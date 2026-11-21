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
    /**
     * "mount" (default): sshfs/cifs mount at `path`.
     * "direct": never mounted; files are reached over ssh commands / smbclient
     * (no FUSE, root or container capabilities needed). `path` is then only a label.
     */
    access?: "mount" | "direct";
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

/** where a backup reads from / writes to */
export type BackupEndpointDoc =
  | { kind: "folder"; folderId: ObjectId; dir: string }
  /** remote path; mounted just for the run (ssh: "" = home, smb: /share/sub) */
  | { kind: "remote"; remoteId: ObjectId; path: string }
  /** absolute path on the server */
  | { kind: "local"; path: string };

/** pre-endpoint docs: source {folderId, dir}, dest {folderId, dir} or {path} */
export type LegacyBackupEndpoint = {
  kind?: undefined;
  folderId?: ObjectId | null;
  dir?: string;
  path?: string | null;
};

export type BackupScheduleDoc = {
  type: "off" | "hourly" | "daily" | "weekly";
  /** minute of the hour (0-59) */
  minute: number;
  /** hour of the day (0-23), daily/weekly */
  hour: number;
  /** 0 = Sunday … 6 = Saturday, weekly */
  weekday: number;
};

export interface BackupDoc {
  _id: ObjectId;
  name: string;
  source: BackupEndpointDoc | LegacyBackupEndpoint;
  dest: BackupEndpointDoc | LegacyBackupEndpoint;
  mode: BackupMode;
  /** comma separated rsync exclude patterns */
  exclude?: string | null;
  /** rescan the destination data folder after a successful run */
  rescanDest: boolean;
  /** snapshot mode: keep this many snapshots, delete older ones (0/null = keep all) */
  keep?: number | null;
  /** snapshot mode: store each snapshot as <name>-<stamp>.zip instead of a folder */
  archive?: "zip" | null;
  schedule?: BackupScheduleDoc | null;
  nextRunAt?: Date | null;
  createdAt: Date;
  status: "idle" | "running" | "error" | "warning" | "success";
  progress?: number | null;
  lastRun?: {
    startedAt: Date;
    finishedAt?: Date | null;
    target?: string;
    message?: string | null;
    /** "manual" | "schedule" */
    trigger?: string;
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

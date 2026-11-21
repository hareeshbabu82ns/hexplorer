/** Types shared by server actions and client components (no server imports here). */

export type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

export const APP_CONNECTION_ID = "app";

export interface ConnectionSummary {
  id: string;
  name: string;
  description: string | null;
  builtIn: boolean;
  /** host:port list, without credentials */
  hosts: string[];
  /** username only, never the password */
  username: string | null;
  defaultDb: string | null;
  /** a live pooled client exists */
  connected: boolean;
  lastUsedAt: string | null;
}

export interface TestConnectionResult {
  version: string;
  databases: number;
}

export interface ServerOverview {
  version: string;
  replicaSet: string | null;
  uptimeSeconds: number | null;
  connections: number | null;
  canListUsers: boolean;
}

export interface DatabaseInfo {
  name: string;
  sizeOnDisk: number;
  empty: boolean;
  system: boolean;
  protected: boolean;
}

export interface DatabaseStats {
  collections: number;
  views: number;
  objects: number;
  dataSize: number;
  storageSize: number;
  indexSize: number;
}

export interface CollectionInfo {
  name: string;
  type: "collection" | "view" | "timeseries";
  count: number | null;
  size: number | null;
  storageSize: number | null;
  avgObjSize: number | null;
  indexCount: number | null;
  totalIndexSize: number | null;
  capped: boolean;
  viewOn?: string;
  /** relaxed EJSON string of the view pipeline */
  pipeline?: string;
}

export interface IndexInfo {
  name: string;
  /** relaxed EJSON string of the key spec */
  key: string;
  unique: boolean;
  sparse: boolean;
  expireAfterSeconds: number | null;
  partialFilterExpression: string | null;
  size: number | null;
}

export interface FindQuery {
  filter?: string;
  sort?: string;
  projection?: string;
  skip?: number;
  limit?: number;
}

export interface FindResult {
  /** relaxed EJSON strings */
  documents: string[];
  total: number;
  estimated: boolean;
}

export interface RoleRef {
  role: string;
  db: string;
}

export interface DbUserInfo {
  user: string;
  db: string;
  roles: RoleRef[];
  mechanisms: string[];
}

export interface UsersResult {
  users: DbUserInfo[];
  /** forAllDBs was denied: only databases we could query are listed */
  partial: boolean;
  /** the user this connection authenticates as (null if unknown) */
  currentUser: { user: string; db: string } | null;
}

export interface CustomRole {
  role: string;
  db: string;
}

export type BackupStatus = "running" | "completed" | "failed";

export interface BackupSummary {
  id: string;
  connectionId: string;
  connectionName: string;
  database: string;
  name: string;
  description: string | null;
  collections: string[];
  documentCount: number;
  sizeBytes: number;
  status: BackupStatus;
  source: "backup" | "upload";
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface RestoreResult {
  collections: number;
  documents: number;
  skipped: number;
  warnings: string[];
}

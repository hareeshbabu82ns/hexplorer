/* eslint-disable no-unused-vars */

type ScanStatus = "idle" | "scanning" | "hashing" | "error";

type DataFolder = {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  status: ScanStatus;
  statusMessage?: string | null;
  progress?: number;
  lastScanAt?: string | null;
  lastScanDurationMs?: number | null;
  fileCount: number;
  dirCount: number;
  totalSize: number;
  mount?: FolderMountInfo | null;
};

type ExploreFile = {
  id: string;
  folderId: string;
  folderName?: string;
  name: string;
  /** relative to folder root */
  relPath: string;
  dir: string;
  ext: string;
  isDirectory: boolean;
  size: number;
  birthDate: string;
  modifiedDate: string;
  hash?: string | null;
};

type FileSortKey = "name" | "size" | "modifiedDate" | "birthDate" | "ext";

type SearchFilesParams = {
  folderId?: string;
  dir?: string;
  search?: string;
  /** when searching, include sub folders of dir (default true) */
  recursive?: boolean;
  sortBy?: FileSortKey;
  sortOrder?: "asc" | "desc";
  page?: number;
  pageSize?: number;
};

type SearchFilesResult = {
  docs: ExploreFile[];
  total: number;
  page: number;
  pageCount: number;
};

type DuplicateMode = "name-size" | "similar-name-size" | "name" | "content";

type DuplicateScope = { folderId: string; dir?: string };

type DuplicateGroup = {
  key: string;
  size: number;
  count: number;
  /** bytes reclaimable if only one copy kept */
  wasted: number;
  files: ExploreFile[];
};

type DuplicateResult = {
  groups: DuplicateGroup[];
  totalGroups: number;
  totalWasted: number;
  /** content mode only: files of same size that still need hashing */
  unhashedCandidates?: number;
};

type DeleteResult = {
  deleted: number;
  failed: { id: string; relPath?: string; error: string }[];
};

type SshRemote = {
  id: string;
  name: string;
  type: "ssh" | "smb";
  host: string;
  user?: string | null;
  port?: number | null;
  auth: "key" | "password";
  identityFile?: string | null;
  keyId?: string | null;
  keyName?: string | null;
  hasPassword: boolean;
  domain?: string | null;
  smbVersion?: string | null;
};

type RemoteInput = {
  id?: string;
  name?: string;
  type: "ssh" | "smb";
  host: string;
  user?: string | null;
  port?: number | null;
  auth?: "key" | "password";
  identityFile?: string | null;
  /** uploaded ssh key id */
  keyId?: string | null;
  /** plain text, only sent when set/changed; stored encrypted */
  password?: string | null;
  domain?: string | null;
  smbVersion?: string | null;
};

type SshKey = {
  id: string;
  name: string;
  keyType: string;
  bits?: number | null;
  fingerprint: string;
  publicKey: string;
  comment?: string | null;
  createdAt: string;
  usedBy: string[];
};

type FolderMountInfo = {
  remoteId: string;
  remoteName: string;
  remotePath: string;
  idleMinutes: number;
  /** reached over ssh / smbclient without mounting */
  direct: boolean;
  mounted: boolean;
  lastUsedAt?: string | null;
};

type BackupMode = "sync" | "mirror" | "snapshot";

type BackupEndpoint =
  | { kind: "folder"; folderId: string; dir: string }
  | { kind: "remote"; remoteId: string; path: string }
  | { kind: "local"; path: string };

type BackupSchedule = {
  type: "off" | "hourly" | "daily" | "weekly";
  minute: number;
  hour: number;
  weekday: number;
};

type BackupHook = {
  scriptId: string;
  /** remote ids, or "local" for the hexplorer host */
  targets: string[];
  /** values by parameter name; secret values are never sent back (see secretsSet) */
  params: Record<string, string>;
  /** read only: secret parameters that have a stored value (leave empty to keep it) */
  secretsSet?: string[];
  /** read only: script name for display */
  scriptName?: string;
  abortOnFail?: boolean;
  when?: "always" | "success" | "failure";
};

type BackupInput = {
  id?: string;
  name?: string;
  source: BackupEndpoint;
  dest: BackupEndpoint;
  mode: BackupMode;
  exclude?: string;
  rescanDest?: boolean;
  keep?: number | null;
  archive?: "zip" | null;
  intoSubfolder?: boolean;
  preScript?: BackupHook | null;
  postScript?: BackupHook | null;
  schedule?: BackupSchedule | null;
};

type BackupJob = {
  id: string;
  name: string;
  source: BackupEndpoint;
  dest: BackupEndpoint;
  /** human readable "where", e.g. "Photos/2024" or "nas:/volume1/backups" */
  sourceLabel: string;
  destLabel: string;
  mode: BackupMode;
  exclude: string;
  rescanDest: boolean;
  keep: number | null;
  archive: "zip" | null;
  intoSubfolder: boolean;
  /** where the copy lands, e.g. "nas:/backups/Photos" or "Disk/backups/Photos-<timestamp>" */
  targetLabel: string;
  preScript: BackupHook | null;
  postScript: BackupHook | null;
  schedule: BackupSchedule | null;
  nextRunAt: string | null;
  status: "idle" | "running" | "error" | "warning" | "success";
  progress: number | null;
  lastRun: {
    startedAt: string;
    finishedAt: string | null;
    target: string | null;
    message: string | null;
    trigger: string | null;
  } | null;
};

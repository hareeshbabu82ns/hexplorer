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
  mounted: boolean;
  lastUsedAt?: string | null;
};

type BackupMode = "sync" | "mirror" | "snapshot";

type BackupInput = {
  id?: string;
  name?: string;
  sourceFolderId: string;
  sourceDir?: string;
  /** data folder destination (remote mounts work too) … */
  destFolderId?: string | null;
  destDir?: string;
  /** … or an absolute local path */
  destPath?: string | null;
  mode: BackupMode;
  exclude?: string;
  rescanDest?: boolean;
};

type BackupJob = {
  id: string;
  name: string;
  source: { folderId: string; folderName: string; dir: string };
  dest: { folderId: string | null; folderName: string | null; dir: string; path: string | null };
  mode: BackupMode;
  exclude: string;
  rescanDest: boolean;
  status: "idle" | "running" | "error" | "warning" | "success";
  progress: number | null;
  lastRun: {
    startedAt: string;
    finishedAt: string | null;
    target: string | null;
    message: string | null;
  } | null;
};

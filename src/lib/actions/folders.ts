"use server";

import { background } from "@/lib/jobs";
import fs from "fs/promises";
import { collections, FolderDoc, normDir, toObjectId } from "@/lib/db";
import {
  assertFolderOnline,
  hashCandidates,
  isJobRunning,
  resolveFolderPath,
  scanFolder,
} from "@/lib/scanner";
import { isMounted, startIdleReaper, unmountFolder } from "@/lib/mounts";

async function mountInfo(f: FolderDoc): Promise<FolderMountInfo | null> {
  if (!f.mount) return null;
  const { remotes } = await collections();
  const r = await remotes.findOne({ _id: f.mount.remoteId }, { projection: { name: 1 } });
  return {
    remoteId: f.mount.remoteId.toHexString(),
    remoteName: r?.name ?? "(deleted remote)",
    remotePath: f.mount.remotePath,
    idleMinutes: f.mount.idleMinutes,
    mounted: await isMounted(f.path),
    lastUsedAt: f.lastUsedAt?.toISOString() ?? null,
  };
}

function serializeFolder(f: FolderDoc, mount?: FolderMountInfo | null): DataFolder {
  return {
    id: f._id.toHexString(),
    name: f.name,
    path: f.path,
    createdAt: f.createdAt.toISOString(),
    // a status left over from a crashed/restarted server is not really running
    status:
      (f.status === "scanning" || f.status === "hashing") &&
      !isJobRunning(f._id.toHexString())
        ? "error"
        : f.status,
    statusMessage:
      (f.status === "scanning" || f.status === "hashing") &&
      !isJobRunning(f._id.toHexString())
        ? "Job was interrupted (server restarted?) — run it again"
        : f.statusMessage,
    progress: f.progress,
    lastScanAt: f.lastScanAt?.toISOString() ?? null,
    lastScanDurationMs: f.lastScanDurationMs ?? null,
    fileCount: f.fileCount ?? 0,
    dirCount: f.dirCount ?? 0,
    totalSize: f.totalSize ?? 0,
    mount: mount ?? null,
  };
}

/** reads only from the DB — never touches disk, works with shares unmounted */
export async function listFolders(): Promise<DataFolder[]> {
  const { folders } = await collections();
  const docs = await folders.find().sort({ name: 1 }).toArray();
  if (docs.some((d) => d.mount?.idleMinutes)) startIdleReaper();
  return Promise.all(docs.map(async (d) => serializeFolder(d, await mountInfo(d))));
}

export async function addFolder(input: {
  name: string;
  path: string;
  scan?: boolean;
}): Promise<DataFolder> {
  const absPath = resolveFolderPath(input.path);
  const name = input.name.trim() || absPath.split("/").pop() || absPath;
  try {
    const st = await fs.stat(absPath);
    if (!st.isDirectory()) throw new Error();
  } catch {
    throw new Error(`Not an accessible directory: ${absPath}`);
  }
  const { folders } = await collections();
  if (await folders.findOne({ path: absPath })) {
    throw new Error(`Folder already added: ${absPath}`);
  }
  const doc: Omit<FolderDoc, "_id"> = {
    name,
    path: absPath,
    createdAt: new Date(),
    status: input.scan !== false ? "scanning" : "idle",
    fileCount: 0,
    dirCount: 0,
    totalSize: 0,
  };
  const res = await folders.insertOne(doc as FolderDoc);
  const folder = { ...doc, _id: res.insertedId } as FolderDoc;
  if (input.scan !== false) background(scanFolder(folder), "scanFolder");
  return serializeFolder(folder);
}

export async function renameFolder(id: string, name: string) {
  const { folders } = await collections();
  await folders.updateOne({ _id: toObjectId(id) }, { $set: { name: name.trim() } });
}

/** removes the folder and its index from the DB — files on disk are untouched */
export async function removeFolder(id: string) {
  const _id = toObjectId(id);
  if (isJobRunning(id)) throw new Error("A scan is running for this folder");
  const { folders, files } = await collections();
  const folder = await folders.findOne({ _id });
  if (folder?.mount) {
    await unmountFolder(folder);
    await fs.rmdir(folder.path).catch(() => {}); // only removes the empty mount point
  }
  await files.deleteMany({ folderId: _id });
  await folders.deleteOne({ _id });
}

/** set status before the background job starts so pollers never miss it */
async function markBusy(folder: FolderDoc, status: "scanning" | "hashing") {
  const { folders } = await collections();
  await folders.updateOne({ _id: folder._id }, { $set: { status, progress: 0, statusMessage: null } });
}

async function getFolder(id: string) {
  const { folders } = await collections();
  const folder = await folders.findOne({ _id: toObjectId(id) });
  if (!folder) throw new Error("Folder not found");
  return folder;
}

/** starts a background (re)scan of the folder or one of its sub folders; poll listFolders for progress */
export async function startScan(id: string, dirIn = "") {
  const dir = normDir(dirIn); // validate before marking the folder busy
  const folder = await getFolder(id);
  if (isJobRunning(id)) throw new Error("A job is already running for this folder");
  await assertFolderOnline(folder); // fail fast with a clear message
  await markBusy(folder, "scanning");
  background(scanFolder(folder, dir), "scanFolder");
}

/** starts background content hashing of same-size candidates (whole folder or a sub folder) */
export async function startHashing(id: string, dirIn = "") {
  const dir = normDir(dirIn);
  const folder = await getFolder(id);
  if (isJobRunning(id)) throw new Error("A job is already running for this folder");
  await assertFolderOnline(folder);
  await markBusy(folder, "hashing");
  background(hashCandidates(folder, dir), "hashCandidates");
}

/** explicit availability probe (triggers an autofs mount) */
export async function checkFolderOnline(
  id: string,
): Promise<{ online: boolean; message?: string }> {
  const folder = await getFolder(id);
  try {
    await assertFolderOnline(folder);
    return { online: true };
  } catch (e: any) {
    return { online: false, message: e.message };
  }
}

export async function getDbStatus() {
  try {
    const { folders, files } = await collections();
    const [folderCount, fileCount] = await Promise.all([
      folders.countDocuments(),
      files.estimatedDocumentCount(),
    ]);
    return { ok: true as const, folderCount, fileCount };
  } catch (e: any) {
    return { ok: false as const, error: e.message ?? String(e) };
  }
}

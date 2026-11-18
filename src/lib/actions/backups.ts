"use server";

import { background } from "@/lib/jobs";
import path from "path";
import { BackupDoc, collections, normDir, toObjectId } from "@/lib/db";
import { runBackup } from "@/lib/backup";
import { isJobRunning } from "@/lib/jobs";

async function serialize(b: BackupDoc, names: Map<string, string>): Promise<BackupJob> {
  const running = isJobRunning(b._id.toHexString());
  const stale = b.status === "running" && !running;
  return {
    id: b._id.toHexString(),
    name: b.name,
    source: {
      folderId: b.source.folderId.toHexString(),
      folderName: names.get(b.source.folderId.toHexString()) ?? "(deleted)",
      dir: b.source.dir,
    },
    dest: {
      folderId: b.dest.folderId?.toHexString() ?? null,
      folderName: b.dest.folderId ? (names.get(b.dest.folderId.toHexString()) ?? "(deleted)") : null,
      dir: b.dest.dir ?? "",
      path: b.dest.path ?? null,
    },
    mode: b.mode,
    exclude: b.exclude ?? "",
    rescanDest: b.rescanDest,
    status: stale ? "error" : b.status,
    progress: b.progress ?? null,
    lastRun: b.lastRun
      ? {
          startedAt: b.lastRun.startedAt.toISOString(),
          finishedAt: b.lastRun.finishedAt?.toISOString() ?? null,
          target: b.lastRun.target ?? null,
          message: stale ? "Interrupted (server restarted?)" : (b.lastRun.message ?? null),
        }
      : null,
  };
}

export async function listBackups(): Promise<BackupJob[]> {
  const { backups, folders } = await collections();
  const names = new Map(
    (await folders.find({}, { projection: { name: 1 } }).toArray()).map((f) => [
      f._id.toHexString(),
      f.name,
    ]),
  );
  const docs = await backups.find().sort({ createdAt: -1 }).toArray();
  return Promise.all(docs.map((d) => serialize(d, names)));
}

/** create (or update) a backup job; optionally start it right away */
export async function saveBackup(input: BackupInput, runNow = false): Promise<string> {
  const { backups, folders } = await collections();
  const sourceId = toObjectId(input.sourceFolderId);
  const source = await folders.findOne({ _id: sourceId });
  if (!source) throw new Error("Source folder not found");
  const srcDir = normDir(input.sourceDir);

  let dest: BackupDoc["dest"];
  if (input.destFolderId) {
    const d = await folders.findOne({ _id: toObjectId(input.destFolderId) });
    if (!d) throw new Error("Destination folder not found");
    const destDir = normDir(input.destDir);
    if (d._id.equals(sourceId)) {
      const inside = (a: string, b: string) => a === b || a.startsWith(b + "/") || b === "";
      // the job's target is destDir/<name>, which must not be inside the source
      if (inside(destDir, srcDir)) throw new Error("Destination is inside the source");
    }
    dest = { folderId: d._id, dir: destDir, path: null };
  } else {
    const p = input.destPath?.trim();
    if (!p || !path.isAbsolute(p)) throw new Error("Destination path must be absolute");
    dest = { folderId: null, dir: "", path: path.resolve(p) };
  }

  const doc = {
    name:
      input.name?.trim() ||
      `${source.name}${srcDir ? "/" + srcDir : ""} → ${input.destFolderId ? "folder" : dest.path}`,
    source: { folderId: sourceId, dir: srcDir },
    dest,
    mode: (["sync", "mirror", "snapshot"] as const).includes(input.mode) ? input.mode : "sync",
    exclude: input.exclude?.trim() || null,
    rescanDest: input.rescanDest !== false,
  };

  let id: string;
  if (input.id) {
    if (isJobRunning(input.id)) throw new Error("Backup is running");
    await backups.updateOne({ _id: toObjectId(input.id) }, { $set: doc });
    id = input.id;
  } else {
    const res = await backups.insertOne({
      ...doc,
      createdAt: new Date(),
      status: "idle",
      lastRun: null,
    } as unknown as BackupDoc);
    id = res.insertedId.toHexString();
  }
  if (runNow) await runBackupNow(id);
  return id;
}

export async function runBackupNow(id: string) {
  const { backups } = await collections();
  const b = await backups.findOne({ _id: toObjectId(id) });
  if (!b) throw new Error("Backup not found");
  if (isJobRunning(id)) throw new Error("Backup is already running");
  // mark running before returning so pollers see it
  await backups.updateOne({ _id: b._id }, { $set: { status: "running", progress: 0 } });
  background(runBackup(b), "runBackup");
}

export async function deleteBackup(id: string) {
  if (isJobRunning(id)) throw new Error("Backup is running");
  const { backups } = await collections();
  await backups.deleteOne({ _id: toObjectId(id) });
}

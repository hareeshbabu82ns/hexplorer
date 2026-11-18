import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import { BackupDoc, collections, FolderDoc, normDir } from "./db";
import { isJobRunning, runningJobs, holdFolders } from "./jobs";
import { slugify } from "./mounts";
import { assertFolderOnline, safeJoin, scanFolder } from "./scanner";

const isInside = (child: string, parent: string) =>
  child === parent || child.startsWith(parent + path.sep);

function stamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** resolve source + destination to absolute paths (mounting remotes as needed) */
export async function resolveBackupPaths(b: BackupDoc) {
  const { folders } = await collections();
  const source = await folders.findOne({ _id: b.source.folderId });
  if (!source) throw new Error("Source folder no longer exists");
  await assertFolderOnline(source);
  const srcDir = normDir(b.source.dir);
  const srcAbs = safeJoin(source.path, srcDir);
  const st = await fs.stat(srcAbs).catch(() => null);
  if (!st) throw new Error(`Source does not exist on disk: ${source.name}/${srcDir}`);

  let destFolder: FolderDoc | null = null;
  let destRoot: string;
  if (b.dest.folderId) {
    destFolder = await folders.findOne({ _id: b.dest.folderId });
    if (!destFolder) throw new Error("Destination folder no longer exists");
    await assertFolderOnline(destFolder);
    destRoot = safeJoin(destFolder.path, normDir(b.dest.dir));
  } else {
    if (!b.dest.path || !path.isAbsolute(b.dest.path))
      throw new Error("Destination path must be absolute");
    destRoot = path.resolve(b.dest.path);
  }

  const baseName = srcDir ? path.basename(srcAbs) : slugify(source.name);
  const target =
    b.mode === "snapshot"
      ? path.join(destRoot, `${baseName}-${stamp()}`)
      : path.join(destRoot, baseName);

  if (isInside(target, srcAbs)) throw new Error("Destination is inside the source");
  if (isInside(srcAbs, target)) throw new Error("Source is inside the destination");

  return { source, destFolder, srcAbs, isDir: st.isDirectory(), target };
}

function rsync(
  args: string[],
  onProgress: (pct: number) => void,
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("rsync", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let buf = "";
    child.stdout.on("data", (d: Buffer) => {
      buf += d.toString();
      const parts = buf.split(/[\r\n]/);
      buf = parts.pop() ?? "";
      for (const line of parts) {
        const m = line.match(/\s(\d{1,3})%\s/);
        if (m) onProgress(Number(m[1]));
      }
    });
    child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-4000)));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stderr }));
  });
}

/** run a backup job to completion (call without await for background runs) */
export async function runBackup(b: BackupDoc) {
  const id = b._id.toHexString();
  if (runningJobs.has(id)) throw new Error("This backup is already running");
  runningJobs.add(id);
  const { backups } = await collections();
  const startedAt = new Date();
  let release = () => {};
  await backups.updateOne(
    { _id: b._id },
    { $set: { status: "running", progress: 0, lastRun: { startedAt, message: null } } },
  );

  try {
    const { source, destFolder, srcAbs, isDir, target } = await resolveBackupPaths(b);
    release = holdFolders(
      [source._id.toHexString(), destFolder?._id.toHexString()].filter(Boolean) as string[],
    );
    await backups.updateOne({ _id: b._id }, { $set: { "lastRun.target": target } });
    await fs.mkdir(isDir ? target : path.dirname(target), { recursive: true });

    let lastWrite = 0;
    const onProgress = (pct: number) => {
      if (Date.now() - lastWrite < 1000) return;
      lastWrite = Date.now();
      void backups.updateOne({ _id: b._id }, { $set: { progress: pct } });
    };

    // -rt instead of -a: owners/permissions often cannot be set on sshfs/cifs targets
    const args = ["-rt", "--modify-window=2", "--info=progress2", "--no-inc-recursive"];
    if (b.mode === "mirror") args.push("--delete");
    for (const ex of (b.exclude ?? "").split(",").map((e) => e.trim()).filter(Boolean))
      args.push("--exclude", ex);
    args.push(isDir ? srcAbs + "/" : srcAbs, isDir ? target + "/" : target);

    let status: BackupDoc["status"] = "success";
    let message: string | null = null;
    try {
      const { code, stderr } = await rsync(args, onProgress);
      if (code === 23 || code === 24) {
        status = "warning";
        message = `Some files were skipped (rsync ${code}): ${stderr.trim().split("\n").slice(-3).join(" | ")}`;
      } else if (code !== 0) {
        throw new Error(`rsync failed (${code}): ${stderr.trim().split("\n").slice(-3).join(" | ")}`);
      }
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
      // rsync not installed: plain recursive copy
      await fs.cp(srcAbs, target, { recursive: true, force: true, preserveTimestamps: true });
      if (b.mode === "mirror") {
        status = "warning";
        message = "rsync not installed: copied files but could not delete extras (mirror)";
      }
    }

    release();
    if (destFolder && b.rescanDest) {
      const rel = path.relative(destFolder.path, target).split(path.sep).join("/");
      try {
        if (!isJobRunning(destFolder._id.toHexString())) await scanFolder(destFolder, rel);
      } catch (e: any) {
        message = [message, `destination rescan failed: ${e.message}`].filter(Boolean).join("; ");
      }
    }

    await backups.updateOne(
      { _id: b._id },
      {
        $set: {
          status,
          progress: 100,
          "lastRun.finishedAt": new Date(),
          "lastRun.message": message,
        },
      },
    );
    console.log(`backup ${b.name}: ${status} -> ${target}`);
  } catch (e: any) {
    console.error("backup failed", b.name, e);
    await backups.updateOne(
      { _id: b._id },
      {
        $set: {
          status: "error",
          "lastRun.finishedAt": new Date(),
          "lastRun.message": e.message ?? String(e),
        },
      },
    );
  } finally {
    release();
    runningJobs.delete(id);
  }
}

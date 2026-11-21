import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import {
  BackupDoc,
  BackupEndpointDoc,
  BackupScheduleDoc,
  collections,
  FolderDoc,
  LegacyBackupEndpoint,
  normDir,
} from "./db";
import { zipTo } from "./backup-zip";
import { isDirect } from "./folder-fs";
import { holdFolders, isJobRunning, runningJobs } from "./jobs";
import { isMounted, mountRemoteAt, mountsRoot, mountTypeFor, slugify, unmountPath } from "./mounts";
import { assertFolderOnline, safeJoin, scanFolder } from "./scanner";

const isInside = (child: string, parent: string) =>
  child === parent || child.startsWith(parent + path.sep);

function stamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** read an endpoint, upgrading pre-endpoint docs ({folderId, dir} / {path}) */
export function normEndpoint(e: BackupEndpointDoc | LegacyBackupEndpoint): BackupEndpointDoc {
  if (e.kind) return e;
  if (e.folderId) return { kind: "folder", folderId: e.folderId, dir: normDir(e.dir ?? "") };
  return { kind: "local", path: e.path ?? "" };
}

/** normalise a remote path: ssh "" = home, smb always starts with / */
export function normRemotePath(p: string, smb: boolean) {
  const t = p.trim().replace(/\/+$/, "");
  if (smb) return "/" + t.split("/").filter(Boolean).join("/");
  return t;
}

/* -------------------------------- schedule -------------------------------- */

const clamp = (n: unknown, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, Math.floor(Number(n) || 0)));

export function normSchedule(s: Partial<BackupScheduleDoc> | null | undefined): BackupScheduleDoc | null {
  if (!s || !s.type || s.type === "off") return null;
  if (!["hourly", "daily", "weekly"].includes(s.type)) return null;
  return {
    type: s.type,
    minute: clamp(s.minute, 0, 59),
    hour: clamp(s.hour, 0, 23),
    weekday: clamp(s.weekday, 0, 6),
  };
}

/** next time (server local time) strictly after `from` that matches the schedule */
export function nextRunAfter(s: BackupScheduleDoc | null | undefined, from = new Date()): Date | null {
  if (!s || s.type === "off") return null;
  const d = new Date(from);
  d.setSeconds(0, 0);
  if (s.type === "hourly") {
    d.setMinutes(s.minute);
    if (d <= from) d.setHours(d.getHours() + 1);
    return d;
  }
  d.setHours(s.hour, s.minute, 0, 0);
  if (s.type === "daily") {
    if (d <= from) d.setDate(d.getDate() + 1);
    return d;
  }
  d.setDate(d.getDate() + ((s.weekday - d.getDay() + 7) % 7));
  if (d <= from) d.setDate(d.getDate() + 7);
  return d;
}

/* -------------------------------- endpoints ------------------------------- */

type Resolved = {
  /** absolute local path (for remotes: inside the temporary mount) */
  abs: string;
  folder: FolderDoc | null;
  /** folder endpoints: the sub dir inside the folder */
  folderDir: string;
  /** last path segment used to name the copy */
  baseName: string;
  cleanup: () => Promise<void>;
};

const noop = async () => {};

/** temporary mount point for a remote endpoint of a backup job */
function backupMountPoint(backupId: string, role: "src" | "dest") {
  return path.join(/*turbopackIgnore: true*/ mountsRoot(), ".backups", `${backupId}-${role}`);
}

async function resolveEndpoint(
  ep: BackupEndpointDoc,
  role: "src" | "dest",
  backupId: string,
): Promise<Resolved> {
  const { folders, remotes } = await collections();
  if (ep.kind === "folder") {
    const folder = await folders.findOne({ _id: ep.folderId });
    if (!folder) throw new Error(`${role === "src" ? "Source" : "Destination"} folder no longer exists`);
    const dir = normDir(ep.dir);
    const baseName = dir ? path.posix.basename(dir) : slugify(folder.name);
    if (isDirect(folder)) {
      // direct (unmounted) folder: rsync needs a path, so mount the remote just for this run
      const remotePath = path.posix.join(folder.mount!.remotePath || ".", dir).replace(/^\.\/?/, "");
      const r = await resolveEndpoint({ kind: "remote", remoteId: folder.mount!.remoteId, path: remotePath }, role, backupId);
      return { ...r, folder, folderDir: dir, baseName };
    }
    await assertFolderOnline(folder);
    return { abs: safeJoin(folder.path, dir), folder, folderDir: dir, baseName, cleanup: noop };
  }
  if (ep.kind === "local") {
    if (!ep.path || !path.isAbsolute(ep.path))
      throw new Error(`${role === "src" ? "Source" : "Destination"} path must be absolute`);
    const abs = path.resolve(/*turbopackIgnore: true*/ ep.path);
    return { abs, folder: null, folderDir: "", baseName: path.basename(abs) || "root", cleanup: noop };
  }
  const remote = await remotes.findOne({ _id: ep.remoteId });
  if (!remote) throw new Error(`${role === "src" ? "Source" : "Destination"} remote no longer exists`);
  const type = mountTypeFor(remote);
  const mp = backupMountPoint(backupId, role);
  // leftover from a crashed run
  await unmountPath(mp, type).catch(() => {});
  await mountRemoteAt(remote, ep.path, mp);
  const cleanup = async () => {
    try {
      await unmountPath(mp, type);
      if (!(await isMounted(mp))) await fs.rmdir(mp).catch(() => {});
    } catch (e: any) {
      console.warn(`backup: could not unmount ${mp}: ${e.message}`);
    }
  };
  const seg = ep.path.split("/").filter(Boolean).pop();
  return { abs: mp, folder: null, folderDir: "", baseName: seg || slugify(remote.name), cleanup };
}

/** human readable endpoint, e.g. "Photos/2024", "nas:/volume1/backup", "/media/usb" */
export function endpointLabel(
  ep: BackupEndpointDoc,
  names: { folders: Map<string, string>; remotes: Map<string, string> },
) {
  if (ep.kind === "folder")
    return `${names.folders.get(ep.folderId.toHexString()) ?? "(deleted folder)"}/${ep.dir}`;
  if (ep.kind === "remote")
    return `${names.remotes.get(ep.remoteId.toHexString()) ?? "(deleted remote)"}:${ep.path || "~"}`;
  return ep.path;
}

/* ---------------------------------- rsync --------------------------------- */

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

function fmtBytes(n: number) {
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** delete the oldest `<baseName>-YYYYMMDD-HHMMSS[.zip]` snapshots beyond `keep`; returns how many */
async function pruneSnapshots(destRoot: string, baseName: string, keep: number) {
  const re = new RegExp(`^${escapeRe(baseName)}-(\\d{8}-\\d{6})(\\.zip)?$`);
  // newest first by timestamp, whether a folder or a zip
  const snaps = (await fs.readdir(destRoot))
    .filter((n) => re.test(n))
    .sort((a, b) => re.exec(b)![1].localeCompare(re.exec(a)![1]));
  const old = snaps.slice(keep);
  for (const n of old)
    await fs.rm(path.join(/*turbopackIgnore: true*/ destRoot, n), { recursive: true, force: true });
  return old.length;
}

/* ----------------------------------- run ---------------------------------- */

/** run a backup job to completion (call without await for background runs) */
export async function runBackup(b: BackupDoc, trigger: "manual" | "schedule" = "manual") {
  const id = b._id.toHexString();
  if (runningJobs.has(id)) throw new Error("This backup is already running");
  runningJobs.add(id);
  const { backups } = await collections();
  const startedAt = new Date();
  let release = () => {};
  const cleanups: (() => Promise<void>)[] = [];
  await backups.updateOne(
    { _id: b._id },
    { $set: { status: "running", progress: 0, lastRun: { startedAt, message: null, trigger } } },
  );

  try {
    const srcEp = normEndpoint(b.source);
    const destEp = normEndpoint(b.dest);
    const src = await resolveEndpoint(srcEp, "src", id);
    cleanups.push(src.cleanup);
    const dest = await resolveEndpoint(destEp, "dest", id);
    cleanups.push(dest.cleanup);
    release = holdFolders(
      [src.folder?._id.toHexString(), dest.folder?._id.toHexString()].filter(Boolean) as string[],
    );

    const st = await fs.stat(src.abs).catch(() => null);
    if (!st) throw new Error(`Source does not exist: ${src.abs}`);
    const isDir = st.isDirectory();
    const destRoot = dest.abs;
    const asZip = b.mode === "snapshot" && b.archive === "zip";
    const target =
      b.mode === "snapshot"
        ? path.join(/*turbopackIgnore: true*/ destRoot, `${src.baseName}-${stamp()}${asZip ? ".zip" : ""}`)
        : path.join(/*turbopackIgnore: true*/ destRoot, src.baseName);
    if (srcEp.kind !== "remote" && destEp.kind !== "remote") {
      if (isInside(target, src.abs)) throw new Error("Destination is inside the source");
      if (isInside(src.abs, target)) throw new Error("Source is inside the destination");
    }

    await backups.updateOne({ _id: b._id }, { $set: { "lastRun.target": target } });
    await fs.mkdir(isDir && !asZip ? target : path.dirname(target), { recursive: true });

    let lastWrite = 0;
    const onProgress = (pct: number) => {
      if (Date.now() - lastWrite < 1000) return;
      lastWrite = Date.now();
      void backups.updateOne({ _id: b._id }, { $set: { progress: pct } });
    };

    const excludes = (b.exclude ?? "").split(",").map((e) => e.trim()).filter(Boolean);
    let status: BackupDoc["status"] = "success";
    const messages: string[] = [];
    if (asZip) {
      const r = await zipTo(src.abs, isDir, target, excludes, onProgress);
      messages.push(`zipped ${r.files} file(s), ${fmtBytes(r.bytes)} → ${fmtBytes(r.zipBytes)}`);
      if (r.skipped) messages.push(`skipped ${r.skipped} symlink(s)/special file(s)`);
    } else try {
      // -rt instead of -a: owners/permissions often cannot be set on sshfs/cifs targets
      const args = ["-rt", "--modify-window=2", "--info=progress2", "--no-inc-recursive"];
      if (b.mode === "mirror") args.push("--delete");
      for (const ex of excludes) args.push("--exclude", ex);
      args.push(isDir ? src.abs + "/" : src.abs, isDir ? target + "/" : target);
      const { code, stderr } = await rsync(args, onProgress);
      if (code === 23 || code === 24) {
        status = "warning";
        messages.push(
          `Some files were skipped (rsync ${code}): ${stderr.trim().split("\n").slice(-3).join(" | ")}`,
        );
      } else if (code !== 0) {
        throw new Error(`rsync failed (${code}): ${stderr.trim().split("\n").slice(-3).join(" | ")}`);
      }
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
      // rsync not installed: plain recursive copy
      await fs.cp(src.abs, target, { recursive: true, force: true, preserveTimestamps: true });
      if (b.mode === "mirror") {
        status = "warning";
        messages.push("rsync not installed: copied files but could not delete extras (mirror)");
      }
    }

    let pruned = 0;
    if (b.mode === "snapshot" && b.keep && b.keep > 0) {
      try {
        pruned = await pruneSnapshots(destRoot, src.baseName, b.keep);
        if (pruned) messages.push(`removed ${pruned} old snapshot(s)`);
      } catch (e: any) {
        status = status === "success" ? "warning" : status;
        messages.push(`snapshot cleanup failed: ${e.message}`);
      }
    }

    release();
    if (dest.folder && b.rescanDest) {
      // after pruning (or for a zip file), rescan the snapshot parent so the index matches
      const rel = pruned || asZip ? dest.folderDir : path.posix.join(dest.folderDir, path.basename(target));
      try {
        if (!isJobRunning(dest.folder._id.toHexString())) await scanFolder(dest.folder, rel);
      } catch (e: any) {
        messages.push(`destination rescan failed: ${e.message}`);
      }
    }

    await backups.updateOne(
      { _id: b._id },
      {
        $set: {
          status,
          progress: 100,
          "lastRun.finishedAt": new Date(),
          "lastRun.message": messages.join("; ") || null,
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
    for (const c of cleanups.reverse()) await c();
    runningJobs.delete(id);
  }
}

/* -------------------------------- scheduler ------------------------------- */

const g = globalThis as unknown as { _hexBackupTimer?: NodeJS.Timeout };

/** start a background job that runs scheduled backups when they are due (idempotent) */
export function startBackupScheduler() {
  if (g._hexBackupTimer) return;
  const tick = async () => {
    try {
      const { backups } = await collections();
      const now = new Date();
      const due = await backups
        .find({ "schedule.type": { $in: ["hourly", "daily", "weekly"] }, nextRunAt: { $lte: now } })
        .toArray();
      for (const b of due) {
        const next = nextRunAfter(b.schedule, now);
        // claim the slot first so a slow run (or a second instance) does not fire twice
        const claimed = await backups.updateOne(
          { _id: b._id, nextRunAt: b.nextRunAt },
          { $set: { nextRunAt: next } },
        );
        if (!claimed.modifiedCount) continue;
        if (isJobRunning(b._id.toHexString())) {
          console.log(`backup ${b.name}: skipped scheduled run, previous run still active`);
          continue;
        }
        console.log(`backup ${b.name}: scheduled run`);
        runBackup(b, "schedule").catch((e) => console.error("scheduled backup failed", b.name, e));
      }
    } catch (e) {
      console.warn("backup scheduler error", e);
    }
  };
  g._hexBackupTimer = setInterval(tick, 30_000);
  g._hexBackupTimer.unref?.();
  void tick();
}

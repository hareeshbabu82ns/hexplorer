"use server";

import path from "path";
import { BackupDoc, BackupEndpointDoc, collections, normDir, toObjectId } from "@/lib/db";
import {
  endpointLabel,
  nextRunAfter,
  normEndpoint,
  normRemotePath,
  normSchedule,
  runBackup,
  startBackupScheduler,
} from "@/lib/backup";
import { background, isJobRunning } from "@/lib/jobs";

type Names = { folders: Map<string, string>; remotes: Map<string, string> };

function serializeEndpoint(ep: BackupEndpointDoc): BackupEndpoint {
  if (ep.kind === "folder") return { kind: "folder", folderId: ep.folderId.toHexString(), dir: ep.dir };
  if (ep.kind === "remote") return { kind: "remote", remoteId: ep.remoteId.toHexString(), path: ep.path };
  return { kind: "local", path: ep.path };
}

function serialize(b: BackupDoc, names: Names): BackupJob {
  const running = isJobRunning(b._id.toHexString());
  const stale = b.status === "running" && !running;
  const source = normEndpoint(b.source);
  const dest = normEndpoint(b.dest);
  return {
    id: b._id.toHexString(),
    name: b.name,
    source: serializeEndpoint(source),
    dest: serializeEndpoint(dest),
    sourceLabel: endpointLabel(source, names),
    destLabel: endpointLabel(dest, names),
    mode: b.mode,
    exclude: b.exclude ?? "",
    rescanDest: b.rescanDest,
    keep: b.keep ?? null,
    archive: b.mode === "snapshot" && b.archive === "zip" ? "zip" : null,
    schedule: b.schedule ?? null,
    nextRunAt: b.schedule ? (b.nextRunAt?.toISOString() ?? null) : null,
    status: stale ? "error" : b.status,
    progress: b.progress ?? null,
    lastRun: b.lastRun
      ? {
          startedAt: b.lastRun.startedAt.toISOString(),
          finishedAt: b.lastRun.finishedAt?.toISOString() ?? null,
          target: b.lastRun.target ?? null,
          message: stale ? "Interrupted (server restarted?)" : (b.lastRun.message ?? null),
          trigger: b.lastRun.trigger ?? null,
        }
      : null,
  };
}

async function loadNames(): Promise<Names> {
  const { folders, remotes } = await collections();
  const [f, r] = await Promise.all([
    folders.find({}, { projection: { name: 1 } }).toArray(),
    remotes.find({}, { projection: { name: 1 } }).toArray(),
  ]);
  return {
    folders: new Map(f.map((x) => [x._id.toHexString(), x.name])),
    remotes: new Map(r.map((x) => [x._id.toHexString(), x.name])),
  };
}

export async function listBackups(): Promise<BackupJob[]> {
  startBackupScheduler(); // normally started by instrumentation; harmless if already running
  const { backups } = await collections();
  const [names, docs] = await Promise.all([loadNames(), backups.find().sort({ createdAt: -1 }).toArray()]);
  return docs.map((d) => serialize(d, names));
}

/** validate a client endpoint and convert it to its stored form */
async function parseEndpoint(ep: BackupEndpoint, role: "Source" | "Destination"): Promise<BackupEndpointDoc> {
  const { folders, remotes } = await collections();
  if (ep?.kind === "folder") {
    const f = await folders.findOne({ _id: toObjectId(ep.folderId) });
    if (!f) throw new Error(`${role} folder not found`);
    return { kind: "folder", folderId: f._id, dir: normDir(ep.dir ?? "") };
  }
  if (ep?.kind === "remote") {
    const r = await remotes.findOne({ _id: toObjectId(ep.remoteId) });
    if (!r) throw new Error(`${role} remote not found`);
    const smb = r.type === "smb";
    const p = normRemotePath(ep.path ?? "", smb);
    if (smb && p === "/") throw new Error(`${role}: pick a share (and optionally a folder) on ${r.name}`);
    return { kind: "remote", remoteId: r._id, path: p };
  }
  if (ep?.kind === "local") {
    const p = ep.path?.trim();
    if (!p || !path.isAbsolute(p)) throw new Error(`${role} path must be absolute`);
    return { kind: "local", path: path.resolve(/*turbopackIgnore: true*/ p) };
  }
  throw new Error(`${role} is missing`);
}

/** the job writes to dest/<name>; reject setups where that lands inside the source */
function assertNoOverlap(src: BackupEndpointDoc, dest: BackupEndpointDoc) {
  const inside = (a: string, b: string) => b === "" || a === b || a.startsWith(b + "/");
  let a: string | null = null;
  let b: string | null = null;
  if (src.kind === "folder" && dest.kind === "folder" && src.folderId.equals(dest.folderId))
    [a, b] = [dest.dir, src.dir];
  else if (src.kind === "remote" && dest.kind === "remote" && src.remoteId.equals(dest.remoteId))
    [a, b] = [dest.path.replace(/^\/+/, ""), src.path.replace(/^\/+/, "")];
  else if (src.kind === "local" && dest.kind === "local")
    [a, b] = [dest.path.replace(/^\/+/, ""), src.path.replace(/^\/+/, "")];
  if (a !== null && b !== null && inside(a, b)) throw new Error("Destination is inside the source");
}

/** create (or update) a backup job; optionally start it right away */
export async function saveBackup(input: BackupInput, runNow = false): Promise<string> {
  const { backups } = await collections();
  const source = await parseEndpoint(input.source, "Source");
  const dest = await parseEndpoint(input.dest, "Destination");
  assertNoOverlap(source, dest);

  const names = await loadNames();
  const mode = (["sync", "mirror", "snapshot"] as const).includes(input.mode) ? input.mode : "sync";
  const schedule = normSchedule(input.schedule);
  const keep = mode === "snapshot" ? Math.max(0, Math.floor(Number(input.keep) || 0)) || null : null;
  const doc = {
    name: input.name?.trim() || `${endpointLabel(source, names)} → ${endpointLabel(dest, names)}`,
    source,
    dest,
    mode,
    exclude: input.exclude?.trim() || null,
    rescanDest: input.rescanDest !== false,
    keep,
    archive: mode === "snapshot" && input.archive === "zip" ? ("zip" as const) : null,
    schedule,
    nextRunAt: nextRunAfter(schedule),
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
  if (schedule) startBackupScheduler();
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
  background(runBackup(b, "manual"), "runBackup");
}

/** pause / resume a job's schedule without editing it */
export async function setBackupScheduleEnabled(id: string, enabled: boolean) {
  const { backups } = await collections();
  const b = await backups.findOne({ _id: toObjectId(id) });
  if (!b?.schedule) throw new Error("This job has no schedule");
  await backups.updateOne({ _id: b._id }, { $set: { nextRunAt: enabled ? nextRunAfter(b.schedule) : null } });
  if (enabled) startBackupScheduler();
}

export async function deleteBackup(id: string) {
  if (isJobRunning(id)) throw new Error("Backup is running");
  const { backups } = await collections();
  await backups.deleteOne({ _id: toObjectId(id) });
}

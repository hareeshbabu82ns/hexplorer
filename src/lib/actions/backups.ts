"use server";

import fs from "fs/promises";
import path from "path";
import { ObjectId } from "mongodb";
import { BackupDoc, BackupEndpointDoc, BackupHookDoc, collections, getDb, normDir, toObjectId } from "@/lib/db";
import { loadScript } from "@/lib/commands/headless";
import { LOCAL_TARGET } from "@/lib/commands/runner";
import { encryptSecret } from "@/lib/secrets";
import {
  endpointBaseName,
  endpointLabel,
  nextRunAfter,
  normEndpoint,
  normRemotePath,
  normSchedule,
  runBackup,
  startBackupScheduler,
  usesSubfolder,
} from "@/lib/backup";
import { isDirect, safeRel } from "@/lib/folder-fs";
import { background, isJobRunning } from "@/lib/jobs";
import { ensureMounted, listRemoteDir } from "@/lib/mounts";
import { safeJoin } from "@/lib/scanner";

type Names = { folders: Map<string, string>; remotes: Map<string, string>; scripts: Map<string, string> };

function serializeEndpoint(ep: BackupEndpointDoc): BackupEndpoint {
  if (ep.kind === "folder") return { kind: "folder", folderId: ep.folderId.toHexString(), dir: ep.dir };
  if (ep.kind === "remote") return { kind: "remote", remoteId: ep.remoteId.toHexString(), path: ep.path };
  return { kind: "local", path: ep.path };
}

function serializeHook(h: BackupHookDoc | null | undefined, names: Names): BackupHook | null {
  if (!h?.scriptId) return null;
  const id = h.scriptId.toHexString();
  return {
    scriptId: id,
    scriptName: names.scripts.get(id) ?? "(deleted script)",
    targets: h.targets ?? [],
    params: h.params ?? {},
    secretsSet: Object.keys(h.secretsEnc ?? {}),
    abortOnFail: h.abortOnFail,
    when: h.when,
  };
}

/** where a job writes: dest itself, dest/<name>, or dest/<name>-<timestamp> */
function targetLabel(b: Pick<BackupDoc, "mode" | "intoSubfolder" | "archive">, source: BackupEndpointDoc, dest: BackupEndpointDoc, names: Names) {
  const d = endpointLabel(dest, names).replace(/\/+$/, "");
  if (!usesSubfolder(b)) return d;
  const name = endpointBaseName(source, names);
  if (b.mode !== "snapshot") return `${d}/${name}`;
  return `${d}/${name}-<timestamp>${b.archive === "zip" ? ".zip" : ""}`;
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
    intoSubfolder: usesSubfolder(b),
    targetLabel: targetLabel(b, source, dest, names),
    preScript: serializeHook(b.preScript, names),
    postScript: serializeHook(b.postScript, names),
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
  const db = await getDb();
  const [f, r, sc] = await Promise.all([
    folders.find({}, { projection: { name: 1 } }).toArray(),
    remotes.find({}, { projection: { name: 1 } }).toArray(),
    db.collection<{ _id: ObjectId; name: string }>("command_scripts").find({}, { projection: { name: 1 } }).toArray(),
  ]);
  return {
    folders: new Map(f.map((x) => [x._id.toHexString(), x.name])),
    remotes: new Map(r.map((x) => [x._id.toHexString(), x.name])),
    scripts: new Map(sc.map((x) => [x._id.toHexString(), x.name])),
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

/**
 * reject a destination inside the source; when the contents go straight into
 * dest, also reject a source inside dest (mirror would delete the source)
 */
function assertNoOverlap(src: BackupEndpointDoc, dest: BackupEndpointDoc, direct: boolean) {
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
  if (direct && a !== null && b !== null && inside(b, a))
    throw new Error("Source is inside the destination — pick a different destination or copy into a sub folder");
}

/** validate a pre / post script; no script = none. Empty secret values keep the stored ones. */
async function parseHook(
  h: BackupHook | null | undefined,
  kind: "pre" | "post",
  prev: BackupHookDoc | null | undefined,
): Promise<BackupHookDoc | null> {
  if (!h?.scriptId) return null;
  const what = kind === "pre" ? "Pre-backup script" : "Post-backup script";
  const script = await loadScript(h.scriptId);
  if (!script) throw new Error(`${what}: script not found`);
  const defs = script.params ?? [];
  const { remotes } = await collections();
  const ids = [...new Set(h.targets ?? [])];
  if (!ids.length) throw new Error(`${what}: pick where to run “${script.name}”`);
  const remoteIds = ids.filter((id) => id !== LOCAL_TARGET);
  const found = await remotes
    .find({ _id: { $in: remoteIds.map(toObjectId) }, $or: [{ type: "ssh" }, { type: { $exists: false } }] })
    .toArray();
  if (found.length !== remoteIds.length) throw new Error(`${what}: some targets are missing or not SSH remotes`);

  const params: Record<string, string> = {};
  const secretsEnc: Record<string, string> = {};
  const samePrev = prev?.scriptId?.toHexString() === script._id.toHexString();
  for (const p of defs) {
    const v = h.params?.[p.name] ?? "";
    if (p.type === "secret") {
      if (v) secretsEnc[p.name] = encryptSecret(v);
      else if (samePrev && prev?.secretsEnc?.[p.name]) secretsEnc[p.name] = prev.secretsEnc[p.name];
      else if (p.required) throw new Error(`${what}: “${p.label || p.name}” is required`);
      continue;
    }
    const val = v || p.default || "";
    if (p.required && !val) throw new Error(`${what}: “${p.label || p.name}” is required`);
    if (p.type === "select" && val && p.options?.length && !p.options.includes(val) && !/\{\w+\}/.test(val))
      throw new Error(`${what}: “${val}” is not an option of ${p.label || p.name}`);
    params[p.name] = val;
  }
  const doc: BackupHookDoc = { scriptId: script._id, targets: ids, params };
  if (Object.keys(secretsEnc).length) doc.secretsEnc = secretsEnc;
  if (kind === "pre") doc.abortOnFail = h.abortOnFail !== false;
  else doc.when = h.when === "success" || h.when === "failure" ? h.when : "always";
  return doc;
}

/** create (or update) a backup job; optionally start it right away */
export async function saveBackup(input: BackupInput, runNow = false): Promise<string> {
  const { backups } = await collections();
  const source = await parseEndpoint(input.source, "Source");
  const dest = await parseEndpoint(input.dest, "Destination");
  const mode = (["sync", "mirror", "snapshot"] as const).includes(input.mode) ? input.mode : "sync";
  const intoSubfolder = mode === "snapshot" || input.intoSubfolder !== false;
  assertNoOverlap(source, dest, !intoSubfolder);

  const names = await loadNames();
  const prev = input.id ? await backups.findOne({ _id: toObjectId(input.id) }) : null;
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
    intoSubfolder,
    preScript: await parseHook(input.preScript, "pre", prev?.preScript),
    postScript: await parseHook(input.postScript, "post", prev?.postScript),
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

/**
 * copy a job as "<name> (copy)": same settings, scripts and stored secrets, never run,
 * schedule kept but paused so the copy does not start until it is resumed
 */
export async function duplicateBackup(id: string): Promise<string> {
  const { backups } = await collections();
  const src = await backups.findOne({ _id: toObjectId(id) });
  if (!src) throw new Error("Backup not found");
  const base = src.name.replace(/ \(copy(?: \d+)?\)$/, "");
  const taken = new Set((await backups.find({}, { projection: { name: 1 } }).toArray()).map((d) => d.name));
  let name = `${base} (copy)`;
  for (let n = 2; taken.has(name); n++) name = `${base} (copy ${n})`;
  const { _id: _omit, lastRun: _lr, progress: _p, ...rest } = src;
  const res = await backups.insertOne({
    ...rest,
    name,
    status: "idle",
    lastRun: null,
    nextRunAt: null,
    createdAt: new Date(),
  } as unknown as BackupDoc);
  return res.insertedId.toHexString();
}

export async function deleteBackup(id: string) {
  if (isJobRunning(id)) throw new Error("Backup is running");
  const { backups } = await collections();
  await backups.deleteOne({ _id: toObjectId(id) });
}

/* --------------------------------- browse --------------------------------- */

type DirListing = { path: string; dirs: string[] };
type BrowseResult = { ok: true; data: DirListing } | { ok: false; error: string };

async function attemptBrowse(fn: () => Promise<DirListing>): Promise<BrowseResult> {
  try {
    return { ok: true, data: await fn() };
  } catch (e: any) {
    return { ok: false, error: (e?.message || String(e)).trim() };
  }
}

const sortNames = (a: string[]) => a.sort((x, y) => x.localeCompare(y, undefined, { sensitivity: "base" }));

/** sub folders of `dir` inside a data folder (direct folders are listed without mounting) */
export async function browseFolderDir(folderId: string, dir: string): Promise<BrowseResult> {
  return attemptBrowse(async () => {
    const { folders, remotes } = await collections();
    const folder = await folders.findOne({ _id: toObjectId(folderId) });
    if (!folder) throw new Error("Folder not found");
    const rel = normDir(dir);
    if (isDirect(folder)) {
      const remote = await remotes.findOne({ _id: folder.mount!.remoteId });
      if (!remote) throw new Error("Remote for this folder no longer exists");
      const remotePath = path.posix.join(folder.mount!.remotePath || ".", safeRel(rel)).replace(/^\.(\/|$)/, "");
      const r = await listRemoteDir(remote, remotePath);
      return { path: rel, dirs: sortNames(r.entries.filter((e) => e.isDirectory).map((e) => e.name)) };
    }
    if (folder.mount) await ensureMounted(folder);
    const list = await fs.readdir(safeJoin(folder.path, rel), { withFileTypes: true });
    return { path: rel, dirs: sortNames(list.filter((d) => d.isDirectory()).map((d) => d.name)) };
  });
}

/** sub folders of an absolute path on the server */
export async function browseLocalDir(p: string): Promise<BrowseResult> {
  return attemptBrowse(async () => {
    const abs = path.resolve(/*turbopackIgnore: true*/ "/", p || "/");
    const list = await fs.readdir(abs, { withFileTypes: true });
    return { path: abs, dirs: sortNames(list.filter((d) => d.isDirectory()).map((d) => d.name)) };
  });
}

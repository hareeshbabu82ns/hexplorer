import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import {
  BackupDoc,
  BackupEndpointDoc,
  BackupHookDoc,
  BackupScheduleDoc,
  collections,
  FolderDoc,
  LegacyBackupEndpoint,
  normDir,
  RemoteDoc,
} from "./db";
import { excludeMatcher, zipTo } from "./backup-zip";
import { loadScript, runScriptHeadless } from "./commands/headless";
import { decryptSecret } from "./secrets";
import { FsEntry, isDirect, remoteFs } from "./folder-fs";
import { holdFolders, isJobRunning, runningJobs } from "./jobs";
import {
  isMounted,
  mountRemoteAt,
  mountsRoot,
  mountTypeFor,
  rsyncSsh,
  run as runCmd,
  shq,
  slugify,
  splitSmbPath,
  sshCommand,
  unmountPath,
} from "./mounts";
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

/** where an endpoint lives: a local path, or a direct (unmounted) remote path */
type Loc =
  | { kind: "local"; abs: string }
  /** root: remote path (ssh: "" = home, relative = from home; smb: /share/sub) */
  | { kind: "ssh" | "smb"; remote: RemoteDoc; root: string };

type Resolved = {
  loc: Loc;
  folder: FolderDoc | null;
  /** folder endpoints: the sub dir inside the folder */
  folderDir: string;
  /** last path segment used to name the copy */
  baseName: string;
  cleanup: () => Promise<void>;
};

const noop = async () => {};

/** temporary mount point / staging dir of a backup job */
function backupWorkDir(backupId: string, role: string) {
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
      // direct folder: never mounted; rsync over ssh / smbclient talk to the remote
      const remote = await remotes.findOne({ _id: folder.mount!.remoteId });
      if (!remote) throw new Error(`Remote of folder ${folder.name} no longer exists`);
      const root = path.posix.join(folder.mount!.remotePath || ".", dir).replace(/^\.(\/|$)/, "");
      const kind = remote.type === "smb" ? "smb" : "ssh";
      return { loc: { kind, remote, root }, folder, folderDir: dir, baseName, cleanup: noop };
    }
    await assertFolderOnline(folder);
    return { loc: { kind: "local", abs: safeJoin(folder.path, dir) }, folder, folderDir: dir, baseName, cleanup: noop };
  }
  if (ep.kind === "local") {
    if (!ep.path || !path.isAbsolute(ep.path))
      throw new Error(`${role === "src" ? "Source" : "Destination"} path must be absolute`);
    const abs = path.resolve(/*turbopackIgnore: true*/ ep.path);
    return { loc: { kind: "local", abs }, folder: null, folderDir: "", baseName: path.basename(abs) || "root", cleanup: noop };
  }
  const remote = await remotes.findOne({ _id: ep.remoteId });
  if (!remote) throw new Error(`${role === "src" ? "Source" : "Destination"} remote no longer exists`);
  const type = mountTypeFor(remote);
  const mp = backupWorkDir(backupId, role);
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
  return { loc: { kind: "local", abs: mp }, folder: null, folderDir: "", baseName: seg || slugify(remote.name), cleanup };
}

/* ------------------------------ loc helpers ------------------------------- */

/** ssh paths: "~" / "~/x" → relative to home */
const sshRel = (p: string) => p.replace(/^~(\/|$)/, "");

function joinLoc(loc: Loc, name: string): Loc {
  if (loc.kind === "local") return { kind: "local", abs: path.join(/*turbopackIgnore: true*/ loc.abs, name) };
  return { ...loc, root: loc.root ? path.posix.join(loc.root, name) : name };
}

/** split a remote loc into (parent loc, base name); null for a root that has no parent */
function splitRemote(loc: Extract<Loc, { root: string }>) {
  const root = loc.kind === "ssh" ? sshRel(loc.root) : loc.root;
  const base = path.posix.basename(root);
  if (!base || (loc.kind === "smb" && !splitSmbPath(root)[1])) return null;
  const parent = path.posix.dirname(root);
  return { parent: parent === "." ? "" : parent, base };
}

const locLabel = (loc: Loc) =>
  loc.kind === "local" ? loc.abs : `${loc.remote.name}:${loc.root || "~"}`;

/** null when missing */
async function statLoc(loc: Loc): Promise<{ isDir: boolean } | null> {
  if (loc.kind === "local") {
    const st = await fs.stat(loc.abs).catch(() => null);
    return st && { isDir: st.isDirectory() };
  }
  const sp = splitRemote(loc);
  if (!sp) {
    await remoteFs(loc.remote, loc.root).listRoot();
    return { isDir: true };
  }
  const e = await remoteFs(loc.remote, sp.parent).stat(sp.base);
  return e && { isDir: e.isDirectory };
}

/** mkdir -p */
async function ensureDir(loc: Loc) {
  if (loc.kind === "local") return void (await fs.mkdir(loc.abs, { recursive: true }));
  if (loc.kind === "smb") return remoteFs(loc.remote, loc.root).mkdirs!([]);
  const p = sshRel(loc.root);
  if (!p) return;
  const c = await sshCommand(loc.remote, `mkdir -p -- ${shq(p)}`);
  await runCmd(c.cmd, c.args, { env: c.env, timeout: 60000 });
}

async function listNames(loc: Loc) {
  if (loc.kind === "local") return fs.readdir(loc.abs);
  return remoteFs(loc.remote, loc.root).listRoot();
}

async function removeEntry(loc: Loc, name: string, isDir: boolean) {
  if (loc.kind === "local")
    return fs.rm(path.join(/*turbopackIgnore: true*/ loc.abs, name), { recursive: true, force: true });
  return remoteFs(loc.remote, loc.root).rm(name, isDir);
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

/** old jobs (no flag) always copied into a sub folder named after the source */
export const usesSubfolder = (b: Pick<BackupDoc, "mode" | "intoSubfolder">) =>
  b.mode === "snapshot" || b.intoSubfolder !== false;

/**
 * name of the entry created inside the destination, or null when the source's
 * contents go straight into the destination (sync / mirror without sub folder).
 * A single-file source always keeps its name.
 */
export function targetName(
  b: Pick<BackupDoc, "mode" | "intoSubfolder" | "archive">,
  baseName: string,
  isDir: boolean,
  when = new Date(),
) {
  if (b.mode === "snapshot") return `${baseName}-${stamp(when)}${b.archive === "zip" ? ".zip" : ""}`;
  if (!isDir || usesSubfolder(b)) return baseName;
  return null;
}

/** last path segment of an endpoint, used to name the copy */
export function endpointBaseName(
  ep: BackupEndpointDoc,
  names: { folders: Map<string, string>; remotes: Map<string, string> },
) {
  const p = ep.kind === "folder" ? ep.dir : ep.path;
  const seg = p.split("/").filter(Boolean).pop();
  if (seg) return seg;
  if (ep.kind === "folder") return slugify(names.folders.get(ep.folderId.toHexString()) ?? "folder");
  if (ep.kind === "remote") return slugify(names.remotes.get(ep.remoteId.toHexString()) ?? "remote");
  return "root";
}

/* ------------------------------- pre / post -------------------------------- */

export type HookContext = Record<string, string>;

export const HOOK_PLACEHOLDERS = ["name", "id", "mode", "trigger", "source", "dest", "target", "status", "message"];

/** replace {name} placeholders in a parameter value with backup run values (unknown ones are left alone) */
export function expandHookValue(v: string, ctx: HookContext) {
  return v.replace(/\{([a-z_]+)\}/gi, (m, k: string) => ctx[k.toLowerCase()] ?? m);
}

/** run a hook's saved script and describe the outcome */
async function hook(label: string, h: BackupHookDoc, ctx: HookContext) {
  try {
    const script = await loadScript(h.scriptId);
    if (!script) return { ok: false, message: `${label}: the script no longer exists` };
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(h.params ?? {})) params[k] = expandHookValue(v, ctx);
    for (const [k, v] of Object.entries(h.secretsEnc ?? {})) params[k] = decryptSecret(v);
    const r = await runScriptHeadless(script, {
      targets: h.targets,
      params,
      title: `${label} · ${ctx.name}`,
    });
    console.log(`backup ${ctx.name}: ${label} “${script.name}” ${r.ok ? "ok" : "failed"}`);
    return { ok: r.ok, message: r.ok ? null : `${label} “${script.name}”: ${r.message}` };
  } catch (e: any) {
    return { ok: false, message: `${label} failed: ${e.message ?? e}` };
  }
}

/* ---------------------------------- rsync --------------------------------- */

function rsync(
  c: { cmd: string; args: string[]; env?: Record<string, string> },
  onProgress: (pct: number) => void,
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(c.cmd, c.args, {
      env: { ...process.env, ...c.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
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
async function pruneSnapshots(destRoot: Loc, baseName: string, keep: number) {
  const re = new RegExp(`^${escapeRe(baseName)}-(\\d{8}-\\d{6})(\\.zip)?$`);
  // newest first by timestamp, whether a folder or a zip
  const snaps = (await listNames(destRoot))
    .filter((n) => re.test(n))
    .sort((a, b) => re.exec(b)![1].localeCompare(re.exec(a)![1]));
  const old = snaps.slice(keep);
  for (const n of old) await removeEntry(destRoot, n, !n.endsWith(".zip"));
  return old.length;
}

/* -------------------------------- transfer -------------------------------- */

type XferOpts = {
  mirror: boolean;
  excludes: string[];
  onProgress: (pct: number) => void;
  /** scratch dir for remote → remote copies */
  stageDir: string;
};
type XferResult = { warnings: string[] };
type TreeEntry = { size: number; mtime: number; dir: boolean };

const BATCH = 500;
const tail = (s: string) => s.trim().split("\n").slice(-3).join(" | ");

/** files + dirs below a local dir (rel → entry), excluded paths left out */
async function walkLocal(root: string, excluded: ReturnType<typeof excludeMatcher>) {
  const out = new Map<string, TreeEntry>();
  const walk = async (abs: string, rel: string) => {
    for (const d of await fs.readdir(abs, { withFileTypes: true })) {
      const r = rel ? `${rel}/${d.name}` : d.name;
      const a = path.join(/*turbopackIgnore: true*/ abs, d.name);
      if (!d.isDirectory() && !d.isFile()) continue;
      if (excluded(r, d.name, d.isDirectory())) continue;
      if (d.isDirectory()) {
        out.set(r, { size: 0, mtime: 0, dir: true });
        await walk(a, r);
      } else {
        const st = await fs.stat(a);
        out.set(r, { size: st.size, mtime: st.mtimeMs, dir: false });
      }
    }
  };
  await walk(root, "");
  return out;
}

/** files + dirs below a remote dir via FolderFs.walk (missing dir = empty) */
async function walkRemote(
  fsx: ReturnType<typeof remoteFs>,
  excluded: ReturnType<typeof excludeMatcher>,
  allowMissing: boolean,
) {
  const out = new Map<string, TreeEntry>();
  const skipped = new Set<string>();
  try {
    await fsx.walk("", async (relDir: string, e: FsEntry) => {
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (relDir && skipped.has(relDir)) return void (e.isDirectory && skipped.add(rel));
      if (excluded(rel, e.name, e.isDirectory)) return void (e.isDirectory && skipped.add(rel));
      out.set(rel, { size: e.size, mtime: e.mtime.getTime(), dir: e.isDirectory });
    });
  } catch (e) {
    if (!allowMissing) throw e;
  }
  return out;
}

/** a file needs copying unless the destination has the same size and is not older */
const changed = (src: TreeEntry, dst: TreeEntry | undefined) =>
  !dst || dst.dir || dst.size !== src.size || dst.mtime < src.mtime - 2000;

/** entries of `dest` that are not in `src` (parents first, children of removed dirs dropped) */
function extras(src: Map<string, TreeEntry>, dest: Map<string, TreeEntry>) {
  const out: [string, TreeEntry][] = [];
  const gone: string[] = [];
  for (const rel of [...dest.keys()].sort()) {
    if (src.get(rel)?.dir === dest.get(rel)!.dir) continue;
    if (gone.some((g) => rel.startsWith(g + "/"))) continue;
    out.push([rel, dest.get(rel)!]);
    if (dest.get(rel)!.dir) gone.push(rel);
  }
  return out;
}

/** progress over a byte total */
function byteProgress(total: number, onProgress: (pct: number) => void) {
  let done = 0;
  return (n: number) => {
    done += n;
    if (total) onProgress(Math.min(99, Math.floor((done / total) * 100)));
  };
}

/** SMB (direct) → local: incremental download with smbclient */
async function smbPull(src: Extract<Loc, { root: string }>, isDir: boolean, target: string, o: XferOpts): Promise<XferResult> {
  const excluded = excludeMatcher(o.excludes);
  let fsx: ReturnType<typeof remoteFs>;
  let entries: Map<string, TreeEntry>;
  const localOf = (rel: string) => (isDir ? path.join(/*turbopackIgnore: true*/ target, rel) : target);
  if (isDir) {
    fsx = remoteFs(src.remote, src.root);
    entries = await walkRemote(fsx, excluded, false);
  } else {
    const sp = splitRemote(src)!;
    fsx = remoteFs(src.remote, sp.parent);
    const e = await fsx.stat(sp.base);
    if (!e) throw new Error(`Source does not exist: ${locLabel(src)}`);
    entries = new Map([[sp.base, { size: e.size, mtime: e.mtime.getTime(), dir: false }]]);
  }

  await fs.mkdir(isDir ? target : path.dirname(target), { recursive: true });
  const todo: { rel: string; e: TreeEntry }[] = [];
  for (const [rel, e] of entries) {
    if (e.dir) {
      await fs.mkdir(localOf(rel), { recursive: true });
      continue;
    }
    const st = await fs.stat(localOf(rel)).catch(() => null);
    const have = st ? { size: st.size, mtime: st.mtimeMs, dir: st.isDirectory() } : undefined;
    if (changed(e, have)) todo.push({ rel, e });
  }

  const warnings: string[] = [];
  const tick = byteProgress(todo.reduce((n, t) => n + t.e.size, 0), o.onProgress);
  let failed = 0;
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    const errs = await fsx.getFiles!(batch.map((t) => ({ rel: t.rel, local: localOf(t.rel) })));
    for (const t of batch) {
      const st = await fs.stat(localOf(t.rel)).catch(() => null);
      if (!st || st.size !== t.e.size) {
        failed++;
        continue;
      }
      // keep the source mtime so the next run can skip unchanged files
      await fs.utimes(localOf(t.rel), new Date(t.e.mtime), new Date(t.e.mtime)).catch(() => {});
      tick(t.e.size);
    }
    if (errs.length && failed) warnings.push(`Some files were not copied: ${errs.slice(-3).join(" | ")}`);
  }
  if (failed && !warnings.length) warnings.push(`${failed} file(s) could not be copied`);

  if (o.mirror && isDir) {
    for (const [rel, e] of extras(entries, await walkLocal(target, excluded)))
      await fs.rm(localOf(rel), { recursive: e.dir, force: true });
  }
  return { warnings };
}

/** local → SMB (direct): incremental upload with smbclient */
async function smbPush(srcAbs: string, isDir: boolean, target: Extract<Loc, { root: string }>, o: XferOpts): Promise<XferResult> {
  const excluded = excludeMatcher(o.excludes);
  let fsx: ReturnType<typeof remoteFs>;
  let local: Map<string, TreeEntry>;
  let dest: Map<string, TreeEntry>;
  const localOf = (rel: string) => (isDir ? path.join(/*turbopackIgnore: true*/ srcAbs, rel) : srcAbs);
  if (isDir) {
    fsx = remoteFs(target.remote, target.root);
    await fsx.mkdirs!([]);
    local = await walkLocal(srcAbs, excluded);
    dest = await walkRemote(fsx, () => false, true);
  } else {
    const sp = splitRemote(target);
    if (!sp) throw new Error(`Cannot write a file to ${locLabel(target)}`);
    fsx = remoteFs(target.remote, sp.parent);
    await fsx.mkdirs!([]);
    const st = await fs.stat(srcAbs);
    local = new Map([[sp.base, { size: st.size, mtime: st.mtimeMs, dir: false }]]);
    const e = await fsx.stat(sp.base);
    dest = new Map(e ? [[sp.base, { size: e.size, mtime: e.mtime.getTime(), dir: e.isDirectory }]] : []);
  }

  const warnings: string[] = [];
  if (o.mirror && isDir) {
    for (const [rel, e] of extras(local, dest)) {
      if (excluded(rel, path.posix.basename(rel), e.dir)) continue; // like rsync: excluded = protected
      await fsx.rm(rel, e.dir).catch((err) => warnings.push(`could not delete ${rel}: ${err.message}`));
      dest.delete(rel);
    }
  }
  const newDirs = [...local].filter(([rel, e]) => e.dir && !dest.get(rel)?.dir).map(([rel]) => rel);
  if (newDirs.length) await fsx.mkdirs!(newDirs);

  const todo = [...local].filter(([rel, e]) => !e.dir && changed(e, dest.get(rel)));
  const tick = byteProgress(todo.reduce((n, [, e]) => n + e.size, 0), o.onProgress);
  const errors: string[] = [];
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    errors.push(...(await fsx.putFiles!(batch.map(([rel]) => ({ local: localOf(rel), rel })))));
    for (const [, e] of batch) tick(e.size);
  }
  if (errors.length) warnings.push(`${errors.length} file(s) could not be copied: ${errors.slice(-3).join(" | ")}`);
  return { warnings };
}

/** rsync between local paths, or local ↔ direct ssh (rsync over ssh, no mount) */
async function rsyncXfer(src: Loc, isDir: boolean, target: Loc, o: XferOpts): Promise<XferResult> {
  // -rt instead of -a: owners/permissions often cannot be set on remote targets
  const args = ["-rt", "--modify-window=2", "--info=progress2", "--no-inc-recursive"];
  if (o.mirror) args.push("--delete");
  for (const ex of o.excludes) args.push("--exclude", ex);
  const ssh = src.kind === "ssh" ? src : target.kind === "ssh" ? target : null;
  const r = ssh ? await rsyncSsh(ssh.remote) : null;
  if (r) args.push("-e", r.shell, "--protect-args");
  const spec = (l: Loc) =>
    (l.kind === "local" ? l.abs : `${r!.target}:${sshRel(l.root) || "."}`) + (isDir ? "/" : "");
  args.push(spec(src), spec(target));
  // rsync only creates the last path level of a local target
  if (target.kind === "local")
    await fs.mkdir(isDir ? target.abs : path.dirname(target.abs), { recursive: true });
  try {
    const { code, stderr } = await rsync(r ? r.wrap(args) : { cmd: "rsync", args }, o.onProgress);
    if (code === 23 || code === 24) return { warnings: [`Some files were skipped (rsync ${code}): ${tail(stderr)}`] };
    if (code !== 0) {
      const hint =
        ssh && /command not found|rsync: not found|No such file or directory.*rsync|connection unexpectedly closed/i.test(stderr)
          ? ` (rsync must be installed on ${ssh.remote.name})`
          : "";
      throw new Error(`rsync failed (${code}): ${tail(stderr)}${hint}`);
    }
    return { warnings: [] };
  } catch (e: any) {
    if (e.code !== "ENOENT" || src.kind !== "local" || target.kind !== "local") throw e;
    // rsync not installed: plain recursive copy
    await fs.cp(src.abs, target.abs, { recursive: true, force: true, preserveTimestamps: true });
    return o.mirror ? { warnings: ["rsync not installed: copied files but could not delete extras (mirror)"] } : { warnings: [] };
  }
}

/** copy src (a dir's contents, or a file) to target, without mounting direct remotes */
async function transfer(src: Loc, isDir: boolean, target: Loc, o: XferOpts): Promise<XferResult> {
  if (src.kind !== "smb" && target.kind !== "smb" && (src.kind === "local" || target.kind === "local"))
    return rsyncXfer(src, isDir, target, o);
  if (src.kind === "smb" && target.kind === "local") return smbPull(src, isDir, target.abs, o);
  if (src.kind === "local" && target.kind === "smb") return smbPush(src.abs, isDir, target, o);
  // remote → remote: copy through a local staging dir
  await fs.rm(o.stageDir, { recursive: true, force: true });
  await fs.mkdir(o.stageDir, { recursive: true });
  const staged: Loc = { kind: "local", abs: path.join(/*turbopackIgnore: true*/ o.stageDir, "data") };
  try {
    const half = (lo: number) => (p: number) => o.onProgress(lo + Math.floor(p / 2));
    const a = await transfer(src, isDir, staged, { ...o, mirror: false, onProgress: half(0) });
    const b = await transfer(staged, isDir, target, { ...o, onProgress: half(50) });
    return { warnings: [...a.warnings, ...b.warnings] };
  } finally {
    await fs.rm(o.stageDir, { recursive: true, force: true });
  }
}

/* ----------------------------------- run ---------------------------------- */

/** run a backup job to completion (call without await for background runs) */
export async function runBackup(b: BackupDoc, trigger: "manual" | "schedule" = "manual") {
  const id = b._id.toHexString();
  if (runningJobs.has(id)) throw new Error("This backup is already running");
  runningJobs.add(id);
  const { backups, folders, remotes } = await collections();
  const startedAt = new Date();
  let release = () => {};
  const cleanups: (() => Promise<void>)[] = [];
  await backups.updateOne(
    { _id: b._id },
    { $set: { status: "running", progress: 0, lastRun: { startedAt, message: null, trigger } } },
  );

  const srcEp = normEndpoint(b.source);
  const destEp = normEndpoint(b.dest);
  let status: BackupDoc["status"] = "success";
  const messages: string[] = [];
  let targetLabel = "";
  const [fNames, rNames] = await Promise.all([
    folders.find({}, { projection: { name: 1 } }).toArray(),
    remotes.find({}, { projection: { name: 1 } }).toArray(),
  ]).catch(() => [[], []] as const);
  const names = {
    folders: new Map(fNames.map((x) => [x._id.toHexString(), x.name])),
    remotes: new Map(rNames.map((x) => [x._id.toHexString(), x.name])),
  };
  const ctx = (): HookContext => ({
    id,
    name: b.name,
    mode: b.mode,
    trigger,
    source: endpointLabel(srcEp, names),
    dest: endpointLabel(destEp, names),
    target: targetLabel,
    status: status === "running" ? "" : status,
    message: messages.join("; "),
  });

  try {
    if (b.preScript?.scriptId) {
      const r = await hook("pre-backup script", b.preScript, ctx());
      if (!r.ok) {
        if (b.preScript.abortOnFail !== false) throw new Error(`${r.message} — backup not run`);
        status = "warning";
        messages.push(r.message!);
      }
    }

    const src = await resolveEndpoint(srcEp, "src", id);
    cleanups.push(src.cleanup);
    const dest = await resolveEndpoint(destEp, "dest", id);
    cleanups.push(dest.cleanup);
    release = holdFolders(
      [src.folder?._id.toHexString(), dest.folder?._id.toHexString()].filter(Boolean) as string[],
    );

    const st = await statLoc(src.loc);
    if (!st) throw new Error(`Source does not exist: ${locLabel(src.loc)}`);
    const isDir = st.isDir;
    const destRoot = dest.loc;
    const asZip = b.mode === "snapshot" && b.archive === "zip";
    const name = targetName(b, src.baseName, isDir);
    const target = name ? joinLoc(destRoot, name) : destRoot;
    if (src.loc.kind === "local" && target.kind === "local" && srcEp.kind !== "remote" && destEp.kind !== "remote") {
      if (isInside(target.abs, src.loc.abs)) throw new Error("Destination is inside the source");
      if (isInside(src.loc.abs, target.abs)) throw new Error("Source is inside the destination");
    }

    targetLabel = locLabel(target);
    await backups.updateOne({ _id: b._id }, { $set: { "lastRun.target": targetLabel } });
    await ensureDir(isDir && !asZip ? target : destRoot);

    let lastWrite = 0;
    const onProgress = (pct: number) => {
      if (Date.now() - lastWrite < 1000) return;
      lastWrite = Date.now();
      void backups.updateOne({ _id: b._id }, { $set: { progress: pct } });
    };

    const excludes = (b.exclude ?? "").split(",").map((e) => e.trim()).filter(Boolean);
    const warnings: string[] = [];
    const xfer: XferOpts = { mirror: b.mode === "mirror", excludes, onProgress, stageDir: backupWorkDir(id, "stage") };
    if (asZip) {
      // zipping needs local files: stage a direct remote source, zip locally, then upload
      const work = backupWorkDir(id, "zip");
      await fs.rm(work, { recursive: true, force: true });
      try {
        let srcAbs = src.loc.kind === "local" ? src.loc.abs : "";
        if (!srcAbs) {
          srcAbs = path.join(/*turbopackIgnore: true*/ work, "src");
          const w = await transfer(src.loc, isDir, { kind: "local", abs: srcAbs }, { ...xfer, mirror: false });
          warnings.push(...w.warnings);
        }
        const zipAbs = target.kind === "local" ? target.abs : path.join(/*turbopackIgnore: true*/ work, path.posix.basename(target.root));
        await fs.mkdir(path.dirname(zipAbs), { recursive: true });
        const r = await zipTo(srcAbs, isDir, zipAbs, excludes, onProgress);
        messages.push(`zipped ${r.files} file(s), ${fmtBytes(r.bytes)} → ${fmtBytes(r.zipBytes)}`);
        if (r.skipped) messages.push(`skipped ${r.skipped} symlink(s)/special file(s)`);
        if (target.kind !== "local") {
          const w = await transfer({ kind: "local", abs: zipAbs }, false, target, { ...xfer, mirror: false, excludes: [] });
          warnings.push(...w.warnings);
        }
      } finally {
        await fs.rm(work, { recursive: true, force: true });
      }
    } else {
      warnings.push(...(await transfer(src.loc, isDir, target, xfer)).warnings);
    }
    if (warnings.length) {
      status = "warning";
      messages.unshift(...warnings);
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
      // after pruning (or for a zip file / contents copied into dest), rescan the parent so the index matches
      const rel = pruned || asZip || !name ? dest.folderDir : path.posix.join(dest.folderDir, name);
      try {
        if (!isJobRunning(dest.folder._id.toHexString())) await scanFolder(dest.folder, rel);
      } catch (e: any) {
        messages.push(`destination rescan failed: ${e.message}`);
      }
    }
    console.log(`backup ${b.name}: ${status} -> ${targetLabel}`);
  } catch (e: any) {
    console.error("backup failed", b.name, e);
    status = "error";
    messages.unshift(e.message ?? String(e));
  } finally {
    release();
    for (const c of cleanups.reverse()) await c();
  }

  try {
    const post = b.postScript;
    const when = post?.when ?? "always";
    const failed = status === "error";
    if (post?.scriptId && (when === "always" || (when === "success") !== failed)) {
      const r = await hook("post-backup script", post, ctx());
      if (!r.ok) {
        if (status === "success") status = "warning";
        messages.push(r.message!);
      }
    }
    await backups.updateOne(
      { _id: b._id },
      {
        $set: {
          status,
          ...(status === "error" ? {} : { progress: 100 }),
          "lastRun.finishedAt": new Date(),
          "lastRun.message": messages.join("; ") || null,
        },
      },
    );
  } finally {
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

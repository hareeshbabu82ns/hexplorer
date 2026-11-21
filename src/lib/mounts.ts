import { spawn } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { ObjectId } from "mongodb";
import config from "@/config/config";
import { collections, FolderDoc, RemoteDoc } from "./db";
import { isJobRunning } from "./jobs";
import { decryptSecret } from "./secrets";
import { materializeKey } from "./ssh-keys";

/** run a command without a shell; optional stdin + env; rejects with stderr */
export function run(
  cmd: string,
  args: string[],
  opts: { input?: string; env?: Record<string, string>; timeout?: number } = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      env: { ...process.env, ...opts.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), opts.timeout ?? 30000);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e: any) => {
      clearTimeout(timer);
      reject(
        e.code === "ENOENT"
          ? Object.assign(new Error(`${cmd} is not installed (run scripts/ubuntu/setup.sh)`), { code: "ENOENT" })
          : e,
      );
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else
        reject(
          new Error(
            (stderr || stdout).trim() ||
              (signal ? `${cmd} timed out` : `${cmd} exited with code ${code}`),
          ),
        );
    });
    if (opts.input !== undefined) child.stdin.end(opts.input);
    else child.stdin.end();
  });
}

/** root under which app-managed mounts are created */
export function mountsRoot() {
  // runtime folders: turbopackIgnore keeps the bundler from walking data/ (and the
  // network shares mounted there) while it traces dependencies
  return path.resolve(
    /*turbopackIgnore: true*/ process.env.MOUNTS_FOLDER || path.join(/*turbopackIgnore: true*/ config.dataFolder, "mounts"),
  );
}

export function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "mount"
  );
}

/** quote a string for a POSIX remote shell */
export function shq(s: string) {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

const remoteType = (r: RemoteDoc) => r.type ?? "ssh";
const usesPassword = (r: RemoteDoc) => remoteType(r) === "smb" || r.auth === "password";
const expandHome = (p: string) => p.replace(/^~(?=\/)/, os.homedir());
const asRoot = (cmd: string, args: string[]): [string, string[]] =>
  process.getuid?.() === 0 ? [cmd, args] : ["sudo", ["-n", cmd, ...args]];

function password(r: RemoteDoc) {
  return r.passwordEnc ? decryptSecret(r.passwordEnc) : "";
}

/* ----------------------------------- SSH ---------------------------------- */

function sshTarget(r: Pick<RemoteDoc, "host" | "user">) {
  return r.user ? `${r.user}@${r.host}` : r.host;
}

const BASE_SSH_OPTS = [
  "ConnectTimeout=10",
  "StrictHostKeyChecking=accept-new",
  "ServerAliveInterval=15",
  "ServerAliveCountMax=3",
];

function sshOpts(r: RemoteDoc) {
  return r.auth === "password"
    ? [...BASE_SSH_OPTS, "PreferredAuthentications=password,keyboard-interactive", "PubkeyAuthentication=no", "NumberOfPasswordPrompts=1"]
    : [...BASE_SSH_OPTS, "BatchMode=yes"]; // key auth: never prompt
}

/** private key file for key auth: uploaded key, then identityFile, else ssh defaults */
async function identityPath(r: RemoteDoc): Promise<string | null> {
  if (r.auth === "password") return null;
  if (r.keyId) return materializeKey(r.keyId);
  return r.identityFile ? expandHome(r.identityFile) : null;
}

/**
 * argv for running remoteCmd on an ssh remote: [cmd, args, env].
 * Password auth goes through sshpass (password passed in the environment, never argv).
 */
export async function sshCommand(
  r: RemoteDoc,
  remoteCmd: string,
  opts: { multiplex?: boolean } = {},
): Promise<{ cmd: string; args: string[]; env?: Record<string, string> }> {
  const args: string[] = [];
  for (const o of sshOpts(r)) args.push("-o", o);
  if (opts.multiplex) {
    // reuse one connection for the many short commands of direct (unmounted) access
    const dir = path.join(/*turbopackIgnore: true*/ os.tmpdir(), `hx-ssh-${process.getuid?.() ?? 0}`);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    args.push("-o", "ControlMaster=auto", "-o", `ControlPath=${dir}/%C`, "-o", "ControlPersist=120");
  }
  if (r.port) args.push("-p", String(r.port));
  const identity = await identityPath(r);
  if (identity) args.push("-i", identity, "-o", "IdentitiesOnly=yes");
  args.push(sshTarget(r), remoteCmd);
  if (r.auth === "password") return { cmd: "sshpass", args: ["-e", "ssh", ...args], env: { SSHPASS: password(r) } };
  return { cmd: "ssh", args };
}

/** stored login password of a remote (password auth only), "" otherwise */
export function remotePassword(r: RemoteDoc) {
  return r.auth === "password" ? password(r) : "";
}

/** run a command on an ssh remote (key auth, or password via sshpass) */
async function sshExec(r: RemoteDoc, remoteCmd: string, timeout = 20000) {
  const c = await sshCommand(r, remoteCmd);
  return run(c.cmd, c.args, { env: c.env, timeout });
}

/** Host aliases from ~/.ssh/config (without wildcards) */
export async function sshConfigHosts(): Promise<string[]> {
  try {
    const txt = await fs.readFile(path.join(/*turbopackIgnore: true*/ os.homedir(), ".ssh", "config"), "utf8");
    const hosts = new Set<string>();
    for (const line of txt.split("\n")) {
      const m = line.trim().match(/^Host\s+(.+)$/i);
      if (!m) continue;
      m[1]
        .split(/\s+/)
        .filter((h) => h && !/[*?!]/.test(h))
        .forEach((h) => hosts.add(h));
    }
    return [...hosts].sort();
  } catch {
    return [];
  }
}

/* ----------------------------------- SMB ---------------------------------- */

/** temp credentials file (0600) for smbclient -A / mount.cifs credentials= */
export async function withSmbCreds<T>(r: RemoteDoc, fn: (credFile: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(/*turbopackIgnore: true*/ os.tmpdir(), "hx-smb-"));
  const file = path.join(/*turbopackIgnore: true*/ dir, "creds");
  const lines = [`username=${r.user || "guest"}`, `password=${password(r)}`];
  if (r.domain) lines.push(`domain=${r.domain}`);
  await fs.writeFile(file, lines.join("\n") + "\n", { mode: 0o600 });
  try {
    return await fn(file);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

export function smbBaseArgs(r: RemoteDoc, credFile: string) {
  const args = ["-A", credFile, "-m", "SMB3"];
  if (r.port) args.push("-p", String(r.port));
  return args;
}

/** split "/share/sub/dir" → ["share", "sub/dir"] */
export function splitSmbPath(p: string): [string, string] {
  const parts = p.split("/").filter(Boolean);
  return [parts[0] ?? "", parts.slice(1).join("/")];
}

async function smbListShares(r: RemoteDoc) {
  const { stdout } = await withSmbCreds(r, (cred) =>
    run("smbclient", ["-L", `//${r.host}`, "-g", ...smbBaseArgs(r, cred)], { timeout: 20000 }),
  );
  return stdout
    .split("\n")
    .map((l) => l.split("|"))
    .filter((c) => c[0] === "Disk" && c[1] && !c[1].endsWith("$"))
    .map((c) => c[1]);
}

const SMB_LS_RE = /^ {2}(.*?)\s+([A-Z]*)\s+(\d+)\s+(Mon|Tue|Wed|Thu|Fri|Sat|Sun) /;

async function smbListDir(r: RemoteDoc, share: string, sub: string) {
  if (/[";\\]/.test(share + sub)) throw new Error("Unsupported characters in path");
  const cmd = sub ? `cd "${sub}"; ls` : "ls";
  const { stdout } = await withSmbCreds(r, (cred) =>
    run("smbclient", [`//${r.host}/${share}`, ...smbBaseArgs(r, cred), "-c", cmd], {
      timeout: 20000,
    }),
  );
  const entries: { name: string; isDirectory: boolean }[] = [];
  for (const line of stdout.split("\n")) {
    const m = line.match(SMB_LS_RE);
    if (!m || m[1] === "." || m[1] === "..") continue;
    entries.push({ name: m[1], isDirectory: m[2].includes("D") });
  }
  return entries;
}

/* --------------------------------- common --------------------------------- */

export async function testRemote(r: RemoteDoc): Promise<string> {
  if (remoteType(r) === "smb") {
    const shares = await smbListShares(r);
    return `shares: ${shares.join(", ") || "(none visible)"}`;
  }
  const { stdout } = await sshExec(r, "echo ok; pwd");
  return `home: ${stdout.trim().split("\n").pop() ?? ""}`;
}

const sortEntries = (e: { name: string; isDirectory: boolean }[]) =>
  e.sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name));

/**
 * List a remote directory. SSH: plain `ls -1Ap` (works on busybox/NAS shells),
 * empty path = remote home. SMB: "/" lists shares, "/share/sub" lists a folder.
 */
export async function listRemoteDir(r: RemoteDoc, remotePath: string) {
  if (remoteType(r) === "smb") {
    const [share, sub] = splitSmbPath(remotePath);
    if (!share) {
      const shares = await smbListShares(r);
      return { path: "/", entries: shares.map((name) => ({ name, isDirectory: true })) };
    }
    return {
      path: "/" + [share, sub].filter(Boolean).join("/"),
      entries: sortEntries(await smbListDir(r, share, sub)),
    };
  }
  const cd = remotePath ? `cd -- ${shq(remotePath)}` : "cd";
  const { stdout } = await sshExec(r, `${cd} && pwd && LC_ALL=C ls -1Ap`);
  const [cwd, ...lines] = stdout.split("\n");
  const entries = lines
    .filter((l) => l && l !== "./" && l !== "../")
    .map((l) => ({ name: l.replace(/\/$/, ""), isDirectory: l.endsWith("/") }));
  return { path: cwd.trim(), entries: sortEntries(entries) };
}

function decodeMountField(s: string) {
  return s.replace(/\\([0-7]{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));
}

/** cheap check via /proc/mounts — does not touch the share itself */
export async function isMounted(mountPoint: string) {
  try {
    const txt = await fs.readFile("/proc/mounts", "utf8");
    const target = path.resolve(/*turbopackIgnore: true*/ mountPoint);
    return txt.split("\n").some((l) => decodeMountField(l.split(" ")[1] ?? "") === target);
  } catch {
    return false;
  }
}

async function getRemote(id: ObjectId) {
  const { remotes } = await collections();
  const r = await remotes.findOne({ _id: id });
  if (!r) throw new Error("Remote for this mount no longer exists");
  return r;
}

const g = globalThis as unknown as {
  _hexMountLocks?: Map<string, Promise<void>>;
  _hexReaper?: NodeJS.Timeout;
};
const mountLocks = (g._hexMountLocks ??= new Map());

async function mountSshfs(remote: RemoteDoc, remotePath: string, mountPoint: string) {
  const opts = [
    ...sshOpts(remote).filter((o) => !o.startsWith("StrictHostKeyChecking")),
    "StrictHostKeyChecking=accept-new",
    "reconnect",
    "idmap=user",
    "follow_symlinks",
  ];
  if (remote.auth === "password") opts.push("password_stdin");
  else {
    const identity = await identityPath(remote);
    if (identity) opts.push(`IdentityFile=${identity}`, "IdentitiesOnly=yes");
  }
  const args = [`${sshTarget(remote)}:${remotePath}`, mountPoint, "-o", opts.join(",")];
  if (remote.port) args.push("-p", String(remote.port));
  await run("sshfs", args, {
    timeout: 30000,
    input: remote.auth === "password" ? password(remote) + "\n" : undefined,
  });
}

async function mountCifs(remote: RemoteDoc, remotePath: string, mountPoint: string) {
  const [share, sub] = splitSmbPath(remotePath);
  if (!share) throw new Error("Pick a share (and optionally a folder) to mount");
  const source = `//${remote.host}/${share}${sub ? "/" + sub : ""}`;
  await withSmbCreds(remote, async (cred) => {
    const opts = [
      `credentials=${cred}`,
      `vers=${remote.smbVersion || "3.0"}`,
      `uid=${process.getuid?.() ?? 0}`,
      `gid=${process.getgid?.() ?? 0}`,
      "iocharset=utf8",
      "file_mode=0664",
      "dir_mode=0775",
      "noperm",
    ];
    if (remote.port) opts.push(`port=${remote.port}`);
    const [cmd, args] = asRoot("mount", ["-t", "cifs", source, mountPoint, "-o", opts.join(",")]);
    await run(cmd, args, { timeout: 30000 });
  });
}

/** mount remotePath of a remote at mountPoint (sshfs or cifs depending on the remote type) */
export async function mountRemoteAt(remote: RemoteDoc, remotePath: string, mountPoint: string) {
  await fs.mkdir(mountPoint, { recursive: true });
  try {
    if (mountTypeFor(remote) === "cifs") await mountCifs(remote, remotePath, mountPoint);
    else await mountSshfs(remote, remotePath, mountPoint);
  } catch (e: any) {
    throw new Error(`mount of ${remote.name}:${remotePath || "~"} failed: ${e.message}`);
  }
}

export async function mountFolder(folder: FolderDoc) {
  if (!folder.mount || folder.mount.access === "direct") return;
  const key = folder._id.toHexString();
  const pending = mountLocks.get(key);
  if (pending) return pending;
  const p = (async () => {
    if (await isMounted(folder.path)) return;
    const remote = await getRemote(folder.mount!.remoteId);
    await mountRemoteAt(remote, folder.mount!.remotePath, folder.path);
    console.log(`mounted ${remote.name}:${folder.mount!.remotePath} -> ${folder.path}`);
    startIdleReaper();
  })().finally(() => mountLocks.delete(key));
  mountLocks.set(key, p);
  return p;
}

/** mount type to use for a remote */
export function mountTypeFor(r: RemoteDoc): "sshfs" | "cifs" {
  return remoteType(r) === "smb" ? "cifs" : "sshfs";
}

export { usesPassword };

/** unmount an sshfs/cifs mount point (no-op when not mounted) */
export async function unmountPath(mountPoint: string, type: "sshfs" | "cifs") {
  if (!(await isMounted(mountPoint))) return;
  const attempts: [string, string[]][] =
    type === "cifs"
      ? [asRoot("umount", [mountPoint])]
      : [
          ["fusermount3", ["-u", mountPoint]],
          ["fusermount", ["-u", mountPoint]],
          asRoot("umount", [mountPoint]),
        ];
  let lastErr: any;
  for (const [cmd, args] of attempts) {
    try {
      await run(cmd, args, { timeout: 15000 });
      console.log(`unmounted ${mountPoint}`);
      return;
    } catch (e: any) {
      lastErr = e;
    }
  }
  throw new Error(`unmount failed: ${lastErr?.message ?? ""}`);
}

export async function unmountFolder(folder: FolderDoc) {
  if (folder.mount?.access === "direct" || !(await isMounted(folder.path))) return;
  if (isJobRunning(folder._id.toHexString()))
    throw new Error("A scan/hash/backup job is using this folder");
  await unmountPath(folder.path, folder.mount?.type === "cifs" ? "cifs" : "sshfs");
}

/** mount if needed — called before any disk access on a mounted folder */
export async function ensureMounted(folder: FolderDoc) {
  if (!folder.mount) return;
  await mountFolder(folder);
  await touchFolder(folder);
}

export async function touchFolder(folder: FolderDoc) {
  if (!folder.mount) return;
  try {
    const { folders } = await collections();
    await folders.updateOne({ _id: folder._id }, { $set: { lastUsedAt: new Date() } });
  } catch {
    /* best effort */
  }
}

/** periodically unmount app-managed mounts that have been idle long enough */
export function startIdleReaper() {
  if (g._hexReaper) return;
  g._hexReaper = setInterval(async () => {
    try {
      const { folders } = await collections();
      const mounted = await folders
        .find({ "mount.idleMinutes": { $gt: 0 }, "mount.access": { $ne: "direct" } })
        .toArray();
      for (const f of mounted) {
        if (isJobRunning(f._id.toHexString()) || mountLocks.has(f._id.toHexString())) continue;
        const idleMs = Date.now() - (f.lastUsedAt?.getTime() ?? 0);
        if (idleMs < f.mount!.idleMinutes * 60_000) continue;
        if (!(await isMounted(f.path))) continue;
        try {
          await unmountFolder(f);
          console.log(`idle unmount: ${f.name} (${Math.round(idleMs / 60000)} min idle)`);
        } catch (e: any) {
          console.warn("idle unmount failed", f.path, e.message); // busy — retry next tick
        }
      }
    } catch (e) {
      console.warn("idle reaper error", e);
    }
  }, 60_000);
  g._hexReaper.unref?.();
}

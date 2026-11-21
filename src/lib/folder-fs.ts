/**
 * Uniform file access for data folders.
 *
 *  - local / mounted folders: plain node fs on folder.path
 *  - direct remote folders (mount.access === "direct"): no mount at all —
 *    SSH runs find/stat/cat/sha1sum over one multiplexed connection, SMB talks
 *    through smbclient. Both only need user level tools (no FUSE, root, caps).
 */
import { spawn } from "child_process";
import crypto from "crypto";
import { createReadStream } from "fs";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { PassThrough, Readable } from "stream";
import { collections, FolderDoc, RemoteDoc } from "./db";
import { ensureMounted, sshCommand, shq, smbBaseArgs, splitSmbPath, touchFolder } from "./mounts";
import { decryptSecret } from "./secrets";

export type FsEntry = { name: string; isDirectory: boolean; size: number; mtime: Date; birthtime: Date };

export interface FolderFs {
  /** human readable location, for messages */
  label: string;
  /** names in the root; throws when the root is unreachable */
  listRoot(): Promise<string[]>;
  /**
   * Recursively list regular files + directories below relDir (not relDir itself),
   * parents before children. Returns the number of directories that could not be read.
   * `skip(relDir, name)` drops an entry and (where the backend can) does not descend into it.
   */
  walk(
    relDir: string,
    onEntry: (relDir: string, e: FsEntry) => Promise<void>,
    skip?: (relDir: string, name: string) => boolean,
  ): Promise<number>;
  /** null when the entry does not exist */
  stat(rel: string): Promise<FsEntry | null>;
  /** file content; `range` is inclusive like HTTP Range */
  read(rel: string, range?: { start: number; end: number }): Readable;
  /** sha1 hex of the file content */
  sha1(rel: string): Promise<string>;
  /**
   * optional batched sha1 (one round trip for many files); returns the hashes it could
   * compute — callers fall back to sha1() for the rest to get a proper error
   */
  sha1Many?(items: { rel: string; size: number }[]): Promise<Map<string, string>>;
  /** delete a file or a directory tree; a missing entry is not an error */
  rm(rel: string, isDirectory: boolean): Promise<void>;
}

export const isDirect = (f: Pick<FolderDoc, "mount">) => f.mount?.access === "direct";

/** validate a folder relative path ("" = root); never escapes the root */
export function safeRel(rel: string) {
  const n = path.posix.normalize(rel.replace(/\\/g, "/")).replace(/^(\.\/)+|\/+$/g, "");
  if (n === "." || n === "") return "";
  if (n.startsWith("/") || n === ".." || n.startsWith("../")) throw new Error(`path escapes folder root: ${rel}`);
  return n;
}

const baseName = (rel: string) => rel.split("/").pop() ?? rel;
const parentOf = (rel: string) => rel.split("/").slice(0, -1).join("/");

function sha1Stream(s: Readable) {
  return new Promise<string>((resolve, reject) => {
    const h = crypto.createHash("sha1");
    s.on("data", (c) => h.update(c))
      .on("end", () => resolve(h.digest("hex")))
      .on("error", reject);
  });
}

/* ---------------------------------- local --------------------------------- */

function localFs(root: string): FolderFs {
  const abs = (rel: string) => {
    const r = safeRel(rel);
    return r ? path.join(/*turbopackIgnore: true*/ root, r) : root;
  };
  const toEntry = (name: string, st: import("fs").Stats): FsEntry => ({
    name,
    isDirectory: st.isDirectory(),
    size: st.isDirectory() ? 0 : st.size,
    mtime: st.mtime,
    birthtime: st.birthtime,
  });
  return {
    label: root,
    listRoot: () => fs.readdir(root),
    async walk(relDir, onEntry, skip) {
      let readErrors = 0;
      const walk = async (dir: string) => {
        let entries: import("fs").Dirent[];
        try {
          entries = await fs.readdir(abs(dir), { withFileTypes: true });
        } catch (e: any) {
          console.warn("cannot read dir", abs(dir), e.message);
          readErrors++;
          return;
        }
        const subDirs: string[] = [];
        for (const d of entries) {
          if (!d.isFile() && !d.isDirectory()) continue; // skip symlinks, sockets...
          if (skip?.(dir, d.name)) continue;
          const rel = dir ? `${dir}/${d.name}` : d.name;
          let st: import("fs").Stats;
          try {
            st = await fs.stat(abs(rel));
          } catch {
            continue;
          }
          await onEntry(dir, toEntry(d.name, st));
          if (st.isDirectory()) subDirs.push(rel);
        }
        for (const d of subDirs) await walk(d);
      };
      await walk(safeRel(relDir));
      return readErrors;
    },
    async stat(rel) {
      try {
        return toEntry(baseName(rel), await fs.stat(abs(rel)));
      } catch (e: any) {
        if (e.code === "ENOENT") return null;
        throw e;
      }
    },
    read: (rel, range) => createReadStream(abs(rel), range),
    sha1: (rel) => sha1Stream(createReadStream(abs(rel))),
    async rm(rel, isDirectory) {
      if (!safeRel(rel)) throw new Error("refusing to delete folder root");
      try {
        await fs.rm(abs(rel), { recursive: isDirectory, force: false });
      } catch (e: any) {
        if (e.code !== "ENOENT") throw e;
      }
    },
  };
}

/* ---------------------------------- shared -------------------------------- */

type Proc = { stdout: Readable; done: Promise<{ code: number; stderr: string }>; kill: () => void };

function spawnProc(cmd: string, args: string[], opts: { env?: Record<string, string>; input?: string } = {}): Proc {
  const child = spawn(cmd, args, { env: { ...process.env, ...opts.env }, stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-8000)));
  const done = new Promise<{ code: number; stderr: string }>((resolve, reject) => {
    child.on("error", (e: any) =>
      reject(e.code === "ENOENT" ? new Error(`${cmd} is not installed (run scripts/ubuntu/setup.sh)`) : e),
    );
    child.on("close", (code) => resolve({ code: code ?? 1, stderr }));
  });
  child.stdin.end(opts.input ?? "");
  return { stdout: child.stdout, done, kill: () => child.kill("SIGKILL") };
}

async function collect(p: Proc, timeoutMs = 60000) {
  const chunks: Buffer[] = [];
  p.stdout.on("data", (c: Buffer) => chunks.push(c));
  const t = setTimeout(p.kill, timeoutMs);
  try {
    const r = await p.done;
    return { ...r, stdout: Buffer.concat(chunks).toString("utf8") };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Stream stdout; fails the stream when the process exits non-zero.
 * The first `hold` bytes are held back until more data arrives or the process exits,
 * for tools that print errors to stdout (smbclient -c) — those never reach the consumer.
 */
function procStream(
  start: () => Promise<Proc>,
  failMsg: (output: string, code: number) => string | null,
  hold = 0,
) {
  const out = new PassThrough();
  start()
    .then((p) => {
      out.on("close", () => p.kill()); // consumer went away (e.g. browser cancelled)
      let held: Buffer[] | null = hold ? [] : null;
      let heldLen = 0;
      p.stdout.on("data", (c: Buffer) => {
        if (!held) return void (out.write(c) || (p.stdout.pause(), out.once("drain", () => p.stdout.resume())));
        held.push(c);
        heldLen += c.length;
        if (heldLen > hold) {
          out.write(Buffer.concat(held));
          held = null;
        }
      });
      const ended = new Promise((r) => p.stdout.once("end", r));
      return Promise.all([p.done, ended]).then(([{ code, stderr }]) => {
        const text = held ? Buffer.concat(held).toString("utf8") : "";
        const msg = failMsg(`${stderr}\n${text}`.trim(), code);
        if (msg) return void out.destroy(new Error(msg));
        if (held) out.write(Buffer.concat(held));
        out.end();
      });
    })
    .catch((e) => out.destroy(e));
  return out;
}

/** cut [start, end] (inclusive) out of a stream that starts at byte 0 */
function sliceStream(src: Readable, start: number, end: number) {
  let pos = 0;
  const out = new PassThrough();
  src.on("data", (c: Buffer) => {
    const from = Math.max(0, start - pos);
    const to = Math.min(c.length, end + 1 - pos);
    pos += c.length;
    if (to > from) out.write(c.subarray(from, to));
    if (pos > end) {
      out.end();
      src.destroy();
    }
  });
  src.on("end", () => out.end());
  src.on("error", (e) => out.destroy(e));
  out.on("close", () => src.destroy());
  return out;
}

/** split a stream into records on `sep`, calling onRecord sequentially (backpressure aware) */
async function eachRecord(s: Readable, sep: string | (() => string), onRecord: (r: string) => Promise<void>) {
  let buf = "";
  for await (const chunk of s) {
    buf += chunk.toString("utf8");
    const parts = buf.split(typeof sep === "string" ? sep : sep());
    buf = parts.pop() ?? "";
    for (const p of parts) if (p) await onRecord(p);
  }
  if (buf) await onRecord(buf);
}

/* ----------------------------------- SSH ---------------------------------- */

/** `cd` into the remote root: "" = home, "~/x" relative to home */
function cdRoot(root: string) {
  if (!root || root === "~") return "cd";
  if (root.startsWith("~/")) return `cd && cd -- ${shq(root.slice(2))}`;
  return `cd -- ${shq(root)}`;
}

/** relative path argument for remote commands ("" = .) */
const rq = (rel: string) => shq(safeRel(rel) ? `./${safeRel(rel)}` : ".");

function parseSshEntry(type: string, size: string, mtime: string, rel: string): FsEntry {
  const d = new Date(Math.floor(Number(mtime) * 1000));
  const isDirectory = type === "d" || type === "directory";
  return { name: baseName(rel), isDirectory, size: isDirectory ? 0 : Number(size) || 0, mtime: d, birthtime: d };
}

function sshFs(remote: RemoteDoc, root: string): FolderFs {
  // always run under sh: the login shell may be anything (fish, csh, a NAS menu…)
  const exec = async (script: string) => {
    const c = await sshCommand(remote, `sh -c ${shq(`${cdRoot(root)} || exit 97\n${script}`)}`, { multiplex: true });
    return spawnProc(c.cmd, c.args, { env: c.env });
  };
  const run = async (script: string, timeoutMs?: number) => {
    const r = await collect(await exec(script), timeoutMs);
    if (r.code === 97) throw new Error(`${remote.name}:${root || "~"} is not accessible: ${r.stderr.trim()}`);
    if (r.code === 255) throw new Error(`ssh to ${remote.name} failed: ${r.stderr.trim()}`);
    return r;
  };
  const label = `${remote.name}:${root || "~"}`;

  return {
    label,
    async listRoot() {
      const r = await run("ls -1A", 20000);
      if (r.code !== 0) throw new Error(r.stderr.trim() || `ls failed (${r.code})`);
      return r.stdout.split("\n").filter(Boolean);
    },
    async walk(relDir, onEntry) {
      const start = rq(relDir);
      // GNU find: NUL separated records; busybox find has no -printf, fall back to stat -c (newline separated)
      const p = await exec(
        `if find . -maxdepth 0 -printf '' >/dev/null 2>&1; then printf 'G\\0'; ` +
          `find ${start} -mindepth 1 \\( -type f -o -type d \\) -printf '%y\\t%s\\t%T@\\t%p\\0'; ` +
          `else printf 'B\\n'; find ${start} -mindepth 1 \\( -type f -o -type d \\) -exec stat -c '%F\\t%s\\t%Y\\t%n' {} +; fi`,
      );
      let sep: string | null = null;
      let head = "";
      const strip = (p: string) => p.replace(/^\.\//, "");
      const handle = async (rec: string) => {
        const [type, size, mtime, ...rest] = rec.split("\t");
        const rel = strip(rest.join("\t"));
        if (!rel || !type) return;
        await onEntry(parentOf(rel), parseSshEntry(type, size, mtime, rel));
      };
      // the first byte tells which format follows
      const body = new PassThrough();
      p.stdout.on("data", (c: Buffer) => {
        if (sep) return void body.write(c);
        head += c.toString("utf8");
        if (head.length < 2) return;
        sep = head[1] === "\0" ? "\0" : "\n";
        body.write(head.slice(2));
      });
      p.stdout.on("end", () => body.end());
      // body only receives data once the separator is known
      await eachRecord(body, () => sep ?? "\0", handle);
      const { code, stderr } = await p.done;
      if (code === 97) throw new Error(`${label} is not accessible: ${stderr.trim()}`);
      if (code === 255) throw new Error(`ssh to ${remote.name} failed: ${stderr.trim()}`);
      // find exits 1 and reports unreadable dirs on stderr; keep stale index entries then
      const denied = stderr.split("\n").filter((l) => /find:|stat:/.test(l)).length;
      return code === 0 ? 0 : Math.max(1, denied);
    },
    async stat(rel) {
      const r = await run(`stat -c '%F\t%s\t%Y' -- ${rq(rel)}`, 20000);
      if (r.code !== 0) {
        if (/No such file/i.test(r.stderr)) return null;
        throw new Error(r.stderr.trim() || `stat failed (${r.code})`);
      }
      const [type, size, mtime] = r.stdout.trim().split("\t");
      return parseSshEntry(type === "directory" ? "d" : "f", size, mtime, safeRel(rel) || label);
    },
    read(rel, range) {
      const len = range ? range.end - range.start + 1 : 0;
      const script = range
        ? `tail -c +${range.start + 1} -- ${rq(rel)} | head -c ${len}`
        : `cat -- ${rq(rel)}`;
      return procStream(
        () => exec(script),
        (stderr, code) => (code === 0 ? null : stderr.trim() || `read failed (${code})`),
      );
    },
    async sha1(rel) {
      const r = await run(`sha1sum -- ${rq(rel)}`, 30 * 60_000);
      const m = r.code === 0 && r.stdout.match(/^([0-9a-f]{40})\b/);
      if (m) return m[1];
      if (r.code === 127 || /not found/i.test(r.stderr)) return sha1Stream(this.read(rel)); // no sha1sum
      throw new Error(r.stderr.trim() || `sha1sum failed (${r.code})`);
    },
    async sha1Many(items) {
      // hashed on the remote host: no file content crosses the network
      const out = new Map<string, string>();
      const r = await run(`sha1sum -- ${items.map((i) => rq(i.rel)).join(" ")}`, 60 * 60_000);
      if (r.code === 127) return out; // no sha1sum: caller falls back to streaming
      for (const line of r.stdout.split("\n")) {
        const m = line.match(/^([0-9a-f]{40}) [ *](.+)$/); // escaped names ("\\…") are left to the fallback
        if (m) out.set(safeRel(m[2]), m[1]);
      }
      return out;
    },
    async rm(rel, isDirectory) {
      if (!safeRel(rel)) throw new Error("refusing to delete folder root");
      const r = await run(`rm ${isDirectory ? "-rf" : "-f"} -- ${rq(rel)}`, 10 * 60_000);
      if (r.code !== 0) throw new Error(r.stderr.trim() || `rm failed (${r.code})`);
    },
  };
}

/* ----------------------------------- SMB ---------------------------------- */

const SMB_LINE_RE =
  /^ {2}(.+?)\s+([A-Z]*)\s+(\d+)\s+((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) \w{3} [ \d]\d \d\d:\d\d:\d\d \d{4})$/;

/** smbclient "ls" line → entry (or null for headers / . / ..) */
function parseSmbLine(line: string): FsEntry | null {
  const m = line.match(SMB_LINE_RE);
  if (!m || m[1] === "." || m[1] === "..") return null;
  const d = new Date(m[4]);
  const isDirectory = m[2].includes("D");
  return { name: m[1], isDirectory, size: isDirectory ? 0 : Number(m[3]), mtime: d, birthtime: d };
}

function smbFs(remote: RemoteDoc, root: string): FolderFs {
  const [share, sub] = splitSmbPath(root);
  if (!share) throw new Error("Direct SMB folders need a share");
  const label = `${remote.name}:/${share}${sub ? "/" + sub : ""}`;
  /** path inside the share, backslash separated, quoted for smbclient */
  const smbPath = (rel: string) => {
    const p = [sub, safeRel(rel)].filter(Boolean).join("/");
    if (/["\n]/.test(p)) throw new Error(`Unsupported character in path for SMB: ${p}`);
    return p.replace(/\//g, "\\");
  };

  /**
   * run smbclient; commands go on stdin (no ";" splitting issues), or with `-c` when the
   * output must be clean (stdin mode prints a banner to stdout). Creds live until the process exits.
   */
  const exec = async (commands: string[], viaArg = false): Promise<Proc> => {
    const dir = await fs.mkdtemp(path.join(/*turbopackIgnore: true*/ os.tmpdir(), "hx-smb-"));
    const cred = path.join(/*turbopackIgnore: true*/ dir, "creds");
    const lines = [
      `username=${remote.user || "guest"}`,
      `password=${remote.passwordEnc ? decryptSecret(remote.passwordEnc) : ""}`,
    ];
    if (remote.domain) lines.push(`domain=${remote.domain}`);
    await fs.writeFile(cred, lines.join("\n") + "\n", { mode: 0o600 });
    const base = [`//${remote.host}/${share}`, ...smbBaseArgs(remote, cred)];
    const p = viaArg
      ? spawnProc("smbclient", [...base, "-c", commands.join("; ")])
      : spawnProc("smbclient", base, { input: commands.join("\n") + "\nexit\n" });
    const cleanup = () => fs.rm(dir, { recursive: true, force: true });
    p.done.then(cleanup, cleanup);
    return p;
  };
  const run = async (commands: string[], timeoutMs?: number) => {
    const r = await collect(await exec(commands), timeoutMs);
    const err = (r.stdout + "\n" + r.stderr).match(/NT_STATUS_\w+/)?.[0];
    return { ...r, err };
  };
  const fatal = (err?: string) =>
    err && /LOGON_FAILURE|BAD_NETWORK_NAME|CONNECTION_REFUSED|HOST_UNREACHABLE|IO_TIMEOUT|ACCESS_DENIED/.test(err);

  return {
    label,
    async listRoot() {
      const cmds = sub ? [`cd "${smbPath("")}"`, "ls"] : ["ls"];
      const r = await run(cmds, 30000);
      if (r.err && (fatal(r.err) || /OBJECT_NAME_NOT_FOUND|OBJECT_PATH_NOT_FOUND|NO_SUCH_FILE/.test(r.err)))
        throw new Error(`${label}: ${r.err}`);
      if (r.code !== 0) throw new Error(r.stderr.trim() || `smbclient failed (${r.code})`);
      return r.stdout.split("\n").map(parseSmbLine).filter(Boolean).map((e) => e!.name);
    },
    async walk(relDir, onEntry) {
      const startDir = smbPath(relDir);
      // recursive ls prints "\dir\sub" headers followed by that directory's entries
      const prefix = (sub ? sub.replace(/\//g, "\\") : "").toLowerCase();
      const p = await exec([...(startDir ? [`cd "${startDir}"`] : []), "recurse ON", "ls"]);
      let cur = safeRel(relDir);
      let readErrors = 0;
      await eachRecord(p.stdout, "\n", async (raw) => {
        const line = raw.replace(/\r$/, "");
        if (line.startsWith("\\")) {
          // header: path from the share root; make it folder relative
          let h = line.slice(1);
          if (prefix && h.toLowerCase().startsWith(prefix)) h = h.slice(prefix.length).replace(/^\\/, "");
          cur = h.replace(/\\/g, "/");
          return;
        }
        if (/NT_STATUS_/.test(line)) {
          readErrors++;
          return;
        }
        const e = parseSmbLine(line);
        if (e) await onEntry(cur, e);
      });
      const { code, stderr } = await p.done;
      const err = stderr.match(/NT_STATUS_\w+/)?.[0];
      if (fatal(err) && !readErrors) throw new Error(`${label}: ${err}`);
      return code === 0 ? readErrors : Math.max(1, readErrors);
    },
    async stat(rel) {
      const r = safeRel(rel);
      if (!r) {
        await this.listRoot();
        const now = new Date();
        return { name: label, isDirectory: true, size: 0, mtime: now, birthtime: now };
      }
      const parent = smbPath(parentOf(r));
      const res = await run([...(parent ? [`cd "${parent}"`] : []), `ls "${baseName(r)}"`], 30000);
      if (res.err && /NO_SUCH_FILE|OBJECT_NAME_NOT_FOUND|OBJECT_PATH_NOT_FOUND/.test(res.err)) return null;
      if (res.err) throw new Error(`${label}: ${res.err}`);
      const e = res.stdout.split("\n").map(parseSmbLine).find((x) => x?.name === baseName(r));
      return e ?? null;
    },
    read(rel, range) {
      const p = smbPath(rel);
      if (p.includes(";")) throw new Error(`Unsupported character ";" in path for SMB reads: ${rel}`);
      const full = procStream(
        () => exec([`get "${p}" -`], true),
        (output, code) => {
          if (code === 0) return null;
          const err = output.match(/NT_STATUS_\w+/)?.[0];
          return err ? `${label}: ${err}` : output || `smbclient failed (${code})`;
        },
        1024,
      );
      // smbclient cannot read a byte range; stream from 0 and cut
      return range ? sliceStream(full, range.start, range.end) : full;
    },
    sha1(rel) {
      return sha1Stream(this.read(rel));
    },
    async sha1Many(items) {
      // one smbclient session downloads the batch into a temp dir; hash + delete locally
      const out = new Map<string, string>();
      const dir = await fs.mkdtemp(path.join(/*turbopackIgnore: true*/ os.tmpdir(), "hx-smbhash-"));
      try {
        const ok = items.filter((i) => !/["\n]/.test(i.rel));
        const cmds = [`lcd "${dir}"`, ...ok.map((i, n) => `get "${smbPath(i.rel)}" "${n}"`)];
        await run(cmds, 60 * 60_000);
        for (const [n, i] of ok.entries()) {
          const f = path.join(/*turbopackIgnore: true*/ dir, String(n));
          const st = await fs.stat(f).catch(() => null);
          if (!st || st.size !== i.size) continue; // missing / changed: let the fallback report it
          out.set(safeRel(i.rel), await sha1Stream(createReadStream(f)));
          await fs.rm(f, { force: true });
        }
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
      return out;
    },
    async rm(rel, isDirectory) {
      const r = safeRel(rel);
      if (!r) throw new Error("refusing to delete folder root");
      const res = await run([isDirectory ? `deltree "${smbPath(r)}"` : `del "${smbPath(r)}"`], 10 * 60_000);
      if (res.err && !/NO_SUCH_FILE|OBJECT_NAME_NOT_FOUND|OBJECT_PATH_NOT_FOUND/.test(res.err))
        throw new Error(`${label}: ${res.err}`);
    },
  };
}

/* --------------------------------- factory -------------------------------- */

/** file access for a folder; mounts mount-mode remotes on demand */
export async function folderFs(folder: FolderDoc): Promise<FolderFs> {
  if (isDirect(folder)) {
    const { remotes } = await collections();
    const remote = await remotes.findOne({ _id: folder.mount!.remoteId });
    if (!remote) throw new Error("Remote for this folder no longer exists");
    void touchFolder(folder);
    return remote.type === "smb" ? smbFs(remote, folder.mount!.remotePath) : sshFs(remote, folder.mount!.remotePath);
  }
  if (folder.mount) await ensureMounted(folder);
  return localFs(folder.path);
}

/** direct access to a remote path without a data folder (used by tests / tools) */
export function remoteFs(remote: RemoteDoc, remotePath: string): FolderFs {
  return remote.type === "smb" ? smbFs(remote, remotePath) : sshFs(remote, remotePath);
}

import { ChildProcess, spawn } from "child_process";
import { ObjectId } from "mongodb";

import { getDb, RemoteDoc } from "@/lib/db";
import { remotePassword, sshCommand } from "@/lib/mounts";
import { decryptSecret } from "@/lib/secrets";
import { maskSecrets, renderTemplate, TargetInfo } from "./template";

/**
 * Remote command execution for the Commands module.
 *
 * A run = one command (template) executed on N ssh remotes in parallel (bounded).
 * The rendered script is sent on stdin to `bash -s` (falls back to sh), so multi-line
 * scripts, heredocs and quotes work without any escaping. Output is kept in memory
 * while the run is live (polled by the UI) and persisted to `command_runs` at the end.
 */

export type TargetStatus = "queued" | "running" | "success" | "failed" | "cancelled" | "timeout";
/** o = stdout, e = stderr, i = info line from hexplorer itself */
export type Chunk = [kind: "o" | "e" | "i", text: string];

export interface TargetRun {
  remoteId: string;
  name: string;
  host: string;
  status: TargetStatus;
  exitCode: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  chunks: Chunk[];
  size: number;
  truncated: boolean;
  /** rendered commands (secrets masked), one per invocation */
  commands: string[];
}

export interface RunState {
  id: string;
  title: string;
  scriptId: string | null;
  stepId: string | null;
  /** command template (secrets are only ever in params, so it is safe to show) */
  template: string;
  foreach: boolean;
  sudo: boolean;
  createdAt: number;
  finishedAt: number | null;
  status: "running" | "done";
  targets: TargetRun[];
}

interface LiveRun extends RunState {
  secrets: string[];
  children: Set<ChildProcess>;
  cancelled: boolean;
}

export interface StartRunInput {
  title?: string;
  scriptId?: string | null;
  stepId?: string | null;
  command: string;
  params: Record<string, string>;
  /** names of params whose values must be masked in history */
  secretParams?: string[];
  /** selected values per remote id ("*" = for every target without its own) */
  selection?: Record<string, string[]>;
  foreach?: boolean;
  sudo?: boolean;
  /** used for sudo when the remote has no stored password; never stored */
  sudoPassword?: string | null;
  timeoutSec?: number;
  concurrency?: number;
}

const MAX_LIVE_BYTES = 4 * 1024 * 1024;
const MAX_STORED_BYTES = 512 * 1024;
const KEEP_FINISHED_MS = 15 * 60 * 1000;

const g = globalThis as unknown as { _hexRuns?: Map<string, LiveRun> };
const runs = (g._hexRuns ??= new Map<string, LiveRun>());

export function getLiveRun(id: string): RunState | undefined {
  return runs.get(id);
}

export function liveRunIds() {
  return [...runs.values()].filter((r) => r.status === "running").map((r) => r.id);
}

function push(t: TargetRun, kind: Chunk[0], text: string) {
  if (!text) return;
  if (t.size >= MAX_LIVE_BYTES) {
    if (!t.truncated) {
      t.truncated = true;
      t.chunks.push(["i", "\n… output truncated (over 4 MB)\n"]);
    }
    return;
  }
  t.size += text.length;
  const last = t.chunks[t.chunks.length - 1];
  // merge adjacent chunks of the same stream, but keep chunk count growing so pollers see
  // new data by index: only merge into chunks that are not yet "sealed" (see snapshot)
  if (last && last[0] === kind && (last as any).open) last[1] += text;
  else {
    const c = [kind, text] as Chunk;
    (c as any).open = true;
    t.chunks.push(c);
  }
}

/** the remote side: run stdin with bash (or sh), optionally through sudo */
function remoteWrapper(sudo: boolean, withPassword: boolean) {
  const S = `S=$(command -v bash 2>/dev/null || echo sh);`;
  if (!sudo) return `${S} exec "$S" -s`;
  if (!withPassword) return `${S} exec sudo -n "$S" -s`;
  // first stdin line is the sudo password: validate it, then the rest of stdin is the script
  return `${S} IFS= read -r HXP; printf '%s\\n' "$HXP" | sudo -S -p '' -v >/dev/null 2>&1; unset HXP; exec sudo -n "$S" -s`;
}

function execOnce(
  run: LiveRun,
  t: TargetRun,
  remote: RemoteDoc,
  script: string,
  sudoPw: string,
  sudo: boolean,
  timeoutMs: number,
): Promise<{ code: number | null; timedOut: boolean }> {
  return new Promise(async (resolve) => {
    let c;
    try {
      c = await sshCommand(remote, remoteWrapper(sudo, !!sudoPw));
    } catch (e: any) {
      push(t, "e", `${e?.message || e}\n`);
      return resolve({ code: -1, timedOut: false });
    }
    const child = spawn(c.cmd, c.args, {
      env: { ...process.env, ...c.env, LC_ALL: "C.UTF-8", TERM: "dumb" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    run.children.add(child);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d: string) => push(t, "o", maskSecrets(d, run.secrets)));
    child.stderr.on("data", (d: string) => push(t, "e", maskSecrets(d, run.secrets)));
    child.stdin.on("error", () => {});
    child.on("error", (e: any) => {
      push(
        t,
        "e",
        e.code === "ENOENT" ? `${c.cmd} is not installed on the hexplorer host\n` : `${e.message}\n`,
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      run.children.delete(child);
      resolve({ code, timedOut });
    });
    const body = script.endsWith("\n") ? script : script + "\n";
    child.stdin.end(sudo && sudoPw ? `${sudoPw}\n${body}` : body);
  });
}

async function runTarget(run: LiveRun, t: TargetRun, remote: RemoteDoc | null, input: StartRunInput) {
  t.status = "running";
  t.startedAt = Date.now();
  if (!remote) {
    push(t, "e", "Remote no longer exists\n");
    return finishTarget(t, "failed", -1);
  }
  if ((remote.type ?? "ssh") !== "ssh") {
    push(t, "e", "Commands can only run on SSH remotes\n");
    return finishTarget(t, "failed", -1);
  }
  const info: TargetInfo = { id: t.remoteId, name: remote.name, host: remote.host, user: remote.user };
  const sel = input.selection?.[t.remoteId] ?? input.selection?.["*"] ?? [];
  const items = input.foreach ? sel : [undefined];
  if (input.foreach && !items.length) {
    push(t, "i", "Nothing selected for this target — skipped\n");
    return finishTarget(t, "success", 0);
  }
  const sudoPw = input.sudo ? remotePassword(remote) || input.sudoPassword || "" : "";
  const timeoutMs = Math.min(Math.max(Number(input.timeoutSec) || 300, 5), 6 * 3600) * 1000;

  let firstFail: number | null = null;
  for (const item of items) {
    if (run.cancelled) return finishTarget(t, "cancelled", null);
    let script: string;
    try {
      script = renderTemplate(input.command, { params: input.params, sel, item, target: info });
    } catch (e: any) {
      push(t, "e", `${e.message}\n`);
      return finishTarget(t, "failed", -1);
    }
    t.commands.push(maskSecrets(script, run.secrets));
    if (items.length > 1 || input.foreach) push(t, "i", `▶ ${item}\n`);
    const { code, timedOut } = await execOnce(run, t, remote, script, sudoPw, !!input.sudo, timeoutMs);
    if (code !== 0 && firstFail === null) firstFail = code;
    if (run.cancelled) return finishTarget(t, "cancelled", code);
    if (timedOut) {
      push(t, "i", `\n⏱ timed out after ${timeoutMs / 1000}s\n`);
      return finishTarget(t, "timeout", code);
    }
    if (code === 255) push(t, "i", "ssh exited with 255 — connection or authentication failed\n");
    if (code !== 0 && input.foreach) push(t, "i", `exit ${code}\n`);
  }
  finishTarget(t, firstFail === null ? "success" : "failed", firstFail ?? 0);
}

function finishTarget(t: TargetRun, status: TargetStatus, code: number | null) {
  t.status = status;
  t.exitCode = code;
  t.finishedAt = Date.now();
}

/** load remotes, create the run and execute it in the background; returns the run id */
export async function startRun(remoteIds: string[], input: StartRunInput): Promise<string> {
  if (!input.command?.trim()) throw new Error("Command is empty");
  const ids = [...new Set(remoteIds)].filter((id) => ObjectId.isValid(id));
  if (!ids.length) throw new Error("Pick at least one target");
  const db = await getDb();
  const docs = await db
    .collection<RemoteDoc>("remotes")
    .find({ _id: { $in: ids.map((i) => new ObjectId(i)) } })
    .toArray();
  const byId = new Map(docs.map((d) => [d._id.toHexString(), d]));
  const secrets = (input.secretParams ?? []).map((n) => input.params[n]).filter(Boolean) as string[];
  if (input.sudoPassword) secrets.push(input.sudoPassword);
  for (const d of docs) if (d.passwordEnc && d.auth === "password") secrets.push(decryptSecret(d.passwordEnc));

  const id = new ObjectId().toHexString();
  const run: LiveRun = {
    id,
    title: input.title?.trim() || input.command.trim().split("\n")[0].slice(0, 80),
    scriptId: input.scriptId ?? null,
    stepId: input.stepId ?? null,
    template: input.command,
    foreach: !!input.foreach,
    sudo: !!input.sudo,
    createdAt: Date.now(),
    finishedAt: null,
    status: "running",
    targets: ids.map((rid) => ({
      remoteId: rid,
      name: byId.get(rid)?.name ?? "(deleted)",
      host: byId.get(rid)?.host ?? "",
      status: "queued",
      exitCode: null,
      startedAt: null,
      finishedAt: null,
      chunks: [],
      size: 0,
      truncated: false,
      commands: [],
    })),
    secrets,
    children: new Set(),
    cancelled: false,
  };
  runs.set(id, run);

  const limit = Math.min(Math.max(Number(input.concurrency) || 8, 1), 64);
  const queue = [...run.targets];
  const worker = async () => {
    for (let t = queue.shift(); t; t = queue.shift()) {
      if (run.cancelled) {
        finishTarget(t, "cancelled", null);
        continue;
      }
      await runTarget(run, t, byId.get(t.remoteId) ?? null, input).catch((e) => {
        push(t!, "e", `${e?.message || e}\n`);
        finishTarget(t!, "failed", -1);
      });
    }
  };
  Promise.all(Array.from({ length: Math.min(limit, queue.length) }, worker))
    .then(() => finishRun(run))
    .catch((e) => console.error("command run failed", e));
  return id;
}

export function cancelRun(id: string) {
  const run = runs.get(id);
  if (!run || run.status !== "running") return false;
  run.cancelled = true;
  for (const c of run.children) c.kill("SIGKILL");
  for (const t of run.targets) if (t.status === "queued") finishTarget(t, "cancelled", null);
  return true;
}

export function joinStream(chunks: Chunk[], kinds: string) {
  return chunks
    .filter((c) => kinds.includes(c[0]))
    .map((c) => c[1])
    .join("");
}

export interface RunDoc {
  _id: ObjectId;
  title: string;
  scriptId: string | null;
  stepId: string | null;
  template: string;
  foreach: boolean;
  sudo: boolean;
  createdAt: Date;
  finishedAt: Date;
  durationMs: number;
  ok: number;
  failed: number;
  targets: {
    remoteId: string;
    name: string;
    host: string;
    status: TargetStatus;
    exitCode: number | null;
    durationMs: number | null;
    commands: string[];
    chunks: Chunk[];
  }[];
}

async function finishRun(run: LiveRun) {
  run.status = "done";
  run.finishedAt = Date.now();
  for (const t of run.targets) for (const c of t.chunks) delete (c as any).open;
  try {
    const db = await getDb();
    const doc: RunDoc = {
      _id: new ObjectId(run.id),
      title: run.title,
      scriptId: run.scriptId,
      stepId: run.stepId,
      template: run.template,
      foreach: run.foreach,
      sudo: run.sudo,
      createdAt: new Date(run.createdAt),
      finishedAt: new Date(run.finishedAt),
      durationMs: run.finishedAt - run.createdAt,
      ok: run.targets.filter((t) => t.status === "success").length,
      failed: run.targets.filter((t) => t.status !== "success").length,
      targets: run.targets.map((t) => {
        // store at most MAX_STORED_BYTES per stream, keeping chunk boundaries for colouring
        let budget = MAX_STORED_BYTES;
        const chunks: Chunk[] = [];
        for (const c of t.chunks) {
          if (budget <= 0) break;
          chunks.push([c[0], c[1].slice(0, budget)]);
          budget -= c[1].length;
        }
        if (budget <= 0) chunks.push(["i", "\n… truncated in history\n"]);
        return {
          remoteId: t.remoteId,
          name: t.name,
          host: t.host,
          status: t.status,
          exitCode: t.exitCode,
          durationMs: t.startedAt && t.finishedAt ? t.finishedAt - t.startedAt : null,
          commands: t.commands,
          chunks,
        };
      }),
    };
    await db.collection<RunDoc>("command_runs").insertOne(doc);
    if (run.scriptId && ObjectId.isValid(run.scriptId))
      await db
        .collection("command_scripts")
        .updateOne({ _id: new ObjectId(run.scriptId) }, { $set: { lastRunAt: new Date() }, $inc: { runCount: 1 } });
  } catch (e) {
    console.error("failed to save command run", e);
  }
  setTimeout(() => runs.delete(run.id), KEEP_FINISHED_MS).unref?.();
}


"use server";

import { ObjectId } from "mongodb";

import { getDb, RemoteDoc } from "@/lib/db";
import { probeHosts, type HostHealth } from "@/lib/commands/health";
import {
  cancelRun,
  Chunk,
  getLiveRun,
  LOCAL_TARGET,
  LOCAL_TARGET_NAME,
  RunDoc,
  startRun,
  StartRunInput,
  TargetStatus,
} from "@/lib/commands/runner";
import { SNIPPETS } from "@/lib/commands/snippets";
import type { ScriptParam, ScriptStep } from "@/lib/commands/template";

/* ---------------------------------- types ---------------------------------- */

export type CmdResult<T> = { ok: true; data: T } | { ok: false; error: string };

export interface CmdTarget {
  id: string;
  name: string;
  host: string;
  user: string | null;
  port: number | null;
  /** the hexplorer host itself (commands run locally, not over ssh) */
  local?: boolean;
}

export interface CmdGroup {
  id: string;
  name: string;
  remoteIds: string[];
}

export interface CmdScript {
  id: string;
  name: string;
  description: string;
  tags: string[];
  params: ScriptParam[];
  steps: ScriptStep[];
  defaultTargets: string[];
  favorite: boolean;
  runCount: number;
  lastRunAt: string | null;
  updatedAt: string;
}

export type CmdScriptInput = Omit<CmdScript, "id" | "runCount" | "lastRunAt" | "updatedAt"> & { id?: string };

export interface RunTargetView {
  remoteId: string;
  name: string;
  host: string;
  status: TargetStatus;
  exitCode: number | null;
  durationMs: number | null;
  commands: string[];
  /** chunk index the returned chunks start at (first one continues the client's chunk at that index) */
  from: number;
  chunks: Chunk[];
  cursor: [number, number];
}

export interface RunView {
  id: string;
  title: string;
  template: string;
  scriptId: string | null;
  stepId: string | null;
  status: "running" | "done";
  createdAt: string;
  finishedAt: string | null;
  targets: RunTargetView[];
}

export interface HistoryItem {
  id: string;
  title: string;
  template: string;
  scriptId: string | null;
  createdAt: string;
  durationMs: number;
  ok: number;
  failed: number;
  targets: { name: string; status: TargetStatus }[];
}

/* ---------------------------------- guard ---------------------------------- */

/** running commands on servers is as privileged as it gets: always check the session here too */
async function requireUser() {
  const [{ headers }, { auth }] = await Promise.all([import("next/headers"), import("@/lib/auth")]);
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  if (!session?.user) throw new Error("Not signed in");
  return session.user;
}

async function guarded<T>(fn: () => Promise<T>): Promise<CmdResult<T>> {
  try {
    await requireUser();
    return { ok: true, data: await fn() };
  } catch (e: any) {
    return { ok: false, error: (e?.message || String(e)).trim() };
  }
}

const oid = (id: string) => {
  if (!ObjectId.isValid(id)) throw new Error(`invalid id: ${id}`);
  return new ObjectId(id);
};

async function cols() {
  const db = await getDb();
  return {
    remotes: db.collection<RemoteDoc>("remotes"),
    scripts: db.collection<any>("command_scripts"),
    groups: db.collection<any>("command_groups"),
    runs: db.collection<RunDoc>("command_runs"),
  };
}

/* --------------------------------- targets --------------------------------- */

export async function listCmdTargets() {
  return guarded(async () => {
    const { remotes, groups } = await cols();
    const [r, g] = await Promise.all([
      remotes.find({ $or: [{ type: "ssh" }, { type: { $exists: false } }] }).sort({ name: 1 }).toArray(),
      groups.find().sort({ name: 1 }).toArray(),
    ]);
    const local: CmdTarget = {
      id: LOCAL_TARGET,
      name: LOCAL_TARGET_NAME,
      host: "localhost",
      user: process.env.USER ?? null,
      port: null,
      local: true,
    };
    return {
      targets: [
        local,
        ...r.map(
          (x): CmdTarget => ({
            id: x._id.toHexString(),
            name: x.name,
            host: x.host,
            user: x.user ?? null,
            port: x.port ?? null,
          }),
        ),
      ],
      groups: g.map((x): CmdGroup => ({ id: x._id.toHexString(), name: x.name, remoteIds: x.remoteIds ?? [] })),
    };
  });
}

export async function saveCmdGroup(input: { id?: string; name: string; remoteIds: string[] }) {
  return guarded(async () => {
    const name = input.name.trim();
    if (!name) throw new Error("Group name is required");
    const { groups } = await cols();
    const doc = { name: name.slice(0, 60), remoteIds: [...new Set(input.remoteIds)] };
    if (input.id) {
      await groups.updateOne({ _id: oid(input.id) }, { $set: doc });
      return input.id;
    }
    return (await groups.insertOne({ ...doc, createdAt: new Date() })).insertedId.toHexString();
  });
}

export async function deleteCmdGroup(id: string) {
  return guarded(async () => {
    const { groups } = await cols();
    await groups.deleteOne({ _id: oid(id) });
  });
}

/* --------------------------------- scripts --------------------------------- */

function serializeScript(d: any): CmdScript {
  return {
    id: d._id.toHexString(),
    name: d.name,
    description: d.description ?? "",
    tags: d.tags ?? [],
    params: d.params ?? [],
    steps: d.steps ?? [],
    defaultTargets: d.defaultTargets ?? [],
    favorite: !!d.favorite,
    runCount: d.runCount ?? 0,
    lastRunAt: d.lastRunAt ? new Date(d.lastRunAt).toISOString() : null,
    updatedAt: new Date(d.updatedAt ?? d.createdAt ?? Date.now()).toISOString(),
  };
}

const PARAM_NAME = /^[a-zA-Z_][\w-]*$/;
const RESERVED = new Set(["sel", "item", "host", "target", "user"]);

function cleanScript(input: CmdScriptInput) {
  const name = input.name?.trim();
  if (!name) throw new Error("Script name is required");
  const seen = new Set<string>();
  const params = (input.params ?? []).map((p) => {
    const n = p.name?.trim();
    if (!n || !PARAM_NAME.test(n)) throw new Error(`Invalid parameter name “${p.name}” (letters, digits, _ and -)`);
    if (RESERVED.has(n)) throw new Error(`“${n}” is a built-in variable and cannot be a parameter`);
    if (seen.has(n)) throw new Error(`Duplicate parameter “${n}”`);
    seen.add(n);
    const options = p.type === "select" ? (p.options ?? []).map((o) => o.trim()).filter(Boolean) : undefined;
    if (p.type === "select" && !options!.length) throw new Error(`Parameter “${n}” needs at least one option`);
    if (p.type === "select" && p.default && !options!.includes(p.default))
      throw new Error(`Default of “${n}” is not one of its options`);
    if (p.type === "number" && p.default && isNaN(Number(p.default)))
      throw new Error(`Default of “${n}” must be a number`);
    return {
      name: n,
      label: p.label?.trim() || undefined,
      type: (["text", "number", "select", "bool", "secret"] as const).includes(p.type) ? p.type : "text",
      // secrets are never stored with a default
      default: p.type === "secret" ? undefined : (p.default ?? undefined),
      options,
      required: !!p.required,
      description: p.description?.trim() || undefined,
    };
  });
  const steps = (input.steps ?? []).map((s) => {
    if (!s.command?.trim()) throw new Error("Every step needs a command");
    return {
      id: s.id || new ObjectId().toHexString(),
      title: s.title?.trim() || undefined,
      command: s.command,
      foreach: !!s.foreach,
      pick: s.pick ?? null,
      sudo: !!s.sudo,
      continueOnError: !!s.continueOnError,
      timeoutSec: s.timeoutSec ? Number(s.timeoutSec) : undefined,
    };
  });
  if (!steps.length) throw new Error("A script needs at least one step");
  return {
    name: name.slice(0, 100),
    description: input.description?.trim() ?? "",
    tags: [...new Set((input.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean))],
    params,
    steps,
    defaultTargets: input.defaultTargets ?? [],
    favorite: !!input.favorite,
  };
}

export async function listCmdScripts() {
  return guarded(async () => {
    const { scripts } = await cols();
    return (await scripts.find().sort({ favorite: -1, name: 1 }).toArray()).map(serializeScript);
  });
}

export async function saveCmdScript(input: CmdScriptInput) {
  return guarded(async () => {
    const doc = cleanScript(input);
    const { scripts } = await cols();
    if (input.id) {
      await scripts.updateOne({ _id: oid(input.id) }, { $set: { ...doc, updatedAt: new Date() } });
      return serializeScript(await scripts.findOne({ _id: oid(input.id) }));
    }
    const now = new Date();
    const res = await scripts.insertOne({ ...doc, runCount: 0, createdAt: now, updatedAt: now });
    return serializeScript({ ...doc, _id: res.insertedId, updatedAt: now });
  });
}

export async function deleteCmdScript(id: string) {
  return guarded(async () => {
    const { scripts } = await cols();
    await scripts.deleteOne({ _id: oid(id) });
  });
}

/** copy a saved script as "<name> (copy)", "<name> (copy 2)", … with fresh step ids and no run stats */
export async function duplicateCmdScript(id: string) {
  return guarded(async () => {
    const { scripts } = await cols();
    const src = await scripts.findOne({ _id: oid(id) });
    if (!src) throw new Error("Script not found");
    const base = String(src.name).replace(/ \(copy(?: \d+)?\)$/, "");
    const taken = new Set(
      (await scripts.find({}, { projection: { name: 1 } }).toArray()).map((d) => String(d.name)),
    );
    let name = `${base} (copy)`;
    for (let n = 2; taken.has(name); n++) name = `${base} (copy ${n})`;
    const doc = cleanScript({
      name,
      description: src.description ?? "",
      tags: src.tags ?? [],
      params: src.params ?? [],
      steps: (src.steps ?? []).map((st: ScriptStep) => ({ ...st, id: "" })),
      defaultTargets: src.defaultTargets ?? [],
      favorite: false,
    });
    const now = new Date();
    const res = await scripts.insertOne({ ...doc, runCount: 0, createdAt: now, updatedAt: now });
    return serializeScript({ ...doc, _id: res.insertedId, updatedAt: now });
  });
}

export async function setCmdScriptFavorite(id: string, favorite: boolean) {
  return guarded(async () => {
    const { scripts } = await cols();
    await scripts.updateOne({ _id: oid(id) }, { $set: { favorite } });
  });
}

/** copy a built-in snippet into the library */
export async function importCmdSnippet(key: string) {
  return guarded(async () => {
    const s = SNIPPETS.find((x) => x.key === key);
    if (!s) throw new Error("Unknown snippet");
    const doc = cleanScript({
      name: s.name,
      description: s.description,
      tags: [s.category.toLowerCase()],
      params: s.params ?? [],
      steps: s.steps.map((st) => ({ ...st, id: "" })),
      defaultTargets: [],
      favorite: false,
    });
    const { scripts } = await cols();
    const now = new Date();
    const res = await scripts.insertOne({ ...doc, runCount: 0, createdAt: now, updatedAt: now });
    return serializeScript({ ...doc, _id: res.insertedId, updatedAt: now });
  });
}

/** import scripts exported as JSON (array of scripts); returns how many were added */
export async function importCmdScripts(json: string) {
  return guarded(async () => {
    let arr: any;
    try {
      arr = JSON.parse(json);
    } catch {
      throw new Error("Not valid JSON");
    }
    if (!Array.isArray(arr)) arr = [arr];
    const docs = arr.map((x: any) => cleanScript({ ...x, id: undefined, defaultTargets: [] }));
    if (!docs.length) return 0;
    const { scripts } = await cols();
    const now = new Date();
    await scripts.insertMany(docs.map((d: any) => ({ ...d, runCount: 0, createdAt: now, updatedAt: now })));
    return docs.length;
  });
}

/* ----------------------------------- runs ---------------------------------- */

export async function startCmdRun(input: StartRunInput & { targets: string[] }) {
  return guarded(() => startRun(input.targets, input));
}

export async function cancelCmdRun(id: string) {
  return guarded(async () => cancelRun(id));
}

function viewFromDoc(d: RunDoc): RunView {
  return {
    id: d._id.toHexString(),
    title: d.title,
    template: d.template,
    scriptId: d.scriptId,
    stepId: d.stepId,
    status: "done",
    createdAt: d.createdAt.toISOString(),
    finishedAt: d.finishedAt.toISOString(),
    targets: d.targets.map((t) => ({
      remoteId: t.remoteId,
      name: t.name,
      host: t.host,
      status: t.status,
      exitCode: t.exitCode,
      durationMs: t.durationMs,
      commands: t.commands,
      from: 0,
      chunks: t.chunks,
      cursor: [Math.max(0, t.chunks.length - 1), t.chunks[t.chunks.length - 1]?.[1].length ?? 0],
    })),
  };
}

/**
 * Incremental view of a run. cursors[i] = [chunkIndex, charOffset] the client already has
 * for target i; omit to get everything.
 */
export async function pollCmdRun(id: string, cursors?: [number, number][]) {
  return guarded(async (): Promise<RunView> => {
    const live = getLiveRun(id);
    if (!live) {
      const { runs } = await cols();
      const d = await runs.findOne({ _id: oid(id) });
      if (!d) throw new Error("Run not found (history may have been cleared)");
      return viewFromDoc(d);
    }
    return {
      id: live.id,
      title: live.title,
      template: live.template,
      scriptId: live.scriptId,
      stepId: live.stepId,
      status: live.status,
      createdAt: new Date(live.createdAt).toISOString(),
      finishedAt: live.finishedAt ? new Date(live.finishedAt).toISOString() : null,
      targets: live.targets.map((t, i) => {
        const [ci, off] = cursors?.[i] ?? [0, 0];
        const from = Math.min(ci, t.chunks.length);
        const chunks: Chunk[] = t.chunks.slice(from).map((c, k) => [c[0], k === 0 ? c[1].slice(off) : c[1]]);
        const last = t.chunks.length - 1;
        return {
          remoteId: t.remoteId,
          name: t.name,
          host: t.host,
          status: t.status,
          exitCode: t.exitCode,
          durationMs: t.startedAt ? (t.finishedAt ?? Date.now()) - t.startedAt : null,
          commands: t.commands,
          from,
          chunks,
          cursor: [Math.max(0, last), t.chunks[last]?.[1].length ?? 0],
        };
      }),
    };
  });
}

export async function listCmdHistory(opts: { q?: string; scriptId?: string; limit?: number } = {}) {
  return guarded(async (): Promise<HistoryItem[]> => {
    const { runs } = await cols();
    const filter: any = {};
    if (opts.scriptId) filter.scriptId = opts.scriptId;
    if (opts.q?.trim()) {
      const rx = { $regex: opts.q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
      filter.$or = [{ title: rx }, { template: rx }, { "targets.name": rx }];
    }
    const docs = await runs
      .find(filter, { projection: { "targets.chunks": 0, "targets.commands": 0 } })
      .sort({ createdAt: -1 })
      .limit(Math.min(opts.limit ?? 100, 500))
      .toArray();
    return docs.map((d) => ({
      id: d._id.toHexString(),
      title: d.title,
      template: d.template,
      scriptId: d.scriptId,
      createdAt: d.createdAt.toISOString(),
      durationMs: d.durationMs,
      ok: d.ok,
      failed: d.failed,
      targets: d.targets.map((t) => ({ name: t.name, status: t.status })),
    }));
  });
}

export async function deleteCmdHistory(id?: string) {
  return guarded(async () => {
    const { runs } = await cols();
    if (id) await runs.deleteOne({ _id: oid(id) });
    else await runs.deleteMany({});
  });
}

/* ---------------------------------- fleet ---------------------------------- */

export async function fleetHealth(remoteIds?: string[]) {
  return guarded(async (): Promise<HostHealth[]> => {
    const { remotes } = await cols();
    const filter: any = { $or: [{ type: "ssh" }, { type: { $exists: false } }] };
    if (remoteIds?.length) filter._id = { $in: remoteIds.map(oid) };
    const docs = await remotes.find(filter).sort({ name: 1 }).toArray();
    return probeHosts(docs);
  });
}

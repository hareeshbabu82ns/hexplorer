import { ObjectId } from "mongodb";

import { getDb } from "@/lib/db";
import { joinStream, startRun, waitForRun } from "./runner";
import { applyPick, usesSelection, type ScriptParam, type ScriptStep } from "./template";

/**
 * Run a saved Commands script unattended (no UI): every step in order on the given
 * targets, feeding each step the values picked by the previous step's auto-pick rule.
 * Each step shows up in the Commands history like a run started from the console.
 */

export interface HeadlessResult {
  ok: boolean;
  /** short human readable outcome, e.g. "step 2 failed on nas (exit 1): …" */
  message: string;
  runIds: string[];
}

export interface SavedScript {
  _id: ObjectId;
  name: string;
  params?: ScriptParam[];
  steps?: ScriptStep[];
  defaultTargets?: string[];
}

export async function loadScript(id: string | ObjectId): Promise<SavedScript | null> {
  if (typeof id === "string" && !ObjectId.isValid(id)) return null;
  const db = await getDb();
  return db.collection<SavedScript>("command_scripts").findOne({ _id: new ObjectId(id) });
}

/** parameter values with defaults filled in; throws when a required one is missing */
export function resolveParams(params: ScriptParam[], values: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const p of params) {
    const v = values[p.name] ?? p.default ?? (p.type === "bool" ? "false" : "");
    if (p.required && !v) throw new Error(`parameter “${p.label || p.name}” is required`);
    out[p.name] = v;
  }
  return out;
}

const lastLines = (s: string) => s.trim().split("\n").slice(-3).join(" | ").slice(0, 400);

export async function runScriptHeadless(
  script: SavedScript,
  opts: { targets: string[]; params: Record<string, string>; title?: string },
): Promise<HeadlessResult> {
  const steps = script.steps ?? [];
  if (!steps.length) return { ok: false, message: "script has no steps", runIds: [] };
  if (!opts.targets.length) return { ok: false, message: "no targets to run on", runIds: [] };
  const defs = script.params ?? [];
  const params = resolveParams(defs, opts.params);
  const secretParams = defs.filter((p) => p.type === "secret").map((p) => p.name);

  const runIds: string[] = [];
  let selection: Record<string, string[]> | undefined;
  for (const [i, step] of steps.entries()) {
    const label = steps.length > 1 ? `step ${i + 1}${step.title ? ` (${step.title})` : ""}` : "script";
    if ((step.foreach || usesSelection(step.command)) && !selection && i > 0)
      return {
        ok: false,
        message: `${label} needs values from step ${i}, which has no auto-pick rule`,
        runIds,
      };
    const id = await startRun(opts.targets, {
      title: `${opts.title ?? script.name}${steps.length > 1 ? ` · ${label}` : ""}`,
      scriptId: script._id.toHexString(),
      stepId: step.id,
      command: step.command,
      params,
      secretParams,
      selection,
      foreach: !!step.foreach,
      sudo: !!step.sudo,
      timeoutSec: step.timeoutSec,
    });
    runIds.push(id);
    const run = await waitForRun(id);
    const failed = run.targets.filter((t) => t.status !== "success");
    if (failed.length && !step.continueOnError) {
      const t = failed[0];
      const out = lastLines(joinStream(t.chunks, "eio"));
      const why = t.status === "failed" ? `exit ${t.exitCode}` : t.status;
      return {
        ok: false,
        message: `${label} failed on ${t.name} (${why})${out ? `: ${out}` : ""}`,
        runIds,
      };
    }
    // values for the next step, from this step's auto-pick rule
    selection = step.pick
      ? Object.fromEntries(run.targets.map((t) => [t.remoteId, applyPick(joinStream(t.chunks, "o"), step.pick!)]))
      : undefined;
  }
  return { ok: true, message: "", runIds };
}

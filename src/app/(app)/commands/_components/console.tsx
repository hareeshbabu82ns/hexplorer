"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Eraser, FilePlus2, KeyRound, ListPlus, Loader2, Play, Save, SlidersHorizontal, Square } from "lucide-react";

import {
  cancelCmdRun,
  pollCmdRun,
  saveCmdScript,
  startCmdRun,
  type CmdGroup,
  type CmdTarget,
} from "@/lib/actions/commands";
import {
  applyPick,
  dangerReasons,
  renderTemplate,
  usesSelection,
  type ScriptParam,
  type ScriptStep,
} from "@/lib/commands/template";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "./confirm";
import { ParamInputs, ParamsEditor } from "./params";
import { mergeRun, newId, stdoutOf, unwrap, type ConsoleSeed, type RunStateView } from "./shared";
import { emptyRuntime, StepCard, type StepRuntime } from "./step-card";
import { TargetPicker } from "./target-picker";

interface Draft {
  scriptId: string | null;
  name: string;
  description: string;
  tags: string[];
  params: ScriptParam[];
  paramValues: Record<string, string>;
  steps: ScriptStep[];
  targets: string[];
}

const STORAGE_KEY = "hx-cmd-console-v1";
const blankStep = (): ScriptStep => ({ id: newId(), command: "" });
const blankDraft = (targets: string[] = []): Draft => ({
  scriptId: null,
  name: "",
  description: "",
  tags: [],
  params: [],
  paramValues: {},
  steps: [blankStep()],
  targets,
});

function loadDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    return d.steps?.length ? d : null;
  } catch {
    return null;
  }
}

function draftFromSeed(seed: ConsoleSeed, currentTargets: string[]): Draft {
  const params = seed.params ?? [];
  const values: Record<string, string> = {};
  for (const p of params) if (p.default !== undefined) values[p.name] = p.default;
  return {
    scriptId: seed.scriptId ?? null,
    name: seed.name ?? "",
    description: seed.description ?? "",
    tags: seed.tags ?? [],
    params,
    paramValues: { ...values, ...seed.paramValues },
    steps: seed.steps?.length ? seed.steps.map((s) => ({ ...s, id: s.id || newId() })) : [blankStep()],
    targets: seed.targets?.length ? seed.targets : currentTargets,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function CommandConsole({
  targets,
  groups,
  seed,
}: {
  targets: CmdTarget[];
  groups: CmdGroup[];
  seed: ConsoleSeed | null;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => (seed ? draftFromSeed(seed, []) : (loadDraft() ?? blankDraft())));
  const [rts, setRts] = useState<Record<string, StepRuntime>>({});
  const [sudoPassword, setSudoPassword] = useState("");
  const [paramsOpen, setParamsOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [runningAll, setRunningAll] = useState(false);
  const [ask, confirmDialog] = useConfirm();
  const stopAll = useRef(false);
  const runIds = useRef<Record<string, string>>({});
  const [seedKey, setSeedKey] = useState(seed?.key ?? null);

  // open a script / command coming from the library, fleet or history
  if (seed && seed.key !== seedKey) {
    setSeedKey(seed.key);
    setDraft(draftFromSeed(seed, draft.targets));
    setRts({});
  }

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    } catch {}
  }, [draft]);

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));
  const rtOf = (id: string) => rts[id] ?? emptyRuntime();
  const setRt = useCallback(
    (id: string, fn: (r: StepRuntime) => StepRuntime) =>
      setRts((all) => ({ ...all, [id]: fn(all[id] ?? emptyRuntime()) })),
    [],
  );
  const targetById = useMemo(() => new Map(targets.map((t) => [t.id, t])), [targets]);
  const paramNames = draft.params.map((p) => p.name);
  const values = useMemo(() => {
    const v: Record<string, string> = {};
    for (const p of draft.params) v[p.name] = draft.paramValues[p.name] ?? p.default ?? (p.type === "bool" ? "false" : "");
    return v;
  }, [draft.params, draft.paramValues]);
  const needsSudo = draft.steps.some((s) => s.sudo);

  /** values step i receives from step i-1, per remote id */
  const selectionFor = useCallback(
    (i: number, runTargets: string[], all = rts): { map: Record<string, string[]>; source: "manual" | "pick" | "none" } => {
      if (i === 0) return { map: {}, source: "none" };
      const prev = draft.steps[i - 1];
      const prt = all[prev.id];
      const map: Record<string, string[]> = {};
      const manual = Object.entries(prt?.sel ?? {}).filter(([, v]) => v.length);
      let source: "manual" | "pick" | "none" = "none";
      for (const tid of runTargets) {
        const own = prt?.sel[tid];
        if (own?.length) {
          map[tid] = own;
          source = "manual";
        } else if (manual.length === 1) {
          map[tid] = manual[0][1];
          source = "manual";
        } else if (prev.pick && prt?.run) {
          const t = prt.run.targets.find((x) => x.remoteId === tid);
          if (t) {
            try {
              map[tid] = applyPick(stdoutOf(t.chunks), prev.pick);
              source = source === "manual" ? source : "pick";
            } catch {}
          }
        }
      }
      return { map, source };
    },
    [draft.steps, rts],
  );

  const previewFor = (i: number) => {
    const step = draft.steps[i];
    const tid = draft.targets[0];
    const t = tid ? targetById.get(tid) : undefined;
    const sel = tid ? (selectionFor(i, [tid]).map[tid] ?? []) : [];
    try {
      return {
        text: renderTemplate(step.command, {
          params: Object.fromEntries(
            draft.params.map((p) => [p.name, p.type === "secret" && values[p.name] ? "••••" : values[p.name]]),
          ),
          sel,
          item: step.foreach ? (sel[0] ?? "<item>") : undefined,
          target: t ? { id: t.id, name: t.name, host: t.host, user: t.user } : undefined,
        }),
      };
    } catch (e: any) {
      return { text: "", error: e.message };
    }
  };

  async function runStep(i: number, runTargets: string[], all = rts): Promise<RunStateView | "paused" | null> {
    const step = draft.steps[i];
    if (!step.command.trim()) {
      toast.error(`Step ${i + 1} is empty`);
      return null;
    }
    if (!runTargets.length) {
      toast.error("Pick at least one target server");
      return null;
    }
    const missing = draft.params.filter((p) => p.required && !values[p.name]);
    if (missing.length) {
      toast.error(`Fill in: ${missing.map((p) => p.label || p.name).join(", ")}`);
      return null;
    }
    let selection: Record<string, string[]> = {};
    if (usesSelection(step.command) || step.foreach) {
      if (i === 0) {
        toast.error("The first step has no previous output to select from");
        return null;
      }
      selection = selectionFor(i, runTargets, all).map;
      if (!Object.values(selection).some((v) => v.length)) return "paused";
    }
    // destructive commands need an explicit OK (rendered with real values)
    const reasons = new Set(dangerReasons(step.command));
    try {
      const tid = runTargets[0];
      dangerReasons(renderTemplate(step.command, { params: values, sel: selection[tid] ?? [], item: selection[tid]?.[0] })).forEach((r) =>
        reasons.add(r),
      );
    } catch {}
    if (reasons.size) {
      const ok = await ask({
        title: `Run a destructive command on ${runTargets.length} server${runTargets.length > 1 ? "s" : ""}?`,
        body: (
          <>
            <p>Step {i + 1} looks dangerous:</p>
            <ul className="list-disc pl-5">
              {[...reasons].map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <p className="text-foreground font-medium">
              {runTargets.map((id) => targetById.get(id)?.name ?? id).join(", ")}
            </p>
          </>
        ),
        confirm: "Run it",
      });
      if (!ok) return null;
    }

    setRt(step.id, (r) => ({ ...r, running: true, paused: false, sel: {}, run: null }));
    let runId: string;
    try {
      runId = await unwrap(
        startCmdRun({
          targets: runTargets,
          title: [draft.name, step.title || `step ${i + 1}`].filter(Boolean).join(" · "),
          scriptId: draft.scriptId,
          stepId: step.id,
          command: step.command,
          params: values,
          secretParams: draft.params.filter((p) => p.type === "secret").map((p) => p.name),
          selection,
          foreach: !!step.foreach,
          sudo: !!step.sudo,
          sudoPassword: step.sudo ? sudoPassword || null : null,
          timeoutSec: step.timeoutSec,
        }),
      );
    } catch (e: any) {
      toast.error(e.message);
      setRt(step.id, (r) => ({ ...r, running: false }));
      return null;
    }
    runIds.current[step.id] = runId;

    let view: RunStateView | null = null;
    let errors = 0;
    for (;;) {
      try {
        const cursors = view?.targets.map((t) => t.cursor);
        const next = await unwrap(pollCmdRun(runId, cursors));
        view = mergeRun(view, next);
        const v = view;
        setRt(step.id, (r) => ({ ...r, run: v, active: r.active ?? v.targets[0]?.remoteId ?? null }));
        if (next.status === "done") break;
        errors = 0;
      } catch (e: any) {
        if (++errors > 5) {
          toast.error(e.message);
          break;
        }
      }
      await sleep(view?.targets.some((t) => t.status === "running") ? 350 : 600);
    }
    setRt(step.id, (r) => ({ ...r, running: false }));
    delete runIds.current[step.id];
    return view;
  }

  async function runAll(from = 0) {
    stopAll.current = false;
    setRunningAll(true);
    let active = draft.targets.filter((id) => targetById.has(id));
    // when resuming, continue with the targets that succeeded in the previous step
    if (from > 0) {
      const prev = rts[draft.steps[from - 1].id]?.run;
      if (prev && !draft.steps[from - 1].continueOnError)
        active = prev.targets.filter((t) => t.status === "success").map((t) => t.remoteId);
    }
    let all = rts;
    try {
      for (let i = from; i < draft.steps.length; i++) {
        if (stopAll.current) break;
        const step = draft.steps[i];
        const res = await runStep(i, active, all);
        if (res === "paused") {
          setRt(step.id, (r) => ({ ...r, paused: true }));
          toast.info(`Step ${i + 1} needs input — select values in step ${i}’s output, then Continue`);
          document.getElementById(`step-${step.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
          return;
        }
        if (!res) return;
        all = { ...all, [step.id]: { ...(all[step.id] ?? emptyRuntime()), run: res, sel: {} } };
        const ok = res.targets.filter((t) => t.status === "success").map((t) => t.remoteId);
        const failed = res.targets.filter((t) => t.status !== "success");
        if (failed.length && !step.continueOnError) {
          if (!ok.length) {
            toast.error(`Step ${i + 1} failed on every target — stopped`);
            return;
          }
          if (i < draft.steps.length - 1)
            toast.warning(`Step ${i + 1} failed on ${failed.map((t) => t.name).join(", ")}`, {
              description: "Continuing with the servers that succeeded",
            });
          active = ok;
        }
      }
      if (!stopAll.current) toast.success("All steps finished");
    } finally {
      setRunningAll(false);
    }
  }

  const cancel = (stepId: string) => {
    const id = runIds.current[stepId];
    if (id) cancelCmdRun(id);
  };
  const cancelAll = () => {
    stopAll.current = true;
    Object.values(runIds.current).forEach((id) => cancelCmdRun(id));
  };

  const updateStep = (i: number, s: ScriptStep) =>
    patch({ steps: draft.steps.map((x, k) => (k === i ? s : x)) });
  const moveStep = (i: number, d: -1 | 1) => {
    const steps = [...draft.steps];
    [steps[i], steps[i + d]] = [steps[i + d], steps[i]];
    patch({ steps });
  };
  const addParam = (name: string) =>
    patch({ params: [...draft.params, { name, type: "text" }] });

  const save = useMutation({
    mutationFn: (asNew: boolean) =>
      unwrap(
        saveCmdScript({
          id: asNew ? undefined : (draft.scriptId ?? undefined),
          name: draft.name,
          description: draft.description,
          tags: draft.tags,
          params: draft.params,
          steps: draft.steps,
          defaultTargets: saveTargets ? draft.targets : [],
          favorite: false,
        }),
      ),
    onSuccess: (s) => {
      patch({ scriptId: s.id, steps: s.steps });
      // step ids may be re-issued by the server; keep runtimes keyed by position
      setRts((all) => {
        const next: Record<string, StepRuntime> = {};
        draft.steps.forEach((old, k) => {
          if (all[old.id] && s.steps[k]) next[s.steps[k].id] = all[old.id];
        });
        return next;
      });
      setSaveOpen(false);
      toast.success(`Saved “${s.name}”`);
      qc.invalidateQueries({ queryKey: ["cmd-scripts"] });
    },
    onError: (e: any) => toast.error(e.message),
  });
  const [saveTargets, setSaveTargets] = useState(true);

  const anyRunning = Object.values(rts).some((r) => r.running);

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <section className="surface space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
            placeholder="Untitled script"
            className="h-9 min-w-0 flex-1 text-base font-semibold sm:max-w-sm"
          />
          {draft.scriptId && <span className="text-muted-foreground text-xs">saved script</span>}
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setParamsOpen(true)}>
              <SlidersHorizontal className="size-4" /> Parameters
              {draft.params.length > 0 && <span className="text-muted-foreground">{draft.params.length}</span>}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setSaveOpen(true)}>
              <Save className="size-4" /> Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              title="New empty script"
              onClick={() => {
                setDraft(blankDraft(draft.targets));
                setRts({});
              }}
            >
              <FilePlus2 className="size-4" /> New
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <TargetPicker
            targets={targets}
            groups={groups}
            value={draft.targets}
            onChange={(ids) => patch({ targets: ids })}
            className="flex-1"
          />
          {needsSudo && (
            <div className="relative" title="Used for sudo on remotes without a stored password; kept only in this tab">
              <KeyRound className="text-muted-foreground absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2" />
              <Input
                type="password"
                autoComplete="off"
                value={sudoPassword}
                onChange={(e) => setSudoPassword(e.target.value)}
                placeholder="sudo password (optional)"
                className="h-9 w-52 pl-8 text-xs"
              />
            </div>
          )}
          <div className="flex items-center gap-1.5">
            {Object.keys(rts).length > 0 && !anyRunning && (
              <Button size="sm" variant="ghost" onClick={() => setRts({})} title="Clear all outputs">
                <Eraser className="size-4" />
              </Button>
            )}
            {runningAll || anyRunning ? (
              <Button size="sm" variant="destructive" onClick={cancelAll}>
                <Square className="size-4" /> Stop
              </Button>
            ) : (
              <Button size="sm" onClick={() => runAll(0)} disabled={!draft.targets.length}>
                <Play className="size-4" /> {draft.steps.length > 1 ? "Run all steps" : "Run"}
              </Button>
            )}
          </div>
        </div>
        {draft.params.length > 0 && (
          <div className="border-t pt-4">
            <ParamInputs
              params={draft.params}
              values={draft.paramValues}
              onChange={(v) => patch({ paramValues: v })}
            />
          </div>
        )}
      </section>

      {draft.steps.map((step, i) => {
        const rt = rtOf(step.id);
        const uses = usesSelection(step.command) || !!step.foreach;
        const runTargets = draft.targets;
        const sel = uses ? selectionFor(i, runTargets) : null;
        return (
          <div key={step.id} id={`step-${step.id}`}>
            <StepCard
              index={i}
              count={draft.steps.length}
              step={step}
              rt={rt}
              paramNames={paramNames}
              input={
                sel
                  ? {
                      uses,
                      source: sel.source,
                      perTarget: Object.entries(sel.map).map(([id, v]) => [targetById.get(id)?.name ?? id, v.length]),
                    }
                  : null
              }
              preview={previewFor(i)}
              dangers={dangerReasons(step.command)}
              onChange={(s) => updateStep(i, s)}
              onRemove={() => patch({ steps: draft.steps.filter((_, k) => k !== i) })}
              onMove={(d) => moveStep(i, d)}
              onDuplicate={() =>
                patch({ steps: [...draft.steps.slice(0, i + 1), { ...step, id: newId() }, ...draft.steps.slice(i + 1)] })
              }
              onRun={async () => {
                const res = await runStep(i, draft.targets);
                if (res === "paused")
                  toast.error(`Select values in step ${i}’s output first (or add an auto-pick rule to step ${i})`);
              }}
              onCancel={() => cancel(step.id)}
              onSel={(rid, v) => setRt(step.id, (r) => ({ ...r, sel: { ...r.sel, [rid]: v } }))}
              onActive={(rid) => setRt(step.id, (r) => ({ ...r, active: rid }))}
              onAddParam={addParam}
              onContinue={() => {
                setRt(step.id, (r) => ({ ...r, paused: false }));
                runAll(i);
              }}
            />
          </div>
        );
      })}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={() => patch({ steps: [...draft.steps, blankStep()] })}>
          <ListPlus className="size-4" /> Add step
        </Button>
        <span className="text-muted-foreground text-xs">
          Steps run in order. Select values in an output and use <code>{"{{sel}}"}</code> in the next step, or turn on
          “for each” and use <code>{"{{item}}"}</code>.
        </span>
        {anyRunning && <Loader2 className="text-muted-foreground ml-auto size-4 animate-spin" />}
      </div>

      <ParamsEditor
        open={paramsOpen}
        onOpenChange={setParamsOpen}
        params={draft.params}
        onSave={(p) => patch({ params: p })}
      />

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save script</DialogTitle>
            <DialogDescription>
              Saved scripts appear in the library and can be re-run with different parameters and targets.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>Name</Label>
              <Input value={draft.name} onChange={(e) => patch({ name: e.target.value })} autoFocus />
            </div>
            <div className="grid gap-1.5">
              <Label>Description</Label>
              <Textarea
                rows={2}
                value={draft.description}
                onChange={(e) => patch({ description: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Tags</Label>
              <Input
                placeholder="docker, maintenance"
                value={draft.tags.join(", ")}
                onChange={(e) => patch({ tags: e.target.value.split(",").map((t) => t.trimStart()) })}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={saveTargets} onCheckedChange={(c) => setSaveTargets(!!c)} />
              Remember the current {draft.targets.length} target(s) as default
            </label>
          </div>
          <DialogFooter className="gap-2">
            {draft.scriptId && (
              <Button variant="outline" disabled={save.isPending} onClick={() => save.mutate(true)}>
                Save as copy
              </Button>
            )}
            <Button disabled={save.isPending || !draft.name.trim()} onClick={() => save.mutate(false)}>
              {save.isPending && <Loader2 className="size-4 animate-spin" />}
              {draft.scriptId ? "Update" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </div>
  );
}

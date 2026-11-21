"use client";

import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Copy,
  Eye,
  GitCompareArrows,
  Loader2,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Repeat,
  ShieldAlert,
  ShieldCheck,
  Square,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";

import { BUILTIN_NAMES, referencedNames, type PickRule, type ScriptStep } from "@/lib/commands/template";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { OutputView } from "./output-view";
import { fmtDuration, isDone, StatusDot, stdoutOf, type RunStateView } from "./shared";

export interface StepRuntime {
  run: RunStateView | null;
  running: boolean;
  /** selection made in this step's output, per remote id (input of the next step) */
  sel: Record<string, string[]>;
  active: string | null;
  paused?: boolean;
}

export const emptyRuntime = (): StepRuntime => ({ run: null, running: false, sel: {}, active: null });

const SEL_VARS = ["sel", "sel|q", "sel|lines", "sel|csv", "item", "item|q"];

export function StepCard({
  index,
  count,
  step,
  rt,
  paramNames,
  input,
  preview,
  dangers,
  onChange,
  onRemove,
  onMove,
  onDuplicate,
  onRun,
  onCancel,
  onSel,
  onActive,
  onAddParam,
  onContinue,
}: {
  index: number;
  count: number;
  step: ScriptStep;
  rt: StepRuntime;
  paramNames: string[];
  /** how many values this step will receive from the previous one, per target name */
  input: { uses: boolean; perTarget: [string, number][]; source: "manual" | "pick" | "none" } | null;
  preview: { text: string; error?: string } | null;
  dangers: string[];
  onChange: (s: ScriptStep) => void;
  onRemove: () => void;
  onMove: (d: -1 | 1) => void;
  onDuplicate: () => void;
  onRun: () => void;
  onCancel: () => void;
  onSel: (remoteId: string, values: string[]) => void;
  onActive: (remoteId: string) => void;
  onAddParam: (name: string) => void;
  onContinue: () => void;
}) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const [showOpts, setShowOpts] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [compare, setCompare] = useState(false);
  const set = (patch: Partial<ScriptStep>) => onChange({ ...step, ...patch });

  const unknown = useMemo(
    () => [...referencedNames(step.command)].filter((n) => !BUILTIN_NAMES.has(n) && !paramNames.includes(n)),
    [step.command, paramNames],
  );

  const insert = (token: string) => {
    const el = ta.current;
    const text = `{{${token}}}`;
    if (!el) return set({ command: step.command + text });
    const s = el.selectionStart ?? step.command.length;
    const e = el.selectionEnd ?? s;
    const next = step.command.slice(0, s) + text + step.command.slice(e);
    set({ command: next });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + text.length, s + text.length);
    });
  };

  const run = rt.run;
  const active = run?.targets.find((t) => t.remoteId === rt.active) ?? run?.targets[0];
  const activeSel = active ? (rt.sel[active.remoteId] ?? []) : [];
  const stats = run
    ? {
        ok: run.targets.filter((t) => t.status === "success").length,
        bad: run.targets.filter((t) => isDone(t.status) && t.status !== "success").length,
        total: run.targets.length,
        ms: run.finishedAt ? new Date(run.finishedAt).getTime() - new Date(run.createdAt).getTime() : null,
      }
    : null;

  // targets grouped by identical stdout (compare mode)
  const groups = useMemo(() => {
    if (!run || !compare) return [];
    const m = new Map<string, string[]>();
    for (const t of run.targets) {
      const k = stdoutOf(t.chunks).trim();
      m.set(k, [...(m.get(k) ?? []), t.name]);
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [run, compare]);

  const setPick = (rule: PickRule | null) => set({ pick: rule });

  return (
    <section
      className={cn(
        "surface animate-fade-up overflow-hidden",
        rt.paused && "ring-warning/60 ring-2",
        rt.running && "ring-info/40 ring-2",
      )}
    >
      {/* header */}
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <span className="bg-primary/10 text-primary flex size-6 shrink-0 items-center justify-center rounded-md text-xs font-semibold tabular-nums">
          {index + 1}
        </span>
        <Input
          value={step.title ?? ""}
          onChange={(e) => set({ title: e.target.value })}
          placeholder={`Step ${index + 1}`}
          className="h-7 min-w-0 flex-1 border-transparent bg-transparent px-1.5 text-sm font-medium shadow-none hover:border-input focus-visible:border-input sm:max-w-xs"
        />
        <div className="flex flex-wrap items-center gap-1">
          {step.foreach && (
            <Badge variant="info">
              <Repeat /> for each
            </Badge>
          )}
          {step.sudo && (
            <Badge variant="warning">
              <ShieldCheck /> sudo
            </Badge>
          )}
          {step.pick && (
            <Badge variant="default" title="Values are picked automatically for the next step">
              <WandSparkles /> auto-pick
            </Badge>
          )}
          {dangers.length > 0 && (
            <Badge variant="destructive" title={dangers.join(", ")}>
              <ShieldAlert /> destructive
            </Badge>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Button size="xs" variant="ghost" onClick={() => setShowOpts(!showOpts)}>
            Options <ChevronDown className={cn("transition-transform", showOpts && "rotate-180")} />
          </Button>
          {rt.running ? (
            <Button size="xs" variant="destructive" onClick={onCancel}>
              <Square /> Stop
            </Button>
          ) : (
            <Button size="xs" onClick={onRun} title="Run this step (Ctrl+Enter)">
              <Play /> Run
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" variant="ghost" className="size-7">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={index === 0} onClick={() => onMove(-1)}>
                <ArrowUp /> Move up
              </DropdownMenuItem>
              <DropdownMenuItem disabled={index === count - 1} onClick={() => onMove(1)}>
                <ArrowDown /> Move down
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onDuplicate}>
                <Copy /> Duplicate
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive" disabled={count === 1} onClick={onRemove}>
                <Trash2 /> Delete step
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="space-y-2.5 p-3">
        {rt.paused && (
          <div className="border-warning/40 bg-warning/10 text-warning flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm">
            <Pause className="size-4" />
            <span className="flex-1">
              Waiting for input — select values in step {index}’s output (click lines, cells or a column header).
            </span>
            <Button size="xs" onClick={onContinue}>
              <Play /> Continue
            </Button>
          </div>
        )}

        {input?.uses && index > 0 && (
          <div className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
            <span>Input from step {index}:</span>
            {input.perTarget.length ? (
              input.perTarget.map(([name, n]) => (
                <Badge key={name} variant={n ? "secondary" : "outline"}>
                  {name}: {n}
                </Badge>
              ))
            ) : (
              <span className="text-warning">nothing selected yet</span>
            )}
            {input.source === "pick" && <span>(auto-pick)</span>}
          </div>
        )}

        <Textarea
          ref={ta}
          value={step.command}
          onChange={(e) => set({ command: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              if (!rt.running) onRun();
            }
          }}
          spellCheck={false}
          placeholder={"command or multi-line script — e.g. docker ps\n(Ctrl+Enter to run)"}
          rows={Math.min(14, Math.max(2, step.command.split("\n").length + 1))}
          className="bg-muted/30 font-mono text-[13px] leading-5"
        />

        <div className="flex flex-wrap items-center gap-1">
          <span className="text-muted-foreground mr-1 text-[11px]">Insert:</span>
          {paramNames.map((p) => (
            <button
              key={p}
              onClick={() => insert(p)}
              className="bg-primary/10 text-primary hover:bg-primary/20 rounded px-1.5 py-0.5 font-mono text-[11px]"
            >
              {p}
            </button>
          ))}
          {index > 0 &&
            SEL_VARS.map((v) => (
              <button
                key={v}
                onClick={() => insert(v)}
                className="bg-info/10 text-info hover:bg-info/20 rounded px-1.5 py-0.5 font-mono text-[11px]"
                title={v.startsWith("item") ? "Turn on “for each” in options" : "Values selected in the previous step"}
              >
                {v}
              </button>
            ))}
          {["host", "target", "user"].map((v) => (
            <button
              key={v}
              onClick={() => insert(v)}
              className="bg-secondary text-muted-foreground hover:text-foreground rounded px-1.5 py-0.5 font-mono text-[11px]"
            >
              {v}
            </button>
          ))}
          <button
            onClick={() => setShowPreview(!showPreview)}
            className="text-muted-foreground hover:text-foreground ml-auto inline-flex items-center gap-1 text-[11px]"
          >
            <Eye className="size-3" /> preview
          </button>
        </div>

        {unknown.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-warning">Undefined:</span>
            {unknown.map((n) => (
              <Button key={n} size="xs" variant="outline" className="h-6" onClick={() => onAddParam(n)}>
                <Plus /> add “{n}” as parameter
              </Button>
            ))}
          </div>
        )}
        {step.command.includes("{{item") && !step.foreach && (
          <div className="text-warning text-xs">
            Uses <code>{"{{item}}"}</code> —{" "}
            <button className="underline" onClick={() => set({ foreach: true })}>
              turn on “for each selected value”
            </button>
          </div>
        )}

        {showPreview && preview && (
          <pre
            className={cn(
              "bg-muted/50 overflow-x-auto rounded-md border px-3 py-2 font-mono text-xs",
              preview.error && "text-destructive",
            )}
          >
            {preview.error ?? (preview.text || " ")}
          </pre>
        )}
        {dangers.length > 0 && showPreview && (
          <div className="text-destructive text-xs">⚠ {dangers.join(" · ")}</div>
        )}

        {showOpts && (
          <div className="bg-muted/30 grid gap-3 rounded-lg border p-3 text-sm sm:grid-cols-2">
            <label className="flex items-center justify-between gap-3">
              <span>
                For each selected value
                <span className="text-muted-foreground block text-xs">runs once per value as {"{{item}}"}</span>
              </span>
              <Switch checked={!!step.foreach} onCheckedChange={(c) => set({ foreach: c })} />
            </label>
            <label className="flex items-center justify-between gap-3">
              <span>
                Run with sudo
                <span className="text-muted-foreground block text-xs">uses the remote’s password if needed</span>
              </span>
              <Switch checked={!!step.sudo} onCheckedChange={(c) => set({ sudo: c })} />
            </label>
            <label className="flex items-center justify-between gap-3">
              <span>
                Continue on error
                <span className="text-muted-foreground block text-xs">failed targets still run the next steps</span>
              </span>
              <Switch checked={!!step.continueOnError} onCheckedChange={(c) => set({ continueOnError: c })} />
            </label>
            <label className="flex items-center justify-between gap-3">
              <span>Timeout (seconds)</span>
              <Input
                type="number"
                min={5}
                className="h-8 w-24"
                value={step.timeoutSec ?? ""}
                placeholder="300"
                onChange={(e) => set({ timeoutSec: e.target.value ? Number(e.target.value) : undefined })}
              />
            </label>
            <div className="border-t pt-3 sm:col-span-2">
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-medium">
                  <WandSparkles className="size-4" /> Auto-pick for the next step
                </span>
                {step.pick ? (
                  <Button size="xs" variant="ghost" onClick={() => setPick(null)}>
                    <X /> Remove
                  </Button>
                ) : (
                  <Button size="xs" variant="outline" onClick={() => setPick({ mode: "column", column: 1 })}>
                    <Plus /> Add rule
                  </Button>
                )}
              </div>
              {step.pick ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
                  <Select
                    value={step.pick.mode}
                    onValueChange={(v) => setPick({ ...step.pick!, mode: v as PickRule["mode"] })}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="lines" className="text-xs">
                        Whole lines
                      </SelectItem>
                      <SelectItem value="column" className="text-xs">
                        Column
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  {step.pick.mode === "column" && (
                    <>
                      <Input
                        type="number"
                        min={1}
                        className="h-8 text-xs"
                        title="Column number"
                        value={step.pick.column ?? 1}
                        onChange={(e) => setPick({ ...step.pick!, column: Number(e.target.value) || 1 })}
                      />
                      <Select
                        value={step.pick.delimiter ?? "whitespace"}
                        onValueChange={(v) => setPick({ ...step.pick!, delimiter: v as any })}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {["whitespace", "spaces2", "tab", "comma", "colon", "pipe"].map((d) => (
                            <SelectItem key={d} value={d} className="text-xs">
                              {d}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </>
                  )}
                  <label className="flex items-center gap-1.5 text-xs">
                    <Switch
                      checked={!!step.pick.skipHeader}
                      onCheckedChange={(c) => setPick({ ...step.pick!, skipHeader: c })}
                    />
                    skip header
                  </label>
                  <Input
                    className="h-8 font-mono text-xs"
                    placeholder="match regex"
                    value={step.pick.match ?? ""}
                    onChange={(e) => setPick({ ...step.pick!, match: e.target.value || undefined })}
                  />
                  <Input
                    className="h-8 font-mono text-xs"
                    placeholder="exclude regex"
                    value={step.pick.exclude ?? ""}
                    onChange={(e) => setPick({ ...step.pick!, exclude: e.target.value || undefined })}
                  />
                </div>
              ) : (
                <p className="text-muted-foreground text-xs">
                  Without a rule, “Run all” pauses here so you can pick values by hand. Tip: select a column in the
                  output and press <b>Auto-pick</b> to create the rule from your selection.
                </p>
              )}
            </div>
          </div>
        )}

        {/* results */}
        {run && (
          <div className="space-y-2 pt-1">
            <div className="flex flex-wrap items-center gap-1.5">
              {run.targets.map((t) => (
                <button
                  key={t.remoteId}
                  onClick={() => onActive(t.remoteId)}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors",
                    active?.remoteId === t.remoteId ? "bg-accent border-primary/40" : "hover:bg-accent/60",
                  )}
                >
                  <StatusDot status={t.status} />
                  {t.name}
                  {(rt.sel[t.remoteId]?.length ?? 0) > 0 && (
                    <span className="bg-primary text-primary-foreground rounded px-1 text-[10px] tabular-nums">
                      {rt.sel[t.remoteId].length}
                    </span>
                  )}
                  {isDone(t.status) && t.durationMs != null && (
                    <span className="text-muted-foreground font-normal">{fmtDuration(t.durationMs)}</span>
                  )}
                </button>
              ))}
              <div className="text-muted-foreground ml-auto flex items-center gap-2 text-xs">
                {rt.running && <Loader2 className="size-3.5 animate-spin" />}
                {stats && (
                  <span>
                    <span className="text-success">{stats.ok} ok</span>
                    {stats.bad > 0 && <span className="text-destructive"> · {stats.bad} failed</span>}
                    {stats.ms != null && ` · ${fmtDuration(stats.ms)}`}
                  </span>
                )}
                {run.targets.length > 1 && (
                  <Button
                    size="xs"
                    variant={compare ? "soft" : "ghost"}
                    onClick={() => setCompare(!compare)}
                    title="Group targets by identical output"
                  >
                    <GitCompareArrows /> Compare
                  </Button>
                )}
              </div>
            </div>

            {compare && groups.length > 0 && (
              <div className="space-y-1 rounded-lg border p-2 text-xs">
                {groups.length === 1 ? (
                  <div className="text-success">Identical output on all {run.targets.length} targets.</div>
                ) : (
                  groups.map(([out, names], i) => (
                    <div key={i} className="flex items-start gap-2">
                      <Badge variant={i === 0 ? "secondary" : "warning"}>{names.length}×</Badge>
                      <span className="font-medium">{names.join(", ")}</span>
                      <span className="text-muted-foreground min-w-0 flex-1 truncate font-mono">
                        {out.split("\n")[0] || "(empty)"}
                      </span>
                    </div>
                  ))
                )}
              </div>
            )}

            {active && (
              <>
                <OutputView
                  key={`${run.id}-${active.remoteId}`}
                  chunks={active.chunks}
                  live={active.status === "running"}
                  selection={activeSel}
                  onSelection={(v) => onSel(active.remoteId, v)}
                  onMakePick={(rule) => {
                    setPick(rule);
                    toast.success("Auto-pick rule saved on this step", {
                      description:
                        rule.mode === "column"
                          ? `Column ${rule.column}${rule.match ? ` where /${rule.match}/` : ""}`
                          : `Lines${rule.match ? ` matching /${rule.match}/` : ""}`,
                    });
                  }}
                  filename={`${active.name}-step${index + 1}.txt`}
                />
                <SelectionBar
                  values={activeSel}
                  multi={run.targets.length > 1}
                  onChange={(v) => onSel(active.remoteId, v)}
                  onApplyAll={() => run.targets.forEach((t) => onSel(t.remoteId, activeSel))}
                  isLast={index === count - 1}
                />
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function SelectionBar({
  values,
  multi,
  onChange,
  onApplyAll,
  isLast,
}: {
  values: string[];
  multi: boolean;
  onChange: (v: string[]) => void;
  onApplyAll: () => void;
  isLast: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  if (!values.length && !editing)
    return (
      <div className="text-muted-foreground flex items-center justify-between text-xs">
        <span>Click lines, table cells or a column header to select values for the next step.</span>
        <button
          className="hover:text-foreground underline-offset-2 hover:underline"
          onClick={() => {
            setDraft("");
            setEditing(true);
          }}
        >
          type values
        </button>
      </div>
    );
  if (editing)
    return (
      <div className="space-y-1.5">
        <Textarea
          autoFocus
          rows={4}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="one value per line"
          className="font-mono text-xs"
        />
        <div className="flex gap-1.5">
          <Button
            size="xs"
            onClick={() => {
              onChange(
                draft
                  .split("\n")
                  .map((s) => s.trim())
                  .filter(Boolean),
              );
              setEditing(false);
            }}
          >
            Apply
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  return (
    <div className="border-primary/25 bg-primary/5 flex flex-wrap items-center gap-1.5 rounded-lg border px-2 py-1.5">
      <span className="text-primary text-xs font-semibold">{values.length} selected</span>
      <span className="text-muted-foreground text-[11px]">
        {isLast ? "→ add a step and use" : "→ next step gets"} <code>{"{{sel}}"}</code>
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap gap-1">
        {values.slice(0, 24).map((v) => (
          <span
            key={v}
            className="bg-background inline-flex max-w-60 items-center gap-1 rounded border px-1.5 font-mono text-[11px]"
          >
            <span className="truncate">{v}</span>
            <button onClick={() => onChange(values.filter((x) => x !== v))} className="hover:text-destructive">
              <X className="size-3" />
            </button>
          </span>
        ))}
        {values.length > 24 && <span className="text-muted-foreground text-[11px]">+{values.length - 24}</span>}
      </div>
      <div className="flex gap-0.5">
        {multi && (
          <Button size="xs" variant="ghost" className="h-6" onClick={onApplyAll} title="Use this selection for every target">
            Apply to all targets
          </Button>
        )}
        <Button
          size="xs"
          variant="ghost"
          className="h-6"
          onClick={() => {
            setDraft(values.join("\n"));
            setEditing(true);
          }}
        >
          Edit
        </Button>
        <Button
          size="xs"
          variant="ghost"
          className="h-6"
          onClick={() => navigator.clipboard.writeText(values.join("\n")).then(() => toast.success("Copied"))}
        >
          Copy
        </Button>
        <Button size="xs" variant="ghost" className="h-6" onClick={() => onChange([])}>
          Clear
        </Button>
      </div>
    </div>
  );
}

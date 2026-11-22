"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, ExternalLink, ListOrdered, Search, SlidersHorizontal, Terminal } from "lucide-react";

import { listCmdScripts, listCmdTargets, type CmdScript } from "@/lib/actions/commands";
import { ParamInputs } from "@/app/(app)/commands/_components/params";
import { unwrap } from "@/app/(app)/commands/_components/shared";
import { TargetPicker } from "@/app/(app)/commands/_components/target-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/** backup run values that can be used inside parameter values as {name} */
const PLACEHOLDERS = ["name", "id", "mode", "trigger", "source", "dest", "target", "status", "message"];

export type HookForm = {
  enabled: boolean;
  scriptId: string;
  targets: string[];
  params: Record<string, string>;
  /** secret params with a stored value on the server */
  secretsSet: string[];
  abortOnFail: boolean;
  when: "always" | "success" | "failure";
};

export function hookForm(h: BackupHook | null | undefined): HookForm {
  return {
    enabled: !!h?.scriptId,
    scriptId: h?.scriptId ?? "",
    targets: h?.targets ?? [],
    params: h?.params ?? {},
    secretsSet: h?.secretsSet ?? [],
    abortOnFail: h?.abortOnFail !== false,
    when: h?.when ?? "always",
  };
}

export function hookInput(h: HookForm): BackupHook | null {
  if (!h.enabled || !h.scriptId) return null;
  return { scriptId: h.scriptId, targets: h.targets, params: h.params, abortOnFail: h.abortOnFail, when: h.when };
}

export function useCmdScripts() {
  return useQuery({ queryKey: ["cmd-scripts"], queryFn: () => unwrap(listCmdScripts()) });
}

function ScriptPicker({
  scripts,
  value,
  onChange,
}: {
  scripts: CmdScript[];
  value: string;
  onChange: (s: CmdScript) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const current = scripts.find((s) => s.id === value);
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return scripts;
    return scripts.filter((s) =>
      [s.name, s.description, ...s.tags, ...s.steps.map((st) => st.title ?? ""), ...s.steps.map((st) => st.command)]
        .join(" ")
        .toLowerCase()
        .includes(t),
    );
  }, [q, scripts]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal">
          <span className={cn("flex min-w-0 items-center gap-2", !current && "text-muted-foreground")}>
            <Terminal className="size-4 shrink-0" />
            <span className="truncate">{current ? current.name : value ? "(deleted script)" : "Search scripts…"}</span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(32rem,calc(100vw-2rem))] p-0" align="start">
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="text-muted-foreground size-4 shrink-0" />
          <input
            autoFocus
            className="placeholder:text-muted-foreground h-10 w-full bg-transparent text-sm outline-none"
            placeholder="Search by name, tag, description or command"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          {filtered.length === 0 && (
            <p className="text-muted-foreground p-3 text-center text-sm">
              {scripts.length ? "No matching scripts" : "No saved scripts yet — create one on the Commands page"}
            </p>
          )}
          {filtered.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                onChange(s);
                setOpen(false);
                setQ("");
              }}
              className={cn(
                "hover:bg-muted flex w-full items-start gap-2 rounded-md p-2 text-left",
                s.id === value && "bg-muted",
              )}
            >
              <Check className={cn("mt-0.5 size-4 shrink-0", s.id === value ? "opacity-100" : "opacity-0")} />
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="truncate text-sm font-medium">{s.name}</span>
                {s.description && <span className="text-muted-foreground line-clamp-2 text-xs">{s.description}</span>}
                <span className="flex flex-wrap items-center gap-1">
                  <Badge variant="outline" className="h-5 gap-1 px-1.5 text-[10px]">
                    <ListOrdered className="size-3" />
                    {s.steps.length} step{s.steps.length === 1 ? "" : "s"}
                  </Badge>
                  {s.params.length > 0 && (
                    <Badge variant="outline" className="h-5 gap-1 px-1.5 text-[10px]">
                      <SlidersHorizontal className="size-3" />
                      {s.params.map((p) => p.name).join(", ")}
                    </Badge>
                  )}
                  {s.tags.map((t) => (
                    <Badge key={t} variant="secondary" className="h-5 px-1.5 text-[10px]">
                      {t}
                    </Badge>
                  ))}
                </span>
              </span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** pick a saved Commands script to run before / after a backup, where to run it, and its parameters */
export function HookEditor({
  kind,
  value: h,
  onChange,
}: {
  kind: "pre" | "post";
  value: HookForm;
  onChange: (h: HookForm) => void;
}) {
  const set = (p: Partial<HookForm>) => onChange({ ...h, ...p });
  const { data: scripts, error } = useCmdScripts();
  const { data: targetData } = useQuery({ queryKey: ["cmd-targets"], queryFn: () => unwrap(listCmdTargets()) });
  const script = scripts?.find((s) => s.id === h.scriptId);
  const id = `hook-${kind}`;

  const pick = (s: CmdScript) => {
    const params: Record<string, string> = {};
    for (const p of s.params) if (p.default !== undefined) params[p.name] = p.default;
    // keep values typed for a parameter of the same name
    for (const p of s.params) if (h.params[p.name] !== undefined) params[p.name] = h.params[p.name];
    set({
      scriptId: s.id,
      params,
      secretsSet: s.id === h.scriptId ? h.secretsSet : [],
      targets: h.targets.length ? h.targets : s.defaultTargets.length ? s.defaultTargets : ["local"],
    });
  };

  // stored secrets: show as "kept" instead of an empty, apparently missing value
  const params = (script?.params ?? []).map((p) =>
    p.type === "secret" && h.secretsSet.includes(p.name) && !h.params[p.name]
      ? { ...p, required: false, description: "stored — leave empty to keep" }
      : p,
  );

  return (
    <div className="grid gap-3 rounded-lg border p-3">
      <div className="flex items-start gap-2">
        <Switch id={id} checked={h.enabled} onCheckedChange={(enabled) => set({ enabled })} />
        <div className="grid gap-0.5">
          <Label htmlFor={id} className="flex items-center gap-1.5">
            <Terminal className="size-3.5" />
            {kind === "pre" ? "Run a script before the backup" : "Run a script after the backup"}
          </Label>
          <p className="text-muted-foreground text-xs">
            {kind === "pre"
              ? "e.g. stop a service or dump a database before copying."
              : "e.g. restart a service or send a notification."}{" "}
            Uses scripts saved on the{" "}
            <Link href="/commands" className="text-primary inline-flex items-center gap-0.5 underline-offset-2 hover:underline">
              Commands page <ExternalLink className="size-3" />
            </Link>
            .
          </p>
        </div>
      </div>
      {h.enabled && (
        <div className="grid gap-3 sm:pl-11">
          {error && <p className="text-destructive text-xs">Could not load scripts: {(error as Error).message}</p>}
          <div className="grid gap-1.5">
            <Label className="text-xs">Script</Label>
            <ScriptPicker scripts={scripts ?? []} value={h.scriptId} onChange={pick} />
            {script && script.steps.length > 1 && (
              <p className="text-muted-foreground text-xs">
                Runs all {script.steps.length} steps in order. Steps that use values from a previous step need an
                auto-pick rule on that step.
              </p>
            )}
          </div>
          {script && (
            <>
              <div className="grid gap-1.5">
                <Label className="text-xs">Run on</Label>
                <TargetPicker
                  targets={targetData?.targets ?? []}
                  groups={targetData?.groups ?? []}
                  value={h.targets}
                  onChange={(targets) => set({ targets })}
                />
              </div>
              {params.length > 0 ? (
                <div className="grid gap-1.5">
                  <Label className="text-xs">Parameters</Label>
                  <ParamInputs params={params} values={h.params} onChange={(v) => set({ params: v })} />
                  <p className="text-muted-foreground text-xs">
                    Values can include backup details:{" "}
                    {PLACEHOLDERS.map((p) => (
                      <code key={p} className="bg-muted mr-1 rounded px-1">{`{${p}}`}</code>
                    ))}
                    {kind === "pre" && "— target, status and message are empty before the run."}
                  </p>
                </div>
              ) : (
                <p className="text-muted-foreground text-xs">
                  This script has no parameters. Define them in the script builder on the Commands page.
                </p>
              )}
            </>
          )}
          <div className="grid gap-1.5 sm:w-1/2">
            {kind === "pre" ? (
              <>
                <Label className="text-xs">If the script fails</Label>
                <Select
                  value={h.abortOnFail ? "abort" : "continue"}
                  onValueChange={(v) => set({ abortOnFail: v === "abort" })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="abort">Skip the backup</SelectItem>
                    <SelectItem value="continue">Back up anyway</SelectItem>
                  </SelectContent>
                </Select>
              </>
            ) : (
              <>
                <Label className="text-xs">Run when the backup</Label>
                <Select value={h.when} onValueChange={(v) => set({ when: v as HookForm["when"] })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="always">Finished (always)</SelectItem>
                    <SelectItem value="success">Succeeded</SelectItem>
                    <SelectItem value="failure">Failed</SelectItem>
                  </SelectContent>
                </Select>
              </>
            )}
          </div>
          <p className="text-muted-foreground text-xs">
            A failing step (non-zero exit) on any target counts as a failure; its last output lines show in the job
            status. Each run also appears in the Commands history.
          </p>
        </div>
      )}
    </div>
  );
}

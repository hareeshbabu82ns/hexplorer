"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, SlidersHorizontal, Trash2 } from "lucide-react";

import { BUILTIN_NAMES, referencedNames, type ParamType, type ScriptParam } from "@/lib/commands/template";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

const PARAM_NAME = /^[a-zA-Z_][\w-]*$/;

/** problem with a parameter definition, or null */
export function paramProblem(p: ScriptParam, all: ScriptParam[]): string | null {
  if (!p.name) return "name is required";
  if (!PARAM_NAME.test(p.name)) return "start with a letter or _; letters, digits, _ and - only";
  if (BUILTIN_NAMES.has(p.name)) return `“${p.name}” is a built-in variable`;
  if (all.filter((x) => x.name === p.name).length > 1) return "duplicate name";
  if (p.type === "select" && !(p.options ?? []).some((o) => o.trim())) return "add at least one option";
  if (p.type === "select" && p.default && !(p.options ?? []).map((o) => o.trim()).includes(p.default))
    return "default is not one of the options";
  if (p.type === "number" && p.default && isNaN(Number(p.default))) return "default must be a number";
  return null;
}

const TYPES: { value: ParamType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "select", label: "Choice" },
  { value: "bool", label: "Yes / no" },
  { value: "secret", label: "Secret" },
];

/** values form shown above the steps */
export function ParamInputs({
  params,
  values,
  onChange,
}: {
  params: ScriptParam[];
  values: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
}) {
  if (!params.length) return null;
  const set = (k: string, v: string) => onChange({ ...values, [k]: v });
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {params.map((p) => {
        const v = values[p.name] ?? p.default ?? "";
        const missing = p.required && !v;
        return (
          <div key={p.name} className="grid gap-1">
            <Label className="flex items-center gap-1.5 text-[12px]">
              {p.label || p.name}
              <code className="text-muted-foreground text-[10.5px] font-normal">{`{{${p.name}}}`}</code>
              {p.required && <span className="text-destructive">*</span>}
            </Label>
            {p.type === "select" ? (
              <Select value={(p.options ?? []).includes(v) ? v : ""} onValueChange={(x) => set(p.name, x)}>
                <SelectTrigger className="h-8">
                  <SelectValue placeholder="Choose…" />
                </SelectTrigger>
                <SelectContent>
                  {(p.options ?? []).map((o) => (
                    <SelectItem key={o} value={o}>
                      {o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : p.type === "bool" ? (
              <div className="flex h-8 items-center gap-2">
                <Switch checked={v === "true"} onCheckedChange={(c) => set(p.name, c ? "true" : "false")} />
                <span className="text-muted-foreground font-mono text-xs">{v === "true" ? "true" : "false"}</span>
              </div>
            ) : (
              <Input
                className={`h-8 font-mono text-[13px] ${missing ? "border-destructive/60" : ""}`}
                type={p.type === "secret" ? "password" : p.type === "number" ? "number" : "text"}
                autoComplete="off"
                value={v}
                placeholder={p.description}
                onChange={(e) => set(p.name, e.target.value)}
              />
            )}
            {p.description && (
              <p className="text-muted-foreground text-[11px]">{p.description}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ParamsEditor({
  open,
  onOpenChange,
  params,
  commands = [],
  onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  params: ScriptParam[];
  /** step commands, to show which parameters are used and which {{names}} are not defined yet */
  commands?: string[];
  onSave: (p: ScriptParam[]) => void;
}) {
  const [rows, setRows] = useState<ScriptParam[]>(params);
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setRows(params);
  }
  const upd = (i: number, patch: Partial<ScriptParam>) =>
    setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...rows];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setRows(next);
  };
  const used = new Set(commands.flatMap((c) => [...referencedNames(c)]));
  const undefinedNames = [...used].filter((n) => !BUILTIN_NAMES.has(n) && !rows.some((r) => r.name === n));
  const problems = rows.map((r) => paramProblem(r, rows));
  const invalid = problems.some(Boolean);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SlidersHorizontal className="size-4" /> Script parameters
          </DialogTitle>
          <DialogDescription>
            Inputs asked for when the script runs (from the console, or from a backup job). Use them in commands as{" "}
            <code>{"{{name}}"}</code>, or <code>{"{{name|q}}"}</code> to shell-quote the value. Secrets are never saved
            with the script and are masked in history.
          </DialogDescription>
        </DialogHeader>
        {undefinedNames.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-dashed p-2.5 text-xs">
            <span className="text-muted-foreground">Used in steps but not defined:</span>
            {undefinedNames.map((n) => (
              <Button
                key={n}
                size="xs"
                variant="outline"
                className="h-6 font-mono"
                onClick={() => setRows([...rows, { name: n, type: "text" }])}
              >
                <Plus /> {n}
              </Button>
            ))}
          </div>
        )}
        <div className="space-y-2">
          {rows.length === 0 && (
            <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-center text-sm">
              No parameters yet. Add one to make this script reusable with different values.
            </p>
          )}
          {rows.map((r, i) => (
            <div key={i} className={`grid gap-2 rounded-lg border p-2.5 ${problems[i] ? "border-destructive/60" : ""}`}>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_110px_1fr]">
                <div className="grid gap-1">
                  <Label className="text-muted-foreground text-[11px]">Name</Label>
                  <Input
                    className="h-8 font-mono text-xs"
                    placeholder="name"
                    value={r.name}
                    onChange={(e) => upd(i, { name: e.target.value.replace(/[^\w-]/g, "") })}
                  />
                </div>
                <div className="grid gap-1">
                  <Label className="text-muted-foreground text-[11px]">Label</Label>
                  <Input
                    className="h-8 text-xs"
                    placeholder="shown on the form"
                    value={r.label ?? ""}
                    onChange={(e) => upd(i, { label: e.target.value })}
                  />
                </div>
                <div className="grid gap-1">
                  <Label className="text-muted-foreground text-[11px]">Type</Label>
                  <Select value={r.type} onValueChange={(v) => upd(i, { type: v as ParamType })}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value} className="text-xs">
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1">
                  <Label className="text-muted-foreground text-[11px]">Default</Label>
                  {r.type === "secret" ? (
                    <div className="text-muted-foreground flex h-8 items-center text-xs">asked on every run</div>
                  ) : r.type === "bool" ? (
                    <div className="flex h-8 items-center gap-2">
                      <Switch
                        checked={r.default === "true"}
                        onCheckedChange={(c) => upd(i, { default: c ? "true" : "false" })}
                      />
                      <span className="text-muted-foreground font-mono text-xs">{r.default === "true" ? "true" : "false"}</span>
                    </div>
                  ) : (
                    <Input
                      className="h-8 font-mono text-xs"
                      type={r.type === "number" ? "number" : "text"}
                      placeholder="default"
                      value={r.default ?? ""}
                      onChange={(e) => upd(i, { default: e.target.value })}
                    />
                  )}
                </div>
              </div>
              {r.type === "select" && (
                <div className="grid gap-1">
                  <Label className="text-muted-foreground text-[11px]">Options (comma separated)</Label>
                  <Input
                    className="h-8 text-xs"
                    placeholder="e.g. start, stop, restart"
                    value={(r.options ?? []).join(",")}
                    onChange={(e) => upd(i, { options: e.target.value.split(",") })}
                  />
                </div>
              )}
              <div className="grid gap-1">
                <Label className="text-muted-foreground text-[11px]">Help text</Label>
                <Input
                  className="h-8 text-xs"
                  placeholder="what this value is for (shown under the input)"
                  value={r.description ?? ""}
                  onChange={(e) => upd(i, { description: e.target.value })}
                />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <code className="bg-muted rounded px-1.5 py-0.5 text-[11px]">{`{{${r.name || "name"}}}`}</code>
                {r.name && commands.length > 0 && !used.has(r.name) && (
                  <span className="text-warning text-[11px]">not used in any step</span>
                )}
                {problems[i] && <span className="text-destructive text-[11px]">{problems[i]}</span>}
                <span className="grow" />
                <label className="flex items-center gap-1.5 text-xs">
                  <Checkbox checked={!!r.required} onCheckedChange={(c) => upd(i, { required: !!c })} />
                  required
                </label>
                <Button size="icon-sm" variant="ghost" disabled={i === 0} onClick={() => move(i, -1)} title="Move up">
                  <ArrowUp className="size-4" />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  disabled={i === rows.length - 1}
                  onClick={() => move(i, 1)}
                  title="Move down"
                >
                  <ArrowDown className="size-4" />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => setRows(rows.filter((_, k) => k !== i))}
                  title="Remove"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRows([...rows, { name: `param${rows.length + 1}`, type: "text" }])}
          >
            <Plus className="size-4" /> Add parameter
          </Button>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={invalid}
            onClick={() => {
              onSave(
                rows.map((r) =>
                  r.type === "select"
                    ? { ...r, options: (r.options ?? []).map((o) => o.trim()).filter(Boolean) }
                    : r,
                ),
              );
              onOpenChange(false);
            }}
          >
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

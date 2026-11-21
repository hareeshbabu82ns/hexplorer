"use client";

import { useState } from "react";
import { Plus, SlidersHorizontal, Trash2 } from "lucide-react";

import type { ParamType, ScriptParam } from "@/lib/commands/template";
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
              <Select value={v} onValueChange={(x) => set(p.name, x)}>
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
  onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  params: ScriptParam[];
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SlidersHorizontal className="size-4" /> Script parameters
          </DialogTitle>
          <DialogDescription>
            Use them in commands as <code>{"{{name}}"}</code>, or <code>{"{{name|q}}"}</code> to shell-quote the
            value. Secrets are never saved and are masked in history.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 rounded-lg border p-2.5 sm:grid-cols-[1fr_1fr_110px_1fr_auto]">
              <Input
                className="h-8 font-mono text-xs"
                placeholder="name"
                value={r.name}
                onChange={(e) => upd(i, { name: e.target.value.replace(/[^\w-]/g, "") })}
              />
              <Input
                className="h-8 text-xs"
                placeholder="Label (optional)"
                value={r.label ?? ""}
                onChange={(e) => upd(i, { label: e.target.value })}
              />
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
              {r.type === "select" ? (
                <Input
                  className="h-8 text-xs"
                  placeholder="options, comma separated"
                  value={(r.options ?? []).join(",")}
                  onChange={(e) => upd(i, { options: e.target.value.split(",") })}
                />
              ) : r.type === "secret" ? (
                <div className="text-muted-foreground flex items-center text-xs">asked on every run</div>
              ) : (
                <Input
                  className="h-8 font-mono text-xs"
                  placeholder="default"
                  value={r.default ?? ""}
                  onChange={(e) => upd(i, { default: e.target.value })}
                />
              )}
              <div className="col-span-2 flex items-center justify-end gap-3 sm:col-span-1">
                <label className="flex items-center gap-1.5 text-xs">
                  <Checkbox checked={!!r.required} onCheckedChange={(c) => upd(i, { required: !!c })} />
                  required
                </label>
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
            onClick={() => {
              onSave(
                rows
                  .filter((r) => r.name.trim())
                  .map((r) =>
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

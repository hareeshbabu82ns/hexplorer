"use client";

import type { CmdResult, RunTargetView, RunView } from "@/lib/actions/commands";
import type { Chunk, TargetStatus } from "@/lib/commands/runner";
import type { ScriptParam, ScriptStep } from "@/lib/commands/template";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, CircleDashed, Clock, Loader2, OctagonX, XCircle } from "lucide-react";

export async function unwrap<T>(p: Promise<CmdResult<T>>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

export const newId = () => Math.random().toString(36).slice(2, 10);

/** client-side view of a run: chunks accumulate across polls */
export type RunTargetState = Omit<RunTargetView, "from">;
export interface RunStateView extends Omit<RunView, "targets"> {
  targets: RunTargetState[];
}

export function mergeRun(prev: RunStateView | null, next: RunView): RunStateView {
  const targets = next.targets.map((t, i) => {
    const old = prev && prev.id === next.id ? prev.targets[i] : undefined;
    const chunks: Chunk[] = old ? old.chunks.map((c) => [c[0], c[1]] as Chunk) : [];
    t.chunks.forEach((c, k) => {
      const idx = t.from + k;
      if (idx < chunks.length) chunks[idx] = [chunks[idx][0], chunks[idx][1] + c[1]];
      else chunks.push([c[0], c[1]]);
    });
    const { from: _from, ...rest } = t;
    return { ...rest, chunks };
  });
  return { ...next, targets };
}

export const stdoutOf = (chunks: Chunk[]) =>
  chunks
    .filter((c) => c[0] === "o")
    .map((c) => c[1])
    .join("");

export const allTextOf = (chunks: Chunk[]) => chunks.map((c) => c[1]).join("");

export const isDone = (s: TargetStatus) => s !== "queued" && s !== "running";

const STATUS_META: Record<
  TargetStatus,
  { label: string; variant: "info" | "success" | "destructive" | "outline" | "warning"; icon: any }
> = {
  queued: { label: "queued", variant: "outline", icon: CircleDashed },
  running: { label: "running", variant: "info", icon: Loader2 },
  success: { label: "ok", variant: "success", icon: CheckCircle2 },
  failed: { label: "failed", variant: "destructive", icon: XCircle },
  cancelled: { label: "cancelled", variant: "warning", icon: OctagonX },
  timeout: { label: "timeout", variant: "warning", icon: Clock },
};

export function StatusBadge({ status, exitCode }: { status: TargetStatus; exitCode?: number | null }) {
  const m = STATUS_META[status];
  const Icon = m.icon;
  return (
    <Badge variant={m.variant}>
      <Icon className={status === "running" ? "animate-spin" : undefined} />
      {m.label}
      {status === "failed" && exitCode != null && exitCode >= 0 ? ` (${exitCode})` : ""}
    </Badge>
  );
}

export function StatusDot({ status }: { status: TargetStatus }) {
  const color =
    status === "success"
      ? "bg-success"
      : status === "failed"
        ? "bg-destructive"
        : status === "running"
          ? "bg-info animate-pulse"
          : status === "queued"
            ? "bg-muted-foreground/40"
            : "bg-warning";
  return <span className={`inline-block size-2 shrink-0 rounded-full ${color}`} />;
}

export function fmtDuration(ms: number | null | undefined) {
  if (ms == null) return "";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  const m = Math.floor(ms / 60000);
  return `${m}m ${Math.round((ms % 60000) / 1000)}s`;
}

export function fmtAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

/** what the console is asked to open (from the library, fleet or history) */
export interface ConsoleSeed {
  key: string;
  scriptId?: string | null;
  name?: string;
  description?: string;
  tags?: string[];
  params?: ScriptParam[];
  steps?: ScriptStep[];
  targets?: string[];
  paramValues?: Record<string, string>;
}

export function download(name: string, text: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronRight, History as HistoryIcon, Loader2, RotateCcw, Search, Trash2 } from "lucide-react";

import { deleteCmdHistory, listCmdHistory, pollCmdRun, type HistoryItem } from "@/lib/actions/commands";
import { EmptyState, ErrorBanner } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { OutputView } from "./output-view";
import { fmtAgo, fmtDuration, mergeRun, newId, StatusBadge, StatusDot, unwrap, type ConsoleSeed } from "./shared";

export function RunHistory({ onOpen }: { onOpen: (seed: ConsoleSeed) => void }) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const { data, error, isLoading } = useQuery({
    queryKey: ["cmd-history", q],
    queryFn: () => unwrap(listCmdHistory({ q, limit: 200 })),
    refetchInterval: 10000,
  });
  const del = useMutation({
    mutationFn: (id?: string) => unwrap(deleteCmdHistory(id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cmd-history"] }),
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="text-muted-foreground absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search commands, titles, servers…"
            className="h-9 pl-8"
          />
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          disabled={!data?.length}
          onClick={() => confirm("Delete the whole command history?") && del.mutate(undefined)}
        >
          <Trash2 className="size-4" /> Clear history
        </Button>
      </div>
      {error && <ErrorBanner>{(error as Error).message}</ErrorBanner>}
      {!isLoading && !data?.length ? (
        <EmptyState icon={HistoryIcon} title="No runs yet" description="Every command you run is recorded here with its output." />
      ) : (
        <div className="surface divide-y overflow-hidden">
          {data?.map((h) => (
            <HistoryRow
              key={h.id}
              item={h}
              open={openId === h.id}
              onToggle={() => setOpenId(openId === h.id ? null : h.id)}
              onDelete={() => del.mutate(h.id)}
              onOpen={onOpen}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function HistoryRow({
  item,
  open,
  onToggle,
  onDelete,
  onOpen,
}: {
  item: HistoryItem;
  open: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onOpen: (seed: ConsoleSeed) => void;
}) {
  const [tab, setTab] = useState(0);
  const { data: run, isLoading } = useQuery({
    queryKey: ["cmd-run", item.id],
    queryFn: async () => mergeRun(null, await unwrap(pollCmdRun(item.id))),
    enabled: open,
    staleTime: Infinity,
  });
  const t = run?.targets[tab];

  return (
    <div>
      <button onClick={onToggle} className="hover:bg-accent/40 flex w-full items-center gap-3 px-4 py-3 text-left">
        <ChevronRight className={cn("text-muted-foreground size-4 shrink-0 transition-transform", open && "rotate-90")} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{item.title}</span>
          </div>
          <code className="text-muted-foreground block truncate text-xs">{item.template.split("\n")[0]}</code>
        </div>
        <div className="hidden max-w-[40%] flex-wrap justify-end gap-1 md:flex">
          {item.targets.slice(0, 5).map((x, i) => (
            <span key={i} className="bg-secondary inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]">
              <StatusDot status={x.status} /> {x.name}
            </span>
          ))}
          {item.targets.length > 5 && <span className="text-muted-foreground text-[11px]">+{item.targets.length - 5}</span>}
        </div>
        <div className="text-muted-foreground w-24 shrink-0 text-right text-xs">
          <div>{fmtAgo(item.createdAt)}</div>
          <div className="tabular-nums">{fmtDuration(item.durationMs)}</div>
        </div>
      </button>
      {open && (
        <div className="bg-muted/20 space-y-3 border-t px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="xs"
              onClick={() =>
                onOpen({
                  key: `hist-${item.id}-${newId()}`,
                  name: item.title,
                  targets: run?.targets.map((x) => x.remoteId),
                  steps: [{ id: newId(), command: item.template }],
                })
              }
            >
              <RotateCcw /> Open in console
            </Button>
            <Button size="xs" variant="ghost" onClick={onDelete}>
              <Trash2 /> Delete
            </Button>
            <span className="text-muted-foreground ml-auto text-xs">{new Date(item.createdAt).toLocaleString()}</span>
          </div>
          <pre className="bg-background overflow-x-auto rounded-md border px-3 py-2 font-mono text-xs">{item.template}</pre>
          {isLoading && <Loader2 className="text-muted-foreground size-4 animate-spin" />}
          {run && (
            <>
              <div className="flex flex-wrap gap-1.5">
                {run.targets.map((x, i) => (
                  <button
                    key={x.remoteId + i}
                    onClick={() => setTab(i)}
                    className={cn(
                      "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium",
                      i === tab ? "bg-accent border-primary/40" : "hover:bg-accent/60",
                    )}
                  >
                    <StatusDot status={x.status} /> {x.name}
                  </button>
                ))}
              </div>
              {t && (
                <>
                  <div className="flex items-center gap-2 text-xs">
                    <StatusBadge status={t.status} exitCode={t.exitCode} />
                    <span className="text-muted-foreground">{t.host}</span>
                    <span className="text-muted-foreground">{fmtDuration(t.durationMs)}</span>
                  </div>
                  <OutputView key={`${item.id}-${tab}`} chunks={t.chunks} filename={`${t.name}.txt`} />
                  {t.commands.length > 1 && (
                    <details className="text-xs">
                      <summary className="text-muted-foreground cursor-pointer">
                        {t.commands.length} invocations
                      </summary>
                      <pre className="bg-background mt-1 max-h-48 overflow-auto rounded border p-2 font-mono">
                        {t.commands.join("\n---\n")}
                      </pre>
                    </details>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

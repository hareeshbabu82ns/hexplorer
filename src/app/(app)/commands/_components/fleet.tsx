"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Box,
  CheckCircle2,
  Clock,
  Loader2,
  PackageOpen,
  Power,
  RefreshCw,
  Server,
  ServerOff,
  Terminal,
} from "lucide-react";

import { fleetHealth, type CmdTarget } from "@/lib/actions/commands";
import type { HostHealth } from "@/lib/commands/health";
import { EmptyState, ErrorBanner, StatCard } from "@/components/app/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { cn, formatSize } from "@/lib/utils";
import { newId, unwrap, type ConsoleSeed } from "./shared";

function fmtUptime(s?: number) {
  if (!s) return "—";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  if (d) return `${d}d ${h}h`;
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}

function Bar({ label, pct, detail }: { label: string; pct: number; detail?: string }) {
  const p = Math.max(0, Math.min(100, pct));
  const tone = p >= 90 ? "bg-destructive" : p >= 75 ? "bg-warning" : "bg-primary";
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="text-muted-foreground truncate font-medium">{label}</span>
        <span className="tabular-nums">
          {Math.round(p)}%{detail && <span className="text-muted-foreground"> · {detail}</span>}
        </span>
      </div>
      <div className="bg-muted h-1.5 overflow-hidden rounded-full">
        <div className={cn("h-full rounded-full transition-all", tone)} style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}

function issues(h: HostHealth): string[] {
  if (!h.ok) return ["unreachable"];
  const out: string[] = [];
  if (h.rebootRequired) out.push("reboot required");
  if (h.failedUnits?.length) out.push(`${h.failedUnits.length} failed units`);
  if (h.securityUpdates) out.push(`${h.securityUpdates} security updates`);
  if (h.disks?.some((d) => d.total && d.used / d.total >= 0.9)) out.push("disk ≥ 90%");
  if (h.memTotal && h.memAvail != null && 1 - h.memAvail / h.memTotal >= 0.9) out.push("memory ≥ 90%");
  if (h.load && h.cpus && h.load[0] / h.cpus >= 1.5) out.push("high load");
  return out;
}

export function Fleet({ targets, onOpen }: { targets: CmdTarget[]; onOpen: (seed: ConsoleSeed) => void }) {
  const [auto, setAuto] = useState(false);
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const { data, error, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["cmd-fleet"],
    queryFn: () => unwrap(fleetHealth()),
    enabled: targets.length > 0,
    refetchInterval: auto ? 60000 : false,
    staleTime: 30000,
  });

  const hosts = useMemo(() => data ?? [], [data]);
  const summary = useMemo(
    () => ({
      up: hosts.filter((h) => h.ok).length,
      down: hosts.filter((h) => !h.ok).length,
      reboot: hosts.filter((h) => h.rebootRequired).length,
      updates: hosts.reduce((n, h) => n + (h.updates ?? 0), 0),
      failed: hosts.reduce((n, h) => n + (h.failedUnits?.length ?? 0), 0),
    }),
    [hosts],
  );
  const shown = issuesOnly ? hosts.filter((h) => issues(h).length) : hosts;

  const openConsole = (ids: string[], command = "") =>
    onOpen({ key: `fleet-${newId()}`, targets: ids, steps: [{ id: newId(), command }] });

  if (!targets.length)
    return (
      <EmptyState
        icon={Server}
        title="No SSH remotes"
        description="Add SSH connections on the Remotes page to see their health here."
      />
    );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          icon={Activity}
          label="Reachable"
          value={data ? `${summary.up}/${hosts.length}` : "…"}
          tone={summary.down ? "warning" : "success"}
          hint={summary.down ? `${summary.down} unreachable` : "all hosts answer"}
        />
        <StatCard icon={Power} label="Reboot required" value={data ? summary.reboot : "…"} tone="warning" />
        <StatCard icon={PackageOpen} label="Pending updates" value={data ? summary.updates : "…"} tone="info" />
        <StatCard
          icon={AlertTriangle}
          label="Failed services"
          value={data ? summary.failed : "…"}
          tone={summary.failed ? "warning" : "success"}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={cn("size-4", isFetching && "animate-spin")} /> Refresh
        </Button>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={auto} onCheckedChange={setAuto} /> Auto-refresh (1 min)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={issuesOnly} onCheckedChange={setIssuesOnly} /> Only hosts with issues
        </label>
        {dataUpdatedAt > 0 && (
          <span className="text-muted-foreground text-xs">
            <Clock className="mr-1 inline size-3" />
            {new Date(dataUpdatedAt).toLocaleTimeString()}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {picked.length > 0 && (
            <>
              <span className="text-muted-foreground text-xs">{picked.length} selected</span>
              <Button size="sm" variant="ghost" onClick={() => setPicked([])}>
                Clear
              </Button>
            </>
          )}
          <Button size="sm" disabled={!picked.length} onClick={() => openConsole(picked)}>
            <Terminal className="size-4" /> Run on selected
          </Button>
        </div>
      </div>

      {error && <ErrorBanner>{(error as Error).message}</ErrorBanner>}
      {!data && isFetching && (
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" /> Probing {targets.length} host(s)…
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {shown.map((h) => {
          const iss = issues(h);
          const memPct = h.memTotal && h.memAvail != null ? (1 - h.memAvail / h.memTotal) * 100 : null;
          const swapPct = h.swapTotal ? (1 - (h.swapFree ?? 0) / h.swapTotal) * 100 : null;
          const loadPct = h.load && h.cpus ? (h.load[0] / h.cpus) * 100 : null;
          const disks = [...(h.disks ?? [])].sort((a, b) => b.used / b.total - a.used / a.total).slice(0, 3);
          const on = picked.includes(h.remoteId);
          return (
            <article key={h.remoteId} className={cn("surface flex flex-col p-4", on && "ring-primary/50 ring-2")}>
              <div className="flex items-start gap-2.5">
                <Checkbox
                  className="mt-1"
                  checked={on}
                  onCheckedChange={() =>
                    setPicked(on ? picked.filter((x) => x !== h.remoteId) : [...picked, h.remoteId])
                  }
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {h.ok ? (
                      <CheckCircle2 className={cn("size-4", iss.length ? "text-warning" : "text-success")} />
                    ) : (
                      <ServerOff className="text-destructive size-4" />
                    )}
                    <h3 className="truncate font-semibold">{h.name}</h3>
                    {h.latencyMs != null && h.ok && (
                      <span className="text-muted-foreground text-[11px] tabular-nums">{h.latencyMs} ms</span>
                    )}
                  </div>
                  <p className="text-muted-foreground truncate text-xs">
                    {h.ok ? `${h.os ?? ""} · ${h.kernel ?? ""} · ${h.arch ?? ""}` : h.host}
                  </p>
                </div>
              </div>

              {!h.ok ? (
                <pre className="text-destructive bg-destructive/5 mt-3 line-clamp-4 whitespace-pre-wrap rounded-md p-2 font-mono text-[11px]">
                  {h.error}
                </pre>
              ) : (
                <div className="mt-4 space-y-2.5">
                  {loadPct != null && (
                    <Bar label={`Load (${h.cpus} cpu)`} pct={loadPct} detail={h.load!.map((l) => l.toFixed(2)).join(" ")} />
                  )}
                  {memPct != null && (
                    <Bar
                      label="Memory"
                      pct={memPct}
                      detail={`${formatSize(h.memTotal! - h.memAvail!, 1)} / ${formatSize(h.memTotal!, 1)}`}
                    />
                  )}
                  {swapPct != null && swapPct > 1 && <Bar label="Swap" pct={swapPct} />}
                  {disks.map((d) => (
                    <Bar
                      key={d.mount}
                      label={d.mount}
                      pct={(d.used / d.total) * 100}
                      detail={`${formatSize(d.total - d.used, 1)} free`}
                    />
                  ))}
                </div>
              )}

              <div className="mt-3 flex flex-wrap gap-1">
                {h.ok && <Badge variant="secondary">up {fmtUptime(h.uptimeSec)}</Badge>}
                {h.docker && (
                  <Badge variant="secondary">
                    <Box /> {h.docker.running}/{h.docker.total} containers
                  </Badge>
                )}
                {h.updates != null && h.updates > 0 && (
                  <Badge variant={h.securityUpdates ? "warning" : "info"}>
                    {h.updates} updates{h.securityUpdates ? ` (${h.securityUpdates} security)` : ""}
                  </Badge>
                )}
                {h.rebootRequired && (
                  <Badge variant="warning">
                    <Power /> reboot required
                  </Badge>
                )}
                {h.failedUnits?.map((u) => (
                  <Badge key={u} variant="destructive" title="failed systemd unit">
                    {u}
                  </Badge>
                ))}
              </div>

              <div className="mt-auto flex flex-wrap gap-1 pt-3">
                <Button size="xs" variant="outline" onClick={() => openConsole([h.remoteId])}>
                  <Terminal /> Console
                </Button>
                {!!h.failedUnits?.length && (
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() =>
                      onOpen({
                        key: `fu-${newId()}`,
                        name: "Restart failed units",
                        targets: [h.remoteId],
                        steps: [
                          {
                            id: newId(),
                            title: "Failed units",
                            command: "systemctl --failed --no-legend --plain",
                            pick: { mode: "column", column: 1 },
                          },
                          {
                            id: newId(),
                            title: "Restart",
                            command: "systemctl restart {{item|q}} && systemctl is-active {{item|q}}",
                            foreach: true,
                            sudo: true,
                            continueOnError: true,
                          },
                        ],
                      })
                    }
                  >
                    Fix units
                  </Button>
                )}
                {h.docker && (
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() =>
                      openConsole([h.remoteId], "docker ps -a --format 'table {{.Names}}\\t{{.Status}}\\t{{.Image}}'")
                    }
                  >
                    Containers
                  </Button>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {issuesOnly && data && !shown.length && (
        <EmptyState icon={CheckCircle2} title="No issues" description="Every host looks healthy." />
      )}
    </div>
  );
}

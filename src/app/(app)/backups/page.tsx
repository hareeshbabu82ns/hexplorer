"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { BackupDialog, BackupSource, describeSchedule } from "@/components/explorer/backup-dialog";
import {
  deleteBackup,
  duplicateBackup,
  listBackups,
  runBackupNow,
  setBackupScheduleEnabled,
} from "@/lib/actions/backups";
import { EmptyState, ErrorBanner, Page, PageHeader, SectionTitle } from "@/components/app/page";
import {
  Archive,
  ArrowDown,
  CalendarClock,
  Clock,
  Copy,
  Folder,
  HardDrive,
  Loader2,
  Pause,
  Pencil,
  Play,
  Plus,
  Server,
  Terminal,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";

const STATUS: Record<BackupJob["status"], "info" | "success" | "destructive" | "outline" | "warning"> = {
  idle: "outline",
  running: "info",
  success: "success",
  warning: "warning",
  error: "destructive",
};

export default function BackupsPage() {
  const qc = useQueryClient();
  const [source, setSource] = useState<BackupSource>(null);
  const {
    data: jobs,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["backups"],
    queryFn: () => listBackups(),
    refetchInterval: (q) => (q.state.data?.some((j) => j.status === "running") ? 1500 : false),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["backups"] });
  const run = useMutation({
    mutationFn: runBackupNow,
    onSuccess: () => (toast.info("Backup started"), refresh()),
    onError: (e: any) => toast.error(e.message),
  });
  const pause = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => setBackupScheduleEnabled(id, enabled),
    onSuccess: (_, v) => (toast.success(v.enabled ? "Schedule resumed" : "Schedule paused"), refresh()),
    onError: (e: any) => toast.error(e.message),
  });
  const dup = useMutation({
    mutationFn: async (j: BackupJob) => {
      const id = await duplicateBackup(j.id);
      return (await listBackups()).find((x) => x.id === id);
    },
    onSuccess: (copy) => {
      refresh();
      if (!copy) return;
      toast.success(
        `Created “${copy.name}”${copy.schedule ? " — its schedule is paused until you resume it" : ""}`,
      );
      // open the copy so source / destination can be changed right away
      setSource({ job: copy });
    },
    onError: (e: any) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: deleteBackup,
    onSuccess: () => (toast.success("Backup job deleted"), refresh()),
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Page>
      <PageHeader
        icon={Archive}
        title="Backups"
        description={
          <>
            Back up data folders, remote paths (SSH / SMB, mounted just for the run) or local paths to any
            of those, on demand or on a schedule. Start one here, or from the folder actions on the{" "}
            <Link href="/files" className="text-foreground underline-offset-4 hover:underline">
              Files
            </Link>{" "}
            page.
          </>
        }
      />

      <div className="flex">
        <Button onClick={() => setSource({ blank: true })}>
          <Plus className="size-4" /> New backup…
        </Button>
      </div>

      <section className="space-y-4">
        <SectionTitle title="Jobs" description={jobs ? `${jobs.length} configured` : undefined} />
        {isLoading && (
          <div className="grid gap-4 lg:grid-cols-2">
            {[0, 1].map((i) => (
              <div key={i} className="surface h-48 animate-pulse" />
            ))}
          </div>
        )}
        {error && <ErrorBanner>{(error as Error).message}</ErrorBanner>}
        {jobs?.length === 0 && (
          <EmptyState
            icon={Archive}
            title="No backup jobs yet"
            description="Create a job to back up a folder or remote with rsync."
          />
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          {jobs?.map((j) => (
            <div key={j.id} className="surface flex min-w-0 flex-col gap-4 p-5">
              <div className="flex items-start gap-3">
                <span className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-xl">
                  <Archive className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold">{j.name}</span>
                    <Badge variant={STATUS[j.status]} className="capitalize">
                      {j.status === "running" && <Loader2 className="animate-spin" />}
                      {j.status}
                    </Badge>
                  </div>
                  <div className="text-muted-foreground mt-0.5 text-xs capitalize">
                    {j.mode} mode{j.archive === "zip" ? " (zip)" : ""}
                    {j.mode === "snapshot" && j.keep ? ` · keep ${j.keep}` : ""}
                    {j.exclude ? ` · exclude ${j.exclude}` : ""}
                  </div>
                </div>
              </div>

              <div className="bg-muted/40 grid gap-1 rounded-lg border p-3 font-mono text-xs">
                <div className="flex min-w-0 items-center gap-1.5" title={j.sourceLabel}>
                  <span className="text-muted-foreground w-9 shrink-0 font-sans">From</span>
                  <KindIcon kind={j.source.kind} />
                  <span className="truncate">{j.sourceLabel}</span>
                </div>
                <ArrowDown className="text-muted-foreground size-3.5" />
                <div className="flex min-w-0 items-center gap-1.5" title={j.targetLabel}>
                  <span className="text-muted-foreground w-9 shrink-0 font-sans">To</span>
                  <KindIcon kind={j.dest.kind} />
                  <span className="truncate">{j.targetLabel}/</span>
                </div>
                <div className="text-muted-foreground font-sans">
                  {j.mode === "snapshot"
                    ? "New timestamped copy each run"
                    : j.intoSubfolder
                      ? "Source copied as a sub folder of the destination"
                      : "Source contents copied straight into the destination"}
                </div>
              </div>
              {(j.preScript || j.postScript) && (
                <div className="grid gap-1 text-xs">
                  {(
                    [
                      ["Before", j.preScript],
                      [
                        `After${j.postScript?.when && j.postScript.when !== "always" ? ` (on ${j.postScript.when})` : ""}`,
                        j.postScript,
                      ],
                    ] as const
                  ).map(
                    ([lbl, h]) =>
                      h && (
                        <div key={lbl} className="flex min-w-0 items-center gap-1.5" title={hookSummary(h)}>
                          <Terminal className="text-muted-foreground size-3.5 shrink-0" />
                          <span className="text-muted-foreground shrink-0">{lbl}:</span>
                          <span className="truncate">{hookSummary(h)}</span>
                        </div>
                      ),
                  )}
                </div>
              )}

              {j.schedule && (
                <div className="flex items-center gap-1.5 text-xs">
                  <CalendarClock className="text-muted-foreground size-3.5" />
                  <span>{describeSchedule(j.schedule)}</span>
                  <span className="text-muted-foreground">
                    {j.nextRunAt ? `· next ${new Date(j.nextRunAt).toLocaleString()}` : "· paused"}
                  </span>
                </div>
              )}
              {j.status === "running" && <Progress value={j.progress ?? 0} className="h-1.5" />}
              {j.lastRun && (
                <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
                  <Clock className="size-3.5" />
                  Last run {new Date(j.lastRun.startedAt).toLocaleString()}
                  {j.lastRun.trigger === "schedule" && " (scheduled)"}
                  {j.lastRun.finishedAt &&
                    ` · ${Math.round(
                      (new Date(j.lastRun.finishedAt).getTime() - new Date(j.lastRun.startedAt).getTime()) /
                        1000,
                    )}s`}
                </div>
              )}
              {j.lastRun?.target && (
                <div
                  className="text-muted-foreground -mt-2 truncate font-mono text-xs"
                  title={j.lastRun.target}
                >
                  → {j.lastRun.target}
                </div>
              )}
              {j.lastRun?.message && (
                <p className={cn("text-xs", j.status === "error" ? "text-destructive" : "text-warning")}>
                  {j.lastRun.message}
                </p>
              )}
              <div className="mt-auto flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={j.status === "running" || run.isPending}
                  onClick={() => run.mutate(j.id)}
                >
                  <Play className="size-4" /> Run now
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={j.status === "running"}
                  onClick={() => setSource({ job: j })}
                >
                  <Pencil className="size-4" /> Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  title="Make a copy of this job"
                  disabled={dup.isPending}
                  onClick={() => dup.mutate(j)}
                >
                  <Copy className="size-4" /> Duplicate
                </Button>
                {j.schedule && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pause.isPending}
                    onClick={() => pause.mutate({ id: j.id, enabled: !j.nextRunAt })}
                  >
                    {j.nextRunAt ? <Pause className="size-4" /> : <CalendarClock className="size-4" />}
                    {j.nextRunAt ? "Pause" : "Resume"}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive ml-auto"
                  disabled={j.status === "running"}
                  onClick={() => del.mutate(j.id)}
                >
                  <Trash2 className="size-4" /> Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      </section>
      <BackupDialog source={source} onClose={() => setSource(null)} />
    </Page>
  );
}

function KindIcon({ kind }: { kind: BackupEndpoint["kind"] }) {
  const Icon = kind === "folder" ? Folder : kind === "remote" ? Server : HardDrive;
  return <Icon className="text-muted-foreground size-3.5 shrink-0" />;
}

function hookSummary(h: BackupHook) {
  const vals = Object.entries(h.params)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`);
  return `${h.scriptName ?? "script"}${vals.length ? ` (${vals.join(", ")})` : ""}`;
}

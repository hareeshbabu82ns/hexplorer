"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import { BackupDialog, BackupSource } from "@/components/explorer/backup-dialog";
import { FolderSelect } from "@/components/explorer/folder-select";
import { deleteBackup, listBackups, runBackupNow } from "@/lib/actions/backups";
import { EmptyState, ErrorBanner, Page, PageHeader, SectionTitle } from "@/components/app/page";
import { Archive, ArrowDown, Clock, Loader2, Play, Plus, Trash2 } from "lucide-react";
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
  const [newFolder, setNewFolder] = useState<string | undefined>();
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
            Back up any data folder or sub folder to another data folder (local or a mounted remote) or a
            local path. Start one here, or from the folder actions on the{" "}
            <Link href="/files" className="text-foreground underline-offset-4 hover:underline">
              Files
            </Link>{" "}
            page.
          </>
        }
      />

      <section className="surface flex flex-wrap items-end gap-3 p-5">
        <div className="grid gap-1.5">
          <Label className="text-[13px]">Back up a whole folder</Label>
          <FolderSelect value={newFolder} onChange={setNewFolder} />
        </div>
        <Button
          disabled={!newFolder}
          onClick={() => newFolder && setSource({ folderId: newFolder, dir: "" })}
        >
          <Plus className="size-4" /> New backup…
        </Button>
      </section>

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
            description="Pick a folder above to create your first rsync backup."
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
                    {j.mode} mode{j.exclude ? ` · exclude ${j.exclude}` : ""}
                  </div>
                </div>
              </div>

              <div className="bg-muted/40 grid gap-1 rounded-lg border p-3 font-mono text-xs">
                <div className="truncate">
                  <span className="text-muted-foreground font-sans">From </span>
                  {j.source.folderName}/{j.source.dir}
                </div>
                <ArrowDown className="text-muted-foreground size-3.5" />
                <div className="truncate">
                  <span className="text-muted-foreground font-sans">To </span>
                  {j.dest.folderId ? `${j.dest.folderName}/${j.dest.dir}` : j.dest.path}
                </div>
              </div>

              {j.status === "running" && <Progress value={j.progress ?? 0} className="h-1.5" />}
              {j.lastRun && (
                <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
                  <Clock className="size-3.5" />
                  Last run {new Date(j.lastRun.startedAt).toLocaleString()}
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
              <div className="mt-auto flex gap-2">
                <Button
                  size="sm"
                  disabled={j.status === "running" || run.isPending}
                  onClick={() => run.mutate(j.id)}
                >
                  <Play className="size-4" /> Run now
                </Button>
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

"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import { BackupDialog, BackupSource } from "@/components/explorer/backup-dialog";
import { FolderSelect } from "@/components/explorer/folder-select";
import { deleteBackup, listBackups, runBackupNow } from "@/lib/actions/backups";

const STATUS: Record<BackupJob["status"], "default" | "secondary" | "destructive" | "outline"> = {
  idle: "outline",
  running: "default",
  success: "secondary",
  warning: "outline",
  error: "destructive",
};

export default function BackupsPage() {
  const qc = useQueryClient();
  const [source, setSource] = useState<BackupSource>(null);
  const [newFolder, setNewFolder] = useState<string | undefined>();
  const { data: jobs, isLoading, error } = useQuery({
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
    <div className="space-y-6 px-4 py-4 pb-16 md:px-10">
      <div>
        <h2 className="text-xl font-bold tracking-tight">Backups</h2>
        <p className="text-muted-foreground text-sm">
          Back up any data folder or sub folder to another data folder (local or a mounted
          remote) or a local path. Start one from here, or from the folder actions on the{" "}
          <Link href="/files" className="underline">Files</Link> page.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1">
          <Label className="text-xs">Back up a whole folder</Label>
          <FolderSelect value={newFolder} onChange={setNewFolder} />
        </div>
        <Button disabled={!newFolder} onClick={() => newFolder && setSource({ folderId: newFolder, dir: "" })}>
          New backup…
        </Button>
      </div>

      {isLoading && <p>Loading…</p>}
      {error && <p className="text-destructive">{(error as Error).message}</p>}
      {jobs?.length === 0 && <p className="text-muted-foreground">No backup jobs yet.</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        {jobs?.map((j) => (
          <Card key={j.id}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="truncate text-base">{j.name}</CardTitle>
                <Badge variant={STATUS[j.status]}>{j.status}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="font-mono text-xs">
                <div>
                  <span className="text-muted-foreground">from </span>
                  {j.source.folderName}/{j.source.dir}
                </div>
                <div>
                  <span className="text-muted-foreground">to </span>
                  {j.dest.folderId ? `${j.dest.folderName}/${j.dest.dir}` : j.dest.path}
                </div>
                <div className="text-muted-foreground">
                  mode {j.mode}
                  {j.exclude ? ` · exclude ${j.exclude}` : ""}
                </div>
              </div>
              {j.status === "running" && <Progress value={j.progress ?? 0} />}
              {j.lastRun && (
                <div className="text-muted-foreground text-xs">
                  Last run {new Date(j.lastRun.startedAt).toLocaleString()}
                  {j.lastRun.finishedAt &&
                    ` · ${Math.round(
                      (new Date(j.lastRun.finishedAt).getTime() -
                        new Date(j.lastRun.startedAt).getTime()) /
                        1000,
                    )}s`}
                  {j.lastRun.target && (
                    <div className="truncate font-mono" title={j.lastRun.target}>
                      → {j.lastRun.target}
                    </div>
                  )}
                </div>
              )}
              {j.lastRun?.message && (
                <p
                  className={
                    j.status === "error" ? "text-destructive text-xs" : "text-xs text-amber-600"
                  }
                >
                  {j.lastRun.message}
                </p>
              )}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={j.status === "running" || run.isPending}
                  onClick={() => run.mutate(j.id)}
                >
                  Run now
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  disabled={j.status === "running"}
                  onClick={() => del.mutate(j.id)}
                >
                  Delete job
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <BackupDialog source={source} onClose={() => setSource(null)} />
    </div>
  );
}

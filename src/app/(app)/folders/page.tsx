"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { FOLDERS_KEY, useFolders } from "@/components/explorer/use-folders";
import {
  addFolder,
  checkFolderOnline,
  removeFolder,
  startHashing,
  startScan,
} from "@/lib/actions/folders";
import { setFolderMounted } from "@/lib/actions/remotes";
import { BackupDialog, BackupSource } from "@/components/explorer/backup-dialog";
import { formatAgo, formatSize } from "@/lib/utils";

function StatusBadge({ f }: { f: DataFolder }) {
  if (f.status === "scanning")
    return <Badge>Scanning… {f.progress ?? 0} entries</Badge>;
  if (f.status === "hashing")
    return <Badge>Hashing… {f.progress ?? 0} files</Badge>;
  if (f.status === "error") return <Badge variant="destructive">Error</Badge>;
  if (!f.lastScanAt) return <Badge variant="outline">Not scanned</Badge>;
  return <Badge variant="secondary">Indexed</Badge>;
}

export default function FoldersPage() {
  const qc = useQueryClient();
  const { data: folders, isLoading, error } = useFolders();
  const [name, setName] = useState("");
  const [folderPath, setFolderPath] = useState("");
  const [scanNow, setScanNow] = useState(true);
  const [backupSource, setBackupSource] = useState<BackupSource>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: FOLDERS_KEY });
  const onErr = (e: any) => toast.error(e.message ?? String(e));

  const add = useMutation({
    mutationFn: () => addFolder({ name, path: folderPath, scan: scanNow }),
    onSuccess: (f) => {
      toast.success(`Added ${f.name}`);
      setName("");
      setFolderPath("");
      refresh();
    },
    onError: onErr,
  });
  const scan = useMutation({
    mutationFn: (id: string) => startScan(id),
    onSuccess: () => (toast.info("Scan started"), refresh()),
    onError: onErr,
  });
  const hash = useMutation({
    mutationFn: (id: string) => startHashing(id),
    onSuccess: () => (toast.info("Hashing duplicate candidates"), refresh()),
    onError: onErr,
  });
  const remove = useMutation({
    mutationFn: removeFolder,
    onSuccess: () => (toast.success("Folder removed from index"), refresh()),
    onError: onErr,
  });
  const mountToggle = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => setFolderMounted(id, on),
    onSuccess: (mounted) => (toast.success(mounted ? "Mounted" : "Unmounted"), refresh()),
    onError: onErr,
  });
  const check = useMutation({
    mutationFn: checkFolderOnline,
    onSuccess: (r) =>
      r.online ? toast.success("Folder is online") : toast.warning(r.message ?? "Offline"),
    onError: onErr,
  });

  return (
    <div className="space-y-6 p-4 pb-16 md:px-6">
      <div>
        <h2 className="text-xl font-bold tracking-tight">Data folders</h2>
        <p className="text-muted-foreground text-sm">
          Add a local path here, or mount a folder from a{" "}
          <Link href="/remotes" className="underline">network remote</Link> (SSH or SMB). Folders are scanned into MongoDB. Browsing, search and duplicate detection
          work from the index even when a share is unmounted; only scan, hash, view and
          delete need the folder on disk.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add folder</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-3 md:flex-row md:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              add.mutate();
            }}
          >
            <div className="grid gap-1.5 md:w-56">
              <Label htmlFor="fname">Name</Label>
              <Input
                id="fname"
                placeholder="Books"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="grid flex-1 gap-1.5">
              <Label htmlFor="fpath">Path</Label>
              <Input
                id="fpath"
                placeholder="/mnt/hexplorer/books  (relative paths resolve under DATA_FOLDER)"
                value={folderPath}
                onChange={(e) => setFolderPath(e.target.value)}
                required
              />
            </div>
            <div className="flex items-center gap-2 pb-2">
              <Switch id="scannow" checked={scanNow} onCheckedChange={setScanNow} />
              <Label htmlFor="scannow">Scan now</Label>
            </div>
            <Button type="submit" disabled={add.isPending || !folderPath}>
              {add.isPending ? "Adding…" : "Add"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {isLoading && <p>Loading…</p>}
      {error && <p className="text-destructive">Failed to load folders: {error.message}</p>}
      {folders && folders.length === 0 && (
        <p className="text-muted-foreground">No folders yet — add one above.</p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {folders?.map((f) => {
          const busy = f.status === "scanning" || f.status === "hashing";
          return (
            <Card key={f.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="truncate text-base">
                      <Link href={`/files?folder=${f.id}`} className="hover:underline">
                        {f.name}
                      </Link>
                    </CardTitle>
                    <p className="text-muted-foreground truncate font-mono text-xs">
                      {f.path}
                    </p>
                  </div>
                  <StatusBadge f={f} />
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {f.mount && (
                  <div className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-xs">
                    <Badge variant={f.mount.mounted ? "default" : "outline"}>
                      {f.mount.mounted ? "Mounted" : "Unmounted"}
                    </Badge>
                    <span className="truncate font-mono">
                      {f.mount.remoteName}:{f.mount.remotePath}
                    </span>
                    <span className="text-muted-foreground">
                      {f.mount.idleMinutes
                        ? `auto-unmount after ${f.mount.idleMinutes} min idle`
                        : "stays mounted"}
                    </span>
                    <span className="grow" />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7"
                      disabled={busy || mountToggle.isPending}
                      onClick={() => mountToggle.mutate({ id: f.id, on: !f.mount!.mounted })}
                    >
                      {f.mount.mounted ? "Unmount" : "Mount"}
                    </Button>
                  </div>
                )}
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <div className="text-muted-foreground text-xs">Files</div>
                    {f.fileCount.toLocaleString()}
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs">Folders</div>
                    {f.dirCount.toLocaleString()}
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs">Size</div>
                    {formatSize(f.totalSize, 1)}
                  </div>
                </div>
                <p className="text-muted-foreground text-xs">
                  {f.lastScanAt
                    ? `Last scan ${formatAgo(new Date(f.lastScanAt))} ago` +
                      (f.lastScanDurationMs
                        ? ` · took ${(f.lastScanDurationMs / 1000).toFixed(1)}s`
                        : "")
                    : "Never scanned"}
                </p>
                {f.statusMessage && (
                  <p
                    className={
                      f.status === "error"
                        ? "text-destructive text-xs"
                        : "text-xs text-amber-600"
                    }
                  >
                    {f.statusMessage}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={busy} onClick={() => scan.mutate(f.id)}>
                    {f.lastScanAt ? "Rescan" : "Scan"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => hash.mutate(f.id)}
                    title="Compute content hashes for same-size files (for content duplicate detection)"
                  >
                    Hash candidates
                  </Button>
                  <Button size="sm" variant="outline" asChild>
                    <Link href={`/files?folder=${f.id}`}>Browse</Link>
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setBackupSource({ folderId: f.id, dir: "" })}>
                    Back up
                  </Button>
                  <Button size="sm" variant="outline" asChild>
                    <Link href={`/duplicates?folder=${f.id}`}>Duplicates</Link>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={check.isPending}
                    onClick={() => check.mutate(f.id)}
                    title="Probe the folder on disk (mounts an autofs share)"
                  >
                    Check online
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="ghost" className="text-destructive" disabled={busy}>
                        Remove
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remove {f.name}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Removes the folder and its index from the database. Files on
                          disk are not touched.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => remove.mutate(f.id)}>
                          Remove
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      <BackupDialog source={backupSource} onClose={() => setBackupSource(null)} />
    </div>
  );
}

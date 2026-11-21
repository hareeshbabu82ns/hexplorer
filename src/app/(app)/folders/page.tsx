"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
} from "@/components/ui/alert-dialog";
import { FOLDERS_KEY, useFolders } from "@/components/explorer/use-folders";
import { addFolder, checkFolderOnline, removeFolder, startHashing, startScan } from "@/lib/actions/folders";
import { setFolderMounted } from "@/lib/actions/remotes";
import { BackupDialog, BackupSource } from "@/components/explorer/backup-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState, ErrorBanner, Metric, Page, PageHeader, SectionTitle } from "@/components/app/page";
import {
  Activity,
  Archive,
  Copy,
  FingerprintPattern,
  FolderOpen,
  HardDrive,
  Loader2,
  MoreHorizontal,
  Network,
  Plug,
  PlugZap,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { cn, formatAgo, formatSize } from "@/lib/utils";

function StatusBadge({ f }: { f: DataFolder }) {
  if (f.status === "scanning")
    return (
      <Badge variant="info">
        <Loader2 className="animate-spin" /> Scanning · {(f.progress ?? 0).toLocaleString()}
      </Badge>
    );
  if (f.status === "hashing")
    return (
      <Badge variant="info">
        <Loader2 className="animate-spin" /> Hashing · {(f.progress ?? 0).toLocaleString()}
      </Badge>
    );
  if (f.status === "error") return <Badge variant="destructive">Error</Badge>;
  if (!f.lastScanAt) return <Badge variant="outline">Not scanned</Badge>;
  return <Badge variant="success">Indexed</Badge>;
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
    onSuccess: (r) => (r.online ? toast.success("Folder is online") : toast.warning(r.message ?? "Offline")),
    onError: onErr,
  });

  const [removeTarget, setRemoveTarget] = useState<DataFolder | null>(null);

  return (
    <Page>
      <PageHeader
        icon={HardDrive}
        title="Data folders"
        description={
          <>
            Add a local path, or mount one from a{" "}
            <Link href="/remotes" className="text-foreground underline-offset-4 hover:underline">
              network remote
            </Link>
            . Browsing, search and duplicate detection work from the index even when a share is unmounted;
            only scan, hash, view and delete need the folder on disk.
          </>
        }
      />

      <section className="surface p-5">
        <SectionTitle
          title="Add folder"
          description="Relative paths resolve under DATA_FOLDER."
          className="mb-4"
        />
        <form
          className="flex flex-col gap-3 md:flex-row md:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <div className="grid gap-1.5 md:w-56">
            <Label htmlFor="fname" className="text-[13px]">
              Name
            </Label>
            <Input id="fname" placeholder="Books" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid flex-1 gap-1.5">
            <Label htmlFor="fpath" className="text-[13px]">
              Path
            </Label>
            <Input
              id="fpath"
              className="font-mono"
              placeholder="/mnt/hexplorer/books"
              value={folderPath}
              onChange={(e) => setFolderPath(e.target.value)}
              required
            />
          </div>
          <label htmlFor="scannow" className="flex h-10 items-center gap-2 text-sm">
            <Switch id="scannow" checked={scanNow} onCheckedChange={setScanNow} />
            Scan now
          </label>
          <Button type="submit" disabled={add.isPending || !folderPath}>
            {add.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            {add.isPending ? "Adding…" : "Add folder"}
          </Button>
        </form>
      </section>

      <section className="space-y-4">
        <SectionTitle
          title="Folders"
          description={
            folders ? `${folders.length} folder${folders.length === 1 ? "" : "s"} indexed` : undefined
          }
        />
        {isLoading && (
          <div className="grid gap-4 lg:grid-cols-2">
            {[0, 1].map((i) => (
              <div key={i} className="surface h-56 animate-pulse" />
            ))}
          </div>
        )}
        {error && <ErrorBanner>Failed to load folders: {error.message}</ErrorBanner>}
        {folders && folders.length === 0 && (
          <EmptyState
            icon={HardDrive}
            title="No folders yet"
            description="Add a local path above, or mount one from a remote."
          />
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          {folders?.map((f) => {
            const busy = f.status === "scanning" || f.status === "hashing";
            return (
              <div key={f.id} className="surface flex min-w-0 flex-col">
                <div className="flex items-start gap-3 p-5 pb-4">
                  <span
                    className={cn(
                      "flex size-11 shrink-0 items-center justify-center rounded-xl",
                      f.mount ? "bg-info/10 text-info" : "bg-primary/10 text-primary",
                    )}
                  >
                    {f.mount ? <Network className="size-5" /> : <HardDrive className="size-5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Link href={`/files?folder=${f.id}`} className="truncate font-semibold hover:underline">
                        {f.name}
                      </Link>
                      <StatusBadge f={f} />
                    </div>
                    <p className="text-muted-foreground mt-0.5 truncate font-mono text-xs" title={f.path}>
                      {f.path}
                    </p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon-sm" variant="ghost" aria-label="More actions">
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      <DropdownMenuItem disabled={busy} onClick={() => hash.mutate(f.id)}>
                        <FingerprintPattern className="mr-2 size-4" /> Hash candidates
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setBackupSource({ folderId: f.id, dir: "" })}>
                        <Archive className="mr-2 size-4" /> Back up…
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href={`/duplicates?folder=${f.id}`}>
                          <Copy className="mr-2 size-4" /> Duplicates
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled={check.isPending} onClick={() => check.mutate(f.id)}>
                        <Activity className="mr-2 size-4" /> Check online
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        disabled={busy}
                        className="text-destructive focus:text-destructive"
                        onClick={() => setRemoveTarget(f)}
                      >
                        <Trash2 className="mr-2 size-4" /> Remove from index
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div className="grid grid-cols-3 gap-4 border-y bg-muted/30 px-5 py-3.5">
                  <Metric label="Files" value={f.fileCount.toLocaleString()} />
                  <Metric label="Folders" value={f.dirCount.toLocaleString()} />
                  <Metric label="Size" value={formatSize(f.totalSize, 1)} />
                </div>

                <div className="flex flex-1 flex-col gap-3 p-5 pt-4">
                  {f.mount && (
                    <div className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-xs">
                      <span className="relative flex size-2">
                        <span
                          className={cn(
                            "size-2 rounded-full",
                            f.mount.mounted ? "bg-success" : "bg-muted-foreground/40",
                          )}
                        />
                      </span>
                      <span className="font-medium">{f.mount.mounted ? "Mounted" : "Unmounted"}</span>
                      <span className="text-muted-foreground min-w-0 truncate font-mono">
                        {f.mount.remoteName}:{f.mount.remotePath}
                      </span>
                      <span className="grow" />
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={busy || mountToggle.isPending}
                        onClick={() => mountToggle.mutate({ id: f.id, on: !f.mount!.mounted })}
                      >
                        {f.mount.mounted ? <PlugZap /> : <Plug />}
                        {f.mount.mounted ? "Unmount" : "Mount"}
                      </Button>
                    </div>
                  )}
                  {f.statusMessage && (
                    <p className={cn("text-xs", f.status === "error" ? "text-destructive" : "text-warning")}>
                      {f.statusMessage}
                    </p>
                  )}
                  <div className="mt-auto flex flex-wrap items-center gap-2">
                    <span className="text-muted-foreground mr-auto text-xs">
                      {f.lastScanAt
                        ? `Scanned ${formatAgo(new Date(f.lastScanAt))} ago` +
                          (f.lastScanDurationMs ? ` · ${(f.lastScanDurationMs / 1000).toFixed(1)}s` : "")
                        : "Never scanned"}
                      {f.mount &&
                        ` · ${f.mount.idleMinutes ? `idle unmount ${f.mount.idleMinutes}m` : "stays mounted"}`}
                    </span>
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`/files?folder=${f.id}`}>
                        <FolderOpen className="size-4" /> Browse
                      </Link>
                    </Button>
                    <Button size="sm" disabled={busy} onClick={() => scan.mutate(f.id)}>
                      <RefreshCw className={cn("size-4", busy && "animate-spin")} />
                      {f.lastScanAt ? "Rescan" : "Scan"}
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <AlertDialog open={!!removeTarget} onOpenChange={(v) => !v && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removeTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Removes the folder and its index from the database. Files on disk are not touched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => removeTarget && remove.mutate(removeTarget.id)}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <BackupDialog source={backupSource} onClose={() => setBackupSource(null)} />
    </Page>
  );
}

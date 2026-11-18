"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { saveBackup } from "@/lib/actions/backups";
import { useFolders } from "./use-folders";

export type BackupSource = { folderId: string; dir: string } | null;

const MODES: { value: BackupMode; label: string; hint: string }[] = [
  { value: "sync", label: "Sync", hint: "Copy new/changed files into <dest>/<name>; never deletes" },
  { value: "mirror", label: "Mirror", hint: "Make <dest>/<name> an exact copy (deletes extra files there)" },
  { value: "snapshot", label: "Snapshot", hint: "New timestamped copy each run: <dest>/<name>-YYYYMMDD-HHMMSS" },
];

/** controlled dialog: open by passing a source, close by setting it to null */
export function BackupDialog({
  source,
  onClose,
}: {
  source: BackupSource;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { data: folders } = useFolders();
  const [destKind, setDestKind] = useState<"folder" | "path">("folder");
  const [destFolderId, setDestFolderId] = useState<string>("");
  const [destDir, setDestDir] = useState("backups");
  const [destPath, setDestPath] = useState("");
  const [mode, setMode] = useState<BackupMode>("sync");
  const [exclude, setExclude] = useState("");
  const [rescan, setRescan] = useState(true);
  const [name, setName] = useState("");

  const srcFolder = folders?.find((f) => f.id === source?.folderId);
  useEffect(() => {
    if (!source) return;
    setName("");
    // default destination: first other folder
    const other = folders?.find((f) => f.id !== source.folderId);
    setDestFolderId((cur) => cur || other?.id || source.folderId);
  }, [source, folders]);

  const save = useMutation({
    mutationFn: (runNow: boolean) =>
      saveBackup(
        {
          name,
          sourceFolderId: source!.folderId,
          sourceDir: source!.dir,
          destFolderId: destKind === "folder" ? destFolderId : null,
          destDir,
          destPath: destKind === "path" ? destPath : null,
          mode,
          exclude,
          rescanDest: rescan,
        },
        runNow,
      ),
    onSuccess: (_, runNow) => {
      toast.success(runNow ? "Backup started — see the Backups page" : "Backup job saved");
      qc.invalidateQueries({ queryKey: ["backups"] });
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const srcLabel = `${srcFolder?.name ?? "?"}/${source?.dir ?? ""}`;
  const baseName = source?.dir ? source.dir.split("/").pop() : srcFolder?.name;
  const destLabel =
    destKind === "folder"
      ? `${folders?.find((f) => f.id === destFolderId)?.name ?? "?"}/${destDir ? destDir + "/" : ""}`
      : `${destPath.replace(/\/$/, "")}/`;

  return (
    <Dialog open={!!source} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Back up {srcLabel}</DialogTitle>
          <DialogDescription>
            Copies with rsync. Remote data folders are mounted automatically for the run.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label>Destination</Label>
            <RadioGroup
              value={destKind}
              onValueChange={(v) => setDestKind(v as "folder" | "path")}
              className="flex gap-4"
            >
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="folder" /> Data folder (local or remote)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="path" /> Local path
              </label>
            </RadioGroup>
          </div>
          {destKind === "folder" ? (
            <div className="flex gap-2">
              <Select value={destFolderId} onValueChange={setDestFolderId}>
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="Pick a folder" />
                </SelectTrigger>
                <SelectContent>
                  {folders?.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name}
                      {f.mount ? " (remote)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                placeholder="sub path, e.g. backups"
                value={destDir}
                onChange={(e) => setDestDir(e.target.value)}
              />
            </div>
          ) : (
            <Input
              placeholder="/media/usb/backups"
              value={destPath}
              onChange={(e) => setDestPath(e.target.value)}
            />
          )}
          <div className="grid gap-1.5">
            <Label>Mode</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as BackupMode)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODES.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              {MODES.find((m) => m.value === mode)?.hint}
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label>Exclude (comma separated rsync patterns)</Label>
            <Input
              placeholder="*.tmp, .DS_Store, @eaDir"
              value={exclude}
              onChange={(e) => setExclude(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Job name (optional)</Label>
            <Input placeholder={`${srcLabel} backup`} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          {destKind === "folder" && (
            <div className="flex items-center gap-2">
              <Switch id="rescan" checked={rescan} onCheckedChange={setRescan} />
              <Label htmlFor="rescan">Index the copy in the destination folder afterwards</Label>
            </div>
          )}
          <p className="bg-muted rounded p-2 font-mono text-xs">
            {srcLabel} → {destLabel}
            {baseName}
            {mode === "snapshot" ? "-<timestamp>" : ""}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={save.isPending} onClick={() => save.mutate(false)}>
            Save job only
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate(true)}>
            Save &amp; run now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

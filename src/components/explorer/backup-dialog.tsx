"use client";

import { useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { saveBackup } from "@/lib/actions/backups";
import { EndpointPicker, useRemotes } from "./backup-endpoint";
import { useFolders } from "./use-folders";

/**
 * What to open the dialog with:
 *  - { folderId, dir }: new job backing up that data folder path
 *  - { job }: edit an existing job
 *  - { blank: true }: new job, pick everything
 */
export type BackupSource =
  | { folderId: string; dir: string }
  | { job: BackupJob }
  | { blank: true }
  | null;

const MODES: { value: BackupMode; label: string; hint: string }[] = [
  { value: "sync", label: "Sync", hint: "Copy new/changed files into <dest>/<name>; never deletes" },
  { value: "mirror", label: "Mirror", hint: "Make <dest>/<name> an exact copy (deletes extra files there)" },
  { value: "snapshot", label: "Snapshot", hint: "New timestamped copy each run: <dest>/<name>-YYYYMMDD-HHMMSS" },
];

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const pad = (n: number) => String(n).padStart(2, "0");
const OFF: BackupSchedule = { type: "off", minute: 0, hour: 2, weekday: 0 };

export function describeSchedule(s: BackupSchedule | null) {
  if (!s || s.type === "off") return "Manual only";
  if (s.type === "hourly") return `Hourly at :${pad(s.minute)}`;
  const at = `${pad(s.hour)}:${pad(s.minute)}`;
  return s.type === "daily" ? `Daily at ${at}` : `${WEEKDAYS[s.weekday]}s at ${at}`;
}

type Form = {
  id?: string;
  name: string;
  source: BackupEndpoint;
  dest: BackupEndpoint;
  mode: BackupMode;
  exclude: string;
  rescan: boolean;
  keep: string;
  zip: boolean;
  schedule: BackupSchedule;
};

function initialForm(init: NonNullable<BackupSource>, folders: { id: string }[] | undefined): Form {
  if ("job" in init) {
    const j = init.job;
    return {
      id: j.id,
      name: j.name,
      source: j.source,
      dest: j.dest,
      mode: j.mode,
      exclude: j.exclude,
      rescan: j.rescanDest,
      keep: j.keep ? String(j.keep) : "",
      zip: j.archive === "zip",
      schedule: j.schedule ?? OFF,
    };
  }
  const source: BackupEndpoint =
    "folderId" in init
      ? { kind: "folder", folderId: init.folderId, dir: init.dir }
      : { kind: "folder", folderId: folders?.[0]?.id ?? "", dir: "" };
  const srcId = source.kind === "folder" ? source.folderId : "";
  const other = folders?.find((f) => f.id !== srcId)?.id ?? srcId;
  return {
    name: "",
    source,
    dest: { kind: "folder", folderId: other, dir: "backups" },
    mode: "sync",
    exclude: "",
    rescan: true,
    keep: "",
    zip: false,
    schedule: OFF,
  };
}

/** controlled dialog: open by passing a source, close by setting it to null */
export function BackupDialog({ source, onClose }: { source: BackupSource; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: folders } = useFolders();
  const { data: remotes } = useRemotes();
  const [form, setForm] = useState<Form | null>(null);
  // (re)initialise when a new source is passed (adjusted during render, not in an effect);
  // until folders load, a fresh job has no folder ids to default to, so retry once they arrive
  const [prev, setPrev] = useState<{ source: BackupSource; ready: boolean }>({ source: null, ready: false });
  const ready = !!folders;
  if (prev.source !== source || (source && !prev.ready && ready)) {
    setPrev({ source, ready });
    setForm(source ? initialForm(source, folders) : null);
  }
  const patch = (p: Partial<Form>) => setForm((f) => (f ? { ...f, ...p } : f));

  const save = useMutation({
    mutationFn: (runNow: boolean) =>
      saveBackup(
        {
          id: form!.id,
          name: form!.name,
          source: form!.source,
          dest: form!.dest,
          mode: form!.mode,
          exclude: form!.exclude,
          rescanDest: form!.rescan,
          keep: form!.keep ? Number(form!.keep) : null,
          archive: form!.mode === "snapshot" && form!.zip ? "zip" : null,
          schedule: form!.schedule,
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

  const label = (ep: BackupEndpoint) => {
    if (ep.kind === "folder")
      return `${folders?.find((f) => f.id === ep.folderId)?.name ?? "?"}/${ep.dir.replace(/^\/+|\/+$/g, "")}`;
    if (ep.kind === "remote") return `${remotes?.find((r) => r.id === ep.remoteId)?.name ?? "?"}:${ep.path || "~"}`;
    return ep.path || "?";
  };
  const baseName = (ep: BackupEndpoint) => {
    const p = ep.kind === "folder" ? ep.dir : ep.path;
    const seg = p.split("/").filter(Boolean).pop();
    if (seg) return seg;
    if (ep.kind === "folder") return folders?.find((f) => f.id === ep.folderId)?.name ?? "?";
    if (ep.kind === "remote") return remotes?.find((r) => r.id === ep.remoteId)?.name ?? "?";
    return "root";
  };

  const f = form;
  const s = f?.schedule ?? OFF;
  const setSchedule = (p: Partial<BackupSchedule>) => patch({ schedule: { ...s, ...p } });

  return (
    <Dialog open={!!source} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{f?.id ? `Edit ${f.name}` : "New backup"}</DialogTitle>
          <DialogDescription>
            Copies with rsync. Remotes and remote data folders are mounted automatically for the run.
          </DialogDescription>
        </DialogHeader>
        {f && (
          <div className="grid gap-5">
            <div className="grid gap-1.5">
              <Label>Source</Label>
              <EndpointPicker role="source" value={f.source} onChange={(source) => patch({ source })} />
            </div>
            <div className="grid gap-1.5">
              <Label>Destination</Label>
              <EndpointPicker role="dest" value={f.dest} onChange={(dest) => patch({ dest })} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid content-start gap-1.5">
                <Label>Mode</Label>
                <Select value={f.mode} onValueChange={(v) => patch({ mode: v as BackupMode })}>
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
                <p className="text-muted-foreground text-xs">{MODES.find((m) => m.value === f.mode)?.hint}</p>
              </div>
              {f.mode === "snapshot" && (
                <div className="grid content-start gap-1.5">
                  <Label>Keep snapshots</Label>
                  <Input
                    type="number"
                    min={0}
                    placeholder="all"
                    value={f.keep}
                    onChange={(e) => patch({ keep: e.target.value })}
                  />
                  <p className="text-muted-foreground text-xs">Older snapshots are deleted after each run.</p>
                </div>
              )}
              {f.mode === "snapshot" && (
                <div className="flex items-start gap-2 sm:col-span-2">
                  <Switch id="zip" checked={f.zip} onCheckedChange={(zip) => patch({ zip })} />
                  <div className="grid gap-0.5">
                    <Label htmlFor="zip">Save each snapshot as a .zip file</Label>
                    <p className="text-muted-foreground text-xs">
                      One compressed archive per run instead of a folder copy. Symlinks are skipped.
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="grid gap-1.5">
              <Label>Schedule</Label>
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={s.type}
                  onValueChange={(type) => setSchedule({ type: type as BackupSchedule["type"] })}
                >
                  <SelectTrigger className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="off">Manual only</SelectItem>
                    <SelectItem value="hourly">Hourly</SelectItem>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                  </SelectContent>
                </Select>
                {s.type === "weekly" && (
                  <Select value={String(s.weekday)} onValueChange={(v) => setSchedule({ weekday: Number(v) })}>
                    <SelectTrigger className="w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {WEEKDAYS.map((d, i) => (
                        <SelectItem key={d} value={String(i)}>
                          {d}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {(s.type === "daily" || s.type === "weekly") && (
                  <Input
                    type="time"
                    className="w-32"
                    value={`${pad(s.hour)}:${pad(s.minute)}`}
                    onChange={(e) => {
                      const [h, m] = e.target.value.split(":").map(Number);
                      if (!isNaN(h) && !isNaN(m)) setSchedule({ hour: h, minute: m });
                    }}
                  />
                )}
                {s.type === "hourly" && (
                  <div className="flex items-center gap-2 text-sm">
                    at minute
                    <Input
                      type="number"
                      min={0}
                      max={59}
                      className="w-20"
                      value={s.minute}
                      onChange={(e) => setSchedule({ minute: Math.min(59, Math.max(0, Number(e.target.value) || 0)) })}
                    />
                  </div>
                )}
              </div>
              {s.type !== "off" && (
                <p className="text-muted-foreground text-xs">Times are in the server&apos;s time zone.</p>
              )}
            </div>

            <div className="grid gap-1.5">
              <Label>Exclude (comma separated rsync patterns)</Label>
              <Input
                placeholder="*.tmp, .DS_Store, @eaDir"
                value={f.exclude}
                onChange={(e) => patch({ exclude: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Job name (optional)</Label>
              <Input
                placeholder={`${label(f.source)} backup`}
                value={f.name}
                onChange={(e) => patch({ name: e.target.value })}
              />
            </div>
            {f.dest.kind === "folder" && (
              <div className="flex items-center gap-2">
                <Switch id="rescan" checked={f.rescan} onCheckedChange={(rescan) => patch({ rescan })} />
                <Label htmlFor="rescan">Index the copy in the destination folder afterwards</Label>
              </div>
            )}
            <p className="bg-muted break-all rounded p-2 font-mono text-xs">
              {label(f.source)} → {label(f.dest).replace(/\/$/, "")}/{baseName(f.source)}
              {f.mode === "snapshot" ? `-<timestamp>${f.zip ? ".zip" : ""}` : ""}
            </p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={save.isPending || !f} onClick={() => save.mutate(false)}>
            {f?.id ? "Save" : "Save job only"}
          </Button>
          <Button disabled={save.isPending || !f} onClick={() => save.mutate(true)}>
            Save &amp; run now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useState } from "react";
import { AlertTriangle, ArrowDown, FolderInput, FolderTree } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { saveBackup } from "@/lib/actions/backups";
import { EndpointPicker, useRemotes } from "./backup-endpoint";
import { HookEditor, hookForm, hookInput, type HookForm } from "./backup-hook";
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
  { value: "sync", label: "Sync", hint: "Copy new and changed files to the target; never deletes anything" },
  { value: "mirror", label: "Mirror", hint: "Make the target an exact copy of the source (deletes extra files in the target)" },
  { value: "snapshot", label: "Snapshot", hint: "A new timestamped copy inside the destination on every run" },
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
  /** sync / mirror: copy into <dest>/<source name> instead of straight into <dest> */
  subfolder: boolean;
  pre: HookForm;
  post: HookForm;
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
      subfolder: j.intoSubfolder,
      pre: hookForm(j.preScript),
      post: hookForm(j.postScript),
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
    subfolder: false,
    pre: hookForm(null),
    post: hookForm(null),
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
          intoSubfolder: form!.mode === "snapshot" || form!.subfolder,
          preScript: hookInput(form!.pre),
          postScript: hookInput(form!.post),
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
  const trim = (p: string) => p.replace(/\/+$/, "");
  const srcLabel = f ? trim(label(f.source)) : "";
  const destLabel = f ? trim(label(f.dest)) : "";
  const subfolder = f?.mode === "snapshot" || !!f?.subfolder;
  const targetLabel = !f
    ? ""
    : f.mode === "snapshot"
      ? `${destLabel}/${baseName(f.source)}-<timestamp>${f.zip ? ".zip" : ""}`
      : subfolder
        ? `${destLabel}/${baseName(f.source)}`
        : destLabel;
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
              <Label>Source — what to copy</Label>
              <EndpointPicker role="source" value={f.source} onChange={(source) => patch({ source })} />
            </div>
            <div className="grid gap-1.5">
              <Label>Destination — where to put it</Label>
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

            {f.mode !== "snapshot" && (
              <div className="grid gap-1.5">
                <Label>Copy as</Label>
                <div className="grid gap-2 sm:grid-cols-2">
                  <LayoutChoice
                    active={!f.subfolder}
                    onClick={() => patch({ subfolder: false })}
                    icon={FolderInput}
                    title="Contents into destination"
                    example={`${srcLabel}/a.jpg → ${destLabel}/a.jpg`}
                  />
                  <LayoutChoice
                    active={f.subfolder}
                    onClick={() => patch({ subfolder: true })}
                    icon={FolderTree}
                    title={`As a folder “${baseName(f.source)}” inside destination`}
                    example={`${srcLabel}/a.jpg → ${destLabel}/${baseName(f.source)}/a.jpg`}
                  />
                </div>
              </div>
            )}

            <div className="bg-muted/40 grid gap-1 rounded-lg border p-3 font-mono text-xs">
              <div className="flex min-w-0 gap-2">
                <span className="text-muted-foreground w-12 shrink-0 font-sans">From</span>
                <span className="break-all">
                  {srcLabel}
                  {f.mode !== "snapshot" && !f.subfolder ? "/*" : ""}
                </span>
              </div>
              <ArrowDown className="text-muted-foreground ml-14 size-3.5" />
              <div className="flex min-w-0 gap-2">
                <span className="text-muted-foreground w-12 shrink-0 font-sans">To</span>
                <span className="break-all">{targetLabel}/</span>
              </div>
              {f.mode === "mirror" && (
                <p className="text-warning mt-1 flex items-start gap-1.5 font-sans">
                  <AlertTriangle className="mt-px size-3.5 shrink-0" />
                  Files in {targetLabel}/ that are not in the source will be deleted
                  {!f.subfolder && " — including anything else already in the destination"}.
                </p>
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
            <HookEditor
              kind="pre"
              value={f.pre}
              onChange={(pre) => patch({ pre })}
            />
            <HookEditor
              kind="post"
              value={f.post}
              onChange={(post) => patch({ post })}
            />
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

function LayoutChoice({
  active,
  onClick,
  icon: Icon,
  title,
  example,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  example: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "grid min-w-0 gap-1 rounded-lg border p-3 text-left text-sm transition-colors",
        active ? "border-primary bg-primary/5 ring-primary ring-1" : "hover:bg-muted/60",
      )}
    >
      <span className="flex items-center gap-2 font-medium">
        <Icon className={cn("size-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
        <span className="truncate">{title}</span>
      </span>
      <span className="text-muted-foreground break-all font-mono text-xs">{example}</span>
    </button>
  );
}

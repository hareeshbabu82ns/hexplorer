"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Archive, Download, History, Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { DangerDialog } from "@/components/db-admin/danger-dialog";
import { useRunAction } from "@/components/db-admin/use-run-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { createBackup, deleteBackup, listBackups, restoreBackup } from "@/lib/actions/db-admin/backups";
import { listCollections } from "@/lib/actions/db-admin/collections";
import { formatBytes, formatNumber } from "@/lib/db-admin/format";
import { dbPath } from "@/lib/db-admin/paths";
import type { BackupSummary, ConnectionSummary } from "@/lib/db-admin/types";

const STATUS_VARIANT = { running: "default", completed: "secondary", failed: "destructive" } as const;

export function BackupsTab({
  connection,
  initial,
  databases,
  connections,
  createFor,
  onCreateHandled,
}: {
  connection: ConnectionSummary;
  initial: BackupSummary[];
  databases: string[];
  connections: ConnectionSummary[];
  createFor: string | null;
  onCreateHandled: () => void;
}) {
  const router = useRouter();
  const { run } = useRunAction();
  const [backups, setBackups] = useState(initial);
  const [creating, setCreating] = useState<string | null>(createFor);
  const [restoring, setRestoring] = useState<BackupSummary | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // "Back up" on the databases tab opens the dialog for that database
  const [lastCreateFor, setLastCreateFor] = useState(createFor);
  if (createFor !== lastCreateFor) {
    setLastCreateFor(createFor);
    if (createFor) setCreating(createFor);
  }

  const anyRunning = backups.some((b) => b.status === "running");
  useEffect(() => {
    if (!anyRunning) return;
    let cancelled = false;
    const t = setInterval(() => {
      listBackups(connection.id).then((r) => {
        if (!cancelled && r.success) setBackups(r.data);
      });
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [anyRunning, connection.id]);

  const reload = async () => {
    const r = await listBackups(connection.id);
    if (r.success) setBackups(r.data);
  };

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const qs = new URLSearchParams({ connectionId: connection.id, name: file.name.replace(/\.ndjson\.gz$/, "") });
      const res = await fetch(`/api/db-admin/backups/upload?${qs}`, {
        method: "POST",
        body: file,
        headers: { "Content-Type": "application/gzip" },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Upload failed (${res.status})`);
      toast.success(`Uploaded ${body.data.name}`);
      await reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap justify-end gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".gz,application/gzip"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
        />
        <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
          {uploading ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Upload className="mr-2 size-4" />}
          Upload
        </Button>
        <Button onClick={() => setCreating(databases.find((d) => !["admin", "local", "config"].includes(d)) ?? "")}>
          <Archive className="mr-2 size-4" /> Create backup
        </Button>
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Backup</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden text-right md:table-cell">Documents</TableHead>
              <TableHead className="hidden text-right md:table-cell">Size</TableHead>
              <TableHead className="hidden sm:table-cell">Created</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {backups.map((b) => (
              <TableRow key={b.id}>
                <TableCell>
                  <div className="font-medium">{b.name}</div>
                  <div className="text-muted-foreground text-xs">
                    <span className="font-mono">{b.database}</span>
                    {b.collections.length ? ` · ${b.collections.length} collection(s)` : " · all collections"}
                    {b.source === "upload" && " · uploaded"}
                  </div>
                  {b.description && <div className="text-muted-foreground text-xs">{b.description}</div>}
                  {b.error && <div className="text-destructive text-xs">{b.error}</div>}
                </TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[b.status]}>
                    {b.status === "running" && <Loader2 className="mr-1 size-3 animate-spin" />}
                    {b.status}
                  </Badge>
                </TableCell>
                <TableCell className="hidden text-right tabular-nums md:table-cell">{formatNumber(b.documentCount)}</TableCell>
                <TableCell className="hidden text-right tabular-nums md:table-cell">{formatBytes(b.sizeBytes)}</TableCell>
                <TableCell className="text-muted-foreground hidden whitespace-nowrap text-xs sm:table-cell" title={new Date(b.createdAt).toLocaleString()}>
                  {formatDistanceToNow(new Date(b.createdAt), { addSuffix: true })}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    {b.status === "completed" && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => setRestoring(b)}>
                          <History className="mr-1 size-4" /> Restore
                        </Button>
                        <Button size="icon" variant="ghost" asChild aria-label="Download">
                          <a href={`/api/db-admin/backups/${b.id}/download`} download>
                            <Download className="size-4" />
                          </a>
                        </Button>
                      </>
                    )}
                    {b.status !== "running" && (
                      <DangerDialog
                        trigger={
                          <Button size="icon" variant="ghost" className="text-destructive" aria-label="Delete backup">
                            <Trash2 className="size-4" />
                          </Button>
                        }
                        title={`Delete backup "${b.name}"?`}
                        description="The backup file is deleted from the server."
                        onConfirm={async () => {
                          const r = await run(() => deleteBackup(b.id), "Backup deleted");
                          if (r) await reload();
                          return !!r;
                        }}
                      />
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {!backups.length && (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground text-center">
                  No backups for this connection yet
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {creating !== null && (
        <CreateBackupDialog
          connectionId={connection.id}
          databases={databases}
          initialDatabase={creating}
          onClose={() => {
            setCreating(null);
            onCreateHandled();
          }}
          onCreated={(b) => {
            setBackups((list) => [b, ...list]);
            setCreating(null);
            onCreateHandled();
          }}
        />
      )}
      {restoring && (
        <RestoreDialog
          key={restoring.id}
          backup={restoring}
          connections={connections}
          defaultConnectionId={connection.id}
          onClose={() => setRestoring(null)}
          onRestored={(target, db) => {
            setRestoring(null);
            if (target === connection.id) router.refresh();
            else router.push(dbPath(target, db));
          }}
        />
      )}
    </div>
  );
}

function useCollections(connectionId: string, database: string) {
  const [state, setState] = useState<{ key: string; names: string[] | null; error: string | null }>({
    key: "",
    names: null,
    error: null,
  });
  const key = `${connectionId}/${database}`;
  useEffect(() => {
    if (!database) return;
    let cancelled = false;
    listCollections(connectionId, database).then((r) => {
      if (cancelled) return;
      setState({
        key,
        names: r.success ? r.data.filter((c) => !c.name.startsWith("system.")).map((c) => c.name) : null,
        error: r.success ? null : r.error,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [connectionId, database, key]);
  return state.key === key ? state : { key, names: null, error: null };
}

function CollectionChecklist({
  names,
  value,
  onChange,
}: {
  names: string[];
  value: string[] | null;
  onChange: (v: string[] | null) => void;
}) {
  return (
    <div className="grid gap-2">
      <RadioGroup value={value === null ? "all" : "some"} onValueChange={(v) => onChange(v === "all" ? null : [])} className="flex gap-4">
        <div className="flex items-center gap-2">
          <RadioGroupItem value="all" id="cl-all" />
          <Label htmlFor="cl-all">All collections</Label>
        </div>
        <div className="flex items-center gap-2">
          <RadioGroupItem value="some" id="cl-some" />
          <Label htmlFor="cl-some">Choose</Label>
        </div>
      </RadioGroup>
      {value !== null && (
        <div className="grid max-h-48 gap-1 overflow-y-auto rounded-md border p-2">
          {names.map((n) => (
            <label key={n} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={value.includes(n)}
                onCheckedChange={(c) => onChange(c ? [...value, n] : value.filter((x) => x !== n))}
              />
              <span className="font-mono">{n}</span>
            </label>
          ))}
          {!names.length && <span className="text-muted-foreground text-sm">No collections</span>}
        </div>
      )}
    </div>
  );
}

function CreateBackupDialog({
  connectionId,
  databases,
  initialDatabase,
  onClose,
  onCreated,
}: {
  connectionId: string;
  databases: string[];
  initialDatabase: string;
  onClose: () => void;
  onCreated: (b: BackupSummary) => void;
}) {
  const [database, setDatabase] = useState(initialDatabase);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState<string[] | null>(null);
  const colls = useCollections(connectionId, database);
  const { busy, run } = useRunAction();

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create backup</DialogTitle>
          <DialogDescription>Runs in the background; the file is a gzipped Extended JSON stream.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (selected && !selected.length) return toast.error("Choose at least one collection");
            const r = await run(
              () => createBackup(connectionId, database, { name, description, collections: selected }),
              "Backup started",
            );
            if (r) onCreated(r);
          }}
        >
          <div className="grid gap-2">
            <Label>Database</Label>
            <Select
              value={database}
              onValueChange={(v) => {
                setDatabase(v);
                setSelected(null);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose a database" />
              </SelectTrigger>
              <SelectContent>
                {databases.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="b-name">Name</Label>
            <Input id="b-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={`${database || "db"} backup`} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="b-desc">Description</Label>
            <Textarea id="b-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          {database &&
            (colls.error ? (
              <p className="text-destructive text-sm">{colls.error}</p>
            ) : colls.names ? (
              <CollectionChecklist names={colls.names} value={selected} onChange={setSelected} />
            ) : (
              <Loader2 className="size-4 animate-spin" />
            ))}
          <DialogFooter>
            <Button type="submit" disabled={busy || !database}>
              {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
              Start backup
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RestoreDialog({
  backup,
  connections,
  defaultConnectionId,
  onClose,
  onRestored,
}: {
  backup: BackupSummary;
  connections: ConnectionSummary[];
  defaultConnectionId: string;
  onClose: () => void;
  onRestored: (connectionId: string, database: string) => void;
}) {
  const [target, setTarget] = useState(defaultConnectionId);
  const [database, setDatabase] = useState(backup.database);
  const [selected, setSelected] = useState<string[] | null>(null);
  const [mode, setMode] = useState<"drop" | "merge">("merge");
  const [typed, setTyped] = useState("");
  const { busy, run } = useRunAction();
  const ready = database.trim() && (mode === "merge" || typed === database) && (!selected || selected.length > 0);

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Restore “{backup.name}”</DialogTitle>
          <DialogDescription>
            From <span className="font-mono">{backup.database}</span> on {backup.connectionName}. Restore into any saved
            connection and any database, including a new one.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Target connection</Label>
              <Select value={target} onValueChange={setTarget}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {connections.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="r-db">Target database</Label>
              <Input id="r-db" className="font-mono" value={database} onChange={(e) => setDatabase(e.target.value)} />
            </div>
          </div>
          <CollectionChecklist names={backup.collections} value={selected} onChange={setSelected} />
          <div className="grid gap-2">
            <Label>Mode</Label>
            <RadioGroup value={mode} onValueChange={(v) => setMode(v as "drop" | "merge")} className="grid gap-2">
              <label className="flex items-start gap-2 text-sm">
                <RadioGroupItem value="merge" className="mt-0.5" />
                <span>
                  <span className="font-medium">Merge</span>
                  <span className="text-muted-foreground block text-xs">
                    Keep existing documents; only documents whose _id is missing are added.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <RadioGroupItem value="drop" className="mt-0.5" />
                <span>
                  <span className="font-medium">Replace</span>
                  <span className="text-muted-foreground block text-xs">
                    Drop each restored collection first, then load the backup.
                  </span>
                </span>
              </label>
            </RadioGroup>
          </div>
          {mode === "drop" && (
            <div className="grid gap-2">
              <Label htmlFor="r-confirm">
                Type <span className="font-mono font-semibold">{database}</span> to confirm
              </Label>
              <Input id="r-confirm" className="font-mono" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={mode === "drop" ? "destructive" : "default"}
            disabled={!ready || busy}
            onClick={async () => {
              const r = await run(
                () =>
                  restoreBackup(backup.id, { targetConnectionId: target, targetDatabase: database.trim(), collections: selected, mode }),
                (d) => `Restored ${formatNumber(d.documents)} document(s) in ${d.collections} collection(s)` + (d.skipped ? `, ${formatNumber(d.skipped)} kept` : ""),
              );
              if (r) {
                r.warnings.forEach((w) => toast.warning(w));
                onRestored(target, database.trim());
              }
            }}
          >
            {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
            {mode === "drop" ? "Replace and restore" : "Restore"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

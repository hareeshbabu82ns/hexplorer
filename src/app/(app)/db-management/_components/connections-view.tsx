"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Database, Loader2, Pencil, Plug, PlugZap, Plus, Trash2, Unplug } from "lucide-react";
import { toast } from "sonner";
import { DangerDialog } from "@/components/db-admin/danger-dialog";
import { useRunAction } from "@/components/db-admin/use-run-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";
import {
  deleteConnection,
  disconnectConnection,
  saveConnection,
  testConnection,
} from "@/lib/actions/db-admin/connections";
import { dbPath } from "@/lib/db-admin/paths";
import type { ConnectionSummary } from "@/lib/db-admin/types";

export function ConnectionsView({ connections }: { connections: ConnectionSummary[] }) {
  const router = useRouter();
  const { run } = useRunAction();
  const [editing, setEditing] = useState<ConnectionSummary | "new" | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  const test = async (c: ConnectionSummary) => {
    setTesting(c.id);
    const r = await run(() => testConnection({ connectionId: c.id }), (d) => `${c.name}: MongoDB ${d.version}, ${d.databases} database(s)`);
    setTesting(null);
    if (r) router.refresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setEditing("new")}>
          <Plus className="mr-2 size-4" /> Add connection
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {connections.map((c) => (
          <Card key={c.id} className="flex flex-col">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="truncate text-lg">
                  <Link href={dbPath(c.id)} className="hover:underline">
                    {c.name}
                  </Link>
                </CardTitle>
                <Database className="text-muted-foreground size-5 shrink-0" />
              </div>
              <CardDescription className="break-all font-mono text-xs">
                {c.hosts.length ? c.hosts.join(", ") : "connection string unreadable — edit it"}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1 space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {c.builtIn && <Badge>Built-in</Badge>}
                {c.connected && <Badge variant="secondary">Connected</Badge>}
                {c.username && <Badge variant="outline">user: {c.username}</Badge>}
                {c.defaultDb && <Badge variant="outline">db: {c.defaultDb}</Badge>}
              </div>
              {c.description && <p className="text-muted-foreground text-sm">{c.description}</p>}
              <p className="text-muted-foreground text-xs">
                {c.lastUsedAt ? `Last used ${formatDistanceToNow(new Date(c.lastUsedAt), { addSuffix: true })}` : c.builtIn ? "" : "Never used"}
              </p>
            </CardContent>
            <CardFooter className="flex flex-wrap gap-2">
              <Button size="sm" asChild>
                <Link href={dbPath(c.id)}>
                  <Plug className="mr-1 size-4" /> Open
                </Link>
              </Button>
              <Button size="sm" variant="outline" onClick={() => test(c)} disabled={testing === c.id}>
                {testing === c.id ? <Loader2 className="mr-1 size-4 animate-spin" /> : <PlugZap className="mr-1 size-4" />}
                Test
              </Button>
              {c.connected && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => (await run(() => disconnectConnection(c.id), "Disconnected")) && router.refresh()}
                >
                  <Unplug className="mr-1 size-4" /> Disconnect
                </Button>
              )}
              {!c.builtIn && (
                <>
                  <Button size="sm" variant="outline" onClick={() => setEditing(c)}>
                    <Pencil className="mr-1 size-4" /> Edit
                  </Button>
                  <DangerDialog
                    trigger={
                      <Button size="sm" variant="ghost" className="text-destructive">
                        <Trash2 className="mr-1 size-4" /> Remove
                      </Button>
                    }
                    title={`Remove "${c.name}"?`}
                    description="Only the saved connection is removed. Databases on the server and backup files are not touched."
                    confirmLabel="Remove"
                    onConfirm={async () => {
                      const r = await run(() => deleteConnection(c.id), "Connection removed");
                      if (r) router.refresh();
                      return !!r;
                    }}
                  />
                </>
              )}
            </CardFooter>
          </Card>
        ))}
      </div>
      {editing && (
        <ConnectionDialog
          initial={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function ConnectionDialog({
  initial,
  onClose,
  onSaved,
}: {
  initial: ConnectionSummary | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [uri, setUri] = useState("");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [testing, setTesting] = useState(false);
  const { busy, run } = useRunAction();

  const test = async () => {
    setTesting(true);
    await run(
      () => (uri.trim() ? testConnection({ uri }) : testConnection({ connectionId: initial!.id })),
      (d) => `Connected: MongoDB ${d.version}, ${d.databases} database(s)`,
    );
    setTesting(false);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? "Edit connection" : "Add connection"}</DialogTitle>
          <DialogDescription>
            The connection string is encrypted at rest and never sent back to the browser.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!initial && !uri.trim()) return toast.error("Connection string is required");
            const r = await run(
              () => saveConnection({ id: initial?.id, name, uri, description }),
              initial ? "Connection updated" : "Connection added",
            );
            if (r) onSaved();
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="conn-name">Name</Label>
            <Input id="conn-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="conn-uri">Connection string</Label>
            <Input
              id="conn-uri"
              type="password"
              autoComplete="off"
              className="font-mono"
              value={uri}
              onChange={(e) => setUri(e.target.value)}
              placeholder={initial ? "leave empty to keep the saved one" : "mongodb://user:password@host:27017/?authSource=admin"}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="conn-desc">Description</Label>
            <Textarea id="conn-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={test} disabled={testing || (!uri.trim() && !initial)}>
              {testing ? <Loader2 className="mr-2 size-4 animate-spin" /> : <PlugZap className="mr-2 size-4" />}
              Test
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

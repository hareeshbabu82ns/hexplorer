"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { DangerDialog } from "@/components/db-admin/danger-dialog";
import { JsonTextarea, jsonError } from "@/components/db-admin/json-textarea";
import { useRunAction } from "@/components/db-admin/use-run-action";
import { Badge } from "@/components/ui/badge";
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
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createIndex, dropIndex } from "@/lib/actions/db-admin/collections";
import { formatBytes } from "@/lib/db-admin/format";
import type { IndexInfo } from "@/lib/db-admin/types";

export function IndexesPanel({
  connectionId,
  database,
  collection,
  indexes,
  readOnly,
}: {
  connectionId: string;
  database: string;
  collection: string;
  indexes: IndexInfo[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const { run } = useRunAction();
  const [creating, setCreating] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Indexes</h2>
        {!readOnly && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="mr-1 size-4" /> Create index
          </Button>
        )}
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Keys</TableHead>
              <TableHead />
              <TableHead className="hidden text-right sm:table-cell">Size</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {indexes.map((ix) => (
              <TableRow key={ix.name}>
                <TableCell className="font-mono text-xs">{ix.name}</TableCell>
                <TableCell className="break-all font-mono text-xs">{ix.key}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {ix.unique && <Badge variant="secondary">unique</Badge>}
                    {ix.sparse && <Badge variant="outline">sparse</Badge>}
                    {ix.expireAfterSeconds != null && <Badge variant="outline">TTL {ix.expireAfterSeconds}s</Badge>}
                    {ix.partialFilterExpression && (
                      <Badge variant="outline" title={ix.partialFilterExpression}>
                        partial
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="hidden text-right tabular-nums sm:table-cell">{formatBytes(ix.size)}</TableCell>
                <TableCell>
                  {!readOnly && ix.name !== "_id_" && (
                    <DangerDialog
                      trigger={
                        <Button size="icon" variant="ghost" className="text-destructive" aria-label="Drop index">
                          <Trash2 className="size-4" />
                        </Button>
                      }
                      title={`Drop index ${ix.name}?`}
                      confirmLabel="Drop index"
                      onConfirm={async () => {
                        const r = await run(() => dropIndex(connectionId, database, collection, ix.name), `Dropped ${ix.name}`);
                        if (r) router.refresh();
                        return !!r;
                      }}
                    />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {creating && (
        <CreateIndexDialog
          connectionId={connectionId}
          database={database}
          collection={collection}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function CreateIndexDialog({
  connectionId,
  database,
  collection,
  onClose,
  onCreated,
}: {
  connectionId: string;
  database: string;
  collection: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [keys, setKeys] = useState('{ "field": 1 }');
  const [name, setName] = useState("");
  const [unique, setUnique] = useState(false);
  const [sparse, setSparse] = useState(false);
  const [ttl, setTtl] = useState("");
  const { busy, run } = useRunAction();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create index</DialogTitle>
          <DialogDescription>
            Keys as JSON: 1 / -1 for ascending / descending, or &quot;text&quot;, &quot;2dsphere&quot;, &quot;hashed&quot;.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await run(
              () =>
                createIndex(connectionId, database, collection, keys, {
                  name: name || null,
                  unique,
                  sparse,
                  expireAfterSeconds: ttl === "" ? null : Number(ttl),
                }),
              (d) => `Created index ${d.name}`,
            );
            if (r) onCreated();
          }}
        >
          <div className="grid gap-2">
            <Label>Keys</Label>
            <JsonTextarea value={keys} onChange={setKeys} rows={4} />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="ix-name">Name (optional)</Label>
              <Input id="ix-name" value={name} onChange={(e) => setName(e.target.value)} className="font-mono" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ix-ttl">TTL seconds (optional)</Label>
              <Input id="ix-ttl" type="number" min={0} value={ttl} onChange={(e) => setTtl(e.target.value)} />
            </div>
          </div>
          <div className="flex gap-6">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={unique} onCheckedChange={setUnique} /> Unique
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={sparse} onCheckedChange={setSparse} /> Sparse
            </label>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy || !!jsonError(keys)}>
              {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
              Create index
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Archive, Eraser, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { DangerDialog } from "@/components/db-admin/danger-dialog";
import { Crumb, DbPageHeader } from "@/components/db-admin/page-header";
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
import {
  clearCollection,
  createCollection,
  dropCollection,
  renameCollection,
} from "@/lib/actions/db-admin/collections";
import { dropDatabase } from "@/lib/actions/db-admin/server";
import { formatBytes, formatNumber } from "@/lib/db-admin/format";
import { dbPath } from "@/lib/db-admin/paths";
import type { CollectionInfo } from "@/lib/db-admin/types";

export function CollectionsView({
  connectionId,
  database,
  collections,
}: {
  connectionId: string;
  database: string;
  collections: CollectionInfo[];
}) {
  const router = useRouter();
  const { run } = useRunAction();
  const [renaming, setRenaming] = useState<string | null>(null);
  const done = (r: unknown) => {
    if (r) router.refresh();
    return !!r;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Collections</h2>
        <CreateCollectionDialog connectionId={connectionId} database={database} />
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="text-right">Documents</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Size</TableHead>
              <TableHead className="hidden text-right md:table-cell">Indexes</TableHead>
              <TableHead className="hidden md:table-cell">Type</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {collections.map((c) => {
              const readOnly = c.name.startsWith("system.");
              return (
                <TableRow key={c.name}>
                  <TableCell className="font-medium">
                    <Link href={dbPath(connectionId, database, c.name)} className="font-mono hover:underline">
                      {c.name}
                    </Link>
                    {c.viewOn && <div className="text-muted-foreground text-xs">view on {c.viewOn}</div>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(c.count)}</TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">
                    {formatBytes(c.size)}
                    {c.avgObjSize != null && <div className="text-muted-foreground text-xs">avg {formatBytes(c.avgObjSize)}</div>}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">
                    {formatNumber(c.indexCount)}
                    {c.totalIndexSize != null && <div className="text-muted-foreground text-xs">{formatBytes(c.totalIndexSize)}</div>}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <div className="flex gap-1">
                      <Badge variant={c.type === "collection" ? "outline" : "secondary"}>{c.type}</Badge>
                      {c.capped && <Badge variant="secondary">capped</Badge>}
                    </div>
                  </TableCell>
                  <TableCell>
                    {!readOnly && (
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" aria-label="Rename" onClick={() => setRenaming(c.name)}>
                          <Pencil className="size-4" />
                        </Button>
                        {c.type !== "view" && (
                          <DangerDialog
                            trigger={
                              <Button size="icon" variant="ghost" aria-label="Clear">
                                <Eraser className="size-4" />
                              </Button>
                            }
                            title={`Clear "${c.name}"?`}
                            description="Deletes every document. Indexes are kept."
                            confirmWord={c.name}
                            confirmLabel="Clear collection"
                            onConfirm={async () =>
                              done(
                                await run(
                                  () => clearCollection(connectionId, database, c.name, c.name),
                                  (d) => `Deleted ${formatNumber(d.deletedCount)} document(s)`,
                                ),
                              )
                            }
                          />
                        )}
                        <DangerDialog
                          trigger={
                            <Button size="icon" variant="ghost" className="text-destructive" aria-label="Drop">
                              <Trash2 className="size-4" />
                            </Button>
                          }
                          title={`Drop "${c.name}"?`}
                          description="The collection, its documents and its indexes are deleted."
                          confirmWord={c.name}
                          confirmLabel="Drop collection"
                          onConfirm={async () =>
                            done(await run(() => dropCollection(connectionId, database, c.name, c.name), `Dropped ${c.name}`))
                          }
                        />
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {!collections.length && (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground text-center">
                  No collections
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {renaming && (
        <RenameDialog
          connectionId={connectionId}
          database={database}
          from={renaming}
          onClose={() => setRenaming(null)}
          onDone={() => {
            setRenaming(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

export function DatabaseHeader({
  crumbs,
  connectionId,
  database,
  isProtected,
}: {
  crumbs: Crumb[];
  connectionId: string;
  database: string;
  isProtected: boolean;
}) {
  const router = useRouter();
  const { run } = useRunAction();
  return (
    <DbPageHeader
      crumbs={crumbs}
      title={<span className="font-mono">{database}</span>}
      actions={
        <>
          <Button variant="outline" asChild>
            <Link href={`${dbPath(connectionId)}?tab=backups&database=${encodeURIComponent(database)}`}>
              <Archive className="mr-2 size-4" /> Back up
            </Link>
          </Button>
          {!isProtected && (
            <DangerDialog
              trigger={
                <Button variant="destructive">
                  <Trash2 className="mr-2 size-4" /> Drop database
                </Button>
              }
              title={`Drop database "${database}"?`}
              description="Every collection, document, index and view in it is deleted. This cannot be undone."
              confirmWord={database}
              confirmLabel="Drop database"
              onConfirm={async () => {
                const r = await run(() => dropDatabase(connectionId, database, database), `Dropped ${database}`);
                if (r) router.push(dbPath(connectionId));
                return !!r;
              }}
            />
          )}
        </>
      }
    />
  );
}

function CreateCollectionDialog({ connectionId, database }: { connectionId: string; database: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [capped, setCapped] = useState(false);
  const [size, setSize] = useState("1048576");
  const [max, setMax] = useState("");
  const { busy, run } = useRunAction();
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="mr-2 size-4" /> Create collection
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create collection</DialogTitle>
            <DialogDescription>In {database}</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await run(
                () =>
                  createCollection(connectionId, database, name, capped ? { capped, size: Number(size), max: max ? Number(max) : null } : {}),
                `Created ${name}`,
              );
              if (r) {
                setOpen(false);
                setName("");
                router.refresh();
              }
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="c-name">Name</Label>
              <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} required className="font-mono" />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={capped} onCheckedChange={setCapped} /> Capped
            </label>
            {capped && (
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="c-size">Size (bytes)</Label>
                  <Input id="c-size" type="number" min={1} value={size} onChange={(e) => setSize(e.target.value)} required />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="c-max">Max documents (optional)</Label>
                  <Input id="c-max" type="number" min={1} value={max} onChange={(e) => setMax(e.target.value)} />
                </div>
              </div>
            )}
            <DialogFooter>
              <Button type="submit" disabled={busy}>
                {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function RenameDialog({
  connectionId,
  database,
  from,
  onClose,
  onDone,
}: {
  connectionId: string;
  database: string;
  from: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [to, setTo] = useState(from);
  const { busy, run } = useRunAction();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename {from}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await run(() => renameCollection(connectionId, database, from, to), `Renamed to ${to}`);
            if (r) onDone();
          }}
        >
          <Input value={to} onChange={(e) => setTo(e.target.value)} className="font-mono" required autoFocus />
          <DialogFooter>
            <Button type="submit" disabled={busy || to === from}>
              {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

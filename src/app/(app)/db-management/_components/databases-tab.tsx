"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Archive, Loader2, Plus, Trash2 } from "lucide-react";
import { DangerDialog } from "@/components/db-admin/danger-dialog";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createDatabase, dropDatabase } from "@/lib/actions/db-admin/server";
import { formatBytes } from "@/lib/db-admin/format";
import { dbPath } from "@/lib/db-admin/paths";
import type { DatabaseInfo } from "@/lib/db-admin/types";

export function DatabasesTab({
  connectionId,
  databases,
  onBackup,
}: {
  connectionId: string;
  databases: DatabaseInfo[];
  onBackup: (db: string) => void;
}) {
  const router = useRouter();
  const { run } = useRunAction();
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <CreateDatabaseDialog connectionId={connectionId} />
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="text-right">Size on disk</TableHead>
              <TableHead className="hidden sm:table-cell" />
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {databases.map((d) => (
              <TableRow key={d.name}>
                <TableCell className="font-medium">
                  <Link href={dbPath(connectionId, d.name)} className="hover:underline">
                    {d.name}
                  </Link>
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatBytes(d.sizeOnDisk)}</TableCell>
                <TableCell className="hidden sm:table-cell">
                  <div className="flex flex-wrap gap-1">
                    {d.system && <Badge variant="secondary">system</Badge>}
                    {d.protected && !d.system && <Badge>app database</Badge>}
                    {d.empty && <Badge variant="outline">empty</Badge>}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => onBackup(d.name)}>
                      <Archive className="mr-1 size-4" /> Back up
                    </Button>
                    {!d.protected && (
                      <DangerDialog
                        trigger={
                          <Button size="sm" variant="ghost" className="text-destructive" aria-label={`Drop ${d.name}`}>
                            <Trash2 className="size-4" />
                          </Button>
                        }
                        title={`Drop database "${d.name}"?`}
                        description="Every collection, document, index and view in it is deleted. This cannot be undone."
                        confirmWord={d.name}
                        confirmLabel="Drop database"
                        onConfirm={async () => {
                          const r = await run(() => dropDatabase(connectionId, d.name, d.name), `Dropped ${d.name}`);
                          if (r) router.refresh();
                          return !!r;
                        }}
                      />
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {!databases.length && (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground text-center">
                  No databases visible to this user
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function CreateDatabaseDialog({ connectionId }: { connectionId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [coll, setColl] = useState("");
  const { busy, run } = useRunAction();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 size-4" /> Create database
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create database</DialogTitle>
          <DialogDescription>MongoDB keeps a database only once it has a collection, so name the first one too.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await run(() => createDatabase(connectionId, name, coll), `Created ${name}`);
            if (r) {
              setOpen(false);
              router.push(dbPath(connectionId, r.name));
            }
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="new-db">Database name</Label>
            <Input id="new-db" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="new-db-coll">First collection</Label>
            <Input id="new-db-coll" value={coll} onChange={(e) => setColl(e.target.value)} required />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

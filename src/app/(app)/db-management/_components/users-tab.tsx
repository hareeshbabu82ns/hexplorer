"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Copy, KeyRound, Loader2, Pencil, Plus, Trash2, Wand2 } from "lucide-react";
import { DangerDialog } from "@/components/db-admin/danger-dialog";
import { useRunAction } from "@/components/db-admin/use-run-action";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { changeUserPassword, createUser, dropUser, updateUserRoles } from "@/lib/actions/db-admin/users";
import { generatePassword } from "@/lib/db-admin/format";
import type { CustomRole, DbUserInfo, RoleRef, UsersResult } from "@/lib/db-admin/types";
import { RoleEditor, roleDescription } from "./role-editor";

export function UsersTab({
  connectionId,
  data,
  customRoles,
  databases,
}: {
  connectionId: string;
  data: UsersResult;
  customRoles: CustomRole[];
  databases: string[];
}) {
  const router = useRouter();
  const { run } = useRunAction();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<DbUserInfo | null>(null);
  const [password, setPassword] = useState<DbUserInfo | null>(null);
  const isMe = (u: DbUserInfo) => data.currentUser?.user === u.user && data.currentUser?.db === u.db;

  return (
    <div className="space-y-3">
      {data.partial && (
        <Alert>
          <AlertDescription>
            This user cannot list users on all databases (usersInfo forAllDBs was denied), so only users from
            databases it can see are shown.
          </AlertDescription>
        </Alert>
      )}
      <div className="flex justify-end">
        <Button onClick={() => setCreating(true)}>
          <Plus className="mr-2 size-4" /> Create user
        </Button>
      </div>
      <div className="rounded-md border">
        <TooltipProvider>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Auth db</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead className="hidden lg:table-cell">Mechanisms</TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.users.map((u) => (
                <TableRow key={`${u.db}.${u.user}`}>
                  <TableCell className="font-medium">
                    {u.user} {isMe(u) && <Badge variant="secondary">you</Badge>}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{u.db}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {u.roles.map((r) => (
                        <Tooltip key={`${r.role}@${r.db}`}>
                          <TooltipTrigger asChild>
                            <Badge variant="outline" className="font-mono font-normal">
                              {r.role}@{r.db}
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent>{roleDescription(r.role)}</TooltipContent>
                        </Tooltip>
                      ))}
                      {!u.roles.length && <span className="text-muted-foreground text-xs">no roles</span>}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden text-xs lg:table-cell">{u.mechanisms.join(", ")}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" aria-label="Edit roles" onClick={() => setEditing(u)}>
                        <Pencil className="size-4" />
                      </Button>
                      <Button size="icon" variant="ghost" aria-label="Change password" onClick={() => setPassword(u)}>
                        <KeyRound className="size-4" />
                      </Button>
                      {!isMe(u) && (
                        <DangerDialog
                          trigger={
                            <Button size="icon" variant="ghost" className="text-destructive" aria-label="Drop user">
                              <Trash2 className="size-4" />
                            </Button>
                          }
                          title={`Drop user "${u.user}"?`}
                          description={`The user is removed from the ${u.db} database. Apps using it lose access.`}
                          confirmLabel="Drop user"
                          onConfirm={async () => {
                            const r = await run(() => dropUser(connectionId, u.user, u.db), `Dropped ${u.user}`);
                            if (r) router.refresh();
                            return !!r;
                          }}
                        />
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!data.users.length && (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground text-center">
                    No users
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TooltipProvider>
      </div>

      {creating && (
        <CreateUserDialog
          connectionId={connectionId}
          customRoles={customRoles}
          databases={databases}
          onClose={() => setCreating(false)}
          onCreated={() => router.refresh()}
        />
      )}
      {editing && (
        <EditRolesDialog
          key={`${editing.db}.${editing.user}`}
          connectionId={connectionId}
          user={editing}
          customRoles={customRoles}
          databases={databases}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
      {password && (
        <PasswordDialog connectionId={connectionId} user={password} onClose={() => setPassword(null)} />
      )}
    </div>
  );
}

function PasswordInput({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-2">
      <Input id={id} type="text" autoComplete="new-password" className="font-mono" value={value} onChange={(e) => onChange(e.target.value)} minLength={8} required />
      <Button type="button" variant="outline" onClick={() => onChange(generatePassword(24))}>
        <Wand2 className="mr-1 size-4" /> Generate
      </Button>
    </div>
  );
}

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2">
      <Input readOnly value={value} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label="Copy"
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      </Button>
    </div>
  );
}

function CreateUserDialog({
  connectionId,
  customRoles,
  databases,
  onClose,
  onCreated,
}: {
  connectionId: string;
  customRoles: CustomRole[];
  databases: string[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const firstDb = databases.find((d) => !["admin", "local", "config"].includes(d)) ?? "admin";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState(() => generatePassword(24));
  const [authDb, setAuthDb] = useState(firstDb);
  const [roles, setRoles] = useState<RoleRef[]>([{ role: "readWrite", db: firstDb }]);
  const [connectionString, setConnectionString] = useState<string | null>(null);
  const { busy, run } = useRunAction();

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{connectionString ? "User created" : "Create user"}</DialogTitle>
          <DialogDescription>
            {connectionString
              ? "Copy the connection string now: the password is not shown again."
              : "The user is created on its authentication database and gets the roles below."}
          </DialogDescription>
        </DialogHeader>
        {connectionString ? (
          <div className="grid gap-4">
            <CopyField value={connectionString} />
            <DialogFooter>
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="grid gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await run(
                () => createUser(connectionId, { username, password, authDb, roles }),
                `Created ${username}`,
              );
              if (r) {
                setConnectionString(r.connectionString);
                onCreated();
              }
            }}
          >
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="u-name">Username</Label>
                <Input id="u-name" value={username} onChange={(e) => setUsername(e.target.value)} required autoComplete="off" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="u-authdb">Authentication database</Label>
                <Input id="u-authdb" list="role-editor-dbs" className="font-mono" value={authDb} onChange={(e) => setAuthDb(e.target.value)} required />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="u-pass">Password (min 8 characters)</Label>
              <PasswordInput id="u-pass" value={password} onChange={setPassword} />
            </div>
            <div className="grid gap-2">
              <Label>Roles</Label>
              <RoleEditor value={roles} onChange={setRoles} customRoles={customRoles} databases={databases} />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={busy}>
                {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
                Create user
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditRolesDialog({
  connectionId,
  user,
  customRoles,
  databases,
  onClose,
  onSaved,
}: {
  connectionId: string;
  user: DbUserInfo;
  customRoles: CustomRole[];
  databases: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [roles, setRoles] = useState<RoleRef[]>(user.roles);
  const { busy, run } = useRunAction();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Roles of {user.user}</DialogTitle>
          <DialogDescription>Saving replaces all of the user&apos;s roles with this list.</DialogDescription>
        </DialogHeader>
        <RoleEditor value={roles} onChange={setRoles} customRoles={customRoles} databases={databases} />
        <DialogFooter>
          <Button
            disabled={busy}
            onClick={async () => {
              const r = await run(() => updateUserRoles(connectionId, user.user, user.db, roles), "Roles updated");
              if (r) onSaved();
            }}
          >
            {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
            Save roles
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PasswordDialog({ connectionId, user, onClose }: { connectionId: string; user: DbUserInfo; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const { busy, run } = useRunAction();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change password of {user.user}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await run(() => changeUserPassword(connectionId, user.user, user.db, password), "Password changed");
            if (r) onClose();
          }}
        >
          <PasswordInput id="pw-new" value={password} onChange={setPassword} />
          <DialogFooter>
            <Button type="submit" disabled={busy || password.length < 8}>
              {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
              Change password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

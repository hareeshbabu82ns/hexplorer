"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronRight, Folder, File as FileIcon, Home, ArrowUp, Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  addMountedFolder,
  browseRemote,
  deleteRemote,
  listRemotes,
  listSshConfigHosts,
  saveRemote,
  testRemoteConnection,
} from "@/lib/actions/remotes";
import { cn } from "@/lib/utils";

const MANUAL = "__manual__";

type FormState = {
  type: "ssh" | "smb";
  alias: string;
  name: string;
  host: string;
  user: string;
  port: string;
  auth: "key" | "password";
  password: string;
  identityFile: string;
  domain: string;
  smbVersion: string;
};

const emptyForm: FormState = {
  type: "ssh",
  alias: MANUAL,
  name: "",
  host: "",
  user: "",
  port: "",
  auth: "password",
  password: "",
  identityFile: "",
  domain: "",
  smbVersion: "3.0",
};

function fromRemote(r: SshRemote): FormState {
  return {
    type: r.type,
    alias: MANUAL,
    name: r.name,
    host: r.host,
    user: r.user ?? "",
    port: r.port ? String(r.port) : "",
    auth: r.auth,
    password: "",
    identityFile: r.identityFile ?? "",
    domain: r.domain ?? "",
    smbVersion: r.smbVersion ?? "3.0",
  };
}

function RemoteForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial?: SshRemote;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const { data: hosts } = useQuery({
    queryKey: ["ssh-config-hosts"],
    queryFn: () => listSshConfigHosts(),
  });
  const [form, setForm] = useState<FormState>(initial ? fromRemote(initial) : emptyForm);
  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const fromAlias = form.type === "ssh" && form.alias !== MANUAL;
  const isSmb = form.type === "smb";
  const needsPassword = isSmb || form.auth === "password";

  const save = useMutation({
    mutationFn: () =>
      saveRemote({
        id: initial?.id,
        type: form.type,
        name: form.name,
        host: fromAlias ? form.alias : form.host,
        user: fromAlias ? null : form.user,
        port: !fromAlias && form.port ? Number(form.port) : null,
        auth: fromAlias ? "key" : isSmb ? "password" : form.auth,
        identityFile: fromAlias ? null : form.identityFile,
        password: form.password || null,
        domain: form.domain,
        smbVersion: form.smbVersion,
      }),
    onSuccess: () => {
      toast.success("Remote saved");
      setForm(emptyForm);
      onSaved();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <form
      className="grid gap-3 md:grid-cols-6 md:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="grid gap-1.5">
        <Label>Type</Label>
        <Select
          value={form.type}
          onValueChange={(v) => setForm((f) => ({ ...f, type: v as "ssh" | "smb", alias: MANUAL }))}
          disabled={!!initial}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ssh">SSH (sshfs)</SelectItem>
            <SelectItem value="smb">SMB / Windows share (cifs)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {form.type === "ssh" && !initial && (
        <div className="grid gap-1.5 md:col-span-2">
          <Label>From ~/.ssh/config</Label>
          <Select value={form.alias} onValueChange={(v) => setForm((f) => ({ ...f, alias: v }))}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={MANUAL}>Enter host / IP manually…</SelectItem>
              {hosts?.map((h) => (
                <SelectItem key={h} value={h}>
                  {h}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="grid gap-1.5">
        <Label>Name</Label>
        <Input placeholder={fromAlias ? form.alias : "nas"} value={form.name} onChange={set("name")} />
      </div>
      {!fromAlias && (
        <>
          <div className="grid gap-1.5">
            <Label>Host / IP</Label>
            <Input placeholder="192.168.1.10" value={form.host} onChange={set("host")} required />
          </div>
          <div className="grid gap-1.5">
            <Label>Port</Label>
            <Input placeholder={isSmb ? "445" : "22"} type="number" value={form.port} onChange={set("port")} />
          </div>
          <div className="grid gap-1.5">
            <Label>User ID</Label>
            <Input placeholder={isSmb ? "guest" : "me"} value={form.user} onChange={set("user")} />
          </div>
          {form.type === "ssh" && (
            <div className="grid gap-1.5">
              <Label>Login with</Label>
              <Select
                value={form.auth}
                onValueChange={(v) => setForm((f) => ({ ...f, auth: v as "key" | "password" }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="password">Password</SelectItem>
                  <SelectItem value="key">SSH key</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {needsPassword && (
            <div className="grid gap-1.5">
              <Label>Password</Label>
              <Input
                type="password"
                autoComplete="new-password"
                placeholder={initial?.hasPassword ? "(unchanged)" : ""}
                value={form.password}
                onChange={set("password")}
              />
            </div>
          )}
          {form.type === "ssh" && form.auth === "key" && (
            <div className="grid gap-1.5 md:col-span-2">
              <Label>Identity file (optional)</Label>
              <Input placeholder="~/.ssh/id_ed25519" value={form.identityFile} onChange={set("identityFile")} />
            </div>
          )}
          {isSmb && (
            <>
              <div className="grid gap-1.5">
                <Label>Domain / workgroup</Label>
                <Input placeholder="WORKGROUP" value={form.domain} onChange={set("domain")} />
              </div>
              <div className="grid gap-1.5">
                <Label>SMB version</Label>
                <Input placeholder="3.0" value={form.smbVersion} onChange={set("smbVersion")} />
              </div>
            </>
          )}
        </>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={save.isPending}>
          {initial ? "Update" : "Save remote"}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

function AddRemoteForm({ onSaved }: { onSaved: () => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Add network remote</CardTitle>
      </CardHeader>
      <CardContent>
        <RemoteForm onSaved={onSaved} />
        <p className="text-muted-foreground mt-3 text-xs">
          Passwords are stored encrypted with <code>APP_SECRET</code>. SSH password login needs{" "}
          <code>sshpass</code> (for browsing); SMB needs <code>smbclient</code> + <code>cifs-utils</code>{" "}
          and root/sudo to mount — <code>scripts/ubuntu/setup.sh</code> installs all of them.
        </p>
      </CardContent>
    </Card>
  );
}

function RemoteBrowser({ remote }: { remote: SshRemote }) {
  const qc = useQueryClient();
  const [cwd, setCwd] = useState("");
  const [pathInput, setPathInput] = useState("");
  const [name, setName] = useState("");
  const [idle, setIdle] = useState("15");
  const [scan, setScan] = useState(true);

  const { data, isFetching, error } = useQuery({
    queryKey: ["remote-ls", remote.id, cwd],
    queryFn: async () => {
      const r = await browseRemote(remote.id, cwd);
      setPathInput(r.path);
      return r;
    },
    retry: false,
  });
  const current = data?.path ?? cwd;
  const isSmbRoot = remote.type === "smb" && current.split("/").filter(Boolean).length === 0;
  const parent = current.replace(/\/[^/]+\/?$/, "") || "/";

  const mount = useMutation({
    mutationFn: () =>
      addMountedFolder({
        remoteId: remote.id,
        remotePath: current,
        name: name || current.split("/").filter(Boolean).pop() || remote.name,
        idleMinutes: Number(idle),
        scan,
      }),
    onSuccess: () => {
      toast.success(`Mounted ${current} — ${scan ? "scanning" : "ready"}`);
      qc.invalidateQueries({ queryKey: ["folders"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Button
          size="icon"
          variant="outline"
          title={remote.type === "smb" ? "Shares" : "Home"}
          onClick={() => setCwd(remote.type === "smb" ? "/" : "")}
        >
          <Home className="size-4" />
        </Button>
        <Button size="icon" variant="outline" title="Up" onClick={() => setCwd(parent)}>
          <ArrowUp className="size-4" />
        </Button>
        <form
          className="flex flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setCwd(pathInput);
          }}
        >
          <Input className="font-mono" value={pathInput} onChange={(e) => setPathInput(e.target.value)} />
          <Button type="submit" variant="outline">
            Go
          </Button>
        </form>
      </div>
      {error && <p className="text-destructive whitespace-pre-wrap text-sm">{(error as Error).message}</p>}
      <div className="h-72 overflow-auto rounded border text-sm">
        {isFetching && <p className="text-muted-foreground p-2">Loading…</p>}
        {!isFetching &&
          data?.entries.map((e) => (
            <button
              key={e.name}
              disabled={!e.isDirectory}
              onClick={() => setCwd(`${current.replace(/\/$/, "")}/${e.name}`)}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-1 text-left",
                e.isDirectory ? "hover:bg-muted" : "text-muted-foreground cursor-default",
              )}
            >
              {e.isDirectory ? <Folder className="size-4 text-amber-500" /> : <FileIcon className="size-4" />}
              <span className="truncate">{e.name}</span>
              {e.isDirectory && <ChevronRight className="ml-auto size-4 opacity-50" />}
            </button>
          ))}
        {!isFetching && data && data.entries.length === 0 && (
          <p className="text-muted-foreground p-2">Empty directory</p>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-3 rounded-md border p-3">
        <div className="grid gap-1">
          <Label className="text-xs">Data folder name</Label>
          <Input
            className="w-48"
            placeholder={current.split("/").filter(Boolean).pop() || remote.name}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">Unmount after idle (min, 0 = never)</Label>
          <Input className="w-28" type="number" min={0} value={idle} onChange={(e) => setIdle(e.target.value)} />
        </div>
        <div className="flex items-center gap-2 pb-2">
          <Switch id={`scan-${remote.id}`} checked={scan} onCheckedChange={setScan} />
          <Label htmlFor={`scan-${remote.id}`}>Scan after mount</Label>
        </div>
        <Button disabled={!data || mount.isPending || isSmbRoot} onClick={() => mount.mutate()}>
          <Plug className="mr-1 size-4" />
          {mount.isPending
            ? "Mounting…"
            : isSmbRoot
              ? "Open a share to mount it"
              : `Mount ${current || "~"} as data folder`}
        </Button>
      </div>
    </div>
  );
}

export default function RemotesPage() {
  const qc = useQueryClient();
  const { data: remotes, isLoading, error } = useQuery({
    queryKey: ["remotes"],
    queryFn: () => listRemotes(),
  });
  const [openId, setOpenId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["remotes"] });

  const test = useMutation({
    mutationFn: testRemoteConnection,
    onSuccess: (r) =>
      r.ok ? toast.success(`Connected — ${r.info}`) : toast.error(r.error),
  });
  const del = useMutation({
    mutationFn: deleteRemote,
    onSuccess: () => (toast.success("Remote deleted"), refresh()),
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-6 px-4 py-4 pb-16 md:px-10">
      <div>
        <h2 className="text-xl font-bold tracking-tight">Network remotes</h2>
        <p className="text-muted-foreground text-sm">
          Connect to a machine over SSH (key or user ID + password) or an SMB/Windows share (user ID +
          password), pick a folder and mount it as a data folder. Mounts are
          made on demand and released after the idle timeout; the index stays searchable while
          unmounted. Manage mounted folders on the <Link className="underline" href="/folders">Folders</Link>{" "}
          page.
        </p>
      </div>

      <AddRemoteForm onSaved={refresh} />

      {isLoading && <p>Loading…</p>}
      {error && <p className="text-destructive">{(error as Error).message}</p>}
      {remotes?.length === 0 && <p className="text-muted-foreground">No remotes yet.</p>}

      <div className="space-y-4">
        {remotes?.map((r) => (
          <Card key={r.id}>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base">{r.name}</CardTitle>
                <span className="bg-muted rounded px-1.5 py-0.5 text-[10px] uppercase">
                  {r.type}
                  {r.type === "ssh" ? ` · ${r.auth}` : ""}
                </span>
                <span className="text-muted-foreground font-mono text-xs">
                  {r.type === "smb" ? "//" : ""}
                  {r.user ? `${r.user}@` : ""}
                  {r.host}
                  {r.port ? `:${r.port}` : ""}
                </span>
                <span className="grow" />
                <Button size="sm" variant="outline" disabled={test.isPending} onClick={() => test.mutate(r.id)}>
                  Test
                </Button>
                <Button size="sm" onClick={() => setOpenId(openId === r.id ? null : r.id)}>
                  {openId === r.id ? "Close browser" : "Browse & mount"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditId(editId === r.id ? null : r.id)}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => del.mutate(r.id)}>
                  Delete
                </Button>
              </div>
            </CardHeader>
            {editId === r.id && (
              <CardContent>
                <RemoteForm
                  initial={r}
                  onSaved={() => (setEditId(null), refresh())}
                  onCancel={() => setEditId(null)}
                />
              </CardContent>
            )}
            {openId === r.id && (
              <CardContent>
                <RemoteBrowser remote={r} />
              </CardContent>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

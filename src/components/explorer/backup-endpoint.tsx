"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUp, ChevronRight, Folder, FolderOpen, HardDrive, Home, Loader2, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { browseRemote, listRemotes } from "@/lib/actions/remotes";
import { cn } from "@/lib/utils";
import { useFolders } from "./use-folders";

export const REMOTES_QK = ["remotes"];

export function useRemotes() {
  return useQuery({ queryKey: REMOTES_QK, queryFn: () => listRemotes() });
}

const KINDS: { value: BackupEndpoint["kind"]; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: "folder", label: "Data folder", icon: Folder },
  { value: "remote", label: "Remote", icon: Server },
  { value: "local", label: "Local path", icon: HardDrive },
];

/** endpoint of the given kind, carrying over what makes sense */
export function switchKind(kind: BackupEndpoint["kind"], defaults: { folderId?: string; remoteId?: string }): BackupEndpoint {
  if (kind === "folder") return { kind, folderId: defaults.folderId ?? "", dir: "" };
  if (kind === "remote") return { kind, remoteId: defaults.remoteId ?? "", path: "" };
  return { kind, path: "" };
}

/** picker for a backup source or destination: data folder + sub path, remote + path, or local path */
export function EndpointPicker({
  value,
  onChange,
  role,
}: {
  value: BackupEndpoint;
  onChange: (v: BackupEndpoint) => void;
  role: "source" | "dest";
}) {
  const { data: folders } = useFolders();
  const { data: remotes } = useRemotes();
  const [browsing, setBrowsing] = useState(false);

  return (
    <div className="grid gap-2">
      <div className="bg-muted grid auto-cols-fr grid-flow-col gap-1 rounded-lg p-1">
        {KINDS.map((k) => {
          const Icon = k.icon;
          const active = k.value === value.kind;
          return (
            <button
              key={k.value}
              type="button"
              onClick={() => {
                if (active) return;
                setBrowsing(false);
                onChange(switchKind(k.value, { folderId: folders?.[0]?.id, remoteId: remotes?.[0]?.id }));
              }}
              className={cn(
                "flex h-8 items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-all sm:text-sm",
                active
                  ? "bg-card text-foreground shadow-card ring-border ring-1"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
              {k.label}
            </button>
          );
        })}
      </div>

      {value.kind === "folder" && (
        <div className="flex gap-2">
          <Select value={value.folderId} onValueChange={(folderId) => onChange({ ...value, folderId })}>
            <SelectTrigger className="w-48 shrink-0">
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
            placeholder={role === "dest" ? "sub path, e.g. backups" : "sub path (empty = whole folder)"}
            value={value.dir}
            onChange={(e) => onChange({ ...value, dir: e.target.value })}
          />
        </div>
      )}

      {value.kind === "remote" && (
        <>
          {remotes?.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              No remotes yet — add one on the Remotes page.
            </p>
          ) : (
            <div className="flex gap-2">
              <Select
                value={value.remoteId}
                onValueChange={(remoteId) => {
                  const smb = remotes?.find((r) => r.id === remoteId)?.type === "smb";
                  onChange({ kind: "remote", remoteId, path: smb ? "/" : "" });
                }}
              >
                <SelectTrigger className="w-48 shrink-0">
                  <SelectValue placeholder="Pick a remote" />
                </SelectTrigger>
                <SelectContent>
                  {remotes?.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name} <span className="text-muted-foreground text-xs uppercase">{r.type}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                className="font-mono text-xs"
                placeholder={
                  remotes?.find((r) => r.id === value.remoteId)?.type === "smb"
                    ? "/share/folder"
                    : "path (empty = home)"
                }
                value={value.path}
                onChange={(e) => onChange({ ...value, path: e.target.value })}
              />
              <Button
                type="button"
                variant="outline"
                disabled={!value.remoteId}
                onClick={() => setBrowsing((b) => !b)}
              >
                <FolderOpen className="size-4" /> Browse
              </Button>
            </div>
          )}
          {browsing && value.remoteId && (
            <RemotePathBrowser
              remote={remotes?.find((r) => r.id === value.remoteId)}
              remoteId={value.remoteId}
              path={value.path}
              onPick={(p) => onChange({ ...value, path: p })}
            />
          )}
          <p className="text-muted-foreground text-xs">
            Mounted just for each run, then unmounted.
          </p>
        </>
      )}

      {value.kind === "local" && (
        <Input
          className="font-mono text-xs"
          placeholder={role === "dest" ? "/media/usb/backups" : "/srv/data/projects"}
          value={value.path}
          onChange={(e) => onChange({ ...value, path: e.target.value })}
        />
      )}
    </div>
  );
}

async function unwrap<T>(p: Promise<{ ok: true; data: T } | { ok: false; error: string }>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

/** compact folder browser; navigating a folder also picks it */
function RemotePathBrowser({
  remote,
  remoteId,
  path,
  onPick,
}: {
  remote?: SshRemote;
  remoteId: string;
  path: string;
  onPick: (p: string) => void;
}) {
  const smb = remote?.type === "smb";
  const { data, isFetching, error } = useQuery({
    queryKey: ["remote-ls", remoteId, path],
    queryFn: () => unwrap(browseRemote(remoteId, path)),
    retry: false,
  });
  const current = data?.path ?? path;
  const parent = current.replace(/\/[^/]+\/?$/, "") || "/";
  const dirs = data?.entries.filter((e) => e.isDirectory) ?? [];

  return (
    <div className="bg-card overflow-hidden rounded-lg border">
      <div className="bg-muted/40 flex items-center gap-1 border-b px-1.5 py-1">
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          title={smb ? "Shares" : "Home"}
          onClick={() => onPick(smb ? "/" : "")}
        >
          <Home className="size-4" />
        </Button>
        <Button type="button" size="icon-sm" variant="ghost" title="Up" onClick={() => onPick(parent)}>
          <ArrowUp className="size-4" />
        </Button>
        <span className="truncate font-mono text-xs">
          {remote?.name}:{current || "~"}
        </span>
        {isFetching && <Loader2 className="text-muted-foreground ml-auto size-3.5 animate-spin" />}
      </div>
      <div className="h-44 overflow-auto p-1 text-sm">
        {error && <p className="text-destructive whitespace-pre-wrap p-2 text-xs">{(error as Error).message}</p>}
        {!isFetching && !error && dirs.length === 0 && (
          <p className="text-muted-foreground p-2 text-xs">No sub folders</p>
        )}
        {dirs.map((e) => (
          <button
            key={e.name}
            type="button"
            onClick={() => onPick(`${current.replace(/\/$/, "")}/${e.name}`)}
            className="hover:bg-accent group flex w-full items-center gap-2 rounded-md px-2 py-1 text-left"
          >
            <Folder className="size-4 fill-amber-400/25 text-amber-500" />
            <span className="truncate">{e.name}</span>
            <ChevronRight className="ml-auto size-4 opacity-0 group-hover:opacity-50" />
          </button>
        ))}
      </div>
    </div>
  );
}

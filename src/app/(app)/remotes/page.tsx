"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUp,
  Check,
  ChevronRight,
  ClipboardCopy,
  File as FileIcon,
  Folder,
  FolderOpen,
  Home,
  KeyRound,
  Loader2,
  MoreHorizontal,
  Network,
  Pencil,
  Plug,
  Zap,
  Plus,
  Server,
  ShieldCheck,
  Terminal,
  Trash2,
  Upload,
  Wifi,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  addMountedFolder,
  browseRemote,
  deleteRemote,
  deleteSshKey,
  listRemotes,
  listSshConfigHosts,
  listSshKeys,
  saveRemote,
  testRemoteConnection,
  uploadSshKey,
} from "@/lib/actions/remotes";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, ErrorBanner, Page, PageHeader, SectionTitle } from "@/components/app/page";

const MANUAL = "__manual__";
/** key auth without an uploaded key: the server user's ~/.ssh defaults / agent */
const KEY_DEFAULT = "__default__";
/** key auth with a key file path on the server */
const KEY_PATH = "__path__";

const KEYS_QK = ["ssh-keys"];
const REMOTES_QK = ["remotes"];

type FormState = {
  type: "ssh" | "smb";
  alias: string;
  name: string;
  host: string;
  user: string;
  port: string;
  auth: "key" | "password";
  keySel: string;
  password: string;
  identityFile: string;
  domain: string;
  smbVersion: string;
};

function initialForm(r: SshRemote | undefined, keys: SshKey[]): FormState {
  if (!r)
    return {
      type: "ssh",
      alias: MANUAL,
      name: "",
      host: "",
      user: "",
      port: "",
      auth: keys.length ? "key" : "password",
      keySel: keys[0]?.id ?? KEY_DEFAULT,
      password: "",
      identityFile: "",
      domain: "",
      smbVersion: "3.0",
    };
  return {
    type: r.type,
    alias: MANUAL,
    name: r.name,
    host: r.host,
    user: r.user ?? "",
    port: r.port ? String(r.port) : "",
    auth: r.auth,
    keySel: r.keyId ?? (r.identityFile ? KEY_PATH : KEY_DEFAULT),
    password: "",
    identityFile: r.identityFile ?? "",
    domain: r.domain ?? "",
    smbVersion: r.smbVersion ?? "3.0",
  };
}

/** turn an ActionResult into a value or a thrown Error (for react-query) */
async function unwrap<T>(p: Promise<{ ok: true; data: T } | { ok: false; error: string }>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/* ------------------------------- small pieces ------------------------------ */

function Field({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label className="text-[13px]">{label}</Label>
      {children}
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
  disabled,
}: {
  value: T;
  onChange: (v: T) => void;
  options: {
    value: T;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }[];
  disabled?: boolean;
}) {
  return (
    <div className="bg-muted grid auto-cols-fr grid-flow-col gap-1 rounded-lg p-1">
      {options.map((o) => {
        const Icon = o.icon;
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            disabled={disabled && !active}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex h-8 items-center justify-center gap-2 rounded-md text-sm font-medium transition-all disabled:opacity-40",
              active
                ? "bg-card text-foreground shadow-card ring-border ring-1"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="xs"
      variant="outline"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          toast.error("Clipboard is not available");
        }
      }}
    >
      {done ? <Check className="text-success" /> : <ClipboardCopy />}
      {done ? "Copied" : label}
    </Button>
  );
}

/* ------------------------------ upload a key ------------------------------- */

function UploadKeyDialog({
  open,
  onOpenChange,
  onUploaded,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onUploaded?: (id: string) => void;
}) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [paste, setPaste] = useState(false);
  const [drag, setDrag] = useState(false);

  const reset = () => {
    setName("");
    setText("");
    setFileName(null);
    setPassphrase("");
    setPaste(false);
  };

  const readFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 64 * 1024) return toast.error("That file is too large to be an SSH private key");
    const t = await f.text();
    setText(t);
    setFileName(f.name);
    if (!name) setName(f.name.replace(/\.(pem|key)$/i, ""));
  };

  const isEncrypted =
    /ENCRYPTED|Proc-Type: 4,ENCRYPTED/.test(text) || /aes\d+-ctr|bcrypt/.test(atobSafe(text));

  const upload = useMutation({
    mutationFn: () => unwrap(uploadSshKey({ name, privateKey: text, passphrase: passphrase || null })),
    onSuccess: (id) => {
      toast.success("SSH key added");
      qc.invalidateQueries({ queryKey: KEYS_QK });
      onUploaded?.(id);
      reset();
      onOpenChange(false);
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="text-primary size-5" /> Add SSH key
          </DialogTitle>
          <DialogDescription>
            Upload a private key to use for SSH remotes. Passphrases are removed on upload and the key is
            stored encrypted with <code className="font-mono text-xs">APP_SECRET</code>.
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation(); // portal events bubble to the remote form that may host this dialog
            upload.mutate();
          }}
        >
          <Field label="Name">
            <Input placeholder="e.g. nas-deploy" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>

          {paste ? (
            <Field label="Private key">
              <Textarea
                className="h-40 font-mono text-xs"
                spellCheck={false}
                placeholder={"-----BEGIN OPENSSH PRIVATE KEY-----\n…\n-----END OPENSSH PRIVATE KEY-----"}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </Field>
          ) : (
            <div className="grid gap-1.5">
              <Label className="text-[13px]">Private key file</Label>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDrag(true);
                }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDrag(false);
                  void readFile(e.dataTransfer.files?.[0]);
                }}
                className={cn(
                  "bg-dots flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center transition-colors",
                  drag ? "border-primary bg-primary/5" : "hover:border-primary/50 hover:bg-accent/40",
                  fileName && "border-primary/40 bg-primary/5",
                )}
              >
                <span
                  className={cn(
                    "flex size-10 items-center justify-center rounded-xl border bg-card shadow-card",
                    fileName ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  {fileName ? <Check className="size-5" /> : <Upload className="size-5" />}
                </span>
                {fileName ? (
                  <span className="text-sm">
                    <span className="font-medium">{fileName}</span>
                    <span className="text-muted-foreground block text-xs">
                      Click to choose a different file
                    </span>
                  </span>
                ) : (
                  <span className="text-sm">
                    <span className="font-medium">Drop a key here or click to browse</span>
                    <span className="text-muted-foreground block text-xs">id_ed25519, id_rsa, *.pem…</span>
                  </span>
                )}
              </button>
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  void readFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </div>
          )}
          <button
            type="button"
            className="text-primary -mt-2 justify-self-start text-xs font-medium hover:underline"
            onClick={() => setPaste((p) => !p)}
          >
            {paste ? "Upload a file instead" : "Paste key text instead"}
          </button>

          <Field
            label="Passphrase"
            hint={
              isEncrypted
                ? "This key looks passphrase-protected."
                : "Only if the key is passphrase-protected."
            }
          >
            <Input
              type="password"
              autoComplete="off"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              className={cn(isEncrypted && !passphrase && "border-warning/60")}
            />
          </Field>

          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!text.trim() || upload.isPending}>
              {upload.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ShieldCheck className="size-4" />
              )}
              {upload.isPending ? "Verifying…" : "Add key"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** peek inside an OpenSSH key body for its cipher name (best effort, client side only) */
function atobSafe(text: string) {
  try {
    const b64 = text.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
    return b64 ? atob(b64).slice(0, 64) : "";
  } catch {
    return "";
  }
}

/* ------------------------------ remote form -------------------------------- */

function RemoteDialog({
  open,
  onOpenChange,
  initial,
  keys,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: SshRemote;
  keys: SshKey[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? `Edit ${initial.name}` : "Add remote"}</DialogTitle>
          <DialogDescription>
            Connect to a machine over SSH or an SMB / Windows share, then browse it and mount folders as data
            folders.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <RemoteForm
            key={initial?.id ?? "new"}
            initial={initial}
            keys={keys}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RemoteForm({ initial, keys, onDone }: { initial?: SshRemote; keys: SshKey[]; onDone: () => void }) {
  const qc = useQueryClient();
  const { data: hosts } = useQuery({
    queryKey: ["ssh-config-hosts"],
    queryFn: () => listSshConfigHosts(),
  });
  const [form, setForm] = useState<FormState>(() => initialForm(initial, keys));
  const [uploadOpen, setUploadOpen] = useState(false);
  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const patch = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }));

  const fromAlias = form.type === "ssh" && form.alias !== MANUAL;
  const isSmb = form.type === "smb";
  const isKey = form.type === "ssh" && form.auth === "key";
  const needsPassword = isSmb || form.auth === "password";
  const uploadedKey = isKey && form.keySel !== KEY_DEFAULT && form.keySel !== KEY_PATH;

  const save = useMutation({
    mutationFn: () =>
      unwrap(
        saveRemote({
          id: initial?.id,
          type: form.type,
          name: form.name,
          host: fromAlias ? form.alias : form.host,
          user: fromAlias ? null : form.user,
          port: !fromAlias && form.port ? Number(form.port) : null,
          auth: isSmb ? "password" : fromAlias ? "key" : form.auth,
          keyId: isKey && uploadedKey ? form.keySel : null,
          identityFile: isKey && form.keySel === KEY_PATH ? form.identityFile : null,
          password: form.password || null,
          domain: form.domain,
          smbVersion: form.smbVersion,
        }),
      ),
    onSuccess: () => {
      toast.success(initial ? "Remote updated" : "Remote added");
      qc.invalidateQueries({ queryKey: REMOTES_QK });
      qc.invalidateQueries({ queryKey: KEYS_QK });
      onDone();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  return (
    <>
      <form
        className="grid gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Segmented
          value={form.type}
          disabled={!!initial}
          onChange={(v) => patch({ type: v, alias: MANUAL })}
          options={[
            { value: "ssh", label: "SSH · sshfs", icon: Terminal },
            { value: "smb", label: "SMB · Windows share", icon: Network },
          ]}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Display name">
            <Input placeholder={fromAlias ? form.alias : "nas"} value={form.name} onChange={set("name")} />
          </Field>
          {form.type === "ssh" && !initial && (
            <Field label="Host from ~/.ssh/config">
              <Select value={form.alias} onValueChange={(v) => patch({ alias: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={MANUAL}>Enter host manually…</SelectItem>
                  {hosts?.map((h) => (
                    <SelectItem key={h} value={h}>
                      {h}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        </div>

        {!fromAlias && (
          <>
            <div className="grid gap-4 sm:grid-cols-[1fr_110px]">
              <Field label="Host / IP">
                <Input
                  className="font-mono"
                  placeholder="192.168.1.10"
                  value={form.host}
                  onChange={set("host")}
                  required
                />
              </Field>
              <Field label="Port">
                <Input
                  className="font-mono"
                  placeholder={isSmb ? "445" : "22"}
                  type="number"
                  value={form.port}
                  onChange={set("port")}
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Username">
                <Input
                  placeholder={isSmb ? "guest" : "me"}
                  value={form.user}
                  onChange={set("user")}
                  autoComplete="off"
                />
              </Field>
              {form.type === "ssh" && (
                <Field label="Authentication">
                  <Segmented
                    value={form.auth}
                    onChange={(v) => patch({ auth: v })}
                    options={[
                      { value: "key", label: "SSH key", icon: KeyRound },
                      {
                        value: "password",
                        label: "Password",
                        icon: ShieldCheck,
                      },
                    ]}
                  />
                </Field>
              )}
            </div>

            {isKey && (
              <div className="bg-muted/40 grid gap-3 rounded-xl border p-4">
                <div className="flex items-end gap-2">
                  <Field label="Private key" className="flex-1">
                    <Select value={form.keySel} onValueChange={(v) => patch({ keySel: v })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {keys.length > 0 && (
                          <SelectGroup>
                            <SelectLabel className="text-muted-foreground text-xs font-medium">
                              Uploaded keys
                            </SelectLabel>
                            {keys.map((k) => (
                              <SelectItem key={k.id} value={k.id}>
                                <span className="flex items-center gap-2">
                                  <KeyRound className="text-primary size-3.5" />
                                  {k.name}
                                  <span className="text-muted-foreground font-mono text-[11px]">
                                    {k.keyType}
                                  </span>
                                </span>
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        )}
                        {keys.length > 0 && <SelectSeparator />}
                        <SelectItem value={KEY_DEFAULT}>Server default (~/.ssh, agent)</SelectItem>
                        <SelectItem value={KEY_PATH}>Key file path on server…</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Button type="button" variant="outline" onClick={() => setUploadOpen(true)}>
                    <Upload className="size-4" /> Upload
                  </Button>
                </div>
                {form.keySel === KEY_PATH && (
                  <Field label="Identity file path">
                    <Input
                      className="font-mono"
                      placeholder="~/.ssh/id_ed25519"
                      value={form.identityFile}
                      onChange={set("identityFile")}
                    />
                  </Field>
                )}
                {uploadedKey && <SelectedKeyHint k={keys.find((k) => k.id === form.keySel)} />}
              </div>
            )}

            {needsPassword && (
              <Field label="Password">
                <Input
                  type="password"
                  autoComplete="new-password"
                  placeholder={initial?.hasPassword ? "•••••••• (unchanged)" : ""}
                  value={form.password}
                  onChange={set("password")}
                />
              </Field>
            )}

            {isSmb && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Domain / workgroup">
                  <Input placeholder="WORKGROUP" value={form.domain} onChange={set("domain")} />
                </Field>
                <Field label="SMB version">
                  <Input placeholder="3.0" value={form.smbVersion} onChange={set("smbVersion")} />
                </Field>
              </div>
            )}
          </>
        )}

        <p className="text-muted-foreground text-xs leading-relaxed">
          Secrets are stored encrypted with <code className="font-mono">APP_SECRET</code>. SSH password login
          needs <code className="font-mono">sshpass</code>; SMB needs{" "}
          <code className="font-mono">smbclient</code> + <code className="font-mono">cifs-utils</code> and
          root/sudo to mount — <code className="font-mono">scripts/ubuntu/setup.sh</code> installs them.
        </p>

        <DialogFooter className="gap-2">
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending && <Loader2 className="size-4 animate-spin" />}
            {initial ? "Save changes" : "Add remote"}
          </Button>
        </DialogFooter>
      </form>
      <UploadKeyDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUploaded={(id) => patch({ keySel: id })}
      />
    </>
  );
}

function SelectedKeyHint({ k }: { k?: SshKey }) {
  if (!k) return <p className="text-muted-foreground text-xs">Key list is refreshing…</p>;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-muted-foreground">Fingerprint</span>
      <code className="bg-card truncate rounded-md border px-1.5 py-0.5 font-mono text-[11px]">
        {k.fingerprint}
      </code>
      <CopyButton text={k.publicKey} label="Copy public key" />
    </div>
  );
}

/* ------------------------------ remote browser ----------------------------- */

function RemoteBrowser({ remote }: { remote: SshRemote }) {
  const qc = useQueryClient();
  const [cwd, setCwd] = useState("");
  const [pathInput, setPathInput] = useState("");
  const [name, setName] = useState("");
  const [idle, setIdle] = useState("15");
  const [scan, setScan] = useState(true);
  const [access, setAccess] = useState<"mount" | "direct">("mount");

  const { data, isFetching, error } = useQuery({
    queryKey: ["remote-ls", remote.id, cwd],
    queryFn: async () => {
      const r = await unwrap(browseRemote(remote.id, cwd));
      setPathInput(r.path);
      return r;
    },
    retry: false,
  });
  const current = data?.path ?? cwd;
  const isSmbRoot = remote.type === "smb" && current.split("/").filter(Boolean).length === 0;
  const parent = current.replace(/\/[^/]+\/?$/, "") || "/";
  const segments = current.split("/").filter(Boolean);

  const mount = useMutation({
    mutationFn: () =>
      unwrap(
        addMountedFolder({
          remoteId: remote.id,
          remotePath: current,
          name: name || current.split("/").filter(Boolean).pop() || remote.name,
          idleMinutes: Number(idle),
          scan,
          access,
        }),
      ),
    onSuccess: () => {
      toast.success(`${access === "direct" ? "Added" : "Mounted"} ${current} — ${scan ? "scanning" : "ready"}`);
      qc.invalidateQueries({ queryKey: ["folders"] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const dirs = data?.entries.filter((e) => e.isDirectory).length ?? 0;
  const files = (data?.entries.length ?? 0) - dirs;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
      <div className="bg-card overflow-hidden rounded-xl border">
        <div className="bg-muted/40 flex items-center gap-1.5 border-b p-2">
          <Button
            size="icon-sm"
            variant="ghost"
            title={remote.type === "smb" ? "Shares" : "Home"}
            onClick={() => setCwd(remote.type === "smb" ? "/" : "")}
          >
            <Home className="size-4" />
          </Button>
          <Button size="icon-sm" variant="ghost" title="Up" onClick={() => setCwd(parent)}>
            <ArrowUp className="size-4" />
          </Button>
          <form
            className="flex min-w-0 flex-1 gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              setCwd(pathInput);
            }}
          >
            <Input
              className="h-8 font-mono text-xs"
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
            />
            <Button type="submit" size="xs" variant="outline" className="h-8">
              Go
            </Button>
          </form>
        </div>
        <div className="flex flex-wrap items-center gap-0.5 border-b px-3 py-1.5 text-xs">
          <button className="text-muted-foreground hover:text-foreground" onClick={() => setCwd("/")}>
            /
          </button>
          {segments.map((s, i) => (
            <span key={i} className="flex items-center gap-0.5">
              {i > 0 && <ChevronRight className="text-muted-foreground/50 size-3" />}
              <button
                className={cn(
                  "hover:text-foreground max-w-40 truncate rounded px-1 py-0.5",
                  i === segments.length - 1 ? "text-foreground font-medium" : "text-muted-foreground",
                )}
                onClick={() => setCwd("/" + segments.slice(0, i + 1).join("/"))}
              >
                {s}
              </button>
            </span>
          ))}
          <span className="text-muted-foreground ml-auto">{data && `${dirs} folders · ${files} files`}</span>
        </div>
        {error && (
          <div className="p-3">
            <ErrorBanner>
              <span className="whitespace-pre-wrap">{errMsg(error)}</span>
            </ErrorBanner>
          </div>
        )}
        <div className="h-80 overflow-auto p-1.5 text-sm">
          {isFetching &&
            Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-2.5 py-2">
                <div className="bg-muted size-4 animate-pulse rounded" />
                <div
                  className="bg-muted h-3 animate-pulse rounded"
                  style={{ width: `${30 + ((i * 37) % 50)}%` }}
                />
              </div>
            ))}
          {!isFetching &&
            data?.entries.map((e) => (
              <button
                key={e.name}
                disabled={!e.isDirectory}
                onClick={() => setCwd(`${current.replace(/\/$/, "")}/${e.name}`)}
                className={cn(
                  "group flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left",
                  e.isDirectory ? "hover:bg-accent" : "text-muted-foreground cursor-default",
                )}
              >
                {e.isDirectory ? (
                  <Folder className="size-4 fill-amber-400/25 text-amber-500" />
                ) : (
                  <FileIcon className="size-4 opacity-60" />
                )}
                <span className="truncate">{e.name}</span>
                {e.isDirectory && (
                  <ChevronRight className="ml-auto size-4 opacity-0 transition-opacity group-hover:opacity-50" />
                )}
              </button>
            ))}
          {!isFetching && data && data.entries.length === 0 && (
            <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 text-sm">
              <FolderOpen className="size-6 opacity-50" /> Empty directory
            </div>
          )}
        </div>
      </div>

      <div className="bg-muted/30 flex flex-col gap-4 rounded-xl border p-4">
        <div>
          <div className="text-sm font-semibold">Add as data folder</div>
          <p className="text-muted-foreground mt-0.5 break-all font-mono text-xs">
            {remote.name}:{current || "~"}
          </p>
        </div>
        <Field label="Folder name">
          <Input
            placeholder={current.split("/").filter(Boolean).pop() || remote.name}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field
          label="Access"
          hint={
            access === "direct"
              ? `No mount: files are read over ${remote.type === "smb" ? "smbclient" : "ssh"} — works without FUSE, root or container privileges`
              : `Mounted with ${remote.type === "smb" ? "cifs (needs root/sudo)" : "sshfs (needs FUSE)"}; fastest for browsing and backups`
          }
        >
          <Segmented
            value={access}
            onChange={setAccess}
            options={[
              { value: "mount", label: "Mount", icon: Plug },
              { value: "direct", label: "Direct", icon: Zap },
            ]}
          />
        </Field>
        {access === "mount" && (
          <Field label="Unmount when idle" hint="Minutes, 0 keeps it mounted">
            <Input type="number" min={0} value={idle} onChange={(e) => setIdle(e.target.value)} />
          </Field>
        )}
        <label htmlFor={`scan-${remote.id}`} className="flex items-center justify-between gap-2 text-sm">
          Scan after adding
          <Switch id={`scan-${remote.id}`} checked={scan} onCheckedChange={setScan} />
        </label>
        <Button
          className="mt-auto"
          disabled={!data || mount.isPending || isSmbRoot}
          onClick={() => mount.mutate()}
        >
          {mount.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plug className="size-4" />}
          {mount.isPending
            ? access === "direct"
              ? "Connecting…"
              : "Mounting…"
            : isSmbRoot
              ? "Open a share first"
              : access === "direct"
                ? "Add data folder"
                : "Mount folder"}
        </Button>
      </div>
    </div>
  );
}

/* --------------------------------- cards ----------------------------------- */

type TestResult = { ok: boolean; text: string; pending?: boolean };

function RemoteCard({
  r,
  open,
  onToggle,
  onEdit,
  onDelete,
}: {
  r: SshRemote;
  open: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [test, setTest] = useState<TestResult | null>(null);
  const runTest = async () => {
    setTest({ ok: false, text: "Connecting…", pending: true });
    const res = await testRemoteConnection(r.id).catch((e) => ({
      ok: false as const,
      error: errMsg(e),
    }));
    if (res.ok) {
      setTest({ ok: true, text: res.info });
      toast.success(`${r.name}: connected`);
    } else {
      setTest({ ok: false, text: res.error });
      toast.error(res.error);
    }
  };
  const Icon = r.type === "smb" ? Network : Terminal;
  const address = `${r.type === "smb" ? "//" : ""}${r.user ? `${r.user}@` : ""}${r.host}${r.port ? `:${r.port}` : ""}`;

  return (
    <div className={cn("surface overflow-hidden transition-shadow", open && "ring-primary/20 ring-2")}>
      <div className="flex flex-wrap items-center gap-4 p-4 sm:p-5">
        <span className="bg-primary/10 text-primary flex size-11 shrink-0 items-center justify-center rounded-xl">
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-semibold">{r.name}</span>
            <Badge variant="secondary" className="font-mono uppercase">
              {r.type}
            </Badge>
            {r.type === "ssh" &&
              (r.auth === "key" ? (
                <Badge variant={r.keyName === "(deleted key)" ? "destructive" : "default"}>
                  <KeyRound />
                  {r.keyName ?? (r.identityFile ? "key file" : "default key")}
                </Badge>
              ) : (
                <Badge variant="outline">
                  <ShieldCheck /> password
                </Badge>
              ))}
          </div>
          <div className="text-muted-foreground mt-1 flex min-w-0 items-center gap-2 text-xs">
            <span className="truncate font-mono">{address}</span>
            {test && (
              <span
                className={cn(
                  "flex min-w-0 items-center gap-1.5",
                  test.pending ? "text-muted-foreground" : test.ok ? "text-success" : "text-destructive",
                )}
                title={test.text}
              >
                <span className="relative flex size-2">
                  {test.pending && (
                    <span className="bg-muted-foreground absolute inset-0 animate-ping rounded-full opacity-60" />
                  )}
                  <span
                    className={cn(
                      "relative size-2 rounded-full",
                      test.pending ? "bg-muted-foreground" : test.ok ? "bg-success" : "bg-destructive",
                    )}
                  />
                </span>
                <span className="truncate">{test.text}</span>
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={test?.pending} onClick={runTest}>
            {test?.pending ? <Loader2 className="size-4 animate-spin" /> : <Wifi className="size-4" />}
            Test
          </Button>
          <Button size="sm" variant={open ? "secondary" : "default"} onClick={onToggle}>
            {open ? <X className="size-4" /> : <FolderOpen className="size-4" />}
            {open ? "Close" : "Browse & mount"}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="size-9" aria-label="More actions">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={onEdit}>
                <Pencil className="mr-2 size-4" /> Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onDelete}>
                <Trash2 className="mr-2 size-4" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {open && (
        <div className="animate-fade-up border-t p-4 sm:p-5">
          <RemoteBrowser remote={r} />
        </div>
      )}
    </div>
  );
}

function KeyCard({ k, onDelete }: { k: SshKey; onDelete: () => void }) {
  return (
    <div className="surface flex min-w-0 flex-col gap-4 p-5">
      <div className="flex items-start gap-3">
        <span className="bg-warning/10 text-warning flex size-10 shrink-0 items-center justify-center rounded-xl">
          <KeyRound className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{k.name}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary" className="font-mono">
              {k.keyType}
              {k.bits ? ` · ${k.bits}` : ""}
            </Badge>
            {k.comment && <span className="text-muted-foreground truncate text-xs">{k.comment}</span>}
          </div>
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          className="text-muted-foreground hover:text-destructive"
          onClick={onDelete}
          aria-label="Delete key"
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
      <code
        className="bg-muted/60 text-muted-foreground block truncate rounded-lg px-2.5 py-1.5 font-mono text-[11px]"
        title={k.fingerprint}
      >
        {k.fingerprint}
      </code>
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground truncate text-xs">
          {k.usedBy.length ? (
            <>
              Used by <span className="text-foreground font-medium">{k.usedBy.join(", ")}</span>
            </>
          ) : (
            "Not used yet"
          )}
        </span>
        <CopyButton text={k.publicKey} label="Public key" />
      </div>
    </div>
  );
}

/* ---------------------------------- page ----------------------------------- */

export default function RemotesPage() {
  const qc = useQueryClient();
  const {
    data: remotes,
    isLoading,
    error,
  } = useQuery({ queryKey: REMOTES_QK, queryFn: () => listRemotes() });
  const { data: keys = [], error: keysError } = useQuery({
    queryKey: KEYS_QK,
    queryFn: () => listSshKeys(),
  });
  const [openId, setOpenId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ open: boolean; remote?: SshRemote }>({
    open: false,
  });
  const [uploadOpen, setUploadOpen] = useState(false);
  const [confirm, setConfirm] = useState<
    { kind: "remote"; item: SshRemote } | { kind: "key"; item: SshKey } | null
  >(null);

  const del = useMutation({
    mutationFn: async (c: NonNullable<typeof confirm>) =>
      c.kind === "remote" ? unwrap(deleteRemote(c.item.id)) : unwrap(deleteSshKey(c.item.id)),
    onSuccess: (_, c) => {
      toast.success(c.kind === "remote" ? "Remote deleted" : "SSH key deleted");
      qc.invalidateQueries({ queryKey: REMOTES_QK });
      qc.invalidateQueries({ queryKey: KEYS_QK });
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  return (
    <Page>
      <PageHeader
        icon={Server}
        title="Remotes"
        description={
          <>
            Connect to machines over SSH or SMB, pick a folder and mount it as a data folder. Mounts are made
            on demand and released when idle; the index stays searchable while unmounted. Mounted folders live
            on the{" "}
            <Link className="text-foreground underline-offset-4 hover:underline" href="/folders">
              Folders
            </Link>{" "}
            page.
          </>
        }
        actions={
          <>
            <Button variant="outline" onClick={() => setUploadOpen(true)}>
              <Upload className="size-4" /> Upload SSH key
            </Button>
            <Button onClick={() => setDialog({ open: true })}>
              <Plus className="size-4" /> Add remote
            </Button>
          </>
        }
      />

      <section className="space-y-4">
        <SectionTitle
          title="Connections"
          description={remotes ? `${remotes.length} remote${remotes.length === 1 ? "" : "s"}` : undefined}
        />
        {error && <ErrorBanner>{errMsg(error)}</ErrorBanner>}
        {isLoading && (
          <div className="space-y-3">
            {[0, 1].map((i) => (
              <div key={i} className="surface h-21 animate-pulse" />
            ))}
          </div>
        )}
        {remotes?.length === 0 && (
          <EmptyState
            icon={Server}
            title="No remotes yet"
            description="Add an SSH host or SMB share to browse it and mount folders into your index."
            action={
              <Button onClick={() => setDialog({ open: true })}>
                <Plus className="size-4" /> Add remote
              </Button>
            }
          />
        )}
        <div className="space-y-3">
          {remotes?.map((r) => (
            <RemoteCard
              key={r.id}
              r={r}
              open={openId === r.id}
              onToggle={() => setOpenId(openId === r.id ? null : r.id)}
              onEdit={() => setDialog({ open: true, remote: r })}
              onDelete={() => setConfirm({ kind: "remote", item: r })}
            />
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <SectionTitle
          title="SSH keys"
          description="Private keys available to SSH remotes. Add the public key to the server's ~/.ssh/authorized_keys."
          actions={
            <Button size="sm" variant="outline" onClick={() => setUploadOpen(true)}>
              <Upload className="size-4" /> Upload key
            </Button>
          }
        />
        {keysError && <ErrorBanner>{errMsg(keysError)}</ErrorBanner>}
        {keys.length === 0 && !keysError ? (
          <EmptyState
            icon={KeyRound}
            title="No SSH keys uploaded"
            description="Upload a private key to log in to SSH remotes without storing passwords."
            action={
              <Button variant="outline" onClick={() => setUploadOpen(true)}>
                <Upload className="size-4" /> Upload SSH key
              </Button>
            }
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {keys.map((k) => (
              <KeyCard key={k.id} k={k} onDelete={() => setConfirm({ kind: "key", item: k })} />
            ))}
          </div>
        )}
      </section>

      <RemoteDialog
        open={dialog.open}
        initial={dialog.remote}
        keys={keys}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
      />
      <UploadKeyDialog open={uploadOpen} onOpenChange={setUploadOpen} />

      <AlertDialog open={!!confirm} onOpenChange={(v) => !v && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {confirm?.kind === "key" ? "SSH key" : "remote"} “{confirm?.item.name}”?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === "key"
                ? "The stored private key is removed permanently. Remotes must not be using it."
                : "The connection settings are removed. Data folders mounted from it must be removed first."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => confirm && del.mutate(confirm)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}

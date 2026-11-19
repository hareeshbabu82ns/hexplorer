"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fingerprint, Loader2, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { authClient } from "@/lib/auth-client";
import { deviceName } from "@/lib/device-name";
import { TwoFactorSection } from "./two-factor-section";

async function unwrap<T>(p: Promise<{ data: T | null; error: { message?: string } | null } | any>) {
  const res = await p;
  if (res?.error) throw new Error(res.error.message ?? "Request failed");
  return res?.data as T;
}

export function SecuritySettings() {
  const qc = useQueryClient();
  const passkeys = useQuery({
    queryKey: ["passkeys"],
    queryFn: () => unwrap<any[]>(authClient.passkey.listUserPasskeys()),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["passkeys"] });
  const onError = (e: Error) => toast.error(e.message);

  const add = useMutation({
    mutationFn: () => unwrap(authClient.passkey.addPasskey({ name: deviceName() })),
    onSuccess: () => {
      toast.success("Passkey added");
      refresh();
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => unwrap(authClient.passkey.deletePasskey({ id })),
    onSuccess: refresh,
    onError,
  });
  const rename = useMutation({
    mutationFn: (v: { id: string; name: string }) => unwrap(authClient.passkey.updatePasskey(v)),
    onSuccess: refresh,
    onError,
  });

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [revoke, setRevoke] = useState(true);
  const changePw = useMutation({
    mutationFn: () =>
      unwrap(
        authClient.changePassword({
          currentPassword: current,
          newPassword: next,
          revokeOtherSessions: revoke,
        }),
      ),
    onSuccess: () => {
      toast.success("Password changed");
      setCurrent("");
      setNext("");
    },
    onError,
  });

  const revokeOthers = useMutation({
    mutationFn: () => unwrap(authClient.revokeOtherSessions()),
    onSuccess: () => toast.success("Signed out on all other devices"),
    onError,
  });

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Security</h3>
        <p className="text-muted-foreground text-sm">Passkeys, two-factor authentication, password and sessions.</p>
      </div>
      <Separator />

      <section className="space-y-3 rounded-xl border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="font-medium">Passkeys</div>
            <p className="text-muted-foreground text-sm">
              Sign in with Face ID / Touch ID / device PIN. Add one on each device you use.
            </p>
          </div>
          <Button className="h-11" onClick={() => add.mutate()} disabled={add.isPending}>
            {add.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Fingerprint className="mr-2 size-4" />}
            Add passkey
          </Button>
        </div>
        {passkeys.isLoading ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : passkeys.error ? (
          <p className="text-destructive text-sm">{(passkeys.error as Error).message}</p>
        ) : !passkeys.data?.length ? (
          <p className="text-muted-foreground text-sm">No passkeys yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {passkeys.data.map((p) => (
              <li key={p.id} className="flex items-center gap-3 p-3">
                <Fingerprint className="text-muted-foreground size-5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{p.name || "Passkey"}</div>
                  <div className="text-muted-foreground text-xs">
                    Added {new Date(p.createdAt).toLocaleString()}
                    {p.backedUp ? " · synced" : ""}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-10"
                  aria-label="Rename"
                  onClick={() => {
                    const name = prompt("Passkey name", p.name ?? "");
                    if (name?.trim()) rename.mutate({ id: p.id, name: name.trim() });
                  }}
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive size-10"
                  aria-label="Delete"
                  onClick={() => confirm(`Delete passkey "${p.name || "Passkey"}"?`) && remove.mutate(p.id)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <TwoFactorSection />

      <form
        className="space-y-3 rounded-xl border p-4"
        onSubmit={(e) => {
          e.preventDefault();
          changePw.mutate();
        }}
      >
        <div className="font-medium">Change password</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="cur">Current password</Label>
            <Input id="cur" type="password" className="h-11" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="new">New password</Label>
            <Input id="new" type="password" className="h-11" autoComplete="new-password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} required />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={revoke} onCheckedChange={setRevoke} /> Sign out other devices
          </label>
          <Button type="submit" className="h-11" disabled={changePw.isPending}>
            {changePw.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
            Update password
          </Button>
        </div>
      </form>

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
        <div>
          <div className="font-medium">Sessions</div>
          <p className="text-muted-foreground text-sm">Sign out everywhere except this device.</p>
        </div>
        <Button variant="outline" className="h-11" onClick={() => revokeOthers.mutate()} disabled={revokeOthers.isPending}>
          Sign out other devices
        </Button>
      </section>
    </div>
  );
}

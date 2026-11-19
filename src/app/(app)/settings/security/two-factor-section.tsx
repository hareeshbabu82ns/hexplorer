"use client";

import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Copy, Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient, useSession } from "@/lib/auth-client";

type Mode = "idle" | "setup" | "codes";

export function TwoFactorSection() {
  const { data: session, refetch } = useSession();
  const enabled = !!(session?.user as { twoFactorEnabled?: boolean } | undefined)?.twoFactorEnabled;
  const [mode, setMode] = useState<Mode>("idle");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [totpURI, setTotpURI] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const call = async <T,>(what: string, p: Promise<any>): Promise<T | null> => {
    setBusy(what);
    try {
      const res = await p;
      if (res?.error) {
        toast.error(res.error.message ?? "Request failed");
        return null;
      }
      return res?.data as T;
    } finally {
      setBusy(null);
    }
  };

  const start = async () => {
    const data = await call<{ totpURI: string; backupCodes: string[] }>(
      "enable",
      authClient.twoFactor.enable({ password }),
    );
    if (!data) return;
    setTotpURI(data.totpURI);
    setBackupCodes(data.backupCodes);
    setPassword("");
    setMode("setup");
  };

  const confirmSetup = async () => {
    const ok = await call("verify", authClient.twoFactor.verifyTotp({ code: code.trim() }));
    if (ok === null) return;
    setCode("");
    toast.success("Two-factor authentication is on");
    await refetch();
    setMode("codes"); // show the backup codes once more to save them
  };

  const regenerate = async () => {
    const data = await call<{ backupCodes: string[] }>(
      "regen",
      authClient.twoFactor.generateBackupCodes({ password }),
    );
    if (!data) return;
    setBackupCodes(data.backupCodes);
    setPassword("");
    setMode("codes");
  };

  const disable = async () => {
    if (!confirm("Turn off two-factor authentication?")) return;
    const ok = await call("disable", authClient.twoFactor.disable({ password }));
    if (ok === null) return;
    setPassword("");
    setMode("idle");
    toast.success("Two-factor authentication is off");
    await refetch();
  };

  const secret = totpURI ? new URL(totpURI).searchParams.get("secret") : null;
  const copy = (text: string) =>
    navigator.clipboard?.writeText(text).then(() => toast.success("Copied"));

  const codesView = (
    <div className="space-y-2">
      <p className="text-sm">
        Backup codes — each works once if you lose your authenticator. Store them somewhere safe.
      </p>
      <div className="bg-muted grid grid-cols-2 gap-1 rounded-lg p-3 font-mono text-sm sm:grid-cols-3">
        {backupCodes.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
      <Button variant="outline" className="h-10" onClick={() => copy(backupCodes.join("\n"))}>
        <Copy className="mr-2 size-4" /> Copy codes
      </Button>
    </div>
  );

  return (
    <section className="space-y-4 rounded-xl border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 font-medium">
            Two-factor authentication
            {enabled ? <Badge>On</Badge> : <Badge variant="secondary">Off</Badge>}
          </div>
          <p className="text-muted-foreground text-sm">
            Ask for a code from an authenticator app after the password. Passkey sign in does
            not need it.
          </p>
        </div>
      </div>

      {mode === "setup" && totpURI ? (
        <div className="space-y-4">
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            <div className="rounded-xl bg-white p-3">
              <QRCodeSVG value={totpURI} size={176} />
            </div>
            <div className="min-w-0 flex-1 space-y-2 text-sm">
              <p>
                1. Scan the QR code with your authenticator app (or tap the link on this device).
              </p>
              <a href={totpURI} className="text-primary block underline">
                Open in authenticator app
              </a>
              {secret && (
                <button
                  type="button"
                  className="bg-muted block w-full break-all rounded-md p-2 text-left font-mono text-xs"
                  onClick={() => copy(secret)}
                >
                  {secret}
                </button>
              )}
              <p>2. Enter the 6-digit code it shows:</p>
              <div className="flex gap-2">
                <Input
                  className="h-11 max-w-40 text-center font-mono text-lg tracking-widest"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
                <Button className="h-11" onClick={confirmSetup} disabled={code.trim().length !== 6 || !!busy}>
                  {busy === "verify" && <Loader2 className="mr-2 size-4 animate-spin" />}
                  Turn on
                </Button>
              </div>
            </div>
          </div>
          {codesView}
          <Button variant="ghost" onClick={() => setMode("idle")}>
            Cancel
          </Button>
        </div>
      ) : (
        <>
          {mode === "codes" && backupCodes.length > 0 && codesView}
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="tfa-pw">Password</Label>
              <Input
                id="tfa-pw"
                type="password"
                className="h-11 w-60"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {enabled ? (
              <>
                <Button variant="outline" className="h-11" onClick={regenerate} disabled={!password || !!busy}>
                  {busy === "regen" && <Loader2 className="mr-2 size-4 animate-spin" />}
                  New backup codes
                </Button>
                <Button variant="destructive" className="h-11" onClick={disable} disabled={!password || !!busy}>
                  <ShieldOff className="mr-2 size-4" /> Turn off
                </Button>
              </>
            ) : (
              <Button className="h-11" onClick={start} disabled={!password || !!busy}>
                {busy === "enable" ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <ShieldCheck className="mr-2 size-4" />
                )}
                Set up
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

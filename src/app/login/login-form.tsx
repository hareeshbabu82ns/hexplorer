"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Fingerprint, Loader2, ShieldCheck } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { deviceName } from "@/lib/device-name";

const passkeysSupported = () =>
  typeof window !== "undefined" && typeof window.PublicKeyCredential !== "undefined";
const noSubscribe = () => () => {};

export function LoginForm({ setup, next }: { setup: boolean; next: string }) {
  const router = useRouter();
  const [step, setStep] = useState<"form" | "passkey" | "2fa">("form");
  const [busy, setBusy] = useState<null | "password" | "passkey">(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const canPasskey = useSyncExternalStore(noSubscribe, passkeysSupported, () => false);
  const [code, setCode] = useState("");
  const [useBackup, setUseBackup] = useState(false);
  const [trustDevice, setTrustDevice] = useState(true);

  const done = () => {
    router.replace(next);
    router.refresh();
  };

  useEffect(() => {
    if (setup || !passkeysSupported()) return;
    // passkey suggestions in the username field's autofill (conditional UI)
    PublicKeyCredential.isConditionalMediationAvailable?.().then((ok) => {
      if (!ok) return;
      void authClient.signIn.passkey({ autoFill: true }).then((res) => {
        if (res && !res.error) done();
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setup]);

  const signInPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (setup) {
      if (password !== confirm) return setError("Passwords do not match");
      setBusy("password");
      const uname = username.trim().toLowerCase();
      const res = await authClient.signUp.email({
        name: name.trim() || uname,
        username: uname,
        // single-user app: email is required by the schema but never used
        email: `${uname}@hexplorer.local`,
        password,
      });
      setBusy(null);
      if (res.error) return setError(res.error.message ?? "Could not create the account");
      if (passkeysSupported()) setStep("passkey");
      else done();
      return;
    }
    setBusy("password");
    const res = await authClient.signIn.username({
      username: username.trim(),
      password,
      rememberMe: true,
    });
    setBusy(null);
    if (res.error) return setError(res.error.message ?? "Invalid username or password");
    if ((res.data as any)?.twoFactorRedirect) {
      setStep("2fa");
      return;
    }
    done();
  };

  const verify2fa = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy("password");
    const c = code.trim().replace(/\s+/g, "");
    const res = useBackup
      ? await authClient.twoFactor.verifyBackupCode({ code: c, trustDevice })
      : await authClient.twoFactor.verifyTotp({ code: c, trustDevice });
    setBusy(null);
    if (res.error) return setError(res.error.message ?? "Invalid code");
    done();
  };

  const signInPasskey = async () => {
    setError(null);
    setBusy("passkey");
    const res = await authClient.signIn.passkey();
    setBusy(null);
    if (res?.error) return setError(res.error.message ?? "Passkey sign in failed");
    done();
  };

  const addPasskey = async () => {
    setError(null);
    setBusy("passkey");
    const res = await authClient.passkey.addPasskey({ name: deviceName() });
    setBusy(null);
    if (res?.error) return setError(res.error.message ?? "Could not add the passkey");
    done();
  };

  const card =
    "bg-card/80 space-y-5 rounded-2xl border p-6 shadow-[var(--shadow-elevated)] backdrop-blur-xl md:p-8";

  if (step === "2fa")
    return (
      <form className={card} onSubmit={verify2fa}>
        <div className="space-y-1 text-center">
          <ShieldCheck className="text-primary mx-auto size-10" />
          <h2 className="text-lg font-semibold">Two-factor authentication</h2>
          <p className="text-muted-foreground text-sm">
            {useBackup
              ? "Enter one of your backup codes."
              : "Enter the 6-digit code from your authenticator app."}
          </p>
        </div>
        <Input
          key={useBackup ? "backup" : "totp"}
          autoFocus
          className="h-14 text-center font-mono text-2xl tracking-[0.3em]"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          inputMode={useBackup ? "text" : "numeric"}
          autoComplete="one-time-code"
          pattern={useBackup ? undefined : "[0-9]{6}"}
          maxLength={useBackup ? 32 : 6}
          required
        />
        <label className="flex items-center justify-between gap-2 text-sm">
          Trust this device for 30 days
          <Switch checked={trustDevice} onCheckedChange={setTrustDevice} />
        </label>
        {error && <p className="text-destructive text-sm">{error}</p>}
        <Button type="submit" className="h-12 w-full text-base" disabled={!!busy}>
          {busy && <Loader2 className="mr-2 size-5 animate-spin" />}
          Verify
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-11 w-full"
          onClick={() => {
            setUseBackup((b) => !b);
            setCode("");
            setError(null);
          }}
        >
          {useBackup ? "Use authenticator code" : "Use a backup code"}
        </Button>
      </form>
    );

  if (step === "passkey")
    return (
      <div className={card}>
        <div className="space-y-1 text-center">
          <Fingerprint className="text-primary mx-auto size-10" />
          <h2 className="text-lg font-semibold">Add a passkey?</h2>
          <p className="text-muted-foreground text-sm">
            Sign in next time with Face ID, Touch ID or your device PIN instead of the password.
          </p>
        </div>
        {error && <p className="text-destructive text-sm">{error}</p>}
        <Button className="h-12 w-full text-base" onClick={addPasskey} disabled={!!busy}>
          {busy ? <Loader2 className="mr-2 size-5 animate-spin" /> : <Fingerprint className="mr-2 size-5" />}
          Add passkey on this device
        </Button>
        <Button variant="ghost" className="h-12 w-full" onClick={done} disabled={!!busy}>
          Not now
        </Button>
      </div>
    );

  return (
    <div className={card}>
      {!setup && canPasskey && (
        <>
          <Button className="h-12 w-full text-base" onClick={signInPasskey} disabled={!!busy}>
            {busy === "passkey" ? (
              <Loader2 className="mr-2 size-5 animate-spin" />
            ) : (
              <Fingerprint className="mr-2 size-5" />
            )}
            Sign in with passkey
          </Button>
          <div className="text-muted-foreground flex items-center gap-3 text-xs uppercase">
            <span className="bg-border h-px flex-1" /> or <span className="bg-border h-px flex-1" />
          </div>
        </>
      )}
      <form className="space-y-4" onSubmit={signInPassword}>
        {setup && (
          <div className="space-y-2">
            <Label htmlFor="name">Display name</Label>
            <Input id="name" className="h-12 text-base" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Your name" />
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="username">User ID</Label>
          <Input
            id="username"
            className="h-12 text-base"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete={setup ? "username" : "username webauthn"}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            minLength={3}
            pattern="[A-Za-z0-9_.]+"
            title="Letters, numbers, underscore and dot"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            className="h-12 text-base"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={setup ? "new-password" : "current-password"}
            required
            minLength={setup ? 8 : 1}
          />
        </div>
        {setup && (
          <div className="space-y-2">
            <Label htmlFor="confirm">Confirm password</Label>
            <Input id="confirm" type="password" className="h-12 text-base" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required minLength={8} />
          </div>
        )}
        {error && <p className="text-destructive text-sm">{error}</p>}
        <Button
          type="submit"
          variant={setup || !canPasskey ? "default" : "outline"}
          className="h-12 w-full text-base"
          disabled={!!busy}
        >
          {busy === "password" && <Loader2 className="mr-2 size-5 animate-spin" />}
          {setup ? "Create account" : "Sign in with password"}
        </Button>
      </form>
    </div>
  );
}

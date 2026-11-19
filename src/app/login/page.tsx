import { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth, needsSetup } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in" };

const safeNext = (n?: string) => (n && n.startsWith("/") && !n.startsWith("//") ? n : "/");

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { next?: string };
}) {
  const next = safeNext(searchParams.next);
  let setup = false;
  let dbError: string | null = null;
  try {
    const session = await auth.api.getSession({ headers: headers() });
    if (session) redirect(next);
    setup = await needsSetup();
  } catch (e: any) {
    if (e?.digest?.startsWith?.("NEXT_REDIRECT")) throw e;
    dbError = e?.message ?? String(e);
  }

  return (
    <div className="bg-muted/40 flex min-h-dvh items-center justify-center px-4 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <span className="bg-primary text-primary-foreground flex size-16 items-center justify-center rounded-2xl text-3xl font-bold shadow-lg">
            H
          </span>
          <h1 className="text-2xl font-bold tracking-tight">HExplorer</h1>
          <p className="text-muted-foreground text-sm">
            {setup ? "Create the owner account for this server" : "Sign in to continue"}
          </p>
        </div>
        {dbError ? (
          <div className="bg-background text-destructive rounded-2xl border p-6 text-sm">
            Database unavailable: {dbError}. Check DATABASE_URL.
          </div>
        ) : (
          <LoginForm setup={setup} next={next} />
        )}
      </div>
    </div>
  );
}

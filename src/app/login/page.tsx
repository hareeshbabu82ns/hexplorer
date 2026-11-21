import { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth, needsSetup } from "@/lib/auth";
import { LogoMark } from "@/components/app/logo";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in" };

const safeNext = (n?: string) => (n && n.startsWith("/") && !n.startsWith("//") ? n : "/");

export default async function LoginPage(
  props: {
    searchParams: Promise<{ next?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const next = safeNext(searchParams.next);
  let setup = false;
  let dbError: string | null = null;
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (session) redirect(next);
    setup = await needsSetup();
  } catch (e: any) {
    if (e?.digest?.startsWith?.("NEXT_REDIRECT")) throw e;
    dbError = e?.message ?? String(e);
  }

  return (
    <div className="bg-background relative flex min-h-dvh items-center justify-center overflow-hidden px-4 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
      <div className="bg-dots pointer-events-none absolute inset-0 mask-[radial-gradient(ellipse_at_center,black,transparent_70%)]" />
      <div className="bg-primary/25 pointer-events-none absolute left-1/2 top-[-10%] size-[520px] -translate-x-1/2 rounded-full blur-[120px]" />
      <div className="animate-fade-up relative w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <LogoMark className="size-14 rounded-2xl" />
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Welcome to HExplorer</h1>
          <p className="text-muted-foreground text-sm">
            {setup ? "Create the owner account for this server" : "Sign in to continue"}
          </p>
        </div>
        {dbError ? (
          <div className="surface text-destructive p-6 text-sm">
            Database unavailable: {dbError}. Check DATABASE_URL.
          </div>
        ) : (
          <LoginForm setup={setup} next={next} />
        )}
      </div>
    </div>
  );
}

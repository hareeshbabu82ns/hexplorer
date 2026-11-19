import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // middleware already gates every request; this is defence in depth + user info
  const session = await auth.api.getSession({ headers: headers() }).catch(() => null);
  if (!session) redirect("/login");
  const u = session.user as typeof session.user & { username?: string | null };
  return <AppShell user={{ name: u.name, username: u.username }}>{children}</AppShell>;
}

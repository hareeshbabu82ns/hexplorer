import { DbAdminError, UNAUTHORIZED } from "./errors";

export interface DbAdminActor {
  userId: string;
  email: string | null;
}

type TestGlobal = { __DB_ADMIN_TEST_ACTOR__?: DbAdminActor | null };

/**
 * Server-side gate for every DB Management entry point (actions, routes, pages).
 *
 * HExplorer is a single-user app, so the signed-in account is the admin. Set
 * DB_ADMIN_USERS (comma separated usernames / emails) to restrict it further.
 */
export async function requireDbAdmin(): Promise<DbAdminActor> {
  // the e2e script (scripts/db-admin-e2e.ts) injects the actor; never in production
  if (process.env.DB_ADMIN_E2E === "1" && process.env.NODE_ENV !== "production") {
    const g = globalThis as TestGlobal;
    if (g.__DB_ADMIN_TEST_ACTOR__ !== undefined) {
      if (!g.__DB_ADMIN_TEST_ACTOR__) throw new DbAdminError(UNAUTHORIZED);
      return g.__DB_ADMIN_TEST_ACTOR__;
    }
  }

  const [{ headers }, { auth }] = await Promise.all([import("next/headers"), import("@/lib/auth")]);
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  if (!session?.user) throw new DbAdminError(UNAUTHORIZED);

  const user = session.user as typeof session.user & { username?: string | null };
  const allowed = (process.env.DB_ADMIN_USERS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (
    allowed.length &&
    !allowed.includes((user.username ?? "").toLowerCase()) &&
    !allowed.includes((user.email ?? "").toLowerCase())
  )
    throw new DbAdminError(UNAUTHORIZED);

  return { userId: String(user.id), email: user.email ?? user.username ?? null };
}

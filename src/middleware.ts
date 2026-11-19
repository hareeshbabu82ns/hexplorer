import { NextRequest, NextResponse } from "next/server";
import { getCookieCache, getSessionCookie } from "better-auth/cookies";

/** paths that work without a session */
const PUBLIC = [
  /^\/login(\/|$)/,
  /^\/api\/auth\//,
  /^\/manifest\.webmanifest$/,
  /^\/sw\.js$/,
  /^\/offline$/,
  /^\/icons\//,
  /^\/(icon|apple-icon)(\.\w+|\/.*)?$/,
  /^\/(favicon\.ico|robots\.txt)$/,
];

async function hasValidSession(req: NextRequest): Promise<{ ok: boolean; setCookie?: string[] }> {
  if (!getSessionCookie(req)) return { ok: false };
  const secret = process.env.BETTER_AUTH_SECRET || process.env.APP_SECRET;
  // fast path: signed session cache cookie (no DB / network round trip)
  for (const isSecure of [true, false]) {
    const cached = await getCookieCache(req, { secret, isSecure }).catch(() => null);
    if (cached?.session) return { ok: true };
  }
  // slow path: ask the auth API (also refreshes the cache cookie)
  const origin = process.env.AUTH_INTERNAL_URL || req.nextUrl.origin;
  try {
    const res = await fetch(new URL("/api/auth/get-session", origin), {
      headers: { cookie: req.headers.get("cookie") ?? "" },
      cache: "no-store",
    });
    const data = res.ok ? await res.json() : null;
    return { ok: !!data?.session, setCookie: res.headers.getSetCookie?.() };
  } catch (e) {
    console.error("session check failed", e);
    return { ok: false };
  }
}

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PUBLIC.some((r) => r.test(pathname))) return NextResponse.next();

  const { ok, setCookie } = await hasValidSession(req);
  if (ok) {
    const res = NextResponse.next();
    for (const c of setCookie ?? []) res.headers.append("set-cookie", c);
    return res;
  }

  // API / server action / RSC fetches get a 401 instead of an HTML redirect
  const isApi =
    pathname.startsWith("/api/") ||
    req.headers.has("next-action") ||
    req.method !== "GET";
  if (isApi) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};

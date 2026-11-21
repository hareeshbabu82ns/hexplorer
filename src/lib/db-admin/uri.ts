import { DbAdminError } from "./errors";

const URI_RE = /^(mongodb(?:\+srv)?):\/\/(?:([^@/]*)@)?([^/?]+)(\/[^?]*)?(\?.*)?$/;

interface ParsedUri {
  scheme: string;
  userinfo: string | null;
  hosts: string[];
  path: string;
  query: URLSearchParams;
}

function parse(uri: string): ParsedUri {
  const m = URI_RE.exec(uri.trim());
  if (!m) throw new DbAdminError("Invalid MongoDB connection string (expected mongodb:// or mongodb+srv://)");
  return {
    scheme: m[1],
    userinfo: m[2] ?? null,
    hosts: m[3].split(",").filter(Boolean),
    path: m[4] ?? "",
    query: new URLSearchParams((m[5] ?? "").replace(/^\?/, "")),
  };
}

const dec = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** hosts, username and default database of a connection string, never the password */
export function describeUri(uri: string): { hosts: string[]; username: string | null; defaultDb: string | null } {
  const p = parse(uri);
  const user = p.userinfo ? dec(p.userinfo.split(":")[0]) : null;
  const db = p.path.replace(/^\//, "");
  return { hosts: p.hosts, username: user || null, defaultDb: db ? dec(db) : null };
}

/** default auth database of a connection string: authSource, else the path db, else admin */
export function authSourceOf(uri: string): string {
  const p = parse(uri);
  return p.query.get("authSource") || dec(p.path.replace(/^\//, "")) || "admin";
}

/** a ready-to-use connection string for another user on the same server */
export function uriWithCredentials(baseUri: string, user: string, password: string, authSource: string): string {
  const p = parse(baseUri);
  p.query.set("authSource", authSource);
  const q = p.query.toString();
  const path = p.path || "/";
  return `${p.scheme}://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${p.hosts.join(",")}${path}${q ? `?${q}` : ""}`;
}

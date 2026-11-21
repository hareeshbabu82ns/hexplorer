/**
 * The one path helper for DB Management pages. Plain module (no "use client"),
 * so server components, actions and client components can all import it.
 */
export const DB_MANAGEMENT_ROOT = "/db-management";

export function dbPath(connectionId?: string | null, database?: string | null, collection?: string | null) {
  let p = DB_MANAGEMENT_ROOT;
  if (!connectionId) return p;
  p += `/${encodeURIComponent(connectionId)}`;
  if (!database) return p;
  p += `/${encodeURIComponent(database)}`;
  if (!collection) return p;
  return `${p}/${encodeURIComponent(collection)}`;
}

/** decode a dynamic route segment (Next passes them still encoded in some versions) */
export function decodeSegment(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

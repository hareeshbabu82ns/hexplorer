import { DbAdminError } from "./errors";

export const SYSTEM_DATABASES = ["admin", "local", "config"];

export function isSystemDatabase(name: string) {
  return SYSTEM_DATABASES.includes(name);
}

/** database names: no /\. "$*<>:|? characters, at most 63 bytes */
export function validateDatabaseName(name: string): string {
  const n = (name ?? "").trim();
  if (!n) throw new DbAdminError("Database name is required");
  if (/[/\\. "$*<>:|?\0]/.test(n))
    throw new DbAdminError('Database name cannot contain any of /\\. "$*<>:|?');
  if (Buffer.byteLength(n, "utf8") > 63) throw new DbAdminError("Database name must be at most 63 bytes");
  return n;
}

/**
 * collection names: not empty, no "$", no NUL; "system." prefixes are only
 * allowed for read-only use (pass allowSystem for reads).
 */
export function validateCollectionName(name: string, opts: { allowSystem?: boolean } = {}): string {
  const n = (name ?? "").trim();
  if (!n) throw new DbAdminError("Collection name is required");
  if (n.includes("$")) throw new DbAdminError("Collection name cannot contain $");
  if (n.includes("\0")) throw new DbAdminError("Collection name cannot contain NUL");
  if (!opts.allowSystem && n.startsWith("system."))
    throw new DbAdminError('Collections starting with "system." are read-only');
  return n;
}

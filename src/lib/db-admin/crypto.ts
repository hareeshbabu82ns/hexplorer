import crypto from "crypto";

/**
 * Saved connection strings are stored AES-256-GCM encrypted with a key derived
 * from DB_ADMIN_SECRET (falls back to BETTER_AUTH_SECRET, then APP_SECRET).
 * Changing that secret makes saved connections unreadable: re-enter them.
 */
let cached: { secret: string; key: Buffer } | null = null;

function key() {
  const secret =
    process.env.DB_ADMIN_SECRET || process.env.BETTER_AUTH_SECRET || process.env.APP_SECRET;
  if (!secret || secret.length < 8)
    throw new Error("Set DB_ADMIN_SECRET (or BETTER_AUTH_SECRET / APP_SECRET, min 8 chars) to save connections");
  if (cached?.secret !== secret)
    cached = { secret, key: crypto.scryptSync(secret, "hexplorer-db-admin-uri", 32) };
  return cached.key;
}

export function encryptUri(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), enc.toString("base64")].join(":");
}

export function decryptUri(blob: string): string {
  const [v, iv, tag, enc] = blob.split(":");
  if (v !== "v1" || !iv || !tag || !enc) throw new Error("Unknown encrypted connection format");
  const d = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  try {
    return Buffer.concat([d.update(Buffer.from(enc, "base64")), d.final()]).toString("utf8");
  } catch {
    throw new Error("Cannot decrypt the saved connection string (secret changed?): edit it and re-enter the URI");
  }
}

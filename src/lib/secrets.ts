import crypto from "crypto";

/**
 * Remote passwords are stored AES-256-GCM encrypted with a key derived from
 * APP_SECRET. Changing APP_SECRET makes stored passwords unreadable (re-enter them).
 */
function key() {
  const secret = process.env.APP_SECRET;
  if (!secret || secret.length < 8)
    throw new Error("APP_SECRET (min 8 chars) must be set in .env to store passwords");
  return crypto.scryptSync(secret, "hexplorer-remote-secrets", 32);
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), enc.toString("base64")].join(":");
}

export function decryptSecret(blob: string): string {
  const [v, iv, tag, enc] = blob.split(":");
  if (v !== "v1") throw new Error("unknown secret format");
  const d = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  try {
    return Buffer.concat([d.update(Buffer.from(enc, "base64")), d.final()]).toString("utf8");
  } catch {
    throw new Error("Cannot decrypt stored password (APP_SECRET changed?) — re-enter it");
  }
}

import crypto from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { ObjectId } from "mongodb";

import { collections } from "./db";
import { run } from "./mounts";
import { decryptSecret } from "./secrets";

/**
 * Uploaded SSH private keys.
 *
 * On upload the key is validated with ssh-keygen, any passphrase is stripped,
 * and the plain key is stored AES-256-GCM encrypted (APP_SECRET). When a remote
 * needs it, it is written to a 0600 file in a 0700 directory under the OS temp
 * dir and passed to ssh / sshfs with -i / IdentityFile.
 */

export interface ParsedKey {
  privateKey: string;
  publicKey: string;
  fingerprint: string;
  keyType: string;
  bits: number | null;
  comment: string | null;
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(/*turbopackIgnore: true*/ os.tmpdir(), "hx-key-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** normalise line endings and make sure the key ends with a newline (ssh is picky) */
function normalizeKeyText(text: string) {
  const t = text.replace(/\r\n?/g, "\n").trim();
  return t + "\n";
}

export async function parsePrivateKey(text: string, passphrase?: string | null): Promise<ParsedKey> {
  const key = normalizeKeyText(text);
  if (key.length > 64 * 1024) throw new Error("Key file is too large");
  if (!/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(key)) {
    if (/^(ssh-|ecdsa-|sk-)/.test(key))
      throw new Error("That is a public key — upload the private key (e.g. id_ed25519, not id_ed25519.pub)");
    throw new Error("Not a recognised private key (expected an OpenSSH or PEM private key)");
  }
  return withTempDir(async (dir) => {
    const file = path.join(/*turbopackIgnore: true*/ dir, "id");
    await fs.writeFile(file, key, { mode: 0o600 });

    // strip passphrase (no-op for unencrypted keys when -P "" matches)
    const strip = (pp: string) =>
      run("ssh-keygen", ["-p", "-q", "-P", pp, "-N", "", "-f", file], {
        timeout: 15000,
      });
    try {
      // a passphrase typed for an unprotected key is harmless: fall back to ""
      await strip(passphrase ?? "").catch((e) => (passphrase ? strip("") : Promise.reject(e)));
    } catch (e: any) {
      const msg = String(e.message || "");
      if (/incorrect passphrase|bad passphrase|decrypt/i.test(msg) || !passphrase)
        throw new Error(
          passphrase
            ? "Incorrect passphrase for this key"
            : "This key is passphrase-protected — enter its passphrase",
        );
      throw new Error(`Could not read key: ${msg}`);
    }

    const privateKey = await fs.readFile(file, "utf8");
    const { stdout: pub } = await run("ssh-keygen", ["-y", "-f", file], {
      timeout: 15000,
    });
    const { stdout: fp } = await run("ssh-keygen", ["-l", "-E", "sha256", "-f", file], { timeout: 15000 });
    // "256 SHA256:abc… comment (ED25519)"
    const m = fp.trim().match(/^(\d+)\s+(\S+)\s+(.*?)\s*\(([^)]+)\)$/);
    const comment = m?.[3] && m[3] !== "no comment" ? m[3] : null;
    return {
      privateKey,
      publicKey: pub.trim(),
      fingerprint: m?.[2] ?? fp.trim().split(/\s+/)[1] ?? "",
      keyType: m?.[4] ?? "SSH",
      bits: m ? Number(m[1]) : null,
      comment,
    };
  });
}

/** private dir for materialised keys (0700, owned by the app user) */
async function keysDir() {
  const uid = process.getuid?.() ?? "u";
  const dir = path.join(/*turbopackIgnore: true*/ os.tmpdir(), `hexplorer-keys-${uid}`);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.chmod(dir, 0o700);
  return dir;
}

/**
 * Write the uploaded key to disk (idempotent) and return its path.
 * The file name includes a content hash so a replaced key never reuses a stale file.
 */
export async function materializeKey(keyId: ObjectId): Promise<string> {
  const { sshKeys } = await collections();
  const doc = await sshKeys.findOne({ _id: keyId });
  if (!doc) throw new Error("The SSH key selected for this remote was deleted — pick another key");
  const plain = decryptSecret(doc.privateKeyEnc);
  const hash = crypto.createHash("sha256").update(plain).digest("hex").slice(0, 12);
  const file = path.join(/*turbopackIgnore: true*/ await keysDir(), `${keyId.toHexString()}-${hash}`);
  try {
    const st = await fs.stat(file);
    if ((st.mode & 0o077) === 0) return file;
  } catch {}
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, plain, { mode: 0o600 });
  await fs.rename(tmp, file);
  return file;
}

/** remove materialised copies of a key (on delete) */
export async function forgetKeyFiles(keyId: ObjectId) {
  try {
    const dir = await keysDir();
    const prefix = keyId.toHexString();
    for (const f of await fs.readdir(dir))
      if (f.startsWith(prefix))
        await fs.rm(path.join(/*turbopackIgnore: true*/ dir, f), {
          force: true,
        });
  } catch {}
}

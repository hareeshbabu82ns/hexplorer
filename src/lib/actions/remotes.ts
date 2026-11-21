"use server";

import fs from "fs/promises";
import path from "path";

import { collections, FolderDoc, RemoteDoc, SshKeyDoc, toObjectId } from "@/lib/db";
import { background, isJobRunning } from "@/lib/jobs";
import {
  isMounted,
  listRemoteDir,
  mountFolder,
  mountsRoot,
  mountTypeFor,
  slugify,
  sshConfigHosts,
  startIdleReaper,
  testRemote,
  unmountFolder,
} from "@/lib/mounts";
import { remoteFs } from "@/lib/folder-fs";
import { scanFolder } from "@/lib/scanner";
import { encryptSecret } from "@/lib/secrets";
import { forgetKeyFiles, parsePrivateKey } from "@/lib/ssh-keys";

/**
 * Production Next.js strips the message of errors thrown from server actions,
 * so actions whose errors the UI shows return them as values instead.
 */
export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function attempt<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e: any) {
    return { ok: false, error: (e?.message || String(e)).trim() };
  }
}

function serializeRemote(r: RemoteDoc, keyNames?: Map<string, string>): SshRemote {
  return {
    id: r._id.toHexString(),
    name: r.name,
    type: r.type ?? "ssh",
    host: r.host,
    user: r.user ?? null,
    port: r.port ?? null,
    auth: r.type === "smb" ? "password" : (r.auth ?? "key"),
    identityFile: r.identityFile ?? null,
    keyId: r.keyId?.toHexString() ?? null,
    keyName: r.keyId ? (keyNames?.get(r.keyId.toHexString()) ?? "(deleted key)") : null,
    hasPassword: !!r.passwordEnc,
    domain: r.domain ?? null,
    smbVersion: r.smbVersion ?? null,
  };
}

export async function listRemotes(): Promise<SshRemote[]> {
  const { remotes, sshKeys } = await collections();
  const keys = await sshKeys.find({}, { projection: { name: 1 } }).toArray();
  const names = new Map(keys.map((k) => [k._id.toHexString(), k.name]));
  return (await remotes.find().sort({ name: 1 }).toArray()).map((r) => serializeRemote(r, names));
}

/** Host aliases found in the server user's ~/.ssh/config */
export async function listSshConfigHosts(): Promise<string[]> {
  return sshConfigHosts();
}

async function saveRemoteImpl(input: RemoteInput) {
  const type = input.type === "smb" ? "smb" : "ssh";
  const host = input.host.trim();
  if (!host || /[\s/\\]/.test(host) || host.startsWith("-")) throw new Error("Invalid host / IP");
  const user = input.user?.trim() || null;
  if (user && (/[\s@]/.test(user) || user.startsWith("-"))) throw new Error("Invalid user");
  const auth = type === "smb" ? "password" : input.auth === "password" ? "password" : "key";
  if (type === "ssh" && auth === "password" && !user) throw new Error("User is required for password login");

  const doc: Partial<RemoteDoc> = {
    name: input.name?.trim() || host,
    type,
    host,
    user,
    port: input.port ? Number(input.port) : null,
    auth,
    identityFile: auth === "key" && !input.keyId ? input.identityFile?.trim() || null : null,
    keyId: auth === "key" && input.keyId ? toObjectId(input.keyId) : null,
    domain: type === "smb" ? input.domain?.trim() || null : null,
    smbVersion: type === "smb" ? input.smbVersion?.trim() || null : null,
  };
  // empty password on edit = keep the stored one
  if (input.password) doc.passwordEnc = encryptSecret(input.password);
  else if (auth === "key") doc.passwordEnc = null;

  const { remotes, sshKeys } = await collections();
  if (doc.keyId && !(await sshKeys.countDocuments({ _id: doc.keyId })))
    throw new Error("Selected SSH key no longer exists");
  if (input.id) {
    await remotes.updateOne({ _id: toObjectId(input.id) }, { $set: doc });
    return input.id;
  }
  if (type === "ssh" && auth === "password" && !input.password) throw new Error("Password is required");
  const res = await remotes.insertOne({
    ...doc,
    createdAt: new Date(),
  } as RemoteDoc);
  return res.insertedId.toHexString();
}

async function deleteRemoteImpl(id: string) {
  const { remotes, folders } = await collections();
  const used = await folders.countDocuments({
    "mount.remoteId": toObjectId(id),
  });
  if (used) throw new Error(`Remote is used by ${used} data folder(s); remove them first`);
  const { backups } = await collections();
  const rid = toObjectId(id);
  const jobs = await backups
    .find({ $or: [{ "source.remoteId": rid }, { "dest.remoteId": rid }] }, { projection: { name: 1 } })
    .toArray();
  if (jobs.length)
    throw new Error(`Remote is used by backup job(s) ${jobs.map((j) => j.name).join(", ")}; change them first`);
  await remotes.deleteOne({ _id: toObjectId(id) });
}

async function getRemoteDoc(id: string) {
  const { remotes } = await collections();
  const r = await remotes.findOne({ _id: toObjectId(id) });
  if (!r) throw new Error("Remote not found");
  return r;
}

export async function testRemoteConnection(id: string) {
  try {
    const info = await testRemote(await getRemoteDoc(id));
    return { ok: true as const, info };
  } catch (e: any) {
    return { ok: false as const, error: (e.message || String(e)).trim() };
  }
}

export async function browseRemote(id: string, remotePath: string) {
  return attempt(async () => listRemoteDir(await getRemoteDoc(id), remotePath));
}

/** label stored in `path` for direct folders (unique per remote + path, never touched on disk) */
function directLabel(remote: RemoteDoc, remotePath: string) {
  return `${remote.type === "smb" ? "smb" : "ssh"}://${remote.name}${remotePath.startsWith("/") ? "" : "/~/"}${remotePath.replace(/^~\/?/, "")}`;
}

const mountPointFor = (remote: RemoteDoc, name: string) =>
  path.join(/*turbopackIgnore: true*/ mountsRoot(), slugify(`${remote.name}-${name}`));

/**
 * Register remotePath of a remote as a data folder: mounted under the mounts root
 * (access "mount"), or reached over ssh / smbclient without any mount ("direct").
 */
async function addMountedFolderImpl(input: {
  remoteId: string;
  remotePath: string;
  name: string;
  idleMinutes: number;
  scan?: boolean;
  access?: "mount" | "direct";
}): Promise<string> {
  const remote = await getRemoteDoc(input.remoteId);
  if (remote.type === "smb" && !input.remotePath.split("/").filter(Boolean).length)
    throw new Error("Open a share first — the share list itself cannot be added");
  const direct = input.access === "direct";
  const name = input.name.trim() || path.posix.basename(input.remotePath) || remote.name;
  const folderPath = direct ? directLabel(remote, input.remotePath) : mountPointFor(remote, name);
  const { folders } = await collections();
  if (await folders.findOne({ path: folderPath }))
    throw new Error(`A data folder already uses ${folderPath}`);
  if (direct) await remoteFs(remote, input.remotePath).listRoot(); // fail fast when unreachable
  else await fs.mkdir(folderPath, { recursive: true });

  const doc: Omit<FolderDoc, "_id"> = {
    name,
    path: folderPath,
    createdAt: new Date(),
    status: "idle",
    fileCount: 0,
    dirCount: 0,
    totalSize: 0,
    mount: {
      type: mountTypeFor(remote),
      remoteId: remote._id,
      remotePath: input.remotePath,
      idleMinutes: direct ? 0 : Math.max(0, Number(input.idleMinutes) || 0),
      access: direct ? "direct" : "mount",
    },
    lastUsedAt: new Date(),
  };
  const res = await folders.insertOne(doc as FolderDoc);
  const folder = { ...doc, _id: res.insertedId } as FolderDoc;
  if (!direct) {
    try {
      await mountFolder(folder);
    } catch (e) {
      await folders.deleteOne({ _id: res.insertedId });
      throw e;
    }
  }
  if (input.scan !== false) {
    await folders.updateOne({ _id: folder._id }, { $set: { status: "scanning", progress: 0 } });
    background(scanFolder(folder), "scanFolder");
  }
  return res.insertedId.toHexString();
}

/** switch a remote data folder between mounting and direct (unmounted) access; the index is kept */
async function setFolderAccessImpl(folderId: string, access: "mount" | "direct") {
  const { folders } = await collections();
  const folder = await folders.findOne({ _id: toObjectId(folderId) });
  if (!folder?.mount) throw new Error("Not a remote data folder");
  const current = folder.mount.access ?? "mount";
  if (current === access) return;
  if (isJobRunning(folderId)) throw new Error("A scan/hash/backup job is using this folder");
  const remote = await getRemoteDoc(folder.mount.remoteId.toHexString());

  if (access === "direct") {
    await remoteFs(remote, folder.mount.remotePath).listRoot(); // reachable without a mount?
    await unmountFolder(folder);
    await fs.rmdir(folder.path).catch(() => {}); // the empty mount point
    const label = directLabel(remote, folder.mount.remotePath);
    if (await folders.findOne({ path: label, _id: { $ne: folder._id } }))
      throw new Error(`A data folder already uses ${label}`);
    await folders.updateOne(
      { _id: folder._id },
      { $set: { path: label, "mount.access": "direct", "mount.idleMinutes": 0 } },
    );
  } else {
    const mp = mountPointFor(remote, folder.name);
    if (await folders.findOne({ path: mp, _id: { $ne: folder._id } }))
      throw new Error(`A data folder already uses ${mp}`);
    await fs.mkdir(mp, { recursive: true });
    const next = { ...folder, path: mp, mount: { ...folder.mount, access: "mount" as const } };
    await mountFolder(next); // throws (and changes nothing) when mounting is not possible here
    await folders.updateOne({ _id: folder._id }, { $set: { path: mp, "mount.access": "mount" } });
  }
}

export async function setFolderMounted(folderId: string, mounted: boolean) {
  const { folders } = await collections();
  const folder = await folders.findOne({ _id: toObjectId(folderId) });
  if (!folder?.mount) throw new Error("Not a mounted folder");
  if (folder.mount.access === "direct") throw new Error("This folder uses direct access and is never mounted");
  if (mounted) {
    await mountFolder(folder);
    await folders.updateOne({ _id: folder._id }, { $set: { lastUsedAt: new Date() } });
  } else {
    await unmountFolder(folder);
  }
  return isMounted(folder.path);
}

export async function setIdleMinutes(folderId: string, idleMinutes: number) {
  const { folders } = await collections();
  await folders.updateOne(
    { _id: toObjectId(folderId), mount: { $ne: null } },
    { $set: { "mount.idleMinutes": Math.max(0, Number(idleMinutes) || 0) } },
  );
  startIdleReaper();
}

/* --------------------------------- SSH keys -------------------------------- */

function serializeKey(k: SshKeyDoc, usedBy: string[]): SshKey {
  return {
    id: k._id.toHexString(),
    name: k.name,
    keyType: k.keyType,
    bits: k.bits ?? null,
    fingerprint: k.fingerprint,
    publicKey: k.publicKey,
    comment: k.comment ?? null,
    createdAt: k.createdAt.toISOString(),
    usedBy,
  };
}

export async function listSshKeys(): Promise<SshKey[]> {
  const { sshKeys, remotes } = await collections();
  const [keys, users] = await Promise.all([
    sshKeys
      .find({}, { projection: { privateKeyEnc: 0 } })
      .sort({ name: 1 })
      .toArray(),
    remotes.find({ keyId: { $ne: null } }, { projection: { name: 1, keyId: 1 } }).toArray(),
  ]);
  return keys.map((k) =>
    serializeKey(
      k as SshKeyDoc,
      users.filter((r) => r.keyId?.equals(k._id)).map((r) => r.name),
    ),
  );
}

/** validate + store an uploaded private key; returns the new key id */
async function uploadSshKeyImpl(input: {
  name?: string | null;
  privateKey: string;
  passphrase?: string | null;
}): Promise<string> {
  if (!input.privateKey?.trim()) throw new Error("Choose a key file or paste a private key");
  const parsed = await parsePrivateKey(input.privateKey, input.passphrase);
  const { sshKeys } = await collections();
  const dupe = await sshKeys.findOne({ fingerprint: parsed.fingerprint });
  if (dupe) throw new Error(`This key is already uploaded as “${dupe.name}”`);
  const name =
    input.name?.trim() ||
    parsed.comment ||
    `${parsed.keyType.toLowerCase()} key ${parsed.fingerprint.slice(7, 15)}`;
  const res = await sshKeys.insertOne({
    name: name.slice(0, 80),
    keyType: parsed.keyType,
    bits: parsed.bits,
    fingerprint: parsed.fingerprint,
    publicKey: parsed.publicKey,
    comment: parsed.comment,
    privateKeyEnc: encryptSecret(parsed.privateKey),
    createdAt: new Date(),
  } as SshKeyDoc);
  return res.insertedId.toHexString();
}

export async function renameSshKey(id: string, name: string) {
  const n = name.trim();
  if (!n) throw new Error("Name is required");
  const { sshKeys } = await collections();
  await sshKeys.updateOne({ _id: toObjectId(id) }, { $set: { name: n.slice(0, 80) } });
}

async function deleteSshKeyImpl(id: string) {
  const { sshKeys, remotes } = await collections();
  const _id = toObjectId(id);
  const used = await remotes.find({ keyId: _id }, { projection: { name: 1 } }).toArray();
  if (used.length)
    throw new Error(`Key is used by ${used.map((r) => r.name).join(", ")} — switch those remotes first`);
  await sshKeys.deleteOne({ _id });
  await forgetKeyFiles(_id);
}

export async function saveRemote(input: RemoteInput) {
  return attempt(() => saveRemoteImpl(input));
}

export async function deleteRemote(id: string) {
  return attempt(() => deleteRemoteImpl(id));
}

export async function addMountedFolder(input: {
  remoteId: string;
  remotePath: string;
  name: string;
  idleMinutes: number;
  scan?: boolean;
  access?: "mount" | "direct";
}) {
  return attempt(() => addMountedFolderImpl(input));
}

export async function setFolderAccess(folderId: string, access: "mount" | "direct") {
  return attempt(() => setFolderAccessImpl(folderId, access));
}

export async function uploadSshKey(input: {
  name?: string | null;
  privateKey: string;
  passphrase?: string | null;
}) {
  return attempt(() => uploadSshKeyImpl(input));
}

export async function deleteSshKey(id: string) {
  return attempt(() => deleteSshKeyImpl(id));
}

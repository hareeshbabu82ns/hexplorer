"use server";

import { background } from "@/lib/jobs";
import fs from "fs/promises";
import path from "path";
import { collections, FolderDoc, RemoteDoc, toObjectId } from "@/lib/db";
import {
  isMounted,
  listRemoteDir,
  mountFolder,
  mountTypeFor,
  mountsRoot,
  slugify,
  sshConfigHosts,
  startIdleReaper,
  testRemote,
  unmountFolder,
} from "@/lib/mounts";
import { scanFolder } from "@/lib/scanner";
import { encryptSecret } from "@/lib/secrets";

function serializeRemote(r: RemoteDoc): SshRemote {
  return {
    id: r._id.toHexString(),
    name: r.name,
    type: r.type ?? "ssh",
    host: r.host,
    user: r.user ?? null,
    port: r.port ?? null,
    auth: r.type === "smb" ? "password" : (r.auth ?? "key"),
    identityFile: r.identityFile ?? null,
    hasPassword: !!r.passwordEnc,
    domain: r.domain ?? null,
    smbVersion: r.smbVersion ?? null,
  };
}

export async function listRemotes(): Promise<SshRemote[]> {
  const { remotes } = await collections();
  return (await remotes.find().sort({ name: 1 }).toArray()).map(serializeRemote);
}

/** Host aliases found in the server user's ~/.ssh/config */
export async function listSshConfigHosts(): Promise<string[]> {
  return sshConfigHosts();
}

export async function saveRemote(input: RemoteInput) {
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
    identityFile: auth === "key" ? input.identityFile?.trim() || null : null,
    domain: type === "smb" ? input.domain?.trim() || null : null,
    smbVersion: type === "smb" ? input.smbVersion?.trim() || null : null,
  };
  // empty password on edit = keep the stored one
  if (input.password) doc.passwordEnc = encryptSecret(input.password);
  else if (auth === "key") doc.passwordEnc = null;

  const { remotes } = await collections();
  if (input.id) {
    await remotes.updateOne({ _id: toObjectId(input.id) }, { $set: doc });
    return input.id;
  }
  if (type === "ssh" && auth === "password" && !input.password)
    throw new Error("Password is required");
  const res = await remotes.insertOne({ ...doc, createdAt: new Date() } as RemoteDoc);
  return res.insertedId.toHexString();
}

export async function deleteRemote(id: string) {
  const { remotes, folders } = await collections();
  const used = await folders.countDocuments({ "mount.remoteId": toObjectId(id) });
  if (used) throw new Error(`Remote is used by ${used} data folder(s); remove them first`);
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
  try {
    return await listRemoteDir(await getRemoteDoc(id), remotePath);
  } catch (e: any) {
    throw new Error((e.message || String(e)).trim());
  }
}

/** mount remotePath of a remote under the mounts root and register it as a data folder */
export async function addMountedFolder(input: {
  remoteId: string;
  remotePath: string;
  name: string;
  idleMinutes: number;
  scan?: boolean;
}): Promise<string> {
  const remote = await getRemoteDoc(input.remoteId);
  if (remote.type === "smb" && !input.remotePath.split("/").filter(Boolean).length)
    throw new Error("Open a share first — the share list itself cannot be mounted");
  const name = input.name.trim() || path.posix.basename(input.remotePath) || remote.name;
  const mountPoint = path.join(mountsRoot(), slugify(`${remote.name}-${name}`));
  const { folders } = await collections();
  if (await folders.findOne({ path: mountPoint }))
    throw new Error(`A data folder already uses ${mountPoint}`);
  await fs.mkdir(mountPoint, { recursive: true });

  const doc: Omit<FolderDoc, "_id"> = {
    name,
    path: mountPoint,
    createdAt: new Date(),
    status: "idle",
    fileCount: 0,
    dirCount: 0,
    totalSize: 0,
    mount: {
      type: mountTypeFor(remote),
      remoteId: remote._id,
      remotePath: input.remotePath,
      idleMinutes: Math.max(0, Number(input.idleMinutes) || 0),
    },
    lastUsedAt: new Date(),
  };
  const res = await folders.insertOne(doc as FolderDoc);
  const folder = { ...doc, _id: res.insertedId } as FolderDoc;
  try {
    await mountFolder(folder);
  } catch (e) {
    await folders.deleteOne({ _id: res.insertedId });
    throw e;
  }
  if (input.scan !== false) {
    await folders.updateOne({ _id: folder._id }, { $set: { status: "scanning", progress: 0 } });
    background(scanFolder(folder), "scanFolder");
  }
  return res.insertedId.toHexString();
}

export async function setFolderMounted(folderId: string, mounted: boolean) {
  const { folders } = await collections();
  const folder = await folders.findOne({ _id: toObjectId(folderId) });
  if (!folder?.mount) throw new Error("Not a mounted folder");
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

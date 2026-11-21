import crypto from "crypto";
import { createReadStream } from "fs";
import fs from "fs/promises";
import path from "path";
import { AnyBulkWriteOperation, ObjectId } from "mongodb";
import config from "@/config/config";
import { C_EXPLORER_DOMAIN, C_EXPLORER_IGNORE_FILE_PATTERNS } from "./constants";
import { belowDir, collections, FileDoc, FolderDoc, normDir } from "./db";
import { isJobRunning, runningJobs } from "./jobs";
import { ensureMounted, touchFolder } from "./mounts";

const BATCH_SIZE = 500;

export { isJobRunning };

/** resolve a user supplied folder path; relative paths are resolved against DATA_FOLDER */
export function resolveFolderPath(p: string) {
  const trimmed = p.trim();
  return path.resolve(/*turbopackIgnore: true*/ 
    path.isAbsolute(trimmed) ? trimmed : path.join(/*turbopackIgnore: true*/ config.dataFolder, trimmed),
  );
}

/** reject after ms — stat on a dead network share can hang for a long time */
export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

/**
 * Make sure the folder root is reachable before touching disk. Accessing an
 * autofs path here triggers the mount. An existing-but-empty root while the
 * index has entries is treated as "not mounted".
 */
export async function assertFolderOnline(folder: FolderDoc) {
  let entries: string[];
  if (folder.mount) await ensureMounted(folder);
  try {
    const st = await withTimeout(fs.stat(folder.path), 15000, "folder access");
    if (!st.isDirectory()) throw new Error("not a directory");
    entries = await withTimeout(fs.readdir(folder.path), 15000, "folder listing");
  } catch (e: any) {
    throw new Error(`Folder "${folder.name}" is offline (${folder.path}): ${e.message}`);
  }
  if (entries.length === 0 && (folder.fileCount > 0 || folder.dirCount > 0)) {
    throw new Error(
      `Folder "${folder.name}" is empty on disk but indexed with entries — probably not mounted (${folder.path})`,
    );
  }
  void touchFolder(folder);
}

/** absolute path of an entry, guaranteed to stay inside the folder root */
export function safeJoin(root: string, relPath: string) {
  const abs = path.resolve(/*turbopackIgnore: true*/ root, relPath);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error(`path escapes folder root: ${relPath}`);
  }
  return abs;
}

/** strip common "copy" decorations so "a (1).pdf", "a - Copy.pdf", "Copy of a.pdf" match "a.pdf" */
export function normalizeName(name: string) {
  const lower = name.toLowerCase();
  const ext = path.extname(lower);
  let base = lower.slice(0, lower.length - ext.length);
  base = base
    .replace(/^copy of\s+/, "")
    .replace(/\s*-\s*copy(\s*\(\d+\))?$/, "")
    .replace(/\s*copy\s*\d*$/, "")
    .replace(/\s*\(\d+\)$/, "")
    .replace(/[\s_\-.]+/g, " ")
    .trim();
  return base + ext;
}

async function loadIgnorePatterns(): Promise<RegExp[]> {
  const { settings } = await collections();
  const s = await settings.findOne({
    domain: C_EXPLORER_DOMAIN,
    key: C_EXPLORER_IGNORE_FILE_PATTERNS,
  });
  if (!s?.value) return [];
  return s.value
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .flatMap((p) => {
      try {
        return [new RegExp(p)];
      } catch {
        console.warn("invalid ignore pattern", p);
        return [];
      }
    });
}

export async function updateFolderStats(folderId: ObjectId) {
  const { files, folders } = await collections();
  const [stats] = await files
    .aggregate<{ fileCount: number; dirCount: number; totalSize: number }>([
      { $match: { folderId } },
      {
        $group: {
          _id: null,
          fileCount: { $sum: { $cond: ["$isDirectory", 0, 1] } },
          dirCount: { $sum: { $cond: ["$isDirectory", 1, 0] } },
          totalSize: { $sum: { $cond: ["$isDirectory", 0, "$size"] } },
        },
      },
    ])
    .toArray();
  await folders.updateOne(
    { _id: folderId },
    {
      $set: {
        fileCount: stats?.fileCount ?? 0,
        dirCount: stats?.dirCount ?? 0,
        totalSize: stats?.totalSize ?? 0,
      },
    },
  );
}

function literalFields(doc: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(doc).map(([k, v]) => [k, { $literal: v }]));
}

function upsertOp(
  folder: FolderDoc,
  relDir: string,
  name: string,
  stats: import("fs").Stats,
  scanId: string,
): AnyBulkWriteOperation<FileDoc> {
  const relPath = relDir ? `${relDir}/${name}` : name;
  const isDirectory = stats.isDirectory();
  const size = isDirectory ? 0 : stats.size;
  const modifiedDate = stats.mtime;
  return {
    updateOne: {
      filter: { folderId: folder._id, relPath },
      upsert: true,
      // pipeline update: keep previous hash only when content metadata unchanged
      update: [
        {
          $set: {
            hash: {
              $cond: [
                { $and: [{ $eq: ["$size", size] }, { $eq: ["$modifiedDate", modifiedDate] }] },
                "$hash",
                null,
              ],
            },
          },
        },
        {
          // values are wrapped in $literal: inside a pipeline update a string starting with "$"
          // (e.g. SMB's "$RECYCLE.BIN") would otherwise be parsed as a field path
          $set: literalFields({
            folderId: folder._id,
            relPath,
            name,
            nameLower: name.toLowerCase(),
            nameNorm: normalizeName(name),
            ext: isDirectory ? "" : path.extname(name).slice(1).toLowerCase(),
            dir: relDir,
            isDirectory,
            size,
            birthDate: stats.birthtime,
            modifiedDate,
            scanId,
          }),
        },
      ] as any,
    },
  };
}

/**
 * Walk the folder (or one of its sub folders) recursively and upsert every entry. Hashes are kept when
 * size + mtime are unchanged. Entries not seen in this scan are removed.
 */
export async function scanFolder(folder: FolderDoc, subDirIn = "") {
  const subDir = normDir(subDirIn);
  const id = folder._id.toHexString();
  if (runningJobs.has(id)) throw new Error("A job is already running for this folder");
  runningJobs.add(id);

  const { files, folders } = await collections();
  const started = Date.now();
  const scanId = new ObjectId().toHexString();
  let processed = 0;
  let readErrors = 0;

  await folders.updateOne(
    { _id: folder._id },
    { $set: { status: "scanning", statusMessage: subDir ? `Scanning ${subDir}` : null, progress: 0 } },
  );

  try {
    await assertFolderOnline(folder);
    const ignore = await loadIgnorePatterns();
    let batch: AnyBulkWriteOperation<FileDoc>[] = [];

    const flush = async () => {
      if (!batch.length) return;
      await files.bulkWrite(batch, { ordered: false });
      processed += batch.length;
      batch = [];
      await folders.updateOne({ _id: folder._id }, { $set: { progress: processed } });
    };

    const walk = async (relDir: string) => {
      const absDir = relDir ? path.join(/*turbopackIgnore: true*/ folder.path, relDir) : folder.path;
      let entries: import("fs").Dirent[];
      try {
        entries = await fs.readdir(absDir, { withFileTypes: true });
      } catch (e: any) {
        console.warn("cannot read dir", absDir, e.message);
        readErrors++;
        return;
      }
      const subDirs: string[] = [];
      for (const entry of entries) {
        if (ignore.some((re) => re.test(entry.name))) continue;
        if (!entry.isFile() && !entry.isDirectory()) continue; // skip symlinks, sockets...
        const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
        let stats: import("fs").Stats;
        try {
          stats = await fs.stat(path.join(/*turbopackIgnore: true*/ absDir, entry.name));
        } catch {
          continue;
        }
        const isDirectory = stats.isDirectory();
        batch.push(upsertOp(folder, relDir, entry.name, stats, scanId));
        if (batch.length >= BATCH_SIZE) await flush();
        if (isDirectory) subDirs.push(relPath);
      }
      for (const d of subDirs) await walk(d);
    };

    if (subDir) {
      // root is verified online; a missing sub folder really was deleted
      let subStats: import("fs").Stats | null = null;
      try {
        subStats = await fs.stat(safeJoin(folder.path, subDir));
      } catch (e: any) {
        if (e.code !== "ENOENT") throw e;
      }
      if (!subStats?.isDirectory()) {
        await files.deleteMany({ folderId: folder._id, $or: [{ relPath: subDir }, belowDir(subDir)] });
      } else {
        // make sure the sub folder and its ancestors are in the index
        const parts = subDir.split("/");
        for (let i = 0; i < parts.length; i++) {
          const rel = parts.slice(0, i + 1).join("/");
          const st = await fs.stat(safeJoin(folder.path, rel));
          batch.push(upsertOp(folder, parts.slice(0, i).join("/"), parts[i], st, scanId));
        }
        await walk(subDir);
      }
    } else {
      await walk("");
    }
    await flush();

    // remove stale entries (deleted on disk since last scan) — but only when the
    // whole tree was readable, otherwise a flaky share would wipe the index
    if (readErrors === 0) {
      await files.deleteMany({ folderId: folder._id, scanId: { $ne: scanId }, ...belowDir(subDir) });
    }
    await updateFolderStats(folder._id);
    await folders.updateOne(
      { _id: folder._id },
      {
        $set: {
          status: "idle",
          statusMessage: readErrors
            ? `${readErrors} directories could not be read; stale entries were kept`
            : subDir
              ? `Last scan: ${subDir} only`
              : null,
          progress: processed,
          lastScanAt: new Date(),
          lastScanDurationMs: Date.now() - started,
        },
      },
    );
    console.log(`scan finished: ${folder.path}/${subDir} (${processed} entries)`);
  } catch (e: any) {
    console.error("scan failed", folder.path, e);
    await folders.updateOne(
      { _id: folder._id },
      { $set: { status: "error", statusMessage: e.message ?? String(e) } },
    );
  } finally {
    runningJobs.delete(id);
    void touchFolder(folder);
  }
}

function hashFile(absPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha1");
    createReadStream(absPath)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")))
      .on("error", reject);
  });
}

/**
 * Compute content hashes for files that share their size with at least one
 * other file (only those can be content duplicates).
 */
export async function hashCandidates(folder: FolderDoc, subDirIn = "") {
  const subDir = normDir(subDirIn);
  const id = folder._id.toHexString();
  if (runningJobs.has(id)) throw new Error("A job is already running for this folder");
  runningJobs.add(id);
  const { files, folders } = await collections();
  await folders.updateOne(
    { _id: folder._id },
    { $set: { status: "hashing", statusMessage: subDir ? `Hashing ${subDir}` : null, progress: 0 } },
  );
  try {
    await assertFolderOnline(folder);
    // size collisions are checked across ALL folders, so cross-folder copies are found
    const all = (await folders.find({}, { projection: { _id: 1 } }).toArray()).map((f) => f._id);
    const candidates = await unhashedCandidates(all, { folderId: folder._id, dir: subDir });
    let done = 0;
    for (const f of candidates) {
      try {
        const hash = await hashFile(safeJoin(folder.path, f.relPath));
        await files.updateOne({ _id: f._id }, { $set: { hash } });
      } catch (e: any) {
        console.warn("hash failed", f.relPath, e.message);
      }
      done++;
      if (done % 20 === 0)
        await folders.updateOne({ _id: folder._id }, { $set: { progress: done } });
    }
    await folders.updateOne(
      { _id: folder._id },
      { $set: { status: "idle", statusMessage: null, progress: done } },
    );
  } catch (e: any) {
    console.error("hashing failed", folder.path, e);
    await folders.updateOne(
      { _id: folder._id },
      { $set: { status: "error", statusMessage: e.message ?? String(e) } },
    );
  } finally {
    runningJobs.delete(id);
    void touchFolder(folder);
  }
}

/**
 * files without a hash whose size collides with another file in the given
 * folders; optionally restricted to one folder (+ sub dir) as hashing target
 */
export async function unhashedCandidates(
  folderIds: ObjectId[],
  target?: { folderId: ObjectId; dir?: string },
) {
  const { files } = await collections();
  const sizes = await files
    .aggregate<{ _id: number }>([
      { $match: { folderId: { $in: folderIds }, isDirectory: false, size: { $gt: 0 } } },
      { $group: { _id: "$size", n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } },
    ])
    .toArray();
  if (!sizes.length) return [];
  return files
    .find(
      {
        folderId: target ? target.folderId : { $in: folderIds },
        ...belowDir(target?.dir ?? ""),
        isDirectory: false,
        size: { $in: sizes.map((s) => s._id) },
        $or: [{ hash: null }, { hash: { $exists: false } }],
      },
      { projection: { _id: 1, relPath: 1, folderId: 1 } },
    )
    .toArray();
}

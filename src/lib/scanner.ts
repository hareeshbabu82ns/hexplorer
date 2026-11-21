import path from "path";
import { AnyBulkWriteOperation, ObjectId } from "mongodb";
import config from "@/config/config";
import { C_EXPLORER_DOMAIN, C_EXPLORER_IGNORE_FILE_PATTERNS } from "./constants";
import { belowDir, collections, FileDoc, FolderDoc, normDir } from "./db";
import { isJobRunning, runningJobs } from "./jobs";
import { folderFs, FolderFs, FsEntry } from "./folder-fs";
import { touchFolder } from "./mounts";

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
 * Make sure the folder root is reachable before touching it, and return the file
 * access for it. Mount-mode remotes are mounted here; accessing an autofs path
 * triggers its mount. An existing-but-empty root while the index has entries is
 * treated as "not mounted".
 */
export async function assertFolderOnline(folder: FolderDoc): Promise<FolderFs> {
  let entries: string[];
  let fsx: FolderFs;
  try {
    fsx = await folderFs(folder);
    entries = await withTimeout(fsx.listRoot(), 30000, "folder listing");
  } catch (e: any) {
    throw new Error(`Folder "${folder.name}" is offline (${folder.path}): ${e.message}`);
  }
  if (entries.length === 0 && (folder.fileCount > 0 || folder.dirCount > 0)) {
    throw new Error(
      `Folder "${folder.name}" is empty but indexed with entries — probably not mounted (${folder.path})`,
    );
  }
  void touchFolder(folder);
  return fsx;
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
  stats: FsEntry,
  scanId: string,
): AnyBulkWriteOperation<FileDoc> {
  const relPath = relDir ? `${relDir}/${name}` : name;
  const isDirectory = stats.isDirectory;
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
    const fsx = await assertFolderOnline(folder);
    const ignore = await loadIgnorePatterns();
    let batch: AnyBulkWriteOperation<FileDoc>[] = [];

    const flush = async () => {
      if (!batch.length) return;
      await files.bulkWrite(batch, { ordered: false });
      processed += batch.length;
      batch = [];
      await folders.updateOne({ _id: folder._id }, { $set: { progress: processed } });
    };

    // ignored names are skipped together with everything below them
    const ignored = (relDir: string, name: string) =>
      ignore.length > 0 &&
      [...(relDir ? relDir.split("/") : []), name].some((seg) => ignore.some((re) => re.test(seg)));
    const walk = async (relDir: string) => {
      const errors = await fsx.walk(
        relDir,
        async (dir, entry) => {
          if (ignored(dir, entry.name)) return; // remote listings are flat: filter below ignored dirs
          batch.push(upsertOp(folder, dir, entry.name, entry, scanId));
          if (batch.length >= BATCH_SIZE) await flush();
        },
        (dir, name) => ignore.some((re) => re.test(name)),
      );
      readErrors += errors;
    };

    if (subDir) {
      // root is verified online; a missing sub folder really was deleted
      const subStats = await fsx.stat(subDir);
      if (!subStats?.isDirectory) {
        await files.deleteMany({ folderId: folder._id, $or: [{ relPath: subDir }, belowDir(subDir)] });
      } else {
        // make sure the sub folder and its ancestors are in the index
        const parts = subDir.split("/");
        for (let i = 0; i < parts.length; i++) {
          const rel = parts.slice(0, i + 1).join("/");
          const st = await fsx.stat(rel);
          if (!st) throw new Error(`${rel} vanished during the scan`);
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
    const fsx = await assertFolderOnline(folder);
    // size collisions are checked across ALL folders, so cross-folder copies are found
    const all = (await folders.find({}, { projection: { _id: 1 } }).toArray()).map((f) => f._id);
    const candidates = await unhashedCandidates(all, { folderId: folder._id, dir: subDir });
    let done = 0;
    // remote backends hash in batches (one round trip each); local files one by one
    const BATCH_FILES = fsx.sha1Many ? 100 : 1;
    const BATCH_BYTES = 256 * 1024 * 1024; // bounds the SMB temp download
    for (let i = 0; i < candidates.length; ) {
      const batch = [candidates[i++]];
      let bytes = batch[0].size;
      while (i < candidates.length && batch.length < BATCH_FILES && bytes + candidates[i].size <= BATCH_BYTES) {
        bytes += candidates[i].size;
        batch.push(candidates[i++]);
      }
      let hashes = new Map<string, string>();
      if (fsx.sha1Many && batch.length > 1) {
        try {
          hashes = await fsx.sha1Many(batch.map((f) => ({ rel: f.relPath, size: f.size })));
        } catch (e: any) {
          console.warn("batch hash failed, hashing one by one", e.message);
        }
      }
      for (const f of batch) {
        try {
          const hash = hashes.get(f.relPath) ?? (await fsx.sha1(f.relPath));
          await files.updateOne({ _id: f._id }, { $set: { hash } });
        } catch (e: any) {
          console.warn("hash failed", f.relPath, e.message);
        }
        done++;
        if (done % 20 === 0) await folders.updateOne({ _id: folder._id }, { $set: { progress: done } });
      }
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
      { projection: { _id: 1, relPath: 1, folderId: 1, size: 1 } },
    )
    .toArray();
}

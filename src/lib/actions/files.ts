"use server";

import { Filter, ObjectId } from "mongodb";
import { collections, escapeRegex, FileDoc, FolderDoc, toObjectId } from "@/lib/db";
import {
  assertFolderOnline,
  unhashedCandidates,
  updateFolderStats,
  withTimeout,
} from "@/lib/scanner";

const SORT_FIELDS: Record<FileSortKey, string> = {
  name: "nameLower",
  size: "size",
  modifiedDate: "modifiedDate",
  birthDate: "birthDate",
  ext: "ext",
};

function serializeFile(f: FileDoc, folderNames?: Map<string, string>): ExploreFile {
  const folderId = f.folderId.toHexString();
  return {
    id: f._id.toHexString(),
    folderId,
    folderName: folderNames?.get(folderId),
    name: f.name,
    relPath: f.relPath,
    dir: f.dir,
    ext: f.ext,
    isDirectory: f.isDirectory,
    size: f.size,
    birthDate: f.birthDate?.toISOString(),
    modifiedDate: f.modifiedDate?.toISOString(),
    hash: f.hash ?? null,
  };
}

async function folderNameMap() {
  const { folders } = await collections();
  const all = await folders.find({}, { projection: { name: 1 } }).toArray();
  return new Map(all.map((f) => [f._id.toHexString(), f.name]));
}

function dirScope(dir: string): Filter<FileDoc> {
  // everything at or below dir
  return dir ? { dir: { $regex: `^${escapeRegex(dir)}(/|$)` } } : {};
}

/** DB only — works with the data folders unmounted */
export async function searchFiles(params: SearchFilesParams): Promise<SearchFilesResult> {
  const { files } = await collections();
  const dir = (params.dir ?? "").replace(/^\/+|\/+$/g, "");
  const pageSize = Math.min(Math.max(params.pageSize ?? 50, 1), 500);
  const page = Math.max(params.page ?? 1, 1);
  const search = params.search?.trim();

  const where: Filter<FileDoc> = {};
  if (params.folderId) where.folderId = toObjectId(params.folderId);
  if (search) {
    where.nameLower = { $regex: escapeRegex(search.toLowerCase()) };
    if (params.recursive === false) where.dir = dir;
    else Object.assign(where, dirScope(dir));
  } else {
    // plain browsing: direct children only
    where.dir = dir;
  }

  const sortField = SORT_FIELDS[params.sortBy ?? "name"] ?? "nameLower";
  const order = params.sortOrder === "desc" ? -1 : 1;
  const sort: Record<string, 1 | -1> = { isDirectory: -1, [sortField]: order };
  if (sortField !== "nameLower") sort.nameLower = 1;

  const [total, docs, names] = await Promise.all([
    files.countDocuments(where),
    files
      .find(where)
      .sort(sort)
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .toArray(),
    folderNameMap(),
  ]);
  return {
    docs: docs.map((d) => serializeFile(d, names)),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** DB only */
export async function findDuplicates(params: {
  folderIds?: string[];
  mode: DuplicateMode;
  dir?: string;
  minSize?: number;
  limit?: number;
}): Promise<DuplicateResult> {
  const { files, folders } = await collections();
  const folderIds = params.folderIds?.length
    ? params.folderIds.map(toObjectId)
    : (await folders.find({}, { projection: { _id: 1 } }).toArray()).map((f) => f._id);

  const match: Filter<FileDoc> = {
    folderId: { $in: folderIds },
    isDirectory: false,
    size: { $gte: Math.max(params.minSize ?? 1, 0) },
  };
  const dir = (params.dir ?? "").replace(/^\/+|\/+$/g, "");
  if (dir) Object.assign(match, dirScope(dir));
  if (params.mode === "content") match.hash = { $type: "string" };

  const groupKey =
    params.mode === "name"
      ? { name: "$nameLower" }
      : params.mode === "similar-name-size"
        ? { name: "$nameNorm", size: "$size" }
        : params.mode === "content"
          ? { hash: "$hash", size: "$size" }
          : { name: "$nameLower", size: "$size" };

  const limit = Math.min(params.limit ?? 300, 2000);
  const [res] = await files
    .aggregate<{
      groups: { _id: any; count: number; size: number; wasted: number; ids: ObjectId[] }[];
      totals: { totalGroups: number; totalWasted: number }[];
    }>(
      [
        { $match: match },
        {
          $group: {
            _id: groupKey,
            count: { $sum: 1 },
            size: { $max: "$size" },
            total: { $sum: "$size" },
            ids: { $push: "$_id" },
          },
        },
        { $match: { count: { $gt: 1 } } },
        { $addFields: { wasted: { $subtract: ["$total", "$size"] } } },
        {
          $facet: {
            groups: [{ $sort: { wasted: -1, count: -1 } }, { $limit: limit }],
            totals: [
              {
                $group: {
                  _id: null,
                  totalGroups: { $sum: 1 },
                  totalWasted: { $sum: "$wasted" },
                },
              },
            ],
          },
        },
      ],
      { allowDiskUse: true },
    )
    .toArray();

  const groupsRaw = res?.groups ?? [];
  const allIds = groupsRaw.flatMap((g) => g.ids);
  const [docs, names] = await Promise.all([
    files.find({ _id: { $in: allIds } }).toArray(),
    folderNameMap(),
  ]);
  const byId = new Map(docs.map((d) => [d._id.toHexString(), d]));

  const groups: DuplicateGroup[] = groupsRaw.map((g) => ({
    key: Object.values(g._id).join(" · "),
    size: g.size,
    count: g.count,
    wasted: g.wasted,
    files: g.ids
      .map((id) => byId.get(id.toHexString()))
      .filter((d): d is FileDoc => !!d)
      .sort((a, b) => a.modifiedDate.getTime() - b.modifiedDate.getTime())
      .map((d) => serializeFile(d, names)),
  }));

  return {
    groups,
    totalGroups: res?.totals[0]?.totalGroups ?? 0,
    totalWasted: res?.totals[0]?.totalWasted ?? 0,
    unhashedCandidates:
      params.mode === "content" ? (await unhashedCandidates(folderIds)).length : undefined,
  };
}

/**
 * Delete files/directories on disk and from the index. This is the one place
 * (besides scan / view) that needs the folder mounted: each folder root is
 * checked first so an unmounted share never causes index entries to be dropped.
 */
export async function deleteFiles(ids: string[]): Promise<DeleteResult> {
  const { files, folders } = await collections();
  const docs = await files.find({ _id: { $in: ids.map(toObjectId) } }).toArray();
  const result: DeleteResult = { deleted: 0, failed: [] };

  const found = new Set(docs.map((d) => d._id.toHexString()));
  for (const id of ids)
    if (!found.has(id)) result.failed.push({ id, error: "not in index" });

  const byFolder = new Map<string, FileDoc[]>();
  for (const d of docs) {
    const k = d.folderId.toHexString();
    byFolder.set(k, [...(byFolder.get(k) ?? []), d]);
  }

  for (const [folderId, items] of byFolder) {
    const folder = (await folders.findOne({ _id: toObjectId(folderId) })) as FolderDoc | null;
    if (!folder) {
      items.forEach((d) =>
        result.failed.push({ id: d._id.toHexString(), relPath: d.relPath, error: "folder not found" }),
      );
      continue;
    }
    let fsx: Awaited<ReturnType<typeof assertFolderOnline>>;
    try {
      fsx = await assertFolderOnline(folder);
    } catch (e: any) {
      items.forEach((d) =>
        result.failed.push({ id: d._id.toHexString(), relPath: d.relPath, error: e.message }),
      );
      continue;
    }

    for (const d of items) {
      try {
        // a missing entry is fine (root is online, verified above) → just drop it from the index
        await withTimeout(fsx.rm(d.relPath, d.isDirectory), 10 * 60_000, "delete");
        if (d.isDirectory) {
          await files.deleteMany({
            folderId: d.folderId,
            $or: [{ _id: d._id }, { relPath: { $regex: `^${escapeRegex(d.relPath)}/` } }],
          });
        } else {
          await files.deleteOne({ _id: d._id });
        }
        result.deleted++;
      } catch (e: any) {
        result.failed.push({
          id: d._id.toHexString(),
          relPath: d.relPath,
          error: e.message ?? String(e),
        });
      }
    }
    await updateFolderStats(folder._id);
  }
  return result;
}

export async function getFile(id: string) {
  const { files, folders } = await collections();
  const f = await files.findOne({ _id: toObjectId(id) });
  if (!f) return null;
  const folder = await folders.findOne({ _id: f.folderId });
  return { file: serializeFile(f), folderName: folder?.name ?? "" };
}

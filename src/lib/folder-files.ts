import { collections, toObjectId } from "./db";
import { safeRel } from "./folder-fs";
import { assertFolderOnline } from "./scanner";

/** resolve folderId + relative path to the folder's file access (mounting / connecting as needed) */
export async function resolveFolderFile(folderId: string, relPath: string) {
  const { folders } = await collections();
  const folder = await folders.findOne({ _id: toObjectId(folderId) });
  if (!folder) throw new Error("Folder not found");
  const rel = safeRel(relPath);
  const fsx = await assertFolderOnline(folder);
  return { folder, fsx, rel };
}

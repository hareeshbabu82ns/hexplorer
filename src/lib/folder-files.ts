import { collections, toObjectId } from "./db";
import { assertFolderOnline, safeJoin } from "./scanner";

/** resolve folderId + relative path to an absolute path, mounting the folder if needed */
export async function resolveFolderFile(folderId: string, relPath: string) {
  const { folders } = await collections();
  const folder = await folders.findOne({ _id: toObjectId(folderId) });
  if (!folder) throw new Error("Folder not found");
  await assertFolderOnline(folder);
  return { folder, abs: safeJoin(folder.path, relPath) };
}

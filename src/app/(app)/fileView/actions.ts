"use server";

import { readFile, stat } from "fs/promises";
import { resolveFolderFile } from "@/lib/folder-files";

const MAX_TEXT = 5 * 1024 * 1024;

export async function getFileData(folderId: string, filePath: string) {
  const { abs } = await resolveFolderFile(folderId, filePath);
  const st = await stat(abs);
  if (st.size > MAX_TEXT) throw new Error("File too large to preview");
  const fileContents = await readFile(abs, "utf8");
  const top = filePath.split("/")[0];
  // markdown exports reference "../assets/x.png" relative to the top folder
  const data = fileContents.replace(
    /(\.\.\/assets\/)/g,
    `/api/assets/${folderId}/${encodeURIComponent(top)}/assets/`,
  );
  return { data };
}

"use server";

import { resolveFolderFile } from "@/lib/folder-files";

const MAX_TEXT = 5 * 1024 * 1024;

export async function getFileData(folderId: string, filePath: string) {
  const { fsx, rel } = await resolveFolderFile(folderId, filePath);
  const st = await fsx.stat(rel);
  if (!st || st.isDirectory) throw new Error("File not found");
  if (st.size > MAX_TEXT) throw new Error("File too large to preview");
  const chunks: Buffer[] = [];
  for await (const c of fsx.read(rel)) chunks.push(c as Buffer);
  const fileContents = Buffer.concat(chunks).toString("utf8");
  const top = filePath.split("/")[0];
  // markdown exports reference "../assets/x.png" relative to the top folder
  const data = fileContents.replace(
    /(\.\.\/assets\/)/g,
    `/api/assets/${folderId}/${encodeURIComponent(top)}/assets/`,
  );
  return { data };
}

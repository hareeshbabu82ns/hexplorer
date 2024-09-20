"use server";

import config from "@/config/config";
import { readFile } from "fs/promises";
import path from "path";

export async function getFileData(filePath: string) {
  const parsedPath = decodeURIComponent(filePath);
  const fullPath = path.join(config.dataFolder, parsedPath);
  const pathSplits = parsedPath.split("/");

  const fileContents = await readFile(fullPath, "utf8");

  // // find regex for image links
  // const imageRegex = /!\[.*\]\(..\/assets\/(.*)\)/g;
  // // replace image links with url encoding
  // const finalContentsWithImage = fileContents.replace(
  //   imageRegex,
  //   (match, p1) => {
  //     return match.replace(
  //       p1,
  //       `/api/assets/${encodeURIComponent(pathSplits[0])}/assets/` +
  //         encodeURIComponent(p1),
  //     );
  //   },
  // );

  const finalContents = fileContents.replace(
    /(..\/assets\/)/g,
    `/api/assets/${encodeURIComponent(pathSplits[0])}/assets/`,
  );

  return {
    data: finalContents,
  };
}

"use server";

import config from "@/config/config";
import path from "path";
import { readFilesInDirectory } from "../file-utils";

export const searchFiles = async (
  params: FetchFilesParams
): Promise<ExploreFilePageData | undefined> => {
  try {
    const basePath = path.join(config.dataFolder, params.path);
    // console.log({ params, basePath });
    const files = await readFilesInDirectory(basePath);
    // console.log({ files });

    return {
      docs:
        files?.map((file) => ({
          name: file.name,
          path: path.join(params.path, file.name),
          size: file.size,
          type: file.isDirectory ? "directory" : file.ext,
          lastUpdate: file.lastModified.toISOString(),
        })) || [],
      pageCount: params.page,
      docCount: files?.length || 0,
    };
  } catch (error: any) {
    console.error("An error occurred reading files:", error);
  }
};

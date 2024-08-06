"use server";

import config from "@/config/config";
import path from "path";
import { readFilesInDirectory } from "../file-utils";
import { databases, FILES_COLL_ID, HEXPLORER_DB_ID } from "../appwrite.config";
import { ID, Query } from "node-appwrite";
import { CreateDbFileParams, DbFile } from "@/types/appwrite.files.types";

interface SyncFilesParams {
  path: string;
  recursive?: boolean;
}
export const syncFiles = async ({
  path: inPath,
  recursive = false,
}: SyncFilesParams) => {
  const basePath = path.join(config.dataFolder, inPath);
  console.log("processing files at: ", { basePath });
  try {
    const files = await readFilesInDirectory(basePath);
    if (!files) throw new Error(`no files at path ${basePath}`);

    // delete old file entries
    const oldFiles = await databases.listDocuments(
      HEXPLORER_DB_ID!,
      FILES_COLL_ID!,
      [Query.equal("path", basePath)],
    );
    for (const file of oldFiles.documents) {
      await databases.deleteDocument(
        HEXPLORER_DB_ID!,
        FILES_COLL_ID!,
        file.$id,
      );
    }

    // create new file entries
    for (const file of files) {
      const dbFile: CreateDbFileParams = {
        name: file.name,
        path: basePath,
        isDirectory: file.isDirectory,
        birthDate: file.createdDate,
        modifiedDate: file.lastModified,
        size: file.size,
      };
      await databases.createDocument(
        HEXPLORER_DB_ID!,
        FILES_COLL_ID!,
        ID.unique(),
        dbFile,
      );
    }

    console.log("finished processing files at: ", {
      basePath,
      cound: files.length,
    });

    if (recursive) {
      for (const file of files) {
        if (file.isDirectory) {
          await syncFiles({ path: path.join(inPath, file.name), recursive });
        }
      }
    }
  } catch (error: any) {
    console.error("An error occurred reading files:", error);
    throw new Error("Failed to sync files");
  }
};

export const searchFiles = async (
  params: FetchFilesParams,
): Promise<ExploreFilePageData | undefined> => {
  try {
    console.log("searching files at: ", { params });
    const basePath = path.join(config.dataFolder, params.path);
    // delete old file entries
    const files = await databases.listDocuments(
      HEXPLORER_DB_ID!,
      FILES_COLL_ID!,
      [
        params.sortOrder === "asc"
          ? Query.orderAsc(params.sortBy || "name")
          : Query.orderDesc(params.sortBy || "name"),
        params.search
          ? Query.and([
              Query.contains("name", params.search),
              Query.startsWith("path", basePath),
            ])
          : Query.equal("path", basePath),
      ],
    );

    return {
      docs:
        files.documents.map((file) => {
          console.log(file.path);
          const filePath =
            file.path === "data" ? "" : file.path?.replace(/^data\//, "");
          return {
            name: file.name,
            path: path.join(filePath, file.name),
            size: file.size,
            type: file.isDirectory
              ? "directory"
              : path.extname(file.name).split(".").pop() || "",
            modifiedDate: file.modifiedDate,
          };
        }) || [],
      pageCount: params.page,
      docCount: files.documents.length || 0,
    };
  } catch (error: any) {
    console.error("An error occurred reading files:", error);
  }
};

// export const searchFiles = async (
//   params: FetchFilesParams,
// ): Promise<ExploreFilePageData | undefined> => {
//   try {
//     const basePath = path.join(config.dataFolder, params.path);
//     // console.log({ params, basePath });
//     const files = await readFilesInDirectory(basePath);
//     // console.log({ files });

//     return {
//       docs:
//         files?.map((file) => ({
//           name: file.name,
//           path: path.join(params.path, file.name),
//           size: file.size,
//           type: file.isDirectory ? "directory" : file.ext,
//           modifiedDate: file.lastModified.toISOString(),
//         })) || [],
//       pageCount: params.page,
//       docCount: files?.length || 0,
//     };
//   } catch (error: any) {
//     console.error("An error occurred reading files:", error);
//   }
// };

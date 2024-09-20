"use server";

import config from "@/config/config";
import path from "path";
import { readFilesInDirectory } from "../file-utils";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

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
    await db.dbFile.deleteMany({ where: { path: { equals: basePath } } });
    // const oldFiles = await databases.listDocuments(
    //   HEXPLORER_DB_ID!,
    //   FILES_COLL_ID!,
    //   [Query.equal("path", basePath)],
    // );
    // for (const file of oldFiles.documents) {
    //   await databases.deleteDocument(
    //     HEXPLORER_DB_ID!,
    //     FILES_COLL_ID!,
    //     file.$id,
    //   );
    // }

    // create new file entries
    const dbFiles: Prisma.DbFileCreateInput[] = [];
    for (const file of files) {
      const dbFile: Prisma.DbFileCreateInput = {
        name: file.name,
        path: basePath,
        isDirectory: file.isDirectory,
        birthDate: file.createdDate,
        modifiedDate: file.lastModified,
        size: file.size,
      };
      dbFiles.push(dbFile);
      // await databases.createDocument(
      //   HEXPLORER_DB_ID!,
      //   FILES_COLL_ID!,
      //   ID.unique(),
      //   dbFile,
      // );
    }
    if (dbFiles.length > 0) await db.dbFile.createMany({ data: dbFiles });

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
    // console.log("searching files at: ", { params });
    const basePath = path.join(config.dataFolder, params.path);
    const queryOrderyBy: any[] = [];
    if (params.sortOrder === "asc") {
      queryOrderyBy.push({ name: "asc" });
    } else {
      queryOrderyBy.push({ name: "desc" });
    }
    const queryWhere: any = {};
    if (params.search) {
      queryWhere["AND"] = [
        { name: { contains: params.search, mode: "insensitive" } },
        { path: { startsWith: basePath } },
      ];
    } else {
      queryWhere["path"] = { equals: basePath };
    }
    // fetch file entries from db
    const files = await db.dbFile.findMany({
      where: queryWhere,
      orderBy: queryOrderyBy,
    });
    // const files = await databases.listDocuments(
    //   HEXPLORER_DB_ID!,
    //   FILES_COLL_ID!,
    //   [
    //     params.sortOrder === "asc"
    //       ? Query.orderAsc(params.sortBy || "name")
    //       : Query.orderDesc(params.sortBy || "name"),
    //     params.search
    //       ? Query.and([
    //           Query.contains("name", params.search),
    //           Query.startsWith("path", basePath),
    //         ])
    //       : Query.equal("path", basePath),
    //   ],
    // );
    return {
      // docs: [],
      docs:
        files.map((file: any) => {
          // console.log(file.path);
          const filePath =
            file.path === config.dataFolder
              ? ""
              : file.path.startsWith(config.dataFolder)
                ? file.path.replace(config.dataFolder, "")
                : file.path;
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
      docCount: files.length || 0,
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

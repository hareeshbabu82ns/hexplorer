"use server";

import config from "@/config/config";
import path from "path";
import fs from "fs/promises";
import { readFilesInDirectory } from "../file-utils";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import {
  C_EXPLORER_DOMAIN,
  C_EXPLORER_IGNORE_FILE_PATTERNS,
} from "../constants";

interface SyncFilesParams {
  path: string;
  recursive?: boolean;
}

export const deleteDuplicateFiles = async ({
  filePath,
}: {
  filePath: string;
}) => {
  const duplicates = await fetchDuplicateFiles({ filePath });
  if (!duplicates) return;
  if (duplicates.length === 0) return;
  const basePath = path.join(config.dataFolder, filePath);

  // loop through duplicates, check if file and fileNext has same name and size and delete file
  for (let idx = 0; idx < duplicates.length-1; idx++) {
    const file = duplicates[idx];
    const fileNext = duplicates[idx + 1];
    if (file.name.substring(6) === fileNext.name.substring(6) && file.size === fileNext.size) {
      const filePath = path.join(basePath, file.path, file.name);
      // await db.dbFile.deleteMany({ where: { path: { equals: filePath } } });
      console.log("deleting file: ",idx, filePath);
      // delete file from path
      await fs.unlink(filePath);
    }
  }
};

export const fetchDuplicateFiles = async ({
  filePath,
}: {
  filePath: string;
}) => {
  const basePath = path.join(config.dataFolder, filePath);
  const files = await db.dbFile.findMany({
    where: { path: { startsWith: basePath }, isDirectory: false },
    select: { name: true, size: true, path: true },
    orderBy: { size: "asc" },
  });

  // const files = await db.dbFile.groupBy({
  //   by: ["name", "size"],
  //   having: { size: { gt: 1 } },
  //   orderBy: { _count: { size: "desc" } },
  //   take: 100,
  // });
  // return files;
  // remove not duplicate entries from files array comparing name and size attributes
  const finalFiles: { name: string; path: string; size: number }[] = [];
  files.forEach((file, idx) => {
    const prevFile = idx === 0 ? { name: "", size: 0 } : files[idx - 1];
    const nextFile =
      idx === files.length - 1 ? { name: "", size: 0 } : files[idx + 1];
    if (
      file.name === prevFile.name ||
      file.size === prevFile.size ||
      file.name === nextFile.name ||
      file.size === nextFile.size
    ) {
      finalFiles.push({
        ...file,
        path: file.path.replace(basePath, ""),
      } as any);
    }
  });
  return finalFiles;
};

export const syncFiles = async ({
  path: inPath,
  recursive = false,
}: SyncFilesParams) => {
  const basePath = path.join(config.dataFolder, inPath);
  console.log("processing files at: ", { basePath });
  try {
    const filesIgnorePatterns = await db.settings.findFirst({
      where: {
        domain: C_EXPLORER_DOMAIN,
        key: C_EXPLORER_IGNORE_FILE_PATTERNS,
      },
    });

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
      if (isFileIgnored(file.name, filesIgnorePatterns?.value)) continue;

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

const isFileIgnored = (
  fileName: string,
  ignorePatterns?: string,
  // isDirectory?: Boolean = false,
) => {
  if (!ignorePatterns) return false;
  const patterns = ignorePatterns.split(",");
  return patterns.some((pattern) => fileName.match(new RegExp(pattern)));
};

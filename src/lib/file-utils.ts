"use server";

import fs from "fs/promises";
// import fsSync from "fs";
import path from "path";
import crypto from "crypto";

interface FileAttributes {
  name: string;
  ext: string;
  path: string;
  isDirectory: boolean;
  lastModified: Date;
  createdDate: Date;
  size: number;
  hash?: string;
  files?: FileAttributes[];
}

async function getFileAttributes(
  filePath: string,
): Promise<FileAttributes | undefined> {
  const stats = await fs.stat(filePath);

  const lastModified = stats.mtime;
  const createdDate = stats.birthtime;
  const size = stats.size;
  // const hash = stats.isDirectory() ? "" : await getFileHash(filePath);
  return {
    name: path.basename(filePath),
    path: path.dirname(filePath),
    ext: path.extname(filePath).split(".").pop() || "",
    isDirectory: stats.isDirectory(),
    size,
    createdDate,
    lastModified,
    // hash,
  };
}

async function getFileHash(filePath: string): Promise<string | undefined> {
  // return new Promise((resolve, reject) => {
  //   const stats = fsSync.statSync(filePath);
  //   const hash = crypto.createHash("md5");
  //   const input = fsSync.createReadStream(filePath);
  //   console.log({ filePath, stats });

  //   input.on("data", (chunk) => {
  //     hash.update(chunk);
  //   });

  //   input.on("end", () => {
  //     const hexHash = hash.digest("hex");
  //     console.log({ filePath, hash: hexHash });
  //     resolve(hexHash);
  //   });

  //   input.on("error", (err) => {
  //     console.error("An error occurred reading file:", err);
  //     reject(err);
  //   });
  // });
  const fileData = await fs.readFile(filePath);
  const hash = crypto.createHash("md5").update(fileData).digest("hex");
  // console.log({ filePath, hash });
  return hash;
}

async function readFilesInDirectory(
  directoryPath: string,
  includeSubdirectories: boolean = false,
): Promise<FileAttributes[] | undefined> {
  const files: FileAttributes[] = [];

  const readDirectory = async (dirPath: string) => {
    const fileNames = await fs.readdir(dirPath);

    for (const fileName of fileNames) {
      const filePath = path.join(dirPath, fileName);
      const stats = await fs.stat(filePath);

      // if (stats.isDirectory() && includeSubdirectories) {
      //   await readDirectory(filePath);
      if (stats.isDirectory()) {
        // await readDirectory(filePath);
        const fileAttributes = await getFileAttributes(filePath);
        if (fileAttributes) files.push(fileAttributes);
      } else if (stats.isFile()) {
        const fileAttributes = await getFileAttributes(filePath);
        if (fileAttributes) files.push(fileAttributes);
      }
    }
  };

  await readDirectory(directoryPath);

  return files;
}

async function createFile(filePath: string) {
  await fs.writeFile(filePath, "");
}

async function moveFile(sourcePath: string, destinationPath: string) {
  await fs.rename(sourcePath, destinationPath);
}

async function deleteFile(filePath: string) {
  await fs.unlink(filePath);
}

export {
  getFileAttributes,
  readFilesInDirectory,
  createFile,
  moveFile,
  deleteFile,
};

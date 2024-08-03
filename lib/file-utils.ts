import fs from "fs";
import path from "path";
import crypto from "crypto";

interface FileAttributes {
  lastModified: Date;
  createdDate: Date;
  size: number;
  hash: string;
}

function getFileAttributes(filePath: string): FileAttributes {
  const stats = fs.statSync(filePath);
  const lastModified = stats.mtime;
  const createdDate = stats.birthtime;
  const size = stats.size;
  const hash = getFileHash(filePath);

  return {
    lastModified,
    createdDate,
    size,
    hash,
  };
}

function getFileHash(filePath: string): string {
  const fileData = fs.readFileSync(filePath);
  const hash = crypto.createHash("md5").update(fileData).digest("hex");
  return hash;
}

function readFilesInDirectory(
  directoryPath: string,
  includeSubdirectories: boolean = false
): string[] {
  let files: string[] = [];

  const readDirectory = (dirPath: string) => {
    const fileNames = fs.readdirSync(dirPath);

    fileNames.forEach((fileName) => {
      const filePath = path.join(dirPath, fileName);
      const stats = fs.statSync(filePath);

      if (stats.isDirectory() && includeSubdirectories) {
        readDirectory(filePath);
      } else if (stats.isFile()) {
        files.push(filePath);
      }
    });
  };

  readDirectory(directoryPath);

  return files;
}

function createFile(filePath: string): void {
  fs.writeFileSync(filePath, "");
}

function moveFile(sourcePath: string, destinationPath: string): void {
  fs.renameSync(sourcePath, destinationPath);
}

function deleteFile(filePath: string): void {
  fs.unlinkSync(filePath);
}

export {
  getFileAttributes,
  readFilesInDirectory,
  createFile,
  moveFile,
  deleteFile,
};

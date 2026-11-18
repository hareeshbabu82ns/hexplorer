"use client";

import Link from "next/link";
import SelectIcon from "@/components/Icons";
import { checkFileType } from "@/lib/utils";

export function fileViewHref(f: ExploreFile) {
  return f.isDirectory
    ? `/files?folder=${f.folderId}&dir=${encodeURIComponent(f.relPath)}`
    : `/fileView/${f.folderId}/${f.relPath.split("/").map(encodeURIComponent).join("/")}`;
}

export function FileNameCell({ file }: { file: ExploreFile }) {
  return (
    <Link href={fileViewHref(file)} prefetch={false} className="group flex items-center gap-1">
      <SelectIcon type={file.isDirectory ? "directory" : checkFileType(file.name)} />
      <span className="truncate text-sm group-hover:underline" title={file.name}>
        {file.name}
      </span>
    </Link>
  );
}

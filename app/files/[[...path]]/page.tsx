"use client";

import SelectIcon from "@/components/Icons";
import { SortProps, TableCard } from "@/components/TableCard";
import { searchFiles } from "@/lib/actions/files";
import {
  checkFileType,
  formatAgo,
  formatSize,
  joinHttpPaths,
} from "@/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";
import path from "path";
import React, { useEffect, useState } from "react";

type Props = {};

export default function FilePage({}: Props) {
  const [filter, setFilter] = useState<string[]>([]); // unused for now
  const [search, setSearch] = useState<string>("");
  const [sort, setSort] = useState<SortProps | undefined>();
  const [page, setPage] = useState<number>(1);

  // Files
  const [files, setFiles] = useState<ExploreFilePageData | null>();
  const [filesLoading, setFilesLoading] = useState(true);
  const [filesError, setFilesError] = useState();

  const pathname = usePathname().replace(/^\/files/, "");

  const fileHeaders = [
    {
      label: "Name",
      display: (file: ExploreFile) => (
        <Link
          href={
            file.type === "directory"
              ? `/files/${file.path}`
              : `/fileView/${file.path}`
          }
        >
          <div className="flex flex-row gap-2 items-center group">
            <SelectIcon
              type={
                file.type === "directory"
                  ? "directory"
                  : checkFileType(file.type)
              }
            />
            <div className="truncate">
              <p className="text-xs md:text-base group-hover:animate-slide">
                {file.name}
              </p>
            </div>
          </div>
        </Link>
      ),
      sortKey: "name",
    },
    {
      label: "Size",
      display: (file: ExploreFile) => (
        <p className="text-xs md:text-base">
          {file.type === "directory" ? "-" : formatSize(file.size)}
        </p>
      ),
      sortKey: "size",
    },
    {
      label: "Type",
      display: (file: ExploreFile) => (
        <p className="text-xs md:text-base">{file.type}</p>
      ),
      sortKey: "type",
    },
    {
      label: "Last Updated",
      display: (file: ExploreFile) => (
        <p className="text-xs md:text-base">
          {formatAgo(new Date(file.lastUpdate), "en")}
        </p>
      ),
      sortKey: "lastUpdate",
    },
  ];

  const formatFilter = (filter: string[] | undefined) => {
    if (filter && filter.length > 0) {
      return "&tag=" + filter.map((tag) => tag).join(",");
    } else {
      return "";
    }
  };

  const fetchFiles = async () => {
    // setFilesLoading(true);
    setFilesError(undefined);

    let sortString = "";
    if (sort) {
      sortString = `&sortBy=${sort?.key}&sortOrder=${sort?.order}`;
    }

    let searchString = "";
    if (search) {
      searchString = `&search=${search}`;
    }

    const filterString = formatFilter(filter);

    try {
      // const response = await fetch(
      //   `${process.env.NEXT_PUBLIC_API_URL}/files?page=${page}&path=${pathname}${searchString}${sortString}${filterString}`
      //   // {
      //   //   credentials: "include",
      //   // }
      // );

      // if (!response.ok) {
      //   throw new Error(
      //     `Failed to fetch Files\nCode : ${response.status} ${response.statusText}`
      //   );
      // }

      // const data = await response.json();
      const data = await searchFiles({
        search,
        page,
        path: pathname,
        sortBy: sort?.key,
        sortOrder: sort?.order,
        filter: filterString,
      });
      setFiles(data);
    } catch (err: any) {
      console.error("Error fetching Files:", err);
      setFilesError(err.message);
    } finally {
      setFilesLoading(false);
    }
  };

  useEffect(() => {
    fetchFiles();
  }, [sort, page, search, filter]);

  const noData = (
    <div className="flex flex-row gap-2 mt-4">
      <div className="flex flex-col gap-2 px-2">
        <p>Pas de fichiers</p>
      </div>
    </div>
  );

  return (
    <div>
      <TableCard
        data={files}
        loading={filesLoading}
        headers={fileHeaders}
        inputPlaceholder="Search..."
        sort={sort}
        setSort={setSort}
        page={page}
        setPage={setPage}
        search={search}
        setSearch={setSearch}
        noData={noData}
        parentPath={path.join("/files", pathname, "..")}
      />
    </div>
  );
}

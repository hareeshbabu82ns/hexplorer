"use client";

import SelectIcon from "@/components/Icons";
import { SortProps, TableCard } from "@/components/TableCard";
import useDebounceCallback from "@/hooks/use-debounce-callback";
import { searchFiles } from "@/lib/actions/files";
import { checkFileType, formatAgo, formatSize } from "@/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";
import path from "path";
import React, { useEffect, useState } from "react";

type Props = {};

export default function FilePage({}: Props) {
  const [filter, setFilter] = useState<string[]>([]); // unused for now
  const [search, setSearch] = useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");
  const [sort, setSort] = useState<SortProps | undefined>();
  const [page, setPage] = useState<number>(1);

  const debouncedSearchFn = useDebounceCallback(setDebouncedSearch, {
    delay: 1000,
  });

  // Files
  const [files, setFiles] = useState<ExploreFilePageData | null>();
  const [filesLoading, setFilesLoading] = useState(true);
  const [filesError, setFilesError] = useState();

  const pathname = decodeURI(usePathname().replace(/^\/files/, ""));

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
          <div className="group flex flex-row items-center gap-2">
            <SelectIcon
              type={
                file.type === "directory"
                  ? "directory"
                  : checkFileType(file.type)
              }
            />
            <div className="truncate">
              <p className="group-hover:animate-slide text-xs md:text-base">
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
          {formatAgo(new Date(file.modifiedDate), "en")}
        </p>
      ),
      sortKey: "modifiedDate",
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
    const filterString = formatFilter(filter);
    try {
      const data = await searchFiles({
        search,
        page,
        path: pathname,
        sortBy: sort?.key,
        sortOrder: sort?.order,
        filter: filterString,
      });
      // console.log("Files:", data);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, page, debouncedSearch, filter]);

  const noData = (
    <div className="mt-4 flex flex-row gap-2">
      <div className="flex flex-col gap-2 px-2">
        <p>No Files</p>
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
        setSearch={(s: string) => {
          setSearch(s);
          debouncedSearchFn(s);
        }}
        noData={noData}
        parentPath={path.join("/files", pathname, "..")}
      />
    </div>
  );
}

"use client";

import { ReactNode } from "react";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Search, ArrowUp, ArrowDown } from "lucide-react";
import Link from "next/link";
import { Input } from "./ui/input";

type Props = {
  data: Data | undefined | null;
  loading: boolean;
  inputPlaceholder: string;
  headers: any;
  search: string;
  setSearch: Function;
  page: number;
  setPage: Function;
  sort: SortProps | undefined;
  setSort: Function;
  noData: ReactNode;
  parentPath: string;
};

type Data = {
  docs: any[];
  pageCount: number;
  docCount: number;
};

export type SortProps = {
  key: string;
  order: "asc" | "desc";
};

export type Header = {
  label: string;
  display: Function;
  sortKey: string;
};

export function TableCard({
  data,
  loading,
  search,
  setSearch,
  page,
  setPage,
  sort,
  setSort,
  inputPlaceholder,
  headers,
  noData,
  parentPath,
}: Props) {
  function PaginationItems({
    totalPages,
    offset,
  }: {
    totalPages: number;
    offset: number;
  }) {
    const maxPaginationItems = 10;
    let x = Math.min(totalPages, maxPaginationItems);
    let y = offset;
    if (y > totalPages - x) y = totalPages - x + 1;

    if (x === maxPaginationItems && y == offset) x = maxPaginationItems - 1;

    const repetitions = new Array(x - y).fill(null);

    return (
      <>
        {offset > 0 && (
          <>
            <PaginationItem className="cursor-pointer">
              <PaginationLink onClick={() => setPage(1)} isActive={page === 1}>
                {1}
              </PaginationLink>
            </PaginationItem>
            {offset > 1 && <p>...</p>}
          </>
        )}
        {repetitions.map((_, id) => (
          <PaginationItem className="cursor-pointer" key={id}>
            <PaginationLink
              onClick={() => setPage(y + id + 1)}
              isActive={page === y + id + 1}
            >
              {y + id + 1}
            </PaginationLink>
          </PaginationItem>
        ))}
        {totalPages > x + y && y == offset && (
          <>
            <p>...</p>
            <PaginationItem className="cursor-pointer">
              <PaginationLink
                onClick={() => setPage(totalPages)}
                isActive={page === totalPages}
              >
                {totalPages}
              </PaginationLink>
            </PaginationItem>
          </>
        )}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="border-input flex h-10 w-full min-w-0 flex-row items-center rounded-md border px-4 text-sm disabled:cursor-not-allowed disabled:opacity-50">
        <Search className="text-muted-foreground size-4 shrink-0" />
        <input
          className="placeholder:text-muted-foreground ring-offset-background h-10 w-full bg-transparent px-3 py-2 focus-visible:outline-none focus-visible:ring-0"
          placeholder={inputPlaceholder}
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Table>
        <TableHeader>
          <TableRow className="min-w-0 rounded-sm hover:bg-transparent">
            {headers &&
              headers.map((header: Header, id: number) => (
                <TableHead
                  key={id}
                  onClick={() => {
                    if (header.sortKey) {
                      if (sort?.key === header.sortKey)
                        if (sort?.order === "asc") {
                          setSort({
                            key: header.sortKey || "",
                            order: "desc",
                          });
                        } else {
                          setSort(undefined);
                        }
                      else
                        setSort({
                          key: header.sortKey || "",
                          order: "asc",
                        });
                    }
                  }}
                  className="hover:bg-muted/60 min-w-0 cursor-pointer truncate p-1 text-xs md:p-4 lg:text-sm"
                >
                  <div className="flex flex-row items-center gap-2">
                    <p>{header.label}</p>
                    <div className="w-4">
                      {sort &&
                        sort.key === header.sortKey &&
                        (sort?.order === "asc" ? (
                          <ArrowDown className="size-4" />
                        ) : (
                          <ArrowUp className="size-4" />
                        ))}
                    </div>
                  </div>
                </TableHead>
              ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow className="h-[50px]">
            <TableCell className="relative max-w-[600px] overflow-hidden truncate px-0.5 md:px-2">
              {parentPath.startsWith("/files") ? (
                <Link href={parentPath}>
                  <div className="flex flex-row items-center gap-2">
                    <p>☝️</p>
                    <div className="truncate">
                      <p className="text-primary text-xs md:text-base">
                        Parent Directory
                      </p>
                    </div>
                  </div>
                </Link>
              ) : null}
            </TableCell>
            {[...Array(headers.length - 1)].map((_, cellId) => (
              <TableCell key={cellId} className="p-1 md:p-4">
                -
              </TableCell>
            ))}
          </TableRow>
          {loading &&
            [...Array(10)].map((_, index) => (
              <TableRow key={index} className="h-[50px]">
                {[...Array(headers.length)].map((_, cellId) => (
                  <TableCell key={cellId} className="p-1 md:p-4">
                    <Skeleton className="h-[20px] w-full min-w-5 rounded-sm" />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          {!loading &&
            data &&
            data.docs.map((row, rowId) => (
              <TableRow key={rowId} className="group">
                {headers.map((_: any, cellId: number) => (
                  <TableCell
                    className="relative overflow-hidden truncate px-1 md:px-2 lg:max-w-[600px]"
                    key={cellId}
                  >
                    {headers[cellId].display && headers[cellId].display(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
        </TableBody>
      </Table>

      {!loading && data && data.docCount === 0 && (
        <div className="my-6 flex w-full items-center justify-center">
          {noData}
        </div>
      )}

      {data && data?.pageCount > 1 && (
        <Pagination>
          <PaginationContent>
            <PaginationItem
              className="cursor-pointer"
              onClick={() => setPage(Math.max(1, page - 1))}
            >
              <PaginationPrevious />
            </PaginationItem>
            <PaginationItems
              offset={Math.max(page - 5, 0)}
              totalPages={data?.pageCount}
            />
            <PaginationItem
              className="cursor-pointer"
              onClick={() => setPage(Math.min(data?.pageCount || 1, page + 1))}
            >
              <PaginationNext />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
}

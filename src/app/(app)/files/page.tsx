"use client";

import { FolderSearch } from "lucide-react";
import { Page, PageHeader } from "@/components/app/page";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Archive, Fingerprint, MoreHorizontal, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BackupDialog, BackupSource } from "@/components/explorer/backup-dialog";
import { startHashing, startScan } from "@/lib/actions/folders";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DeleteConfirm } from "@/components/explorer/delete-confirm";
import { FileNameCell } from "@/components/explorer/file-name-cell";
import { FolderSelect } from "@/components/explorer/folder-select";
import { useFolders } from "@/components/explorer/use-folders";
import useDebounceCallback from "@/hooks/use-debounce-callback";
import { searchFiles } from "@/lib/actions/files";
import { formatSize } from "@/lib/utils";

const COLUMNS: { key: FileSortKey; label: string; className?: string }[] = [
  { key: "name", label: "Name" },
  { key: "size", label: "Size", className: "w-24 text-right" },
  { key: "ext", label: "Type", className: "hidden w-20 lg:table-cell" },
  { key: "modifiedDate", label: "Modified", className: "w-44" },
  { key: "birthDate", label: "Created", className: "hidden w-44 xl:table-cell" },
];

const fmtDate = (s?: string) => (s ? new Date(s).toLocaleString() : "-");

function FilesExplorer() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const folderId = sp.get("folder") || undefined;
  const dir = sp.get("dir") || "";
  const q = sp.get("q") || "";
  const sortBy = (sp.get("sort") as FileSortKey) || "name";
  const sortOrder = sp.get("order") === "desc" ? "desc" : "asc";
  const page = Number(sp.get("page") || 1);
  const recursive = sp.get("recursive") !== "0";
  const pageSize = 100;

  const setParams = (patch: Record<string, string | undefined>, resetPage = true) => {
    const next = new URLSearchParams(sp.toString());
    if (resetPage) next.delete("page");
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === "") next.delete(k);
      else next.set(k, v);
    }
    router.push(`${pathname}?${next.toString()}`);
  };

  const [searchInput, setSearchInput] = useState(q);
  const [prevQ, setPrevQ] = useState(q);
  if (q !== prevQ) {
    setPrevQ(q);
    setSearchInput(q);
  }
  const debouncedSearch = useDebounceCallback((v: string) => setParams({ q: v }), {
    delay: 400,
  });

  const { data: folders } = useFolders();
  const folder = folders?.find((f) => f.id === folderId);
  const folderBusy = folder?.status === "scanning" || folder?.status === "hashing";
  const qc = useQueryClient();
  const [backupSource, setBackupSource] = useState<BackupSource>(null);

  // refresh the listing when a scan of this folder finishes
  const prevStatus = useRef(folder?.status);
  useEffect(() => {
    if (prevStatus.current === "scanning" && folder?.status !== "scanning")
      qc.invalidateQueries({ queryKey: ["files"] });
    prevStatus.current = folder?.status;
  }, [folder?.status, qc]);

  const jobErr = (e: any) => toast.error(e.message ?? String(e));
  const scan = useMutation({
    mutationFn: ({ fid, d }: { fid: string; d: string }) => startScan(fid, d),
    onSuccess: (_, v) => {
      toast.info(`Scanning ${v.d || "whole folder"}…`);
      qc.invalidateQueries({ queryKey: ["folders"] });
    },
    onError: jobErr,
  });
  const hash = useMutation({
    mutationFn: ({ fid, d }: { fid: string; d: string }) => startHashing(fid, d),
    onSuccess: (_, v) => {
      toast.info(`Hashing duplicate candidates in ${v.d || "whole folder"}…`);
      qc.invalidateQueries({ queryKey: ["folders"] });
    },
    onError: jobErr,
  });

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ["files", { folderId, dir, q, sortBy, sortOrder, page, recursive }],
    queryFn: () =>
      searchFiles({ folderId, dir, search: q, sortBy, sortOrder, page, pageSize, recursive }),
    placeholderData: keepPreviousData,
  });

  const [selected, setSelected] = useState<Record<string, ExploreFile>>({});
  // clear the selection whenever the listing changes
  const listingKey = JSON.stringify([folderId, dir, q, page, sortBy, sortOrder]);
  const [prevListingKey, setPrevListingKey] = useState(listingKey);
  if (listingKey !== prevListingKey) {
    setPrevListingKey(listingKey);
    setSelected({});
  }
  const selectedList = useMemo(() => Object.values(selected), [selected]);
  const docs = data?.docs ?? [];
  const allChecked = docs.length > 0 && docs.every((d) => selected[d.id]);

  const toggle = (f: ExploreFile, on: boolean) =>
    setSelected((s) => {
      const n = { ...s };
      if (on) n[f.id] = f;
      else delete n[f.id];
      return n;
    });

  const segments = dir ? dir.split("/") : [];
  const browsing = !q;
  const crossFolder = !folderId;

  return (
    <Page className="space-y-6">
      <PageHeader icon={FolderSearch} title="Files" description="Browse folders and search every indexed file. Sort, filter, view and act on files in place." />
      <div className="flex flex-wrap items-center gap-3">
        <FolderSelect
          value={folderId}
          onChange={(v) => setParams({ folder: v, dir: undefined })}
        />
        <Input
          type="search"
          className="w-72"
          placeholder={folder ? `Search in ${folder.name}…` : "Search all folders…"}
          value={searchInput}
          onChange={(e) => {
            setSearchInput(e.target.value);
            debouncedSearch(e.target.value);
          }}
        />
        {q && (
          <div className="flex items-center gap-2">
            <Switch
              id="rec"
              checked={recursive}
              onCheckedChange={(v) => setParams({ recursive: v ? undefined : "0" })}
            />
            <Label htmlFor="rec">Include subfolders</Label>
          </div>
        )}
        <span className="grow" />
        {folderId && (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={folderBusy || scan.isPending}
              onClick={() => scan.mutate({ fid: folderId, d: dir })}
              title="Rescan this folder level and everything below it"
            >
              <RefreshCw className="mr-1 size-4" /> Scan {dir ? "here" : "all"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={folderBusy || hash.isPending}
              onClick={() => hash.mutate({ fid: folderId, d: dir })}
              title="Content-hash same-size files below this level (for exact duplicate detection)"
            >
              <Fingerprint className="mr-1 size-4" /> Hash {dir ? "here" : "all"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setBackupSource({ folderId, dir })}>
              <Archive className="mr-1 size-4" /> Back up {dir ? "this folder" : "all"}
            </Button>
          </>
        )}
        <DeleteConfirm
          items={selectedList}
          onDone={() => setSelected({})}
          trigger={
            <Button variant="destructive" size="sm" disabled={!selectedList.length}>
              <Trash2 className="mr-1 size-4" /> Delete selected ({selectedList.length})
            </Button>
          }
        />
      </div>

      {folderId && (
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href={`/files?folder=${folderId}`}>{folder?.name ?? "Root"}</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            {segments.map((seg, i) => (
              <span key={i} className="contents">
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbLink asChild>
                    <Link
                      href={`/files?folder=${folderId}&dir=${encodeURIComponent(
                        segments.slice(0, i + 1).join("/"),
                      )}`}
                    >
                      {seg}
                    </Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
              </span>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
      )}

      {!folderId && browsing && (
        <p className="text-muted-foreground text-sm">
          Pick a folder to browse, or type to search across every indexed folder.
        </p>
      )}

      {error && <p className="text-destructive">Error: {(error as Error).message}</p>}

      {(folderId || q) && (
        <>
          <div className="text-muted-foreground flex items-center gap-2 text-xs">
            {data ? `${data.total.toLocaleString()} item(s)` : ""}
            {isFetching && <span>· loading…</span>}
            {folderBusy && (
              <span>
                · {folder!.statusMessage ?? folder!.status} ({folder!.progress ?? 0})…
              </span>
            )}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <Checkbox
                    checked={allChecked}
                    onCheckedChange={(v) =>
                      setSelected((s) => {
                        const n = { ...s };
                        docs.forEach((d) => (v ? (n[d.id] = d) : delete n[d.id]));
                        return n;
                      })
                    }
                  />
                </TableHead>
                {COLUMNS.map((c) => (
                  <TableHead
                    key={c.key}
                    className={`hover:bg-muted/60 cursor-pointer select-none ${c.className ?? ""}`}
                    onClick={() =>
                      setParams({
                        sort: c.key,
                        order: sortBy === c.key && sortOrder === "asc" ? "desc" : "asc",
                      })
                    }
                  >
                    <span className="inline-flex items-center gap-1">
                      {c.label}
                      {sortBy === c.key &&
                        (sortOrder === "asc" ? (
                          <ArrowUp className="size-3" />
                        ) : (
                          <ArrowDown className="size-3" />
                        ))}
                    </span>
                  </TableHead>
                ))}
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {browsing && dir && (
                <TableRow>
                  <TableCell />
                  <TableCell colSpan={6}>
                    <Link
                      className="text-primary text-sm hover:underline"
                      href={`/files?folder=${folderId}&dir=${encodeURIComponent(
                        segments.slice(0, -1).join("/"),
                      )}`}
                    >
                      ↑ Parent directory
                    </Link>
                  </TableCell>
                </TableRow>
              )}
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={7}>Loading…</TableCell>
                </TableRow>
              )}
              {!isLoading && docs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground">
                    {folder && !folder.lastScanAt
                      ? "This folder has not been scanned yet."
                      : "No files."}
                  </TableCell>
                </TableRow>
              )}
              {docs.map((f) => (
                <TableRow key={f.id} data-state={selected[f.id] ? "selected" : undefined}>
                  <TableCell>
                    <Checkbox
                      checked={!!selected[f.id]}
                      onCheckedChange={(v) => toggle(f, !!v)}
                    />
                  </TableCell>
                  <TableCell className="max-w-[480px]">
                    <FileNameCell file={f} />
                    {(!browsing || crossFolder) && (
                      <div className="text-muted-foreground truncate pl-9 font-mono text-xs">
                        {crossFolder && f.folderName ? `${f.folderName}: ` : ""}
                        {f.dir || "/"}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {f.isDirectory ? "-" : formatSize(f.size, 1)}
                  </TableCell>
                  <TableCell className="hidden text-sm lg:table-cell">{f.isDirectory ? "dir" : f.ext}</TableCell>
                  <TableCell className="text-sm">{fmtDate(f.modifiedDate)}</TableCell>
                  <TableCell className="hidden text-sm xl:table-cell">{fmtDate(f.birthDate)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {f.isDirectory && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-8" title="Folder actions">
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            disabled={!!folders?.find((x) => x.id === f.folderId && x.status !== "idle" && x.status !== "error")}
                            onSelect={() => scan.mutate({ fid: f.folderId, d: f.relPath })}
                          >
                            <RefreshCw className="mr-2 size-4" /> Scan this folder
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={!!folders?.find((x) => x.id === f.folderId && x.status !== "idle" && x.status !== "error")}
                            onSelect={() => hash.mutate({ fid: f.folderId, d: f.relPath })}
                          >
                            <Fingerprint className="mr-2 size-4" /> Hash duplicate candidates
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onSelect={() => setBackupSource({ folderId: f.folderId, dir: f.relPath })}
                          >
                            <Archive className="mr-2 size-4" /> Back up…
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                    <DeleteConfirm
                      items={[f]}
                      trigger={
                        <Button variant="ghost" size="icon" className="size-8" title="Delete">
                          <Trash2 className="text-destructive size-4" />
                        </Button>
                      }
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {data && data.pageCount > 1 && (
            <div className="flex items-center justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setParams({ page: String(page - 1) }, false)}
              >
                Previous
              </Button>
              <span className="text-sm">
                Page {page} / {data.pageCount}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= data.pageCount}
                onClick={() => setParams({ page: String(page + 1) }, false)}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
      <BackupDialog source={backupSource} onClose={() => setBackupSource(null)} />
    </Page>
  );
}

export default function FilesPage() {
  return (
    <Suspense fallback={<div className="p-6">Loading…</div>}>
      <FilesExplorer />
    </Suspense>
  );
}

"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DeleteConfirm } from "@/components/explorer/delete-confirm";
import { FileNameCell } from "@/components/explorer/file-name-cell";
import { FolderSelect } from "@/components/explorer/folder-select";
import { useFolders } from "@/components/explorer/use-folders";
import { findDuplicates } from "@/lib/actions/files";
import { startHashing } from "@/lib/actions/folders";
import { formatSize } from "@/lib/utils";

const MODES: { value: DuplicateMode; label: string; hint: string }[] = [
  { value: "name-size", label: "Same name + size", hint: "Fast, from the index" },
  {
    value: "similar-name-size",
    label: "Similar name + size",
    hint: 'Ignores "(1)", "- Copy", "Copy of", separators and case',
  },
  { value: "name", label: "Same name (any size)", hint: "Versions of the same file" },
  {
    value: "content",
    label: "Identical content (hash)",
    hint: "Exact; needs 'Hash candidates' run on the folder (disk access)",
  },
];

type KeepRule = "oldest" | "newest" | "shortest";

function DuplicatesExplorer() {
  const sp = useSearchParams();
  const qc = useQueryClient();
  const [folderId, setFolderId] = useState<string | undefined>(
    sp.get("folder") || undefined,
  );
  const [mode, setMode] = useState<DuplicateMode>("name-size");
  const [minSizeKb, setMinSizeKb] = useState("0");
  const [dir, setDir] = useState("");
  const [selected, setSelected] = useState<Record<string, ExploreFile>>({});
  const { data: folders } = useFolders();

  const params = {
    folderIds: folderId ? [folderId] : undefined,
    mode,
    dir,
    minSize: Math.max(1, Math.round(Number(minSizeKb || 0) * 1024)),
  };
  const { data, isFetching, error } = useQuery({
    queryKey: ["duplicates", params],
    queryFn: () => findDuplicates(params),
  });

  const hashing = useMutation({
    mutationFn: async () => {
      const ids = folderId ? [folderId] : (folders ?? []).map((f) => f.id);
      for (const id of ids) await startHashing(id);
    },
    onSuccess: () => {
      toast.info("Hashing started — progress is shown on the Folders page");
      qc.invalidateQueries({ queryKey: ["folders"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const selectedList = useMemo(() => Object.values(selected), [selected]);
  const selectedBytes = selectedList.reduce((a, f) => a + f.size, 0);

  const toggle = (f: ExploreFile, on: boolean) =>
    setSelected((s) => {
      const n = { ...s };
      if (on) n[f.id] = f;
      else delete n[f.id];
      return n;
    });

  /** select every file in each group except the one to keep */
  const autoSelect = (rule: KeepRule) => {
    const n: Record<string, ExploreFile> = {};
    data?.groups.forEach((g) => {
      const sorted = [...g.files].sort((a, b) => {
        if (rule === "shortest")
          return a.relPath.length - b.relPath.length || a.modifiedDate.localeCompare(b.modifiedDate);
        const d = a.modifiedDate.localeCompare(b.modifiedDate);
        return rule === "oldest" ? d : -d;
      });
      sorted.slice(1).forEach((f) => (n[f.id] = f));
    });
    setSelected(n);
  };

  const busyFolders = folders?.filter((f) => f.status === "hashing");

  return (
    <div className="space-y-4 p-4 pb-16 md:px-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1">
          <Label className="text-xs">Folder</Label>
          <FolderSelect value={folderId} onChange={(v) => (setFolderId(v), setSelected({}))} />
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">Match by</Label>
          <Select value={mode} onValueChange={(v) => (setMode(v as DuplicateMode), setSelected({}))}>
            <SelectTrigger className="w-60">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODES.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">Within sub path</Label>
          <Input
            className="w-48"
            placeholder="e.g. Movies/2020"
            value={dir}
            onChange={(e) => setDir(e.target.value)}
            disabled={!folderId}
          />
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">Min size (KB)</Label>
          <Input
            className="w-28"
            type="number"
            min={0}
            value={minSizeKb}
            onChange={(e) => setMinSizeKb(e.target.value)}
          />
        </div>
      </div>
      <p className="text-muted-foreground text-xs">{MODES.find((m) => m.value === mode)?.hint}</p>

      {mode === "content" && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm">
          <span>
            {data?.unhashedCandidates
              ? `${data.unhashedCandidates.toLocaleString()} same-size files are not hashed yet.`
              : "All same-size candidates are hashed."}
          </span>
          {!!busyFolders?.length && (
            <Badge>Hashing: {busyFolders.map((f) => `${f.name} (${f.progress ?? 0})`).join(", ")}</Badge>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={hashing.isPending || !!busyFolders?.length || !data?.unhashedCandidates}
            onClick={() => hashing.mutate()}
          >
            Hash candidates
          </Button>
        </div>
      )}

      <div className="bg-background/95 sticky top-16 z-10 flex flex-wrap items-center gap-2 border-b py-2 backdrop-blur">
        <span className="text-sm">
          {data
            ? `${data.totalGroups.toLocaleString()} groups · ${formatSize(data.totalWasted, 1)} reclaimable`
            : ""}
          {data && data.groups.length < data.totalGroups && ` (showing top ${data.groups.length})`}
          {isFetching && " · loading…"}
        </span>
        <span className="grow" />
        <span className="text-muted-foreground text-xs">Auto-select all but:</span>
        <Button size="sm" variant="outline" onClick={() => autoSelect("oldest")}>
          Keep oldest
        </Button>
        <Button size="sm" variant="outline" onClick={() => autoSelect("newest")}>
          Keep newest
        </Button>
        <Button size="sm" variant="outline" onClick={() => autoSelect("shortest")}>
          Keep shortest path
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setSelected({})}>
          Clear
        </Button>
        <DeleteConfirm
          items={selectedList}
          onDone={() => setSelected({})}
          trigger={
            <Button size="sm" variant="destructive" disabled={!selectedList.length}>
              <Trash2 className="mr-1 size-4" />
              Delete {selectedList.length} ({formatSize(selectedBytes, 1)})
            </Button>
          }
        />
      </div>

      {error && <p className="text-destructive">Error: {(error as Error).message}</p>}
      {data && data.groups.length === 0 && !isFetching && (
        <p className="text-muted-foreground">No duplicates found.</p>
      )}

      <div className="space-y-3">
        {data?.groups.map((g) => {
          const allSel = g.files.every((f) => selected[f.id]);
          return (
            <div key={g.key} className="rounded-md border">
              <div className="bg-muted/50 flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
                <span className="truncate font-mono" title={g.key}>
                  {g.key.length > 80 ? g.key.slice(0, 80) + "…" : g.key}
                </span>
                <Badge variant="secondary">{g.count} copies</Badge>
                <Badge variant="outline">{formatSize(g.size, 1)} each</Badge>
                <span className="text-muted-foreground">
                  {formatSize(g.wasted, 1)} reclaimable
                </span>
                {allSel && (
                  <Badge variant="destructive">All copies selected!</Badge>
                )}
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {g.files.map((f) => (
                    <tr key={f.id} className="border-t">
                      <td className="w-8 px-3 py-1.5">
                        <Checkbox
                          checked={!!selected[f.id]}
                          onCheckedChange={(v) => toggle(f, !!v)}
                        />
                      </td>
                      <td className="max-w-0 py-1.5">
                        <FileNameCell file={f} />
                        <div className="text-muted-foreground truncate pl-9 font-mono text-xs">
                          {f.folderName}: {f.dir || "/"}
                        </div>
                      </td>
                      <td className="w-24 text-right">{formatSize(f.size, 1)}</td>
                      <td className="text-muted-foreground w-48 px-2 text-xs">
                        modified {new Date(f.modifiedDate).toLocaleString()}
                      </td>
                      <td className="w-10">
                        <DeleteConfirm
                          items={[f]}
                          onDone={() => toggle(f, false)}
                          trigger={
                            <Button variant="ghost" size="icon" className="size-8" title="Delete">
                              <Trash2 className="text-destructive size-4" />
                            </Button>
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function DuplicatesPage() {
  return (
    <Suspense fallback={<div className="p-6">Loading…</div>}>
      <DuplicatesExplorer />
    </Suspense>
  );
}

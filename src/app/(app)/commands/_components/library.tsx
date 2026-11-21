"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  BookPlus,
  Download,
  FileCode2,
  Library,
  MoreHorizontal,
  Play,
  Search,
  Sparkles,
  Star,
  Trash2,
  Upload,
} from "lucide-react";

import {
  deleteCmdScript,
  importCmdScripts,
  importCmdSnippet,
  listCmdScripts,
  setCmdScriptFavorite,
  type CmdScript,
} from "@/lib/actions/commands";
import { SNIPPETS, type Snippet } from "@/lib/commands/snippets";
import { EmptyState, ErrorBanner, SectionTitle } from "@/components/app/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { download, fmtAgo, newId, unwrap, type ConsoleSeed } from "./shared";

const exportable = (s: CmdScript) => ({
  name: s.name,
  description: s.description,
  tags: s.tags,
  params: s.params,
  steps: s.steps.map(({ id: _id, ...rest }) => rest),
});

export function ScriptLibrary({ onOpen }: { onOpen: (seed: ConsoleSeed) => void }) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const { data: scripts, error, isLoading } = useQuery({
    queryKey: ["cmd-scripts"],
    queryFn: () => unwrap(listCmdScripts()),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["cmd-scripts"] });

  const fav = useMutation({
    mutationFn: (s: CmdScript) => unwrap(setCmdScriptFavorite(s.id, !s.favorite)),
    onSuccess: refresh,
  });
  const del = useMutation({
    mutationFn: (s: CmdScript) => unwrap(deleteCmdScript(s.id)),
    onSuccess: () => (toast.success("Script deleted"), refresh()),
    onError: (e: any) => toast.error(e.message),
  });
  const addSnippet = useMutation({
    mutationFn: (key: string) => unwrap(importCmdSnippet(key)),
    onSuccess: (s) => (toast.success(`“${s.name}” added to your library`), refresh()),
    onError: (e: any) => toast.error(e.message),
  });
  const doImport = useMutation({
    mutationFn: () => unwrap(importCmdScripts(importText)),
    onSuccess: (n) => {
      toast.success(`Imported ${n} script(s)`);
      setImportOpen(false);
      setImportText("");
      refresh();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const tags = useMemo(() => [...new Set((scripts ?? []).flatMap((s) => s.tags))].sort(), [scripts]);
  const shown = (scripts ?? []).filter(
    (s) =>
      (!tag || s.tags.includes(tag)) &&
      (!q ||
        `${s.name} ${s.description} ${s.tags.join(" ")} ${s.steps.map((x) => x.command).join(" ")}`
          .toLowerCase()
          .includes(q.toLowerCase())),
  );

  const open = (s: CmdScript) =>
    onOpen({
      key: `${s.id}-${newId()}`,
      scriptId: s.id,
      name: s.name,
      description: s.description,
      tags: s.tags,
      params: s.params,
      steps: s.steps,
      targets: s.defaultTargets,
    });
  const openSnippet = (s: Snippet) =>
    onOpen({
      key: `snip-${s.key}-${newId()}`,
      name: s.name,
      description: s.description,
      tags: [s.category.toLowerCase()],
      params: s.params,
      steps: s.steps.map((st) => ({ ...st, id: newId() })),
    });

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <SectionTitle
          title="Saved scripts"
          description="Re-run with new parameters and targets, or open to edit."
          actions={
            <>
              <Button size="sm" variant="ghost" onClick={() => setImportOpen(true)}>
                <Upload className="size-4" /> Import
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={!scripts?.length}
                onClick={() =>
                  download(
                    "hexplorer-scripts.json",
                    JSON.stringify((scripts ?? []).map(exportable), null, 2),
                    "application/json",
                  )
                }
              >
                <Download className="size-4" /> Export all
              </Button>
            </>
          }
        />
        {error && <ErrorBanner>{(error as Error).message}</ErrorBanner>}
        {(scripts?.length ?? 0) > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-64">
              <Search className="text-muted-foreground absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search scripts…" className="h-9 pl-8" />
            </div>
            {tags.map((t) => (
              <Button key={t} size="xs" variant={tag === t ? "soft" : "ghost"} onClick={() => setTag(tag === t ? null : t)}>
                #{t}
              </Button>
            ))}
          </div>
        )}
        {!isLoading && !scripts?.length ? (
          <EmptyState
            icon={Library}
            title="No saved scripts yet"
            description="Build one in the Console and press Save, or add a starter script from the gallery below."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((s) => (
              <article key={s.id} className="surface group flex flex-col p-4">
                <div className="flex items-start gap-2">
                  <FileCode2 className="text-primary mt-0.5 size-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-semibold">{s.name}</h3>
                    {s.description && (
                      <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">{s.description}</p>
                    )}
                  </div>
                  <button
                    onClick={() => fav.mutate(s)}
                    className={cn(
                      "rounded p-0.5",
                      s.favorite ? "text-warning" : "text-muted-foreground/40 hover:text-warning",
                    )}
                    title="Favorite"
                  >
                    <Star className={cn("size-4", s.favorite && "fill-current")} />
                  </button>
                </div>
                <pre className="bg-muted/40 text-muted-foreground mt-3 line-clamp-3 overflow-hidden rounded-md px-2 py-1.5 font-mono text-[11px] leading-4">
                  {s.steps.map((x) => x.command.split("\n")[0]).join("\n")}
                </pre>
                <div className="mt-3 flex flex-wrap gap-1">
                  <Badge variant="secondary">
                    {s.steps.length} step{s.steps.length > 1 ? "s" : ""}
                  </Badge>
                  {s.params.length > 0 && <Badge variant="secondary">{s.params.length} params</Badge>}
                  {s.defaultTargets.length > 0 && <Badge variant="outline">{s.defaultTargets.length} targets</Badge>}
                  {s.tags.map((t) => (
                    <Badge key={t} variant="outline">
                      #{t}
                    </Badge>
                  ))}
                </div>
                <div className="mt-auto flex items-center gap-1 pt-4">
                  <Button size="xs" onClick={() => open(s)}>
                    <Play /> Open & run
                  </Button>
                  <span className="text-muted-foreground ml-2 text-[11px]">
                    {s.runCount ? `${s.runCount} runs · ${s.lastRunAt ? fmtAgo(s.lastRunAt) : ""}` : "never run"}
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon-sm" variant="ghost" className="ml-auto size-7">
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() =>
                          download(
                            `${s.name.replace(/[^\w-]+/g, "_")}.json`,
                            JSON.stringify(exportable(s), null, 2),
                            "application/json",
                          )
                        }
                      >
                        <Download /> Export JSON
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => confirm(`Delete “${s.name}”?`) && del.mutate(s)}
                      >
                        <Trash2 /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <SectionTitle
          title={
            <span className="flex items-center gap-2">
              <Sparkles className="text-primary size-4" /> Starter scripts
            </span>
          }
          description="Common self-hosting maintenance tasks. Open to try one, or add it to your library to customise."
        />
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {SNIPPETS.map((s) => (
            <div key={s.key} className="hover:bg-accent/40 flex items-start gap-3 rounded-lg border p-3 transition-colors">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{s.name}</span>
                  <Badge variant="outline">{s.category}</Badge>
                </div>
                <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">{s.description}</p>
              </div>
              <div className="flex shrink-0 gap-0.5">
                <Button size="icon-sm" variant="ghost" title="Open in console" onClick={() => openSnippet(s)}>
                  <Play className="size-4" />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  title="Add to library"
                  disabled={addSnippet.isPending}
                  onClick={() => addSnippet.mutate(s.key)}
                >
                  <BookPlus className="size-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import scripts</DialogTitle>
            <DialogDescription>Paste JSON exported from HExplorer, or choose a .json file.</DialogDescription>
          </DialogHeader>
          <Input
            type="file"
            accept="application/json,.json"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) setImportText(await f.text());
            }}
          />
          <Textarea
            rows={10}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            className="font-mono text-xs"
            placeholder='[{"name": "…", "steps": [{"command": "uptime"}]}]'
          />
          <DialogFooter>
            <Button disabled={!importText.trim() || doImport.isPending} onClick={() => doImport.mutate()}>
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

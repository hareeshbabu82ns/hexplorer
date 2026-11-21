"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Copy, LayoutGrid, Loader2, Pencil, Plus, Search, Table2, Trash2 } from "lucide-react";
import { DangerDialog } from "@/components/db-admin/danger-dialog";
import { JsonTextarea, jsonError } from "@/components/db-admin/json-textarea";
import { useRunAction } from "@/components/db-admin/use-run-action";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  deleteDocument,
  deleteMatching,
  findDocuments,
  insertDocuments,
  replaceDocument,
} from "@/lib/actions/db-admin/documents";
import { formatNumber } from "@/lib/db-admin/format";
import type { FindResult } from "@/lib/db-admin/types";
import { cn } from "@/lib/utils";

const PAGE_SIZES = [20, 50, 100];

interface Query {
  filter: string;
  sort: string;
  projection: string;
}

type Parsed = { raw: string; doc: Record<string, unknown>; idJson: string };

function parseDocs(docs: string[]): Parsed[] {
  return docs.map((raw) => {
    const doc = JSON.parse(raw) as Record<string, unknown>;
    return { raw, doc, idJson: JSON.stringify(doc._id ?? null) };
  });
}

const pretty = (v: unknown) => JSON.stringify(v, null, 2);

function cellPreview(v: unknown): string {
  if (v === undefined) return "";
  if (v === null) return "null";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length === 1 && keys[0].startsWith("$")) {
      const inner = o[keys[0]];
      return typeof inner === "object" ? JSON.stringify(inner) : String(inner);
    }
    const s = JSON.stringify(v);
    return s.length > 80 ? s.slice(0, 77) + "…" : s;
  }
  return String(v);
}

export function DocumentsBrowser({
  connectionId,
  database,
  collection,
  initial,
  readOnly,
}: {
  connectionId: string;
  database: string;
  collection: string;
  initial: FindResult;
  readOnly: boolean;
}) {
  const [draft, setDraft] = useState<Query>({ filter: "", sort: "", projection: "" });
  const [query, setQuery] = useState<Query>(draft);
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(0);
  const [result, setResult] = useState(initial);
  const [view, setView] = useState<"cards" | "table">("cards");
  const [editor, setEditor] = useState<{ mode: "insert" | "edit"; text: string; idJson?: string } | null>(null);
  const { busy, run } = useRunAction();

  const docs = useMemo(() => parseDocs(result.documents), [result]);
  const columns = useMemo(() => {
    const set = new Set<string>();
    docs.forEach((d) => Object.keys(d.doc).forEach((k) => set.add(k)));
    return [...set];
  }, [docs]);

  const load = async (q: Query = query, p = page, size = pageSize) => {
    const r = await run(() =>
      findDocuments(connectionId, database, collection, { ...q, skip: p * size, limit: size }),
    );
    if (r) {
      setResult(r);
      setQuery(q);
      setPage(p);
      setPageSize(size);
    }
    return r;
  };

  const actionsFor = (d: Parsed) => ({
    onEdit: () => setEditor({ mode: "edit", text: pretty(d.doc), idJson: d.idJson }),
    onDuplicate: () => {
      const { _id: _drop, ...rest } = d.doc;
      setEditor({ mode: "insert", text: pretty(rest) });
    },
    onDelete: async () => {
      const r = await run(() => deleteDocument(connectionId, database, collection, d.idJson), "Document deleted");
      if (r) await load();
      return !!r;
    },
  });

  const errors = {
    filter: jsonError(draft.filter, { allowEmpty: true, allowHex: true }),
    sort: jsonError(draft.sort, { allowEmpty: true }),
    projection: jsonError(draft.projection, { allowEmpty: true }),
  };
  const pages = Math.max(1, Math.ceil(result.total / pageSize));
  const hasFilter = !!query.filter.trim() && query.filter.trim() !== "{}";

  return (
    <div className="space-y-3">
      <form
        className="grid gap-2 lg:grid-cols-[2fr_1fr_1fr_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          if (!errors.filter && !errors.sort && !errors.projection) load(draft, 0);
        }}
      >
        {(["filter", "sort", "projection"] as const).map((k) => (
          <div key={k} className="grid gap-1">
            <Input
              aria-label={k}
              value={draft[k]}
              onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
              placeholder={
                k === "filter" ? 'filter, e.g. {"status": "active"} or a 24-hex _id' : k === "sort" ? 'sort, e.g. {"_id": -1}' : 'projection, e.g. {"name": 1}'
              }
              className={cn("font-mono text-xs", errors[k] && "border-destructive")}
            />
            {errors[k] && <p className="text-destructive text-xs">{errors[k]}</p>}
          </div>
        ))}
        <Button type="submit" disabled={busy}>
          {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Search className="mr-2 size-4" />}
          Find
        </Button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-muted-foreground text-sm">
          {result.total === 0
            ? "No documents"
            : `${formatNumber(page * pageSize + 1)}–${formatNumber(page * pageSize + docs.length)} of ${result.estimated ? "~" : ""}${formatNumber(result.total)}`}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup type="single" size="sm" value={view} onValueChange={(v) => v && setView(v as "cards" | "table")}>
            <ToggleGroupItem value="cards" aria-label="JSON cards">
              <LayoutGrid className="size-4" />
            </ToggleGroupItem>
            <ToggleGroupItem value="table" aria-label="Table">
              <Table2 className="size-4" />
            </ToggleGroupItem>
          </ToggleGroup>
          <Select value={String(pageSize)} onValueChange={(v) => load(query, 0, Number(v))}>
            <SelectTrigger className="h-9 w-[90px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((s) => (
                <SelectItem key={s} value={String(s)}>
                  {s} / page
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="icon" variant="outline" aria-label="Previous page" disabled={busy || page === 0} onClick={() => load(query, page - 1)}>
            <ChevronLeft className="size-4" />
          </Button>
          <span className="text-sm tabular-nums">
            {page + 1} / {pages}
          </span>
          <Button size="icon" variant="outline" aria-label="Next page" disabled={busy || page + 1 >= pages} onClick={() => load(query, page + 1)}>
            <ChevronRight className="size-4" />
          </Button>
          {!readOnly && (
            <>
              <Button size="sm" onClick={() => setEditor({ mode: "insert", text: "{\n  \n}" })}>
                <Plus className="mr-1 size-4" /> Insert
              </Button>
              <DangerDialog
                trigger={
                  <Button size="sm" variant="outline" className="text-destructive" disabled={!hasFilter}>
                    <Trash2 className="mr-1 size-4" /> Delete matching
                  </Button>
                }
                title={`Delete every document matching the filter?`}
                description={
                  <div className="space-y-2">
                    <p>
                      {formatNumber(result.total)} document(s) in <span className="font-mono">{collection}</span> match:
                    </p>
                    <pre className="bg-muted overflow-x-auto rounded p-2 font-mono text-xs">{query.filter}</pre>
                  </div>
                }
                confirmWord={collection}
                confirmLabel="Delete documents"
                onConfirm={async () => {
                  const r = await run(
                    () => deleteMatching(connectionId, database, collection, query.filter, collection),
                    (d) => `Deleted ${formatNumber(d.deletedCount)} document(s)`,
                  );
                  if (r) await load(query, 0);
                  return !!r;
                }}
              />
            </>
          )}
        </div>
      </div>

      {view === "cards" ? (
        <div className="grid gap-3">
          {docs.map((d, i) => (
            <div key={`${d.idJson}-${i}`} className="group relative rounded-md border">
              <pre className="max-h-96 overflow-auto p-3 font-mono text-xs leading-relaxed">{pretty(d.doc)}</pre>
              {!readOnly && <DocActions d={d} {...actionsFor(d)} />}
            </div>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((c) => (
                  <TableHead key={c} className="whitespace-nowrap font-mono text-xs">
                    {c}
                  </TableHead>
                ))}
                {!readOnly && <TableHead className="w-0" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {docs.map((d, i) => (
                <TableRow key={`${d.idJson}-${i}`}>
                  {columns.map((c) => (
                    <TableCell key={c} className="max-w-72 truncate font-mono text-xs" title={c in d.doc ? JSON.stringify(d.doc[c]) : ""}>
                      {cellPreview(d.doc[c])}
                    </TableCell>
                  ))}
                  {!readOnly && (
                    <TableCell className="relative">
                      <DocActions d={d} inline {...actionsFor(d)} />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {editor && (
        <DocumentEditor
          mode={editor.mode}
          initialText={editor.text}
          onClose={() => setEditor(null)}
          onSave={async (text) => {
            const r =
              editor.mode === "insert"
                ? await run(
                    () => insertDocuments(connectionId, database, collection, text),
                    (d) => `Inserted ${d.insertedCount} document(s)`,
                  )
                : await run(() => replaceDocument(connectionId, database, collection, editor.idJson!, text), "Document saved");
            if (r) {
              setEditor(null);
              await load();
            }
          }}
        />
      )}
    </div>
  );
}

function DocActions({
  d,
  inline,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  d: Parsed;
  inline?: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => Promise<boolean>;
}) {
  return (
    <div className={cn("flex gap-1", !inline && "bg-background/90 absolute right-2 top-2 rounded-md opacity-100 md:opacity-0 md:group-hover:opacity-100")}>
      <Button size="icon" variant="ghost" className="size-8" aria-label="Edit" onClick={onEdit}>
        <Pencil className="size-4" />
      </Button>
      <Button size="icon" variant="ghost" className="size-8" aria-label="Duplicate" onClick={onDuplicate}>
        <Copy className="size-4" />
      </Button>
      <DangerDialog
        trigger={
          <Button size="icon" variant="ghost" className="text-destructive size-8" aria-label="Delete">
            <Trash2 className="size-4" />
          </Button>
        }
        title="Delete this document?"
        description={<pre className="bg-muted max-h-40 overflow-auto rounded p-2 font-mono text-xs">_id: {d.idJson}</pre>}
        onConfirm={onDelete}
      />
    </div>
  );
}

function DocumentEditor({
  mode,
  initialText,
  onClose,
  onSave,
}: {
  mode: "insert" | "edit";
  initialText: string;
  onClose: () => void;
  onSave: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState(initialText);
  const [saving, setSaving] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="max-h-[95dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{mode === "insert" ? "Insert documents" : "Edit document"}</DialogTitle>
          <DialogDescription>
            Extended JSON: {'{"$oid": …}'}, {'{"$date": …}'}, {'{"$numberLong": "…"}'}, {'{"$numberDecimal": "…"}'} keep their BSON types.
            {mode === "insert" ? " Paste one object or an array of objects." : " _id cannot be changed."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label className="sr-only">Document JSON</Label>
          <JsonTextarea value={text} onChange={setText} rows={20} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            disabled={saving || !!jsonError(text)}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave(text);
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
            {mode === "insert" ? "Insert" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

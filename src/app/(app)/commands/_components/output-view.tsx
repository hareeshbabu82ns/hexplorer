"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Copy,
  Download,
  Filter,
  Highlighter,
  Rows3,
  Table2,
  Text,
  WandSparkles,
  WrapText,
} from "lucide-react";

import type { Chunk } from "@/lib/commands/runner";
import {
  looksLikeHeader,
  parseTable,
  splitLines,
  type PickDelimiter,
  type PickRule,
} from "@/lib/commands/template";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { allTextOf, download, stdoutOf } from "./shared";

const MAX_RENDER = 5000;

const DELIMS: { value: PickDelimiter; label: string }[] = [
  { value: "whitespace", label: "Whitespace" },
  { value: "spaces2", label: "2+ spaces / tab" },
  { value: "tab", label: "Tab" },
  { value: "comma", label: "Comma" },
  { value: "colon", label: "Colon" },
  { value: "pipe", label: "Pipe |" },
];

interface Line {
  kind: Chunk[0];
  text: string;
}

function toLines(chunks: Chunk[]): Line[] {
  const out: Line[] = [];
  let cur: Line | null = null;
  for (const [kind, text] of chunks) {
    const parts = text.split("\n");
    parts.forEach((p, i) => {
      if (!cur) cur = { kind, text: "" };
      cur.text += p;
      if (i < parts.length - 1) {
        out.push(cur);
        cur = null;
      }
    });
  }
  if (cur && (cur as Line).text) out.push(cur);
  return out;
}

function makeMatcher(filter: string): ((s: string) => boolean) | null {
  const f = filter.trim();
  if (!f) return null;
  const m = f.match(/^\/(.+)\/([a-z]*)$/);
  if (m) {
    try {
      const re = new RegExp(m[1], m[2].includes("i") ? m[2] : m[2] + "i");
      return (s) => re.test(s);
    } catch {
      return null;
    }
  }
  const lower = f.toLowerCase();
  return (s) => s.toLowerCase().includes(lower);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function OutputView({
  chunks,
  selection,
  onSelection,
  onMakePick,
  live,
  filename = "output.txt",
  className,
}: {
  chunks: Chunk[];
  selection?: string[];
  onSelection?: (values: string[]) => void;
  /** turn the current visual selection into an automatic pick rule for unattended re-runs */
  onMakePick?: (rule: PickRule) => void;
  live?: boolean;
  filename?: string;
  className?: string;
}) {
  const selectable = !!onSelection;
  const sel = useMemo(() => selection ?? [], [selection]);
  const selSet = useMemo(() => new Set(sel), [sel]);
  const stdout = useMemo(() => stdoutOf(chunks), [chunks]);
  const autoHeader = useMemo(() => looksLikeHeader(stdout), [stdout]);

  const [mode, setMode] = useState<"raw" | "table">("raw");
  const [delimChoice, setDelim] = useState<PickDelimiter | null>(null);
  // header lines like "CONTAINER ID   IMAGE" need 2+ space splitting
  const autoDelim: PickDelimiter = useMemo(() => {
    const first = splitLines(stdout).find((l) => l.trim()) ?? "";
    return autoHeader && /\S \S/.test(first.trim()) && /\S {2,}\S/.test(first) ? "spaces2" : "whitespace";
  }, [stdout, autoHeader]);
  const delim = delimChoice ?? autoDelim;
  const [header, setHeader] = useState<boolean | null>(null);
  const [filter, setFilter] = useState("");
  const [wrap, setWrap] = useState(false);
  const [lastCol, setLastCol] = useState<number>(0);
  const lastLine = useRef<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const useHeader = header ?? autoHeader;
  const matcher = useMemo(() => makeMatcher(filter), [filter]);

  const lines = useMemo(() => toLines(chunks), [chunks]);
  const shownLines = useMemo(
    () => lines.map((l, i) => ({ ...l, i })).filter((l) => !matcher || matcher(l.text)),
    [lines, matcher],
  );

  const table = useMemo(() => {
    const t = parseTable(stdout, delim, useHeader);
    const raw = splitLines(stdout).filter((l) => l.trim());
    const body = useHeader ? raw.slice(1) : raw;
    const rows = t.rows.map((cells, i) => ({ cells, line: (body[i] ?? "").trim() }));
    const shown = rows.filter((r) => !matcher || matcher(r.line));
    const width = Math.max(t.header?.length ?? 0, ...rows.map((r) => r.cells.length), 0);
    return { header: t.header, rows: shown, width, total: rows.length };
  }, [stdout, delim, useHeader, matcher]);

  // keep the newest output visible while a command streams
  useEffect(() => {
    if (!live || !scroller.current) return;
    const el = scroller.current;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) el.scrollTop = el.scrollHeight;
  }, [chunks, live]);

  const setSel = (values: string[]) => onSelection?.([...new Set(values.filter((v) => v !== ""))]);
  const toggleValue = (v: string) => setSel(selSet.has(v) ? sel.filter((x) => x !== v) : [...sel, v]);

  const clickLine = (idx: number, e: React.MouseEvent) => {
    if (!selectable) return;
    if (!window.getSelection()?.isCollapsed) return; // user is highlighting text
    const pos = shownLines.findIndex((l) => l.i === idx);
    if (e.shiftKey && lastLine.current != null) {
      const a = shownLines.findIndex((l) => l.i === lastLine.current);
      const [s, t] = a < pos ? [a, pos] : [pos, a];
      const vals = shownLines.slice(s, t + 1).map((l) => l.text.trim());
      setSel([...sel, ...vals]);
    } else toggleValue(lines[idx].text.trim());
    lastLine.current = idx;
  };

  const clickColumn = (c: number) => {
    setLastCol(c);
    const vals = table.rows.map((r) => r.cells[c]).filter((v): v is string => !!v);
    const allIn = vals.length > 0 && vals.every((v) => selSet.has(v));
    setSel(allIn ? sel.filter((x) => !vals.includes(x)) : [...sel, ...vals]);
  };

  const addHighlighted = () => {
    const text = window.getSelection()?.toString() ?? "";
    const vals = text
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!vals.length) return toast.info("Highlight some text in the output first");
    setSel([...sel, ...vals]);
  };

  const makePick = () => {
    const f = filter.trim();
    const regex = f ? (/^\/(.+)\/[a-z]*$/.test(f) ? f.replace(/^\/(.+)\/[a-z]*$/, "$1") : escapeRe(f)) : undefined;
    const rule: PickRule =
      mode === "table"
        ? { mode: "column", column: lastCol + 1, delimiter: delim, skipHeader: useHeader, match: regex }
        : { mode: "lines", match: regex };
    onMakePick?.(rule);
  };

  const text = allTextOf(chunks);
  const tooMany = (mode === "raw" ? shownLines.length : table.rows.length) > MAX_RENDER;

  return (
    <div className={cn("flex min-w-0 flex-col rounded-lg border", className)}>
      <div className="bg-muted/40 flex flex-wrap items-center gap-1.5 border-b px-2 py-1.5">
        <div className="bg-background flex rounded-md border p-0.5">
          <Button
            size="xs"
            variant={mode === "raw" ? "secondary" : "ghost"}
            className="h-6"
            onClick={() => setMode("raw")}
          >
            <Text /> Raw
          </Button>
          <Button
            size="xs"
            variant={mode === "table" ? "secondary" : "ghost"}
            className="h-6"
            onClick={() => setMode("table")}
          >
            <Table2 /> Table
          </Button>
        </div>
        {mode === "table" && (
          <>
            <Select value={delim} onValueChange={(v) => setDelim(v as PickDelimiter)}>
              <SelectTrigger className="h-7 w-[130px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DELIMS.map((d) => (
                  <SelectItem key={d.value} value={d.value} className="text-xs">
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="xs"
              variant={useHeader ? "soft" : "ghost"}
              onClick={() => setHeader(!useHeader)}
              title="First line is a header"
            >
              <Rows3 /> Header
            </Button>
          </>
        )}
        <div className="relative">
          <Filter className="text-muted-foreground absolute left-2 top-1/2 size-3.5 -translate-y-1/2" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="filter or /regex/"
            className="h-7 w-40 pl-7 font-mono text-xs"
          />
        </div>
        <div className="ml-auto flex items-center gap-0.5">
          {selectable && (
            <Button
              size="xs"
              variant="ghost"
              onMouseDown={(e) => e.preventDefault()}
              onClick={addHighlighted}
              title="Add highlighted text to the selection"
            >
              <Highlighter /> <span className="hidden sm:inline">Add highlight</span>
            </Button>
          )}
          {onMakePick && (
            <Button
              size="xs"
              variant="ghost"
              onClick={makePick}
              title={
                mode === "table"
                  ? `Auto-select column ${lastCol + 1}${filter ? " of matching rows" : ""} on future runs`
                  : `Auto-select ${filter ? "matching " : "all "}lines on future runs`
              }
            >
              <WandSparkles /> <span className="hidden sm:inline">Auto-pick</span>
            </Button>
          )}
          <Button
            size="icon-sm"
            variant="ghost"
            className={cn("size-7", wrap && "text-primary")}
            onClick={() => setWrap(!wrap)}
            title="Wrap lines"
          >
            <WrapText className="size-3.5" />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            className="size-7"
            title="Copy output"
            onClick={() => navigator.clipboard.writeText(text).then(() => toast.success("Copied"))}
          >
            <Copy className="size-3.5" />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            className="size-7"
            title="Download output"
            onClick={() => download(filename, text)}
          >
            <Download className="size-3.5" />
          </Button>
        </div>
      </div>

      <div
        ref={scroller}
        className="bg-background max-h-105 min-h-16 overflow-auto font-mono text-[12.5px] leading-5"
      >
        {mode === "raw" ? (
          <div className="py-1">
            {shownLines.slice(0, MAX_RENDER).map((l) => {
              const v = l.text.trim();
              const on = selectable && v !== "" && selSet.has(v);
              return (
                <div
                  key={l.i}
                  onClick={(e) => clickLine(l.i, e)}
                  className={cn(
                    "group flex",
                    selectable && v && "hover:bg-accent/60 cursor-pointer",
                    on && "bg-primary/15 hover:bg-primary/20",
                  )}
                >
                  <span className="text-muted-foreground/50 w-10 shrink-0 select-none pr-2 text-right text-[11px] tabular-nums">
                    {l.i + 1}
                  </span>
                  <span
                    className={cn(
                      "min-w-0 flex-1 pr-3",
                      wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre",
                      l.kind === "e" && "text-destructive",
                      l.kind === "i" && "text-info italic",
                    )}
                  >
                    {l.text || " "}
                  </span>
                </div>
              );
            })}
            {!lines.length && (
              <div className="text-muted-foreground text-xs italic p-3">
                {live ? "Waiting for output…" : "(no output)"}
              </div>
            )}
          </div>
        ) : (
          <table className="w-full border-collapse text-left">
            {table.width > 0 && (
              <thead className="bg-muted/60 sticky top-0 z-10">
                <tr>
                  {selectable && <th className="w-8" />}
                  {Array.from({ length: table.width }, (_, c) => (
                    <th
                      key={c}
                      onClick={() => selectable && clickColumn(c)}
                      className={cn(
                        "whitespace-nowrap border-b px-2 py-1 text-[11px] font-semibold",
                        selectable && "hover:text-primary cursor-pointer",
                        c === lastCol && selectable && "text-primary",
                      )}
                      title={selectable ? "Select this column" : undefined}
                    >
                      {table.header?.[c] ?? `col ${c + 1}`}
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {table.rows.slice(0, MAX_RENDER).map((r, i) => {
                const rowOn = selSet.has(r.line);
                return (
                  <tr key={i} className={cn("hover:bg-accent/40 border-b border-dashed last:border-0", rowOn && "bg-primary/10")}>
                    {selectable && (
                      <td className="px-2 align-top">
                        <input
                          type="checkbox"
                          className="accent-primary mt-1 size-3"
                          checked={rowOn}
                          onChange={() => toggleValue(r.line)}
                          title="Select whole line"
                        />
                      </td>
                    )}
                    {Array.from({ length: table.width }, (_, c) => {
                      const v = r.cells[c];
                      const on = v !== undefined && selSet.has(v);
                      return (
                        <td
                          key={c}
                          onClick={() => {
                            if (!selectable || v === undefined) return;
                            setLastCol(c);
                            toggleValue(v);
                          }}
                          className={cn(
                            "px-2 py-0.5 align-top",
                            wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre",
                            selectable && v !== undefined && "cursor-pointer hover:underline",
                            on && "bg-primary/20 text-primary font-semibold",
                          )}
                        >
                          {v ?? ""}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {!table.rows.length && (
                <tr>
                  <td className="text-muted-foreground text-xs italic p-3">(no stdout rows)</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
        {tooMany && (
          <div className="text-muted-foreground border-t px-3 py-2 text-xs">
            Showing first {MAX_RENDER} rows — use the filter or download the full output.
          </div>
        )}
      </div>
      {mode === "table" && matcher && (
        <div className="text-muted-foreground border-t px-2 py-1 text-[11px]">
          {table.rows.length} of {table.total} rows match
        </div>
      )}
    </div>
  );
}

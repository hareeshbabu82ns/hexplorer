"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CornerDownLeft, Search } from "lucide-react";

import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

import { NAV_ITEMS } from "./nav-items";

type Cmd = {
  id: string;
  label: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  run: () => void;
};

/** ⌘K / Ctrl+K: jump to a page or search all indexed files */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  const go = (href: string) => {
    onOpenChange(false);
    setQ("");
    router.push(href);
  };

  const items = useMemo<Cmd[]>(() => {
    const term = q.trim().toLowerCase();
    const nav = NAV_ITEMS.filter(
      (i) => !term || i.title.toLowerCase().includes(term) || i.description.toLowerCase().includes(term),
    ).map((i) => ({
      id: i.href,
      label: i.title,
      hint: i.description,
      icon: i.icon,
      run: () => go(i.href),
    }));
    const search: Cmd[] = term
      ? [
          {
            id: "search",
            label: `Search files for “${q.trim()}”`,
            hint: "All indexed folders",
            icon: Search,
            run: () => go(`/files?q=${encodeURIComponent(q.trim())}`),
          },
        ]
      : [];
    return [...search, ...nav];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const active = Math.min(index, Math.max(0, items.length - 1));

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) setQ("");
      }}
    >
      <DialogContent className="top-[18%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0 data-[state=open]:slide-in-from-top-[2%] [&>button:last-child]:hidden">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <div className="flex items-center gap-3 border-b px-4">
          <Search className="text-muted-foreground size-4" />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(i + 1, items.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                items[active]?.run();
              }
            }}
            placeholder="Search files or jump to…"
            className="placeholder:text-muted-foreground h-14 flex-1 bg-transparent text-[15px] outline-none"
          />
          <kbd className="text-muted-foreground rounded-md border px-1.5 py-0.5 font-mono text-[10px]">
            ESC
          </kbd>
        </div>
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-2">
          {items.length === 0 && (
            <p className="text-muted-foreground px-3 py-8 text-center text-sm">No matches</p>
          )}
          {items.map((c, i) => {
            const Icon = c.icon;
            return (
              <button
                key={c.id}
                onMouseMove={() => setIndex(i)}
                onClick={c.run}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm",
                  i === active ? "bg-accent text-accent-foreground" : "text-foreground/90",
                )}
              >
                <span
                  className={cn(
                    "flex size-8 items-center justify-center rounded-md border",
                    i === active ? "bg-card text-primary" : "bg-muted/50 text-muted-foreground",
                  )}
                >
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{c.label}</span>
                  <span className="text-muted-foreground block truncate text-xs">{c.hint}</span>
                </span>
                {i === active && <CornerDownLeft className="text-muted-foreground size-3.5" />}
              </button>
            );
          })}
        </div>
        <div className="text-muted-foreground bg-muted/40 flex items-center gap-4 border-t px-4 py-2 text-[11px]">
          <span>
            <kbd className="font-mono">↑↓</kbd> navigate
          </span>
          <span>
            <kbd className="font-mono">↵</kbd> open
          </span>
          <span className="ml-auto">
            <kbd className="font-mono">⌘K</kbd> toggle
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

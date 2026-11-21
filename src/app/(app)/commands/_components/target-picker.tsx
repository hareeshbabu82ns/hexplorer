"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, ChevronDown, Layers, Save, Server, Trash2, X } from "lucide-react";

import { deleteCmdGroup, saveCmdGroup, type CmdGroup, type CmdTarget } from "@/lib/actions/commands";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { unwrap } from "./shared";

export function TargetPicker({
  targets,
  groups,
  value,
  onChange,
  className,
}: {
  targets: CmdTarget[];
  groups: CmdGroup[];
  value: string[];
  onChange: (ids: string[]) => void;
  className?: string;
}) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [groupName, setGroupName] = useState("");
  const byId = useMemo(() => new Map(targets.map((t) => [t.id, t])), [targets]);
  const selected = value.filter((id) => byId.has(id));
  const filtered = targets.filter(
    (t) => !q || `${t.name} ${t.host} ${t.user ?? ""}`.toLowerCase().includes(q.toLowerCase()),
  );
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  const save = useMutation({
    mutationFn: () => unwrap(saveCmdGroup({ name: groupName, remoteIds: selected })),
    onSuccess: () => {
      toast.success(`Group “${groupName}” saved`);
      setGroupName("");
      qc.invalidateQueries({ queryKey: ["cmd-targets"] });
    },
    onError: (e: any) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: (id: string) => unwrap(deleteCmdGroup(id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cmd-targets"] }),
    onError: (e: any) => toast.error(e.message),
  });

  const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-1.5", className)}>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5">
            <Server className="size-4" />
            {selected.length ? `${selected.length} target${selected.length > 1 ? "s" : ""}` : "Pick targets"}
            <ChevronDown className="text-muted-foreground size-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-85 p-0">
          <div className="border-b p-2">
            <Input
              autoFocus
              placeholder="Filter servers…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-8"
            />
          </div>
          {groups.length > 0 && (
            <div className="border-b p-2">
              <div className="text-muted-foreground mb-1.5 px-1 text-[11px] font-medium uppercase tracking-wider">
                Groups
              </div>
              <div className="flex flex-wrap gap-1">
                {groups.map((g) => (
                  <span key={g.id} className="group/g inline-flex items-center">
                    <Button
                      size="xs"
                      variant={sameSet(g.remoteIds, selected) ? "soft" : "secondary"}
                      onClick={() => onChange(g.remoteIds.filter((id) => byId.has(id)))}
                    >
                      <Layers /> {g.name}
                      <span className="text-muted-foreground">{g.remoteIds.length}</span>
                    </Button>
                    <button
                      title="Delete group"
                      className="text-muted-foreground hover:text-destructive ml-0.5 hidden group-hover/g:inline"
                      onClick={() => del.mutate(g.id)}
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="max-h-72 overflow-y-auto p-1">
            {filtered.map((t) => (
              <label
                key={t.id}
                className="hover:bg-accent flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm"
              >
                <Checkbox checked={selected.includes(t.id)} onCheckedChange={() => toggle(t.id)} />
                <span className="min-w-0 flex-1 truncate font-medium">{t.name}</span>
                <span className="text-muted-foreground truncate font-mono text-xs">
                  {t.user ? `${t.user}@` : ""}
                  {t.host}
                </span>
              </label>
            ))}
            {!filtered.length && (
              <div className="text-muted-foreground px-2 py-6 text-center text-sm">
                {targets.length ? "No match" : "No SSH remotes yet — add one on the Remotes page"}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5 border-t p-2">
            <Button size="xs" variant="ghost" onClick={() => onChange(targets.map((t) => t.id))}>
              <Check /> All
            </Button>
            <Button size="xs" variant="ghost" onClick={() => onChange([])}>
              <X /> None
            </Button>
            <div className="ml-auto flex items-center gap-1">
              <Input
                placeholder="Save as group"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                className="h-7 w-32 text-xs"
                onKeyDown={(e) => e.key === "Enter" && groupName && selected.length && save.mutate()}
              />
              <Button
                size="icon-sm"
                variant="ghost"
                className="size-7"
                disabled={!groupName.trim() || !selected.length}
                onClick={() => save.mutate()}
                title="Save selection as group"
              >
                <Save className="size-3.5" />
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
      {selected.slice(0, 6).map((id) => (
        <span
          key={id}
          className="bg-secondary text-secondary-foreground inline-flex h-7 items-center gap-1 rounded-md pl-2 pr-1 text-xs font-medium"
        >
          {byId.get(id)?.name}
          <button onClick={() => toggle(id)} className="hover:text-destructive rounded p-0.5" title="Remove">
            <X className="size-3" />
          </button>
        </span>
      ))}
      {selected.length > 6 && <span className="text-muted-foreground text-xs">+{selected.length - 6} more</span>}
    </div>
  );
}

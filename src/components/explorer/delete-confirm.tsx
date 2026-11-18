"use client";

import { ReactNode, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { deleteFiles } from "@/lib/actions/files";

/**
 * Confirmation dialog that deletes the given files from disk + index.
 * `items` is only used to show what will be deleted.
 */
export function DeleteConfirm({
  items,
  trigger,
  onDone,
}: {
  items: ExploreFile[];
  trigger: ReactNode;
  onDone?: (result: DeleteResult) => void;
}) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const { mutate, isPending } = useMutation({
    mutationFn: () => deleteFiles(items.map((i) => i.id)),
    onSuccess: (res) => {
      if (res.deleted) toast.success(`Deleted ${res.deleted} item(s)`);
      if (res.failed.length) {
        toast.error(
          `${res.failed.length} failed: ${res.failed
            .slice(0, 3)
            .map((f) => `${f.relPath ?? f.id} — ${f.error}`)
            .join("; ")}`,
        );
      }
      qc.invalidateQueries({ queryKey: ["files"] });
      qc.invalidateQueries({ queryKey: ["duplicates"] });
      qc.invalidateQueries({ queryKey: ["folders"] });
      setOpen(false);
      onDone?.(res);
    },
    onError: (e: any) => toast.error(e.message ?? "Delete failed"),
  });

  const dirs = items.filter((i) => i.isDirectory).length;

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild disabled={!items.length}>
        {trigger}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete {items.length} item{items.length === 1 ? "" : "s"} from disk?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes the files from the data folder (the share must be
            mounted).
            {dirs > 0 && ` ${dirs} folder(s) will be deleted with all their contents.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="bg-muted max-h-60 overflow-auto rounded p-2 font-mono text-xs">
          {items.slice(0, 200).map((i) => (
            <li key={i.id} className="truncate">
              {i.folderName ? `${i.folderName}: ` : ""}
              {i.relPath}
              {i.isDirectory ? "/" : ""}
            </li>
          ))}
          {items.length > 200 && <li>… and {items.length - 200} more</li>}
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={isPending}
            onClick={(e) => {
              e.preventDefault();
              mutate();
            }}
          >
            {isPending ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

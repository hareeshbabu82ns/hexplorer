"use client";

import { ReactNode, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Destructive confirmation. With confirmWord, the confirm button stays disabled
 * until the user types that word.
 */
export function DangerDialog({
  trigger,
  title,
  description,
  confirmWord,
  confirmLabel = "Delete",
  onConfirm,
  open: openProp,
  onOpenChange,
  children,
}: {
  trigger?: ReactNode;
  title: string;
  description?: ReactNode;
  confirmWord?: string;
  confirmLabel?: string;
  /** return false to keep the dialog open */
  onConfirm: () => Promise<unknown> | unknown;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
  children?: ReactNode;
}) {
  const [innerOpen, setInnerOpen] = useState(false);
  const open = openProp ?? innerOpen;
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const setOpen = (o: boolean) => {
    if (!o) setTyped("");
    setInnerOpen(o);
    onOpenChange?.(o);
  };
  const ready = !confirmWord || typed === confirmWord;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription asChild><div>{description}</div></DialogDescription>}
        </DialogHeader>
        {children}
        {confirmWord && (
          <div className="grid gap-2">
            <Label htmlFor="danger-confirm">
              Type <span className="font-mono font-semibold">{confirmWord}</span> to confirm
            </Label>
            <Input
              id="danger-confirm"
              autoComplete="off"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="font-mono"
            />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!ready || busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await onConfirm();
                if (r !== false) setOpen(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

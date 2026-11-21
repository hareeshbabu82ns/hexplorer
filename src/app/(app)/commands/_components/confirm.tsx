"use client";

import { ReactNode, useCallback, useRef, useState } from "react";
import { ShieldAlert } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";

interface Ask {
  title: string;
  body: ReactNode;
  confirm: string;
}

/** `const [ask, dialog] = useConfirm(); if (!(await ask({...}))) return;` */
export function useConfirm(): [(a: Ask) => Promise<boolean>, ReactNode] {
  const [state, setState] = useState<Ask | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);
  const ask = useCallback(
    (a: Ask) =>
      new Promise<boolean>((resolve) => {
        resolver.current = resolve;
        setState(a);
      }),
    [],
  );
  const close = (v: boolean) => {
    resolver.current?.(v);
    resolver.current = null;
    setState(null);
  };
  const dialog = (
    <AlertDialog open={!!state} onOpenChange={(o) => !o && close(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <ShieldAlert className="text-destructive size-5" /> {state?.title}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="text-muted-foreground space-y-2 text-sm">{state?.body}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => close(false)}>Cancel</AlertDialogCancel>
          <AlertDialogAction className={buttonVariants({ variant: "destructive" })} onClick={() => close(true)}>
            {state?.confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  return [ask, dialog];
}

"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/db-admin/types";

/**
 * Runs a server action that returns ActionResult: toasts errors, optionally
 * toasts success, and returns the data (or null on failure).
 */
export function useRunAction() {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(action: () => Promise<ActionResult<T>>, successMsg?: string | ((d: T) => string)) => {
    setBusy(true);
    try {
      const res = await action();
      if (!res.success) {
        toast.error(res.error);
        return null;
      }
      if (successMsg) toast.success(typeof successMsg === "function" ? successMsg(res.data) : successMsg);
      return res.data;
    } catch (e) {
      toast.error((e as Error)?.message || "Request failed");
      return null;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, run };
}

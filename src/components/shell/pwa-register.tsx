"use client";

import { useEffect } from "react";

/** registers the service worker (production only, so dev HMR is never cached) */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((e) => {
      console.warn("service worker registration failed", e);
    });
  }, []);
  return null;
}

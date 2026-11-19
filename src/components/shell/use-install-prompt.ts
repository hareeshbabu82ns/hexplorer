"use client";

import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * "Install app" support: Chrome/Edge/Android fire beforeinstallprompt;
 * iPadOS/iOS Safari have no prompt API, so we show Add to Home Screen steps.
 */
export function useInstallPrompt() {
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [standalone, setStandalone] = useState(true);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(display-mode: standalone)");
    const update = () =>
      setStandalone(mq.matches || (navigator as any).standalone === true);
    update();
    mq.addEventListener("change", update);
    // iPadOS reports itself as Mac; touch points tell them apart
    const ua = navigator.userAgent;
    setIos(/iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1));

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setEvent(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      mq.removeEventListener("change", update);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  return {
    /** show an install entry at all */
    canInstall: !standalone && (!!event || ios),
    /** iOS: manual Add to Home Screen */
    manual: !event && ios,
    install: async () => {
      if (!event) return false;
      await event.prompt();
      const { outcome } = await event.userChoice;
      setEvent(null);
      return outcome === "accepted";
    },
  };
}

"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * "Install app" support: Chrome/Edge/Android fire beforeinstallprompt;
 * iPadOS/iOS Safari have no prompt API, so we show Add to Home Screen steps.
 */
const STANDALONE_MQ = "(display-mode: standalone)";

function subscribeStandalone(cb: () => void) {
  const mq = window.matchMedia(STANDALONE_MQ);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
const isStandalone = () =>
  window.matchMedia(STANDALONE_MQ).matches || (navigator as any).standalone === true;

// iPadOS reports itself as Mac; touch points tell them apart
const isIos = () => {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
};
const noSubscribe = () => () => {};

export function useInstallPrompt() {
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const standalone = useSyncExternalStore(subscribeStandalone, isStandalone, () => true);
  const ios = useSyncExternalStore(noSubscribe, isIos, () => false);

  useEffect(() => {

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setEvent(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
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

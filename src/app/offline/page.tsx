import { WifiOff } from "lucide-react";
import { ReloadButton } from "./reload-button";

export const metadata = { title: "Offline" };

/** pre-cached by the service worker and shown when the server cannot be reached */
export default function OfflinePage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <WifiOff className="text-muted-foreground size-12" />
      <h1 className="text-xl font-semibold">Can&apos;t reach the HExplorer server</h1>
      <p className="text-muted-foreground max-w-sm text-sm">
        Check that you are on the same network as the server (or connected to its VPN), then try again.
      </p>
      <ReloadButton />
    </div>
  );
}

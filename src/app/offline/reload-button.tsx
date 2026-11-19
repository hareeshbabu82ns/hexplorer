"use client";

import { Button } from "@/components/ui/button";

export function ReloadButton() {
  return (
    <Button className="h-11 px-6" onClick={() => location.reload()}>
      Try again
    </Button>
  );
}

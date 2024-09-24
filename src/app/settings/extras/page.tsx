"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { fetchSettings, updateSettings } from "@/lib/actions/settings";
import {
  C_EXPLORER_DOMAIN,
  C_EXPLORER_IGNORE_FILE_PATTERNS,
} from "@/lib/constants";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

export default function SettingsAppearancePage() {
  const [explorerIgnorePatterns, setExplorerIgnorePatterns] = useState("");

  const {
    data: settings,
    error,
    isLoading,
    isFetching,
  } = useQuery({
    queryKey: ["fetchSettings", C_EXPLORER_DOMAIN],
    queryFn: async () => {
      const res = await fetchSettings(C_EXPLORER_DOMAIN);
      if (res) {
        const settingsArray = Array.isArray(res) ? res : [res];
        setExplorerIgnorePatterns(
          settingsArray.find(
            (s: any) => s.key === C_EXPLORER_IGNORE_FILE_PATTERNS,
          )?.value || "",
        );
      }
      return res;
    },
  });

  const { mutate: updateSettingsFn } = useMutation({
    mutationKey: ["updateSettings", C_EXPLORER_DOMAIN],
    mutationFn: async () => {
      const settings = [
        {
          key: C_EXPLORER_IGNORE_FILE_PATTERNS,
          value: explorerIgnorePatterns,
        },
      ];
      return updateSettings({ domain: C_EXPLORER_DOMAIN, settings });
    },
  });

  if (isLoading || isFetching) {
    return <h4>Loading Settings...</h4>;
  }

  if (error) {
    return <h4>Error Loading Settings</h4>;
  }
  // if (!settings) {
  //   return <h4>No Settings Loaded</h4>;
  // }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Extras</h3>
        <p className="text-muted-foreground text-sm">Extra settings.</p>
      </div>
      <Separator />
      <div className="space-y-4">
        <h4 className="text-sm font-medium">Explorer Ignore Patterns</h4>
        <Input
          value={explorerIgnorePatterns}
          onChange={(e) => setExplorerIgnorePatterns(e.target.value)}
        />
      </div>
      <div className="flex justify-end">
        <Button onClick={() => updateSettingsFn()}>Save</Button>
      </div>
    </div>
  );
}

"use client";

import { useQuery } from "@tanstack/react-query";
import { listFolders } from "@/lib/actions/folders";

export const FOLDERS_KEY = ["folders"];

/** folder list; polls while a scan/hash job is running */
export function useFolders() {
  return useQuery({
    queryKey: FOLDERS_KEY,
    queryFn: () => listFolders(),
    refetchInterval: (q) =>
      q.state.data?.some((f) => f.status === "scanning" || f.status === "hashing")
        ? 1500
        : false,
  });
}

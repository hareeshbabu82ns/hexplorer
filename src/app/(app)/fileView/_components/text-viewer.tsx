"use client";

import { useQuery } from "@tanstack/react-query";
import { getFileData } from "../actions";

export default function TextViewer({ folderId, filePath }: { folderId: string; filePath: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["fileData", folderId, filePath],
    queryFn: async () => (await getFileData(folderId, filePath)).data,
  });
  if (isLoading) return <div>Loading…</div>;
  if (error) return <div className="text-destructive">Error: {error.message}</div>;
  return <pre className="bg-muted overflow-auto rounded p-4 text-xs">{data}</pre>;
}

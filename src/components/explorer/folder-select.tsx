"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFolders } from "./use-folders";

const ALL = "__all__";

export function FolderSelect({
  value,
  onChange,
  className,
}: {
  value?: string;
  onChange: (folderId: string | undefined) => void;
  className?: string;
}) {
  const { data: folders } = useFolders();
  return (
    <Select
      value={value || ALL}
      onValueChange={(v) => onChange(v === ALL ? undefined : v)}
    >
      <SelectTrigger className={className ?? "w-56"}>
        <SelectValue placeholder="All folders" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>All folders</SelectItem>
        {folders?.map((f) => (
          <SelectItem key={f.id} value={f.id}>
            {f.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

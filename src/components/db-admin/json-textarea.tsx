"use client";

import { useMemo } from "react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/** EJSON-aware parse check for the browser (plain JSON syntax is what matters here) */
export function jsonError(text: string, opts: { allowEmpty?: boolean; allowHex?: boolean } = {}): string | null {
  const t = text.trim();
  if (!t) return opts.allowEmpty ? null : "Required";
  if (opts.allowHex && /^["']?[0-9a-fA-F]{24}["']?$/.test(t)) return null;
  try {
    JSON.parse(t);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

/** monospace JSON editor that shows the parse error inline */
export function JsonTextarea({
  value,
  onChange,
  rows = 10,
  allowEmpty,
  allowHex,
  placeholder,
  className,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  allowEmpty?: boolean;
  allowHex?: boolean;
  placeholder?: string;
  className?: string;
  id?: string;
}) {
  const error = useMemo(() => jsonError(value, { allowEmpty, allowHex }), [value, allowEmpty, allowHex]);
  return (
    <div className="grid gap-1">
      <Textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        spellCheck={false}
        placeholder={placeholder}
        className={cn("font-mono text-xs", error && value.trim() && "border-destructive", className)}
      />
      {error && value.trim() && <p className="text-destructive text-xs">{error}</p>}
    </div>
  );
}

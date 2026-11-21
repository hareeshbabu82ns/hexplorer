import { useId } from "react";

import { cn } from "@/lib/utils";

/** hexagon brand mark */
export function LogoMark({ className }: { className?: string }) {
  const id = useId();
  return (
    <span
      className={cn(
        "relative inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] shadow-[inset_0_1px_0_rgb(255_255_255/0.25),0_2px_8px_-2px_hsl(var(--primary)/0.55)]",
        "bg-brand-gradient",
        className,
      )}
    >
      <svg viewBox="0 0 24 24" className="size-[58%] text-white" aria-hidden>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="1" />
            <stop offset="1" stopColor="#fff" stopOpacity="0.75" />
          </linearGradient>
        </defs>
        <path
          d="M12 2.5 20.25 7.25v9.5L12 21.5 3.75 16.75v-9.5Z"
          fill="none"
          stroke={`url(#${id})`}
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path d="M9 8v8M15 8v8M9 12h6" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("text-[15px] font-semibold tracking-tight", className)}>
      H<span className="text-muted-foreground font-medium">Explorer</span>
    </span>
  );
}

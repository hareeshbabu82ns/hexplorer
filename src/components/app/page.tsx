import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/** centred, padded page body used by every app screen */
export function Page({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("mx-auto w-full max-w-7xl space-y-8 px-4 py-6 pb-16 md:p-8", className)}>
      {children}
    </div>
  );
}

export function PageHeader({
  icon: Icon,
  title,
  description,
  actions,
  className,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("animate-fade-up flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="flex min-w-0 items-start gap-4">
        {Icon && (
          <span className="bg-card text-primary shadow-card hidden size-12 shrink-0 items-center justify-center rounded-xl border sm:flex">
            <Icon className="size-[22px]" strokeWidth={1.75} />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight md:text-[28px] md:leading-9">{title}</h1>
          {description && (
            <p className="text-muted-foreground mt-1 max-w-3xl text-sm leading-relaxed">{description}</p>
          )}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function SectionTitle({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-3", className)}>
      <div>
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {description && <p className="text-muted-foreground mt-0.5 text-sm">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = "primary",
  className,
}: {
  icon?: LucideIcon;
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "primary" | "info" | "warning" | "success";
  className?: string;
}) {
  const tones = {
    primary: "bg-primary/10 text-primary",
    info: "bg-info/10 text-info",
    warning: "bg-warning/10 text-warning",
    success: "bg-success/10 text-success",
  } as const;
  return (
    <div className={cn("surface group relative overflow-hidden p-5", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="text-muted-foreground text-[13px] font-medium">{label}</div>
        {Icon && (
          <span className={cn("flex size-8 items-center justify-center rounded-lg", tones[tone])}>
            <Icon className="size-4" />
          </span>
        )}
      </div>
      <div className="mt-3 text-[28px] font-semibold leading-none tracking-tight tabular-nums">{value}</div>
      {hint && <div className="text-muted-foreground mt-2 text-xs">{hint}</div>}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "bg-dots flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-14 text-center",
        className,
      )}
    >
      <span className="bg-card text-muted-foreground shadow-card mb-4 flex size-12 items-center justify-center rounded-xl border">
        <Icon className="size-5" />
      </span>
      <h3 className="font-semibold">{title}</h3>
      {description && <p className="text-muted-foreground mt-1 max-w-sm text-sm">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorBanner({ children }: { children: ReactNode }) {
  return (
    <div className="border-destructive/25 bg-destructive/5 text-destructive rounded-xl border px-4 py-3 text-sm">
      {children}
    </div>
  );
}

/** small key/value used inside cards */
export function Metric({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-muted-foreground text-[11px] font-medium uppercase tracking-wider">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}

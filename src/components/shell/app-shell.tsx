"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronRight,
  Command,
  Moon,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Sun,
} from "lucide-react";
import { useTheme } from "next-themes";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { LogoMark, Wordmark } from "@/components/app/logo";

import { CommandPalette } from "./command-palette";
import { activeItem, AppNavItem, isActive, NAV_GROUPS, NAV_ITEMS } from "./nav-items";
import { ShellUser, UserMenu } from "./user-menu";

const COLLAPSE_KEY = "hexplorer.sidebar.collapsed";
const COLLAPSE_EVENT = "hexplorer:sidebar";

/** sidebar collapsed flag, persisted in localStorage (in-memory if storage is blocked) */
let collapsedFallback = false;
function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return collapsedFallback;
  }
}
function writeCollapsed(v: boolean) {
  collapsedFallback = v;
  try {
    localStorage.setItem(COLLAPSE_KEY, v ? "1" : "0");
  } catch {}
  window.dispatchEvent(new Event(COLLAPSE_EVENT));
}
function subscribeCollapsed(cb: () => void) {
  window.addEventListener(COLLAPSE_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(COLLAPSE_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

/**
 * iPad-first shell:
 *  - md (iPad portrait, 768–1023px): icon rail with labels
 *  - lg+ (iPad landscape / desktop): full sidebar, collapsible to the rail
 *  - below md (phones): bottom tab bar + "More" sheet
 * Only <main> scrolls, so the chrome stays put like a native app.
 */
export function AppShell({ user, children }: { user: ShellUser; children: React.ReactNode }) {
  const pathname = usePathname();
  const collapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false);
  const toggleCollapsed = () => writeCollapsed(!collapsed);
  const wide = !collapsed;
  const current = activeItem(pathname);
  const [paletteOpen, setPaletteOpen] = useState(false);

  return (
    <div className="bg-background flex h-dvh overflow-hidden">
      {/* sidebar / rail (tablet and up) */}
      <aside
        className={cn(
          "bg-sidebar border-sidebar-border hidden shrink-0 flex-col border-r transition-[width] duration-200 md:flex",
          "pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[env(safe-area-inset-left)] pt-[env(safe-area-inset-top)]",
          "md:w-21",
          wide && "lg:w-65",
        )}
      >
        <div
          className={cn("flex h-16 items-center justify-center px-3", wide && "lg:justify-between lg:px-4")}
        >
          <Link href="/" className="flex items-center gap-2.5">
            <LogoMark />
            <span className={cn("hidden", wide && "lg:inline")}>
              <Wordmark />
            </span>
          </Link>
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn("text-muted-foreground hidden", wide && "lg:inline-flex")}
            onClick={toggleCollapsed}
            aria-label="Collapse sidebar"
          >
            <PanelLeftClose className="size-4" />
          </Button>
        </div>

        <div className={cn("hidden px-3 pb-2", wide && "lg:block")}>
          <button
            onClick={() => setPaletteOpen(true)}
            className="bg-card text-muted-foreground hover:text-foreground shadow-xs flex h-9 w-full items-center gap-2 rounded-lg border px-3 text-sm transition-colors dark:bg-input/30"
          >
            <Search className="size-4" />
            <span className="flex-1 text-left">Search…</span>
            <Kbd />
          </button>
        </div>

        <nav className="flex flex-1 flex-col gap-4 overflow-y-auto lg:px-3 p-2">
          {NAV_GROUPS.map((group) => (
            <div key={group} className="flex flex-col gap-0.5">
              <div
                className={cn(
                  "text-muted-foreground/70 hidden px-3 pb-1 text-[11px] font-medium uppercase tracking-[0.08em]",
                  wide && "lg:block",
                )}
              >
                {group}
              </div>
              {NAV_ITEMS.filter((i) => i.group === group).map((item) => (
                <SideLink key={item.href} item={item} active={current === item} wide={wide} />
              ))}
            </div>
          ))}
        </nav>

        <div className={cn("flex flex-col items-center gap-1 px-2", wide && "lg:items-stretch lg:px-3")}>
          {collapsed && (
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hidden size-11 lg:inline-flex"
              onClick={toggleCollapsed}
              aria-label="Expand sidebar"
            >
              <PanelLeftOpen className="size-5" />
            </Button>
          )}
          <div className={cn("w-12", wide && "lg:w-full")}>
            <div className={cn(wide ? "lg:hidden" : "")}>
              <UserMenu user={user} compact side="right" />
            </div>
            {wide && (
              <div className="hidden rounded-xl border bg-card/60 p-1 shadow-xs lg:block">
                <UserMenu user={user} side="top" />
              </div>
            )}
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-background/75 supports-backdrop-filter:bg-background/60 z-30 border-b pr-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)] backdrop-blur-xl">
          <div className="flex h-14 items-center gap-3 px-4 md:px-6">
            <Link href="/" className="md:hidden">
              <LogoMark className="size-8 rounded-lg" />
            </Link>
            <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
              <span className="text-muted-foreground hidden sm:inline">{current?.group ?? "Workspace"}</span>
              <ChevronRight className="text-muted-foreground/50 hidden size-3.5 sm:block" />
              <span className="flex min-w-0 items-center gap-2 font-medium">
                {current && <current.icon className="text-muted-foreground size-4 shrink-0" />}
                <span className="truncate">{current?.title ?? "HExplorer"}</span>
              </span>
            </nav>
            <div className="ml-auto flex items-center gap-1.5">
              <button
                onClick={() => setPaletteOpen(true)}
                className={cn(
                  "bg-card text-muted-foreground hover:text-foreground shadow-xs hidden h-9 w-64 items-center gap-2 rounded-lg border px-3 text-sm transition-colors sm:flex dark:bg-input/30",
                  wide && "lg:hidden",
                )}
              >
                <Search className="size-4" />
                <span className="flex-1 text-left">Search files…</span>
                <Kbd />
              </button>
              <Button
                variant="ghost"
                size="icon"
                className="size-9 sm:hidden"
                aria-label="Search"
                onClick={() => setPaletteOpen(true)}
              >
                <Search className="size-[18px]" />
              </Button>
              <ThemeToggle />
              <div className="md:hidden">
                <UserMenu user={user} compact />
              </div>
            </div>
          </div>
        </header>
        <main
          id="main-scroll"
          className="flex-1 overflow-y-auto overscroll-contain pb-[calc(4.5rem+env(safe-area-inset-bottom))] pr-[env(safe-area-inset-right)] md:pb-[env(safe-area-inset-bottom)]"
        >
          {children}
        </main>
      </div>

      <BottomBar pathname={pathname} />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}

function Kbd() {
  return (
    <kbd className="bg-muted text-muted-foreground inline-flex h-5 items-center gap-0.5 rounded border px-1.5 font-mono text-[10px] font-medium">
      <Command className="size-2.5" />K
    </kbd>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      className="text-muted-foreground hover:text-foreground size-9"
      aria-label="Toggle theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <Sun className="size-[18px] scale-100 rotate-0 transition-transform dark:scale-0 dark:-rotate-90" />
      <Moon className="absolute size-[18px] scale-0 rotate-90 transition-transform dark:scale-100 dark:rotate-0" />
    </Button>
  );
}

function SideLink({ item, active, wide }: { item: AppNavItem; active: boolean; wide: boolean }) {
  const Icon = item.icon;
  const link = (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg px-1 text-[11px] font-medium transition-colors",
        wide && "lg:min-h-9 lg:flex-row lg:justify-start lg:gap-3 lg:px-3 lg:text-[13.5px]",
        active
          ? "bg-card text-foreground shadow-card ring-1 ring-border dark:bg-accent dark:ring-white/5"
          : "text-muted-foreground hover:bg-accent/70 hover:text-foreground",
      )}
    >
      {active && (
        <span
          className={cn(
            "bg-primary absolute -left-2 top-1/2 hidden h-5 w-[3px] -translate-y-1/2 rounded-r-full",
            wide && "lg:block",
          )}
        />
      )}
      <Icon
        className={cn("size-5 shrink-0 lg:size-[18px]", active ? "text-primary" : "")}
        strokeWidth={active ? 2.1 : 1.8}
      />
      <span className="truncate">{item.title}</span>
    </Link>
  );
  if (wide) return link;
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.description}</TooltipContent>
    </Tooltip>
  );
}

function BottomBar({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false);
  const current = activeItem(pathname);
  const primary = NAV_ITEMS.filter((i) => i.primary);
  const more = NAV_ITEMS.filter((i) => !i.primary);
  const moreActive = !!current && !current.primary;
  // close the "More" sheet after navigating
  const [prevPath, setPrevPath] = useState(pathname);
  if (pathname !== prevPath) {
    setPrevPath(pathname);
    setOpen(false);
  }

  const tab =
    "relative flex flex-1 flex-col items-center justify-center gap-1 py-2 text-[10.5px] font-medium transition-colors";
  return (
    <nav className="bg-background/85 supports-backdrop-filter:bg-background/70 fixed inset-x-0 bottom-0 z-40 flex border-t px-[env(safe-area-inset-left)] pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
      {primary.map((item) => {
        const Icon = item.icon;
        const active = current === item;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(tab, active ? "text-primary" : "text-muted-foreground")}
          >
            {active && <span className="bg-primary absolute top-0 h-0.5 w-8 rounded-b-full" />}
            <Icon className="size-[22px]" strokeWidth={active ? 2.1 : 1.8} />
            {item.title}
          </Link>
        );
      })}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger className={cn(tab, moreActive ? "text-primary" : "text-muted-foreground")}>
          <MoreHorizontal className="size-[22px]" />
          More
        </SheetTrigger>
        <SheetContent side="bottom" className="rounded-t-3xl pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
          <SheetHeader>
            <SheetTitle>More</SheetTitle>
          </SheetHeader>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {more.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "surface flex items-center gap-3 p-4 text-sm font-medium",
                    isActive(pathname, item.href) && "border-primary/40 text-primary",
                  )}
                >
                  <span className="bg-primary/10 text-primary flex size-9 items-center justify-center rounded-lg">
                    <Icon className="size-[18px]" />
                  </span>
                  <span className="min-w-0">
                    <span className="block">{item.title}</span>
                    <span className="text-muted-foreground block truncate text-xs font-normal">
                      {item.description}
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
    </nav>
  );
}

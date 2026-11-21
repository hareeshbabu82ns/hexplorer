"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { MoreHorizontal, PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { siteConfig } from "@/config/site";
import { activeItem, AppNavItem, isActive, NAV_ITEMS } from "./nav-items";
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

  return (
    <div className="bg-background flex h-dvh overflow-hidden">
      {/* sidebar / rail (tablet and up) */}
      <aside
        className={cn(
          "bg-muted/40 hidden shrink-0 flex-col border-r md:flex",
          "pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[env(safe-area-inset-left)] pt-[env(safe-area-inset-top)]",
          "md:w-[88px]",
          wide && "lg:w-64",
        )}
      >
        <div className={cn("flex h-16 items-center justify-center px-3", wide && "lg:justify-between lg:px-4")}>
          <Link href="/" className="flex items-center gap-2 font-bold">
            <span className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-xl text-lg">
              H
            </span>
            <span className={cn("hidden text-lg", wide && "lg:inline")}>{siteConfig.name}</span>
          </Link>
          <Button
            variant="ghost"
            size="icon"
            className={cn("hidden", wide && "lg:inline-flex")}
            onClick={toggleCollapsed}
            aria-label="Collapse sidebar"
          >
            <PanelLeftClose className="size-5" />
          </Button>
        </div>
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-2 py-2">
          {NAV_ITEMS.map((item) => (
            <SideLink key={item.href} item={item} active={current === item} wide={wide} />
          ))}
        </nav>
        <div className={cn("flex flex-col items-center gap-1 px-2", wide && "lg:items-stretch")}>
          {collapsed && (
            <Button
              variant="ghost"
              size="icon"
              className="hidden size-12 lg:inline-flex"
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
              <div className="hidden lg:block">
                <UserMenu user={user} side="top" />
              </div>
            )}
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-background/80 supports-backdrop-filter:bg-background/60 z-30 border-b pr-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)] backdrop-blur-sm">
          <div className="flex h-14 items-center gap-3 px-4 md:h-16 md:px-6">
            <Link href="/" className="md:hidden">
              <span className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg font-bold">
                H
              </span>
            </Link>
            <h1 className="truncate text-lg font-semibold md:text-xl">
              {current?.title ?? siteConfig.name}
            </h1>
            <div className="ml-auto flex items-center gap-2">
              <QuickSearch />
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
    </div>
  );
}

function SideLink({ item, active, wide }: { item: AppNavItem; active: boolean; wide: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[11px] font-medium transition-colors",
        wide && "lg:min-h-11 lg:flex-row lg:justify-start lg:gap-3 lg:px-3 lg:text-sm",
        active
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      <Icon className="size-5 shrink-0" />
      <span className="truncate">{item.title}</span>
    </Link>
  );
}

function QuickSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  return (
    <>
      <form
        className="relative hidden sm:block"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) router.push(`/files?q=${encodeURIComponent(q.trim())}`);
        }}
      >
        <Search className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2" />
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search all files…"
          className="h-10 w-56 rounded-full pl-9 lg:w-72"
          enterKeyHint="search"
        />
      </form>
      <Button asChild variant="ghost" size="icon" className="size-10 sm:hidden">
        <Link href="/files" aria-label="Search files">
          <Search className="size-5" />
        </Link>
      </Button>
    </>
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

  const tab = "flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium";
  return (
    <nav className="bg-background/90 supports-backdrop-filter:bg-background/70 fixed inset-x-0 bottom-0 z-40 flex border-t px-[env(safe-area-inset-left)] pb-[env(safe-area-inset-bottom)] backdrop-blur-sm md:hidden">
      {primary.map((item) => {
        const Icon = item.icon;
        const active = current === item;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(tab, active ? "text-primary" : "text-muted-foreground")}
          >
            <Icon className="size-6" />
            {item.title}
          </Link>
        );
      })}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger className={cn(tab, moreActive ? "text-primary" : "text-muted-foreground")}>
          <MoreHorizontal className="size-6" />
          More
        </SheetTrigger>
        <SheetContent side="bottom" className="rounded-t-2xl pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
          <SheetHeader>
            <SheetTitle>More</SheetTitle>
          </SheetHeader>
          <div className="mt-4 grid grid-cols-3 gap-3">
            {more.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex flex-col items-center gap-2 rounded-xl border p-4 text-sm",
                    isActive(pathname, item.href) && "border-primary text-primary",
                  )}
                >
                  <Icon className="size-6" />
                  {item.title}
                </Link>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
    </nav>
  );
}

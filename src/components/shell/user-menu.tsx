"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Download, KeyRound, LogOut, Monitor, Moon, Sun, UserRound } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { useInstallPrompt } from "./use-install-prompt";

export interface ShellUser {
  name: string;
  username?: string | null;
}

export function UserMenu({
  user,
  compact,
  side = "bottom",
}: {
  user: ShellUser;
  compact?: boolean;
  side?: "bottom" | "right" | "top";
}) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const { canInstall, manual, install } = useInstallPrompt();
  const initial = (user.name || user.username || "?").slice(0, 1).toUpperCase();

  const doSignOut = async () => {
    await signOut();
    router.replace("/login");
    router.refresh();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={cn(
            "h-12 gap-3 rounded-lg px-2 active:scale-100",
            compact ? "w-12 justify-center" : "w-full justify-start",
          )}
        >
          <span className="bg-brand-gradient flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.3)]">
            {initial}
          </span>
          {!compact && (
            <span className="min-w-0 text-left">
              <span className="block truncate text-sm font-medium">{user.name}</span>
              {user.username && (
                <span className="text-muted-foreground block truncate text-xs">
                  @{user.username}
                </span>
              )}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side={side} align="end" className="w-60">
        <DropdownMenuLabel className="flex items-center gap-2">
          <UserRound className="size-4" /> {user.name}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="h-10">
          <Link href="/settings/security">
            <KeyRound className="mr-2 size-4" /> Security &amp; 2FA
          </Link>
        </DropdownMenuItem>
        {canInstall && (
          <DropdownMenuItem
            className="h-10"
            onClick={async () => {
              if (manual)
                toast.info("Tap the Share button, then “Add to Home Screen”.", {
                  duration: 8000,
                });
              else await install();
            }}
          >
            <Download className="mr-2 size-4" /> Install app
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
          Theme
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
          <DropdownMenuRadioItem value="light" className="h-10">
            <Sun className="mr-2 size-4" /> Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark" className="h-10">
            <Moon className="mr-2 size-4" /> Dark
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system" className="h-10">
            <Monitor className="mr-2 size-4" /> System
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive h-10" onClick={doSignOut}>
          <LogOut className="mr-2 size-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

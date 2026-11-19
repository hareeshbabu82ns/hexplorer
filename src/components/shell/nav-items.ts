import {
  Archive,
  Copy,
  FolderSearch,
  HardDrive,
  LayoutDashboard,
  LucideIcon,
  Server,
  Settings,
} from "lucide-react";

export interface AppNavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  /** shown in the phone bottom bar (the rest go under "More") */
  primary?: boolean;
}

export const NAV_ITEMS: AppNavItem[] = [
  { title: "Home", href: "/", icon: LayoutDashboard, primary: true },
  { title: "Files", href: "/files", icon: FolderSearch, primary: true },
  { title: "Duplicates", href: "/duplicates", icon: Copy, primary: true },
  { title: "Folders", href: "/folders", icon: HardDrive, primary: true },
  { title: "Remotes", href: "/remotes", icon: Server },
  { title: "Backups", href: "/backups", icon: Archive },
  { title: "Settings", href: "/settings", icon: Settings },
];

export const isActive = (pathname: string, href: string) =>
  href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");

/** fileView pages belong to Files */
export function activeItem(pathname: string) {
  if (pathname.startsWith("/fileView")) return NAV_ITEMS.find((i) => i.href === "/files");
  return NAV_ITEMS.find((i) => isActive(pathname, i.href));
}

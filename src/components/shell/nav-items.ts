import {
  Archive,
  Copy,
  Database,
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
  group: "Workspace" | "Storage" | "System";
  description: string;
  /** shown in the phone bottom bar (the rest go under "More") */
  primary?: boolean;
}

export const NAV_ITEMS: AppNavItem[] = [
  {
    title: "Overview",
    href: "/",
    icon: LayoutDashboard,
    group: "Workspace",
    primary: true,
    description: "Index health at a glance",
  },
  {
    title: "Files",
    href: "/files",
    icon: FolderSearch,
    group: "Workspace",
    primary: true,
    description: "Browse and search the index",
  },
  {
    title: "Duplicates",
    href: "/duplicates",
    icon: Copy,
    group: "Workspace",
    primary: true,
    description: "Find and reclaim wasted space",
  },
  {
    title: "Folders",
    href: "/folders",
    icon: HardDrive,
    group: "Storage",
    primary: true,
    description: "Indexed data folders",
  },
  {
    title: "Remotes",
    href: "/remotes",
    icon: Server,
    group: "Storage",
    description: "SSH & SMB connections and keys",
  },
  { title: "Backups", href: "/backups", icon: Archive, group: "Storage", description: "rsync backup jobs" },
  {
    title: "Databases",
    href: "/db-management",
    icon: Database,
    group: "System",
    description: "MongoDB servers & backups",
  },
  {
    title: "Settings",
    href: "/settings",
    icon: Settings,
    group: "System",
    description: "Preferences and security",
  },
];

export const NAV_GROUPS = ["Workspace", "Storage", "System"] as const;

export const isActive = (pathname: string, href: string) =>
  href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");

/** fileView pages belong to Files */
export function activeItem(pathname: string) {
  if (pathname.startsWith("/fileView")) return NAV_ITEMS.find((i) => i.href === "/files");
  return NAV_ITEMS.find((i) => isActive(pathname, i.href));
}

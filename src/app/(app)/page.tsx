import Link from "next/link";
import {
  Archive,
  ArrowUpRight,
  Copy,
  Database,
  FileStack,
  FolderSearch,
  HardDrive,
  Network,
  Plus,
  Server,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorBanner, Page, SectionTitle, StatCard } from "@/components/app/page";
import { listFolders } from "@/lib/actions/folders";
import { formatAgo, formatSize } from "@/lib/utils";

export const dynamic = "force-dynamic";

const ACTIONS = [
  {
    href: "/files",
    title: "Search files",
    text: "Find anything across every indexed folder",
    icon: FolderSearch,
  },
  { href: "/duplicates", title: "Find duplicates", text: "Match by name, size or content hash", icon: Copy },
  { href: "/remotes", title: "Connect a remote", text: "Mount SSH hosts and SMB shares", icon: Server },
  { href: "/backups", title: "Run a backup", text: "rsync folders to another location", icon: Archive },
];

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function StatusBadge({ f }: { f: DataFolder }) {
  if (f.status === "scanning") return <Badge variant="info">Scanning</Badge>;
  if (f.status === "hashing") return <Badge variant="info">Hashing</Badge>;
  if (f.status === "error") return <Badge variant="destructive">Error</Badge>;
  if (!f.lastScanAt) return <Badge variant="outline">Not scanned</Badge>;
  return <Badge variant="success">Indexed</Badge>;
}

export default async function IndexPage() {
  let folders: DataFolder[] = [];
  let dbError: string | null = null;
  try {
    folders = await listFolders();
  } catch (e: any) {
    dbError = e.message;
  }
  const files = folders.reduce((a, f) => a + f.fileCount, 0);
  const dirs = folders.reduce((a, f) => a + f.dirCount, 0);
  const size = folders.reduce((a, f) => a + f.totalSize, 0);
  const mounted = folders.filter((f) => f.mount);
  const busy = folders.filter((f) => f.status === "scanning" || f.status === "hashing").length;
  const sorted = [...folders].sort((a, b) => b.totalSize - a.totalSize);
  const maxSize = sorted[0]?.totalSize || 1;

  return (
    <Page>
      {/* hero */}
      <section className="surface animate-fade-up relative overflow-hidden p-6 md:p-8">
        <div className="bg-dots pointer-events-none absolute inset-0 mask-[linear-gradient(to_left,black,transparent_70%)]" />
        <div className="bg-primary/20 pointer-events-none absolute -right-24 -top-24 size-72 rounded-full blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <p className="text-primary text-sm font-medium">{greeting()}</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight md:text-4xl">
              Your files, indexed and in order.
            </h1>
            <p className="text-muted-foreground mt-2 text-[15px] leading-relaxed">
              {folders.length
                ? `${files.toLocaleString()} files across ${folders.length} data folder${folders.length === 1 ? "" : "s"}${busy ? ` · ${busy} job${busy === 1 ? "" : "s"} running` : ""}.`
                : "Add a data folder or connect a remote to start indexing."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href="/files">
                <FolderSearch className="size-4" /> Search files
              </Link>
            </Button>
            <Button asChild>
              <Link href="/folders">
                <Plus className="size-4" /> Add folder
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {dbError && <ErrorBanner>Database unavailable: {dbError} (check DATABASE_URL)</ErrorBanner>}

      {/* stats */}
      <section className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        <StatCard
          icon={HardDrive}
          label="Data folders"
          value={folders.length.toLocaleString()}
          hint={`${mounted.length} mounted from remotes`}
        />
        <StatCard
          icon={FileStack}
          tone="info"
          label="Indexed files"
          value={files.toLocaleString()}
          hint={`${dirs.toLocaleString()} directories`}
        />
        <StatCard
          icon={Database}
          tone="warning"
          label="Total size"
          value={formatSize(size, 1)}
          hint="Across all folders"
        />
        <StatCard
          icon={Network}
          tone="success"
          label="Remote mounts"
          value={mounted.length.toLocaleString()}
          hint={`${mounted.filter((f) => f.mount?.mounted).length} currently online`}
        />
      </section>

      <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
        {/* folders */}
        <section className="min-w-0 space-y-4">
          <SectionTitle
            title="Data folders"
            description="Largest first"
            actions={
              <Button asChild variant="ghost" size="sm">
                <Link href="/folders">
                  Manage <ArrowUpRight className="size-4" />
                </Link>
              </Button>
            }
          />
          {folders.length === 0 && !dbError ? (
            <EmptyState
              icon={HardDrive}
              title="No data folders yet"
              description="Point HExplorer at a local path, or mount one from an SSH/SMB remote."
              action={
                <Button asChild>
                  <Link href="/folders">
                    <Plus className="size-4" /> Add folder
                  </Link>
                </Button>
              }
            />
          ) : (
            <div className="surface divide-y overflow-hidden">
              {sorted.slice(0, 8).map((f) => (
                <Link
                  key={f.id}
                  href={`/files?folder=${f.id}`}
                  className="hover:bg-accent/50 group flex items-center gap-4 px-4 py-3.5 transition-colors sm:px-5"
                >
                  <span className="bg-muted text-muted-foreground group-hover:text-primary flex size-10 shrink-0 items-center justify-center rounded-lg transition-colors">
                    {f.mount ? <Network className="size-[18px]" /> : <HardDrive className="size-[18px]" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{f.name}</span>
                      <StatusBadge f={f} />
                    </div>
                    <div className="mt-2 flex items-center gap-3">
                      <div className="bg-muted h-1.5 flex-1 overflow-hidden rounded-full">
                        <div
                          className="bg-brand-gradient h-full rounded-full"
                          style={{ width: `${Math.max(2, (f.totalSize / maxSize) * 100)}%` }}
                        />
                      </div>
                      <span className="text-muted-foreground w-20 shrink-0 text-right text-xs tabular-nums">
                        {formatSize(f.totalSize, 1)}
                      </span>
                    </div>
                  </div>
                  <div className="text-muted-foreground hidden w-28 shrink-0 text-right text-xs sm:block">
                    <div className="text-foreground font-medium tabular-nums">
                      {f.fileCount.toLocaleString()} files
                    </div>
                    {f.lastScanAt ? `scanned ${formatAgo(new Date(f.lastScanAt))} ago` : "never scanned"}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* quick actions */}
        <section className="min-w-0 space-y-4">
          <SectionTitle title="Quick actions" />
          <div className="grid grid-cols-1 gap-3">
            {ACTIONS.map((a) => (
              <Link
                key={a.href}
                href={a.href}
                className="surface hover:border-primary/40 group flex items-center gap-4 p-4 transition-all hover:-translate-y-px hover:shadow-(--shadow-elevated)"
              >
                <span className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-lg">
                  <a.icon className="size-[18px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{a.title}</span>
                  <span className="text-muted-foreground block truncate text-xs">{a.text}</span>
                </span>
                <ArrowUpRight className="text-muted-foreground group-hover:text-primary size-4 transition-colors" />
              </Link>
            ))}
          </div>
        </section>
      </div>
    </Page>
  );
}

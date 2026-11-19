import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listFolders } from "@/lib/actions/folders";
import { formatSize } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function IndexPage() {
  let folders: DataFolder[] = [];
  let dbError: string | null = null;
  try {
    folders = await listFolders();
  } catch (e: any) {
    dbError = e.message;
  }
  const files = folders.reduce((a, f) => a + f.fileCount, 0);
  const size = folders.reduce((a, f) => a + f.totalSize, 0);

  return (
    <section className="grid gap-6 p-4 pb-8 md:p-6">
      <div className="flex max-w-[980px] flex-col items-start gap-2">
        <h2 className="text-2xl font-bold tracking-tight md:text-3xl">Welcome back</h2>
        <p className="text-muted-foreground max-w-[700px] text-lg">
          Index data folders into MongoDB, search and sort files, and clean up duplicates.
        </p>
      </div>
      {dbError && (
        <p className="text-destructive">Database unavailable: {dbError} (check DATABASE_URL)</p>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          ["Data folders", folders.length.toLocaleString()],
          ["Indexed files", files.toLocaleString()],
          ["Total size", formatSize(size, 1)],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardHeader className="pb-1">
              <CardTitle className="text-muted-foreground text-sm font-normal">{label}</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">{value}</CardContent>
          </Card>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link href="/folders">Manage folders</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/remotes">Network remotes</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/files">Search files</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/duplicates">Find duplicates</Link>
        </Button>
      </div>
    </section>
  );
}

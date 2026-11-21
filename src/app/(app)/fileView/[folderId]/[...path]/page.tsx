import Link from "next/link";
import { Button } from "@/components/ui/button";
import ImageViewer from "../../_components/image-viewer";
import MarkdownViewer from "../../_components/markdown-viewer";
import TextViewer from "../../_components/text-viewer";

const TEXT_EXT = ["txt", "log", "json", "csv", "yml", "yaml", "xml", "ini", "conf", "sh", "js", "ts", "py"];
const IMG_EXT = ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp"];

export default async function FileViewPage(
  props: {
    params: Promise<{ folderId: string; path: string[] }>;
  }
) {
  const params = await props.params;
  const relPath = params.path.map((p) => decodeURIComponent(p)).join("/");
  const ext = relPath.split(".").pop()?.toLowerCase() ?? "";
  const dir = relPath.split("/").slice(0, -1).join("/");
  const rawUrl = `/api/assets/${params.folderId}/${params.path.join("/")}`;

  let viewer: React.ReactNode;
  if (ext === "md") viewer = <MarkdownViewer folderId={params.folderId} filePath={relPath} />;
  else if (IMG_EXT.includes(ext)) viewer = <ImageViewer src={rawUrl} alt={relPath} />;
  else if (TEXT_EXT.includes(ext)) viewer = <TextViewer folderId={params.folderId} filePath={relPath} />;
  else if (["pdf", "mp4", "webm", "mp3", "ogg", "wav"].includes(ext))
    viewer = <iframe src={rawUrl} className="h-[80vh] w-full rounded border" title={relPath} />;
  else viewer = <p className="text-muted-foreground">No preview for .{ext} files.</p>;

  return (
    <div className="space-y-4 px-4 py-4 md:px-10">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" asChild>
          <Link href={`/files?folder=${params.folderId}&dir=${encodeURIComponent(dir)}`}>← Back</Link>
        </Button>
        <span className="truncate font-mono text-sm">{relPath}</span>
        <span className="grow" />
        <Button variant="outline" size="sm" asChild>
          <a href={`${rawUrl}?download=1`}>Download</a>
        </Button>
      </div>
      {viewer}
    </div>
  );
}

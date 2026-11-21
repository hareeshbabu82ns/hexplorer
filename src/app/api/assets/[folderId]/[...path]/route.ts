import path from "path";
import { Readable } from "stream";
import mime from "mime";
import { NextRequest } from "next/server";
import { resolveFolderFile } from "@/lib/folder-files";

export const dynamic = "force-dynamic";

/** parse a single "bytes=a-b" range; null = whole file */
function parseRange(header: string | null, size: number) {
  const m = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (!m[1] && !m[2])) return null;
  let start: number;
  let end: number;
  if (!m[1]) {
    start = Math.max(0, size - Number(m[2])); // suffix: last N bytes
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  return start <= end && start < size ? { start, end } : "invalid";
}

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ folderId: string; path: string[] }> }
) {
  const params = await props.params;
  const relPath = params.path.map((p) => decodeURIComponent(p)).join("/");
  try {
    const { fsx, rel } = await resolveFolderFile(params.folderId, relPath);
    const st = await fsx.stat(rel);
    if (!st || st.isDirectory) throw new Error("not a file");
    const fileName = path.posix.basename(rel);
    const download = request.nextUrl.searchParams.get("download") === "1";
    const range = parseRange(request.headers.get("range"), st.size);
    const headers: Record<string, string> = {
      "Content-Type": mime.getType(fileName) || "application/octet-stream",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Accept-Ranges": "bytes",
      "Last-Modified": st.mtime.toUTCString(),
    };
    if (range === "invalid")
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${st.size}` } });
    const body = fsx.read(rel, range ?? undefined);
    const stream = Readable.toWeb(body) as ReadableStream;
    if (range) {
      headers["Content-Range"] = `bytes ${range.start}-${range.end}/${st.size}`;
      headers["Content-Length"] = String(range.end - range.start + 1);
      return new Response(stream, { status: 206, headers });
    }
    headers["Content-Length"] = String(st.size);
    return new Response(stream, { headers });
  } catch (e: any) {
    return new Response(`File not available: ${e.message}`, { status: 404 });
  }
}

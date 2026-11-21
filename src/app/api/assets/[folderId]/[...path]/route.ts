import { createReadStream } from "fs";
import { stat } from "fs/promises";
import path from "path";
import { Readable } from "stream";
import mime from "mime";
import { NextRequest } from "next/server";
import { resolveFolderFile } from "@/lib/folder-files";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ folderId: string; path: string[] }> }
) {
  const params = await props.params;
  const relPath = params.path.map((p) => decodeURIComponent(p)).join("/");
  let abs: string;
  try {
    ({ abs } = await resolveFolderFile(params.folderId, relPath));
    const st = await stat(abs);
    if (!st.isFile()) throw new Error("not a file");
    const fileName = path.basename(abs);
    const download = request.nextUrl.searchParams.get("download") === "1";
    const stream = Readable.toWeb(createReadStream(abs)) as ReadableStream;
    return new Response(stream, {
      headers: {
        "Content-Type": mime.getType(fileName) || "application/octet-stream",
        "Content-Length": String(st.size),
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      },
    });
  } catch (e: any) {
    return new Response(`File not available: ${e.message}`, { status: 404 });
  }
}

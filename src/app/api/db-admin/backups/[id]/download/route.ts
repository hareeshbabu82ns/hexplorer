import fs from "fs";
import fsp from "fs/promises";
import { Readable } from "stream";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { backupFilePath } from "@/lib/db-admin/backup";
import { DbAdminError, UNAUTHORIZED } from "@/lib/db-admin/errors";
import { requireDbAdmin } from "@/lib/db-admin/guard";
import { writeAudit } from "@/lib/db-admin/run";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  let actor;
  try {
    actor = await requireDbAdmin();
  } catch {
    return NextResponse.json({ error: UNAUTHORIZED }, { status: 401 });
  }
  const id = params.id;
  const row = /^[0-9a-f]{24}$/i.test(id) ? await prisma.dbBackup.findUnique({ where: { id } }) : null;
  if (!row) return NextResponse.json({ error: "Backup not found" }, { status: 404 });
  if (row.status !== "completed")
    return NextResponse.json({ error: "Backup is not completed" }, { status: 409 });

  let file: string;
  let size: number;
  try {
    file = await backupFilePath(row);
    size = (await fsp.stat(file)).size;
  } catch (e) {
    const msg = e instanceof DbAdminError ? e.message : "Backup file is missing on disk";
    await writeAudit(actor, { action: "backup.download", connectionId: row.connectionId, target: row.database, details: { backupId: id } }, false, msg);
    return NextResponse.json({ error: msg }, { status: 404 });
  }
  await writeAudit(
    actor,
    { action: "backup.download", connectionId: row.connectionId, target: row.database, details: { backupId: id } },
    true,
  );
  const stamp = row.createdAt.toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const safe = `${row.name}`.replace(/[^\w.-]+/g, "_").slice(0, 80) || "backup";
  const body = Readable.toWeb(fs.createReadStream(file)) as ReadableStream;
  return new Response(body, {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Length": String(size),
      "Content-Disposition": `attachment; filename="${safe}-${stamp}.ndjson.gz"`,
      "Cache-Control": "no-store",
    },
  });
}

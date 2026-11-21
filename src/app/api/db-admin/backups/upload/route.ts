import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  backupDir,
  backupFilePath,
  fileNameFor,
  newBackupId,
  toSummary,
  validateBackupFile,
} from "@/lib/db-admin/backup";
import { DbAdminError, UNAUTHORIZED } from "@/lib/db-admin/errors";
import { requireDbAdmin } from "@/lib/db-admin/guard";
import { resolveConnection } from "@/lib/db-admin/pool";
import { writeAudit } from "@/lib/db-admin/run";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST /api/db-admin/backups/upload?connectionId=&name=  (raw .ndjson.gz file as the body) */
export async function POST(req: NextRequest) {
  let actor;
  try {
    actor = await requireDbAdmin();
  } catch {
    return NextResponse.json({ error: UNAUTHORIZED }, { status: 401 });
  }
  const connectionId = req.nextUrl.searchParams.get("connectionId") ?? "";
  const nameParam = (req.nextUrl.searchParams.get("name") ?? "").trim();
  const audit = { action: "backup.upload", connectionId: connectionId || null, details: { name: nameParam } };

  const fail = async (error: string, status = 400) => {
    await writeAudit(actor, audit, false, error);
    return NextResponse.json({ error }, { status });
  };

  let conn;
  try {
    conn = await resolveConnection(connectionId);
  } catch {
    return fail("Unknown connection");
  }
  if (!req.body) return fail("Empty upload");

  const dir = await backupDir();
  // turbopackIgnore: a literal suffix on a runtime dir would make the bundler glob the whole project
  const tmp = path.join(/*turbopackIgnore: true*/ dir, `.upload-${crypto.randomBytes(8).toString("hex")}.tmp`);
  try {
    await pipeline(Readable.fromWeb(req.body as any), fs.createWriteStream(tmp));
    const info = await validateBackupFile(tmp);
    const id = newBackupId();
    const record = { id, fileName: fileNameFor(id) };
    const size = (await fsp.stat(tmp)).size;
    await fsp.rename(tmp, await backupFilePath(record));
    const row = await prisma.dbBackup.create({
      data: {
        ...record,
        connectionId: conn.id,
        connectionName: conn.name,
        database: info.database,
        name: nameParam || `${info.database} (uploaded)`,
        collections: info.collections,
        documentCount: info.documents,
        sizeBytes: size,
        status: "completed",
        source: "upload",
        createdById: actor.userId,
        completedAt: new Date(),
      },
    });
    await writeAudit(actor, { ...audit, target: info.database, details: { ...audit.details, backupId: id } }, true);
    return NextResponse.json({ success: true, data: toSummary(row) });
  } catch (e) {
    await fsp.rm(tmp, { force: true }).catch(() => undefined);
    const msg = e instanceof DbAdminError ? e.message : `Upload failed: ${(e as Error)?.message || e}`;
    return fail(msg, e instanceof DbAdminError ? 400 : 500);
  }
}

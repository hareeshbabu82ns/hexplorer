"use server";

import fsp from "fs/promises";
import { after } from "next/server";
import { background } from "@/lib/jobs";
import { prisma } from "@/lib/prisma";
import {
  backupFilePath,
  backupTargets,
  fileNameFor,
  markStaleBackups,
  newBackupId,
  restoreBackup as runRestore,
  runBackup,
  toSummary,
} from "@/lib/db-admin/backup";
import { DbAdminError } from "@/lib/db-admin/errors";
import { validateDatabaseName } from "@/lib/db-admin/names";
import { getClient } from "@/lib/db-admin/pool";
import { mutate, read } from "@/lib/db-admin/run";
import type { BackupSummary, RestoreResult } from "@/lib/db-admin/types";

export async function listBackups(connectionId?: string | null) {
  return read("Failed to list backups", async (): Promise<BackupSummary[]> => {
    await markStaleBackups();
    const rows = await prisma.dbBackup.findMany({
      where: connectionId ? { connectionId } : {},
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toSummary);
  });
}

export async function getBackup(id: string) {
  return read("Failed to load backup", async () => {
    const row = await prisma.dbBackup.findUnique({ where: { id } });
    if (!row) throw new DbAdminError("Backup not found");
    return toSummary(row);
  });
}

/** inserts a running record, returns it right away and streams the backup in the background (after()) */
export async function createBackup(
  connectionId: string,
  database: string,
  input: { name: string; description?: string | null; collections?: string[] | null },
) {
  return mutate(
    (d?: BackupSummary) => ({
      action: "backup.create",
      connectionId,
      target: database,
      details: { backupId: d?.id ?? null, name: input.name, collections: input.collections ?? "all" },
    }),
    "Failed to start backup",
    async (actor) => {
      const db = validateDatabaseName(database);
      const name = input.name?.trim() || `${db} ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
      const { client, conn } = await getClient(connectionId);
      // validates the collection subset before anything is written
      const metas = await backupTargets(client.db(db), input.collections ?? null);
      if (!metas.length) throw new DbAdminError(`Database "${db}" has no collections to back up`);
      const id = newBackupId();
      const row = await prisma.dbBackup.create({
        data: {
          id,
          connectionId,
          connectionName: conn.name,
          database: db,
          name,
          description: input.description?.trim() || null,
          collections: input.collections?.length ? metas.map((m) => m.name) : [],
          fileName: fileNameFor(id),
          status: "running",
          source: "backup",
          createdById: actor.userId,
        },
      });
      // after() keeps the job alive past the response; outside a request (scripts) run it detached
      try {
        after(() => runBackup(row.id).catch((e) => console.error(`db backup ${row.id} failed:`, e)));
      } catch {
        background(runBackup(row.id), `db backup ${row.id}`);
      }
      return toSummary(row);
    },
  );
}

export async function deleteBackup(id: string) {
  return mutate({ action: "backup.delete", target: id }, "Failed to delete backup", async () => {
    const row = await prisma.dbBackup.findUnique({ where: { id } });
    if (!row) throw new DbAdminError("Backup not found");
    if (row.status === "running") throw new DbAdminError("The backup is still running");
    await fsp.rm(await backupFilePath(row), { force: true });
    await prisma.dbBackup.delete({ where: { id } });
    return { id };
  });
}

export async function restoreBackup(
  id: string,
  opts: { targetConnectionId: string; targetDatabase: string; collections?: string[] | null; mode: "drop" | "merge" },
) {
  return mutate(
    (d?: RestoreResult) => ({
      action: "backup.restore",
      connectionId: opts.targetConnectionId,
      target: opts.targetDatabase,
      details: {
        backupId: id,
        mode: opts.mode,
        collections: opts.collections?.length ? opts.collections : "all",
        ...(d ? { restored: d.documents, skipped: d.skipped } : {}),
      },
    }),
    "Restore failed",
    () => runRestore(id, opts),
  );
}

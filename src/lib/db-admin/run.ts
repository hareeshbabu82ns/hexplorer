import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DbAdminError, errorMessage, isUnauthorizedError, UNAUTHORIZED } from "./errors";
import { DbAdminActor, requireDbAdmin } from "./guard";
import type { ActionResult } from "./types";

export interface AuditEntry {
  /** e.g. database.drop, user.create, backup.restore */
  action: string;
  connectionId?: string | null;
  /** e.g. db.collection */
  target?: string | null;
  /** never put passwords or URIs here */
  details?: Record<string, unknown>;
}

const isUnauthorized = (e: unknown) => e instanceof DbAdminError && e.message === UNAUTHORIZED;

/** guarded read: never throws */
export async function read<T>(
  fallback: string,
  task: (actor: DbAdminActor) => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    const actor = await requireDbAdmin();
    return { success: true, data: await task(actor) };
  } catch (e) {
    if (!(e instanceof DbAdminError) && !isUnauthorizedError(e)) console.error(`[db-admin] ${fallback}:`, e);
    return { success: false, error: isUnauthorized(e) ? UNAUTHORIZED : errorMessage(e, fallback) };
  }
}

export async function writeAudit(actor: DbAdminActor, entry: AuditEntry, success: boolean, error?: string) {
  try {
    await prisma.dbAuditLog.create({
      data: {
        userId: actor.userId,
        actorEmail: actor.email,
        action: entry.action,
        connectionId: entry.connectionId ?? null,
        target: entry.target ?? null,
        success,
        error: error ?? null,
        details: (entry.details ?? {}) as Prisma.InputJsonValue,
      },
    });
  } catch (e) {
    console.error("[db-admin] failed to write audit log", e);
  }
}

/**
 * guarded mutation: writes an audit row on success and on failure. `audit` may
 * be a function of the result to add details known only afterwards.
 */
export async function mutate<T>(
  audit: AuditEntry | ((data: T | undefined) => AuditEntry),
  fallback: string,
  task: (actor: DbAdminActor) => Promise<T>,
): Promise<ActionResult<T>> {
  let actor: DbAdminActor;
  try {
    actor = await requireDbAdmin();
  } catch {
    return { success: false, error: UNAUTHORIZED };
  }
  const entryFor = (data?: T) => (typeof audit === "function" ? audit(data) : audit);
  try {
    const data = await task(actor);
    await writeAudit(actor, entryFor(data), true);
    return { success: true, data };
  } catch (e) {
    const error = errorMessage(e, fallback);
    if (!(e instanceof DbAdminError) && !isUnauthorizedError(e)) console.error(`[db-admin] ${fallback}:`, e);
    let entry: AuditEntry;
    try {
      entry = entryFor(undefined);
    } catch {
      entry = typeof audit === "function" ? { action: "unknown" } : audit;
    }
    await writeAudit(actor, entry, false, error);
    return { success: false, error };
  }
}

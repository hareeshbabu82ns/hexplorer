import { PrismaClient } from "@prisma/client";

const g = globalThis as unknown as { _prisma?: PrismaClient };

/** one client per process (kept on globalThis so dev hot reload does not leak clients) */
export const prisma: PrismaClient = (g._prisma ??= new PrismaClient());

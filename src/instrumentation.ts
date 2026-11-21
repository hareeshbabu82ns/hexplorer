/** runs once per server start (Next.js instrumentation hook) */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startBackupScheduler } = await import("@/lib/backup");
  startBackupScheduler();
}

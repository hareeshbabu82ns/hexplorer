/**
 * In-process job bookkeeping.
 *  - runningJobs: exclusive scan/hash jobs per folder, and backup jobs by backup id
 *  - folder usage refcount: folders in use by a backup (must not be unmounted/scanned)
 */
const g = globalThis as unknown as { _hexJobs?: Set<string>; _hexBusy?: Map<string, number> };
export const runningJobs = (g._hexJobs ??= new Set<string>());
const busy = (g._hexBusy ??= new Map<string, number>());

export function isJobRunning(id: string) {
  return runningJobs.has(id) || (busy.get(id) ?? 0) > 0;
}

/** mark folders as in use; returns a release function */
export function holdFolders(ids: string[]) {
  ids.forEach((id) => busy.set(id, (busy.get(id) ?? 0) + 1));
  let released = false;
  return () => {
    if (released) return;
    released = true;
    ids.forEach((id) => {
      const n = (busy.get(id) ?? 1) - 1;
      if (n <= 0) busy.delete(id);
      else busy.set(id, n);
    });
  };
}

/** fire-and-forget a background job without risking an unhandled rejection */
export function background(p: Promise<unknown>, what: string) {
  p.catch((e) => console.error(`background ${what} failed:`, e));
}

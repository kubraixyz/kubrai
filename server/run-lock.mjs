// One copy at a time, however each was started. Cron wraps its jobs in flock(1), but a person running the same script by
// hand goes around that lock; for a job that pays money two overlapping runs read the same ledger and pay the same
// people twice (referral-payout.mjs, audit 2026-10-05). So the script takes the lock itself: it runs again as a child of
// `flock -n <lockFile>`, and that child does the work. The lock is the kernel's, gone the moment the holder dies, so a
// crash never leaves a stale one behind.
import { spawnSync } from "node:child_process";

export const LOCK_BUSY = 75;   // exit code of the copy that found the lock taken (flock -E)

/** Call at the top of a script, before any work. Returns only in the copy that holds the lock; any other process
 *  exits here with the child's code (LOCK_BUSY when another run holds it; 1 when flock itself could not run). */
export function runLocked(lockFile) {
  if (process.env.KUBRAI_RUN_LOCK === lockFile) return;   // this is the child that holds it
  const r = spawnSync("flock", ["-n", "-E", String(LOCK_BUSY), lockFile, process.execPath, ...process.execArgv, ...process.argv.slice(1)],
    { stdio: "inherit", env: { ...process.env, KUBRAI_RUN_LOCK: lockFile } });
  if (r.error) { console.error(`${new Date().toISOString()} could not take the lock ${lockFile} (${r.error.message}); not running`); process.exit(1); }
  if (r.status === LOCK_BUSY) console.error(`${new Date().toISOString()} another run holds ${lockFile}; this one did nothing`);
  process.exit(r.status ?? 1);
}

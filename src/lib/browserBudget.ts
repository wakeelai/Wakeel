import { newId, today, type Db } from "./db";
const LEASE_MS = 30_000;
const MAX_CONCURRENT = 3;
const MAX_DAILY_MS = 600_000;

/** Reserve one of three concurrent slots and <=30 seconds of the shared daily free allotment atomically. */
export async function reserveBrowserRun(db: Db, maxRunsPerDay: number): Promise<string | null> {
  const day = today();
  const ts = Date.now();
  const leaseId = newId("browser");
  await db.run("DELETE FROM browser_run_leases WHERE expires_at <= ?", ts);
  const results = await db.batch([
    db.stmt(
      `INSERT INTO browser_run_leases (lease_id, expires_at)
       SELECT ?, ? WHERE (SELECT COUNT(*) FROM browser_run_leases WHERE expires_at > ?) < ?`,
      leaseId, ts + LEASE_MS, ts, MAX_CONCURRENT,
    ),
    db.stmt(
      `INSERT INTO browser_daily_usage (day, calls, reserved_ms, used_ms)
       SELECT ?, 1, 30000, 0 WHERE EXISTS (SELECT 1 FROM browser_run_leases WHERE lease_id = ?)
       ON CONFLICT(day) DO UPDATE SET calls = calls + 1, reserved_ms = reserved_ms + 30000
       WHERE calls < ? AND used_ms + reserved_ms + 30000 <= ? RETURNING calls`,
      day, leaseId, Math.min(20, Math.max(1, maxRunsPerDay)), MAX_DAILY_MS,
    ),
    db.stmt("DELETE FROM browser_run_leases WHERE lease_id = ? AND changes() = 0", leaseId),
  ]);
  return (results[1]?.meta?.changes ?? 0) === 1 ? leaseId : null;
}

/** Release the reservation and lease on completion; stale leases expire after the hard run budget. */
export async function settleBrowserRun(db: Db, leaseId: string, elapsedMs: number): Promise<void> {
  await db.batch([
    db.stmt(
      `UPDATE browser_daily_usage SET reserved_ms = MAX(0, reserved_ms - 30000), used_ms = used_ms + ?
       WHERE day = ? AND reserved_ms >= 30000`,
      Math.max(0, Math.min(30_000, Math.ceil(elapsedMs))), today(),
    ),
    db.stmt("DELETE FROM browser_run_leases WHERE lease_id = ?", leaseId),
  ]);
}

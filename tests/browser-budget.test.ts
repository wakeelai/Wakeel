import { describe, expect, it } from "vitest";
import { Db } from "../src/lib/db";
import { reserveBrowserRun, settleBrowserRun } from "../src/lib/browserBudget";
import { createTestD1 } from "./testDb";

describe("atomic free Browser Run budget", () => {
  it("admits at most three concurrent sessions and releases slots when settled", async () => {
    const raw = createTestD1();
    const db = new Db(raw);
    const leases = await Promise.all(Array.from({ length: 8 }, () => reserveBrowserRun(db, 20)));
    expect(leases.filter(Boolean)).toHaveLength(3);
    await expect(raw.prepare("SELECT COUNT(*) AS n FROM browser_run_leases").first()).resolves.toMatchObject({ n: 3 });
    for (const lease of leases.filter((id): id is string => !!id)) await settleBrowserRun(db, lease, 5_000);
    await expect(raw.prepare("SELECT COUNT(*) AS n FROM browser_run_leases").first()).resolves.toMatchObject({ n: 0 });
    await expect(raw.prepare("SELECT used_ms AS n FROM browser_daily_usage").first()).resolves.toMatchObject({ n: 15_000 });
  });

  it("never reserves beyond the app-wide 10-minute daily ceiling", async () => {
    const raw = createTestD1();
    const db = new Db(raw);
    const held: string[] = [];
    for (let i = 0; i < 20; i++) {
      const lease = await reserveBrowserRun(db, 20);
      if (lease) held.push(lease);
      if (held.length === 3) await settleBrowserRun(db, held.shift()!, 30_000);
    }
    const row = await raw.prepare("SELECT calls, used_ms FROM browser_daily_usage").first<{ calls: number; used_ms: number }>();
    expect(row?.calls).toBeLessThanOrEqual(20);
    expect((row?.used_ms ?? 0) + (Number(raw._get("browser_daily_usage", { day: new Date().toISOString().slice(0, 10) })?.reserved_ms) || 0)).toBeLessThanOrEqual(600_000);
    for (const lease of held) await settleBrowserRun(db, lease, 1_000);
  });
});

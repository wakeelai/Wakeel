import { Hono } from "hono";
import type { Env } from "../types";
import { Db, today } from "../lib/db";
import { loadSettings } from "../lib/settings";

export const usageRoute = new Hono<{ Bindings: Env }>();

usageRoute.get("/", async (c) => {
  const user = c.get("user");
  const db = new Db(c.env.DB);
  const day = today();

  const rows = await db.all<{ provider: string; calls: number }>(
    "SELECT provider, calls FROM usage WHERE user_id = ? AND day = ?",
    user.id,
    day,
  );
  const credits = await db.first<{ balance: number }>(
    "SELECT balance FROM credits WHERE user_id = ?",
    user.id,
  );

  const s = await loadSettings(c.env);
  return c.json({
    day,
    // Explicitly labeled: this is OUR counter, not a claim about the
    // provider's real remaining quota (we generally can't know that).
    source: "application-estimated",
    providers: rows,
    creditsBalance: credits?.balance ?? 0,
    limits: {
      maxFreeAiCallsPerDay: s.maxFreeAiCallsPerDay,
      maxBrowserTasksPerDay: s.maxBrowserTasksPerDay,
    },
  });
});

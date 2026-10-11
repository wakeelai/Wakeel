import { Hono } from "hono";
import type { Env } from "../types";
import { Db, newId, now, today } from "../lib/db";
import { loadSettings, NUMERIC_SETTING_KEYS } from "../lib/settings";
import { MAX_OBJECT_BYTES, MAX_TOTAL_OBJECT_BYTES } from "../lib/objectStore";
import { finalizePaymentAndCredit } from "../payments/credit";

export const adminRoute = new Hono<{ Bindings: Env }>();

async function logAdminAction(
  db: Db,
  adminUserId: string,
  action: string,
  targetType: string,
  targetId: string,
  metadata: unknown = {},
) {
  await db.run(
    `INSERT INTO admin_logs (id, admin_user_id, action, target_type, target_id, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    newId("alog"),
    adminUserId,
    action,
    targetType,
    targetId,
    JSON.stringify(metadata),
    now(),
  );
}

adminRoute.get("/dashboard", async (c) => {
  const db = new Db(c.env.DB);
  const [users, tasks, revenue, failedTasks, payments] = await Promise.all([
    db.first<{ n: number }>("SELECT COUNT(*) as n FROM users"),
    db.first<{ n: number }>("SELECT COUNT(*) as n FROM tasks"),
    db.first<{ total: number }>(
      "SELECT COALESCE(SUM(amount_usd),0) as total FROM payments WHERE status = 'finished'",
    ),
    db.first<{ n: number }>("SELECT COUNT(*) as n FROM tasks WHERE status = 'failed'"),
    db.first<{ n: number }>("SELECT COUNT(*) as n FROM payments WHERE status = 'finished'"),
  ]);

  const day = today();
  const providerUsage = await db.all(
    "SELECT provider, SUM(calls) as calls FROM usage WHERE day = ? GROUP BY provider",
    day,
  );

  return c.json({
    totalUsers: users?.n ?? 0,
    totalTasks: tasks?.n ?? 0,
    failedTasks: failedTasks?.n ?? 0,
    totalRevenueUsd: revenue?.total ?? 0,
    totalPayments: payments?.n ?? 0,
    providerUsageToday: providerUsage,
  });
});

// --- Users --------------------------------------------------------------

adminRoute.get("/users", async (c) => {
  const db = new Db(c.env.DB);
  const q = c.req.query("q");
  const users = q
    ? await db.all(
        "SELECT id, email, display_name, role, status, created_at FROM users WHERE email LIKE ? ORDER BY created_at DESC LIMIT 100",
        `%${q}%`,
      )
    : await db.all(
        "SELECT id, email, display_name, role, status, created_at FROM users ORDER BY created_at DESC LIMIT 100",
      );
  return c.json({ users });
});

adminRoute.get("/users/:id", async (c) => {
  const db = new Db(c.env.DB);
  const id = c.req.param("id");
  const [user, credits, tasks, payments] = await Promise.all([
    db.first("SELECT * FROM users WHERE id = ?", id),
    db.first<{ balance: number }>("SELECT balance FROM credits WHERE user_id = ?", id),
    db.all("SELECT id, title, status, created_at FROM tasks WHERE user_id = ? ORDER BY created_at DESC LIMIT 50", id),
    db.all("SELECT id, amount_usd, status, created_at FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 50", id),
  ]);
  if (!user) return c.json({ error: "Not found" }, 404);
  return c.json({ user, creditsBalance: credits?.balance ?? 0, tasks, payments });
});

adminRoute.post("/users/:id/suspend", async (c) => {
  const admin = c.get("user");
  const db = new Db(c.env.DB);
  const id = c.req.param("id");
  const body = await c.req.json<{ suspended: boolean }>();
  await db.run(
    "UPDATE users SET status = ?, updated_at = ? WHERE id = ?",
    body.suspended ? "suspended" : "active",
    now(),
    id,
  );
  await logAdminAction(db, admin.id, body.suspended ? "suspend_user" : "unsuspend_user", "user", id);
  return c.json({ ok: true });
});

adminRoute.post("/users/:id/credits", async (c) => {
  const admin = c.get("user");
  const db = new Db(c.env.DB);
  const id = c.req.param("id");
  const body = await c.req.json<{ amount: number; reason?: string }>();
  if (!Number.isInteger(body.amount)) return c.json({ error: "amount must be an integer" }, 400);

  const row = await db.first<{ balance: number }>("SELECT balance FROM credits WHERE user_id = ?", id);
  const balanceAfter = Math.max(0, (row?.balance ?? 0) + body.amount);
  if (row) {
    await db.run("UPDATE credits SET balance = ?, updated_at = ? WHERE user_id = ?", balanceAfter, now(), id);
  } else {
    await db.run("INSERT INTO credits (user_id, balance, updated_at) VALUES (?, ?, ?)", id, balanceAfter, now());
  }
  await db.run(
    `INSERT INTO credit_transactions (id, user_id, amount, reason, balance_after, created_at)
     VALUES (?, ?, ?, 'admin_adjustment', ?, ?)`,
    newId("ctx"),
    id,
    body.amount,
    balanceAfter,
    now(),
  );
  await logAdminAction(db, admin.id, "adjust_credits", "user", id, { amount: body.amount, reason: body.reason });
  return c.json({ ok: true, balance: balanceAfter });
});

// --- Payments -------------------------------------------------------------

adminRoute.get("/payments", async (c) => {
  const db = new Db(c.env.DB);
  const payments = await db.all(
    `SELECT p.*, u.email as user_email FROM payments p
     JOIN users u ON u.id = p.user_id
     ORDER BY p.created_at DESC LIMIT 200`,
  );
  return c.json({ payments });
});

/**
 * Manual approval path for Direct Wallet Mode: an admin reviews the
 * submitted tx hash (e.g. against a block explorer) and only then are
 * credits granted — mirroring the automatic NOWPayments webhook flow but
 * with a human in the loop instead of a cryptographic signature.
 */
adminRoute.post("/payments/:id/approve", async (c) => {
  const admin = c.get("user");
  const db = new Db(c.env.DB);
  const id = c.req.param("id");

  const payment = await db.first<{
    id: string;
    user_id: string;
    plan_id: string;
    status: string;
    provider: string;
  }>("SELECT * FROM payments WHERE id = ?", id);
  if (!payment) return c.json({ error: "Not found" }, 404);
  if (payment.provider !== "direct_wallet") {
    return c.json({ error: "Only direct_wallet payments use manual approval" }, 400);
  }
  if (payment.status === "finished") {
    return c.json({ ok: true, alreadyFinished: true });
  }

  if (payment.status !== "pending_review") {
    return c.json({ error: "Only payments awaiting review (with a submitted tx hash) can be approved" }, 400);
  }

  const result = await finalizePaymentAndCredit(db, { paymentId: payment.id });
  await logAdminAction(db, admin.id, "approve_payment", "payment", payment.id, { credits: result.credits });
  return c.json({ ok: true, creditsAwarded: result.credits, alreadyFinished: result.duplicate === true });
});

adminRoute.post("/payments/:id/reject", async (c) => {
  const admin = c.get("user");
  const db = new Db(c.env.DB);
  const id = c.req.param("id");
  const res = await db.run(
    "UPDATE payments SET status = 'failed', updated_at = ? WHERE id = ? AND provider = 'direct_wallet' AND status = 'pending_review'",
    now(),
    id,
  );
  if ((res.meta?.changes ?? 0) === 0) return c.json({ error: "Nothing to reject" }, 400);
  await logAdminAction(db, admin.id, "reject_payment", "payment", id);
  return c.json({ ok: true });
});

// --- Settings ---------------------------------------------------------

adminRoute.get("/settings", async (c) => {
  const db = new Db(c.env.DB);
  const settings = await loadSettings(c.env);
  const plans = await db.all("SELECT * FROM plans ORDER BY sort_order ASC");
  return c.json({
    settings,
    plans,
    envLimits: {
      maxFreeAiCallsPerDay: c.env.MAX_FREE_AI_CALLS_PER_DAY,
      maxBrowserTasksPerDay: c.env.MAX_BROWSER_TASKS_PER_DAY,
      maxTaskRuntimeMs: c.env.MAX_TASK_RUNTIME_MS,
      maxFileSizeMb: c.env.MAX_FILE_SIZE_MB,
      maxProjectsPerUser: c.env.MAX_PROJECTS_PER_USER,
      maxStorageMbPerUser: c.env.MAX_STORAGE_MB_PER_USER,
    },
    providers: {
      groq: Boolean(c.env.GROQ_API_KEY),
      openrouter: Boolean(c.env.OPENROUTER_API_KEY),
      cloudflareAi: true, // binding is always present if configured in wrangler.toml
      jinaReader: true, // reader endpoint is deliberately used without a key
      cloudflareBrowser: Boolean(c.env.BROWSER),
      nowpayments: Boolean(c.env.NOWPAYMENTS_API_KEY && c.env.NOWPAYMENTS_IPN_SECRET),
      directWallet: Boolean(c.env.TRUST_WALLET_ADDRESS),
    },
  });
});

adminRoute.post("/settings", async (c) => {
  const admin = c.get("user");
  const db = new Db(c.env.DB);
  const body = await c.req.json<Record<string, unknown>>();
  // Whitelist + validate: only known numeric limits and the maintenance flag are ever stored.
  const clean: Record<string, number | boolean> = {};
  for (const key of NUMERIC_SETTING_KEYS) {
    const v = body[key];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) {
      const requested = Math.floor(v);
      clean[key] = key === "maxFileSizeMb"
        ? Math.min(requested, MAX_OBJECT_BYTES / (1024 * 1024))
        : key === "maxStorageMbPerUser"
          ? Math.min(requested, MAX_TOTAL_OBJECT_BYTES / (1024 * 1024))
          : requested;
    }
  }
  if (typeof body.maintenanceMode === "boolean") clean.maintenanceMode = body.maintenanceMode;

  const existing = await db.first<{ id: string }>(
    "SELECT id FROM agent_settings WHERE id = 'global'",
  );
  if (existing) {
    await db.run(
      "UPDATE agent_settings SET settings_json = ?, updated_at = ? WHERE id = 'global'",
      JSON.stringify(clean),
      now(),
    );
  } else {
    await db.run(
      "INSERT INTO agent_settings (id, scope, settings_json, updated_at) VALUES ('global', 'global', ?, ?)",
      JSON.stringify(clean),
      now(),
    );
  }
  await logAdminAction(db, admin.id, "update_settings", "agent_settings", "global", clean);
  return c.json({ ok: true });
});

adminRoute.patch("/plans/:id", async (c) => {
  const admin = c.get("user");
  const db = new Db(c.env.DB);
  const id = c.req.param("id");
  const body = await c.req.json<{ priceUsd?: number; creditsIncluded?: number; isActive?: boolean }>();
  if (
    (body.priceUsd !== undefined && !(body.priceUsd >= 0)) ||
    (body.creditsIncluded !== undefined && !(Number.isInteger(body.creditsIncluded) && body.creditsIncluded >= 0))
  ) {
    return c.json({ error: "Invalid plan values" }, 400);
  }

  const fields: string[] = [];
  const values: unknown[] = [];
  if (body.priceUsd !== undefined) { fields.push("price_usd = ?"); values.push(body.priceUsd); }
  if (body.creditsIncluded !== undefined) { fields.push("credits_included = ?"); values.push(body.creditsIncluded); }
  if (body.isActive !== undefined) { fields.push("is_active = ?"); values.push(body.isActive ? 1 : 0); }
  if (fields.length === 0) return c.json({ ok: true });

  values.push(id);
  await db.run(`UPDATE plans SET ${fields.join(", ")} WHERE id = ?`, ...values);
  await logAdminAction(db, admin.id, "update_plan", "plan", id, body);
  return c.json({ ok: true });
});

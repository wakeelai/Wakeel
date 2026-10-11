import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import type { Context, Next } from "hono";
import type { Env } from "./types";
import { Db } from "./lib/db";
import { loadSettings } from "./lib/settings";
import { authMiddleware, adminMiddleware } from "./middleware/auth";
import { rateLimit, ipKey, userKey } from "./middleware/rateLimit";
import { authRoute } from "./routes/auth";
import { tasksRoute } from "./routes/tasks";
import { projectsRoute } from "./routes/projects";
import { filesRoute } from "./routes/files";
import { artifactsRoute } from "./routes/artifacts";
import { usageRoute } from "./routes/usage";
import { paymentsRoute } from "./routes/payments";
import { scanBscPaymentInvoices } from "./payments/bscAutoScanner";
import { webhooksRoute } from "./routes/webhooks";
import { adminRoute } from "./routes/admin";

const app = new Hono<{ Bindings: Env }>();

app.use("*", secureHeaders());
app.use(
  "/api/*",
  cors({
    origin: (origin, c) => {
      if (!origin) return undefined;
      let requestUrl: URL;
      try { requestUrl = new URL(c.req.url); } catch { return undefined; }
      if (origin === requestUrl.origin) return origin;
      const explicit = (c.env.CORS_ALLOWED_ORIGINS ?? "").split(",").map((value: string) => value.trim()).filter(Boolean);
      if (explicit.includes(origin)) return origin;
      if (c.env.APP_ENV === "development" && requestUrl.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(requestUrl.hostname)) {
        try {
          const parsed = new URL(origin);
          if (parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) return origin;
        } catch { /* invalid Origin is rejected */ }
      }
      return undefined;
    },
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  }),
);

app.get("/api/health", (c) => c.json({ ok: true, app: c.env.APP_NAME }));

// Public: the pricing page is visible to guests. Prices are admin-editable, so they come from D1.
app.get("/api/plans", async (c) => {
  const plans = await new Db(c.env.DB).all(
    "SELECT id, name, price_usd, credits_included, features_json, is_active, sort_order FROM plans WHERE is_active = 1 ORDER BY sort_order ASC",
  );
  return c.json({ plans });
});

/** Maintenance mode blocks anything that creates work or stores data, for non-admins only. */
async function maintenanceGuard(c: Context<{ Bindings: Env }>, next: Next) {
  if (c.req.method !== "GET") {
    const settings = await loadSettings(c.env);
    if (settings.maintenanceMode && c.get("user").role !== "admin") {
      return c.json({ error: "The service is under maintenance. Please try again shortly.", code: "maintenance" }, 503);
    }
  }
  await next();
}

// Public webhook endpoint — NOT behind authMiddleware (NOWPayments calls
// this directly). It authenticates itself via HMAC signature instead.
// Rate-limit middleware is registered BEFORE the route so it runs first.
app.use("/api/webhooks/*", rateLimit({ windowSeconds: 60, max: 60, keyFn: ipKey }));
app.route("/api/webhooks", webhooksRoute);

// Everything else under /api requires a verified Supabase Auth access token.
app.use("/api/auth/*", authMiddleware, rateLimit({ windowSeconds: 60, max: 60, keyFn: userKey }));
app.use("/api/tasks/*", authMiddleware, maintenanceGuard);
app.use("/api/projects/*", authMiddleware, maintenanceGuard);
app.use("/api/files/*", authMiddleware, maintenanceGuard, rateLimit({ windowSeconds: 60, max: 30, keyFn: userKey }));
app.use("/api/artifacts/*", authMiddleware);
app.use("/api/usage/*", authMiddleware);
app.use("/api/payments/*", authMiddleware, rateLimit({ windowSeconds: 60, max: 10, keyFn: userKey }));
app.use("/api/admin/*", authMiddleware, adminMiddleware);

app.route("/api/auth", authRoute);
app.route("/api/tasks", tasksRoute);
app.route("/api/projects", projectsRoute);
app.route("/api/files", filesRoute);
app.route("/api/artifacts", artifactsRoute);
app.route("/api/usage", usageRoute);
app.route("/api/payments", paymentsRoute);
app.route("/api/admin", adminRoute);

app.notFound((c) => {
  if (c.req.path.startsWith("/api/")) {
    return c.json({ error: "Not found" }, 404);
  }
  // Non-API paths fall through to the static SPA build.
  return c.env.ASSETS.fetch(c.req.raw);
});

app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

// Cloudflare Cron Trigger: passively detect transfers every five minutes. Keep the
// Hono instance itself as the default object so app.request remains available in tests.
const worker = Object.assign(app, {
  fetch: app.fetch.bind(app),
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      scanBscPaymentInvoices(env).then((result) => {
        if (result.paymentsCredited > 0) console.log("BSC USDT payments credited", result);
      }).catch((error) => {
        console.error("BSC USDT automatic scanner failed; cursor retained for retry", String(error).slice(0, 220));
      }),
    );
  },
});

export default worker;

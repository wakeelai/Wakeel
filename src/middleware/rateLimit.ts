import type { Context, Next } from "hono";
import type { Env } from "../types";

/**
 * Atomic fixed-window D1 limiter. KV get/put is eventually consistent and can lose increments
 * during bursts; UPSERT serializes counter increments on the primary database.
 */
export function rateLimit(opts: {
  windowSeconds: number;
  max: number;
  keyFn: (c: Context<{ Bindings: Env }>) => string;
}) {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const bucket = Math.floor(Date.now() / (opts.windowSeconds * 1000));
    const key = `rl:${opts.windowSeconds}:${opts.keyFn(c)}`;
    const row = await c.env.DB.prepare(
      `INSERT INTO rate_limit_counters (bucket_key, window_id, count) VALUES (?, ?, 1)
       ON CONFLICT(bucket_key, window_id) DO UPDATE SET count = count + 1 RETURNING count`,
    ).bind(key, bucket).first<{ count: number }>();
    const current = Number(row?.count ?? opts.max + 1);
    if (current === 1 && bucket % 60 === 0) {
      await c.env.DB.prepare("DELETE FROM rate_limit_counters WHERE bucket_key = ? AND window_id < ?").bind(key, bucket - 2).run();
    }
    if (current > opts.max) {
      const retryAfter = opts.windowSeconds - (Math.floor(Date.now() / 1000) % opts.windowSeconds);
      c.header("Retry-After", String(retryAfter));
      return c.json(
        { error: "Rate limit exceeded, please slow down and try again shortly.", retryAfterSeconds: retryAfter },
        429,
      );
    }
    await next();
  };
}

export function ipKey(c: Context<{ Bindings: Env }>): string {
  return c.req.header("cf-connecting-ip") ?? "unknown-ip";
}

export function userKey(c: Context<{ Bindings: Env }>): string {
  return c.get("user")?.id ?? ipKey(c);
}

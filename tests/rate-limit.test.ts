import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/types";
import { rateLimit } from "../src/middleware/rateLimit";
import { createTestD1 } from "./testDb";

describe("atomic D1 rate limiter", () => {
  it("admits exactly the configured number during a concurrent burst and sets Retry-After", async () => {
    const raw = createTestD1();
    const app = new Hono<{ Bindings: Env }>();
    app.use("*", rateLimit({ windowSeconds: 60, max: 10, keyFn: () => "shared-user" }));
    app.get("/", (c) => c.text("ok"));
    const env = { DB: raw } as unknown as Env;
    const responses = await Promise.all(Array.from({ length: 40 }, () => app.request("/", {}, env)));
    expect(responses.filter((r) => r.status === 200)).toHaveLength(10);
    const blocked = responses.filter((r) => r.status === 429);
    expect(blocked).toHaveLength(30);
    expect(Number(blocked[0]?.headers.get("Retry-After"))).toBeGreaterThan(0);
    const bucket = Math.floor(Date.now() / 60_000);
    expect(raw._get("rate_limit_counters", { bucket_key: "rl:60:shared-user", window_id: bucket })?.count).toBe(40);
  });
});

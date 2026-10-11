import { Hono } from "hono";
import type { Env } from "../types";
import { Db, now } from "../lib/db";

export const authRoute = new Hono<{ Bindings: Env }>();

authRoute.get("/me", async (c) => {
  const user = c.get("user");
  const db = new Db(c.env.DB);
  const profile = await db.first(
    "SELECT id, email, display_name, avatar_url, locale, theme, role, created_at FROM users WHERE id = ?",
    user.id,
  );
  const credits = await db.first<{ balance: number }>(
    "SELECT balance FROM credits WHERE user_id = ?",
    user.id,
  );
  return c.json({ user: profile, creditsBalance: credits?.balance ?? 0 });
});

authRoute.patch("/me", async (c) => {
  const user = c.get("user");
  const db = new Db(c.env.DB);
  const body = await c.req.json<{
    displayName?: string;
    locale?: "ar" | "en";
    theme?: "light" | "dark" | "system";
  }>();

  const fields: string[] = [];
  const values: unknown[] = [];
  if (body.displayName !== undefined) {
    fields.push("display_name = ?");
    values.push(body.displayName);
  }
  if (body.locale !== undefined) {
    fields.push("locale = ?");
    values.push(body.locale);
  }
  if (body.theme !== undefined) {
    fields.push("theme = ?");
    values.push(body.theme);
  }
  if (fields.length === 0) return c.json({ ok: true });

  fields.push("updated_at = ?");
  values.push(now());
  values.push(user.id);

  await db.run(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`, ...values);
  return c.json({ ok: true });
});

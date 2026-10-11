import type { Context, Next } from "hono";
import type { Env, AuthUser } from "../types";
import { verifySupabaseAccessToken, SupabaseAuthError } from "../lib/supabaseAuth";
import { Db, newId, now } from "../lib/db";

declare module "hono" {
  interface ContextVariableMap {
    user: AuthUser;
  }
}

export async function authMiddleware(
  c: Context<{ Bindings: Env }>,
  next: Next,
) {
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    return c.json({ error: "Missing bearer token" }, 401);
  }
  const token = header.slice("Bearer ".length).trim();
  if (!token || token.length > 16_384) {
    return c.json({ error: "Invalid or expired token" }, 401);
  }

  let claims;
  try {
    claims = await verifySupabaseAccessToken(token, c.env);
  } catch (error) {
    if (error instanceof SupabaseAuthError) {
      return c.json(
        { error: error.status === 401 ? "Invalid or expired token" : "Authentication service temporarily unavailable" },
        error.status,
      );
    }
    return c.json({ error: "Authentication service temporarily unavailable" }, 503);
  }

  const db = new Db(c.env.DB);
  let user = await db.first<{
    id: string;
    role: string;
    status: string;
    email: string;
  }>("SELECT id, role, status, email FROM users WHERE supabase_uid = ?", claims.uid);

  // Preserve accounts created under Firebase: only link an existing email when
  // Supabase confirms ownership, so a typo/unverified signup cannot take over data.
  if (!user) {
    const byEmail = await db.first<{
      id: string;
      role: string;
      status: string;
      email: string;
    }>("SELECT id, role, status, email FROM users WHERE lower(email) = lower(?)", claims.email);

    if (byEmail && !claims.emailVerified) {
      return c.json({
        error: "Verify this email with Supabase before linking it to an existing account.",
        code: "email_linking_requires_verified_email",
      }, 403);
    }

    if (byEmail && claims.emailVerified) {
      await db.run(
        "UPDATE users SET supabase_uid = ?, updated_at = ? WHERE id = ?",
        claims.uid,
        now(),
        byEmail.id,
      );
      // Re-read to ensure the identity link was actually applied and remains unique.
      user = await db.first<{ id: string; role: string; status: string; email: string }>(
        "SELECT id, role, status, email FROM users WHERE supabase_uid = ?",
        claims.uid,
      );
      if (!user) {
        return c.json({ error: "Account linking failed. Please contact support." }, 409);
      }
    }
  }

  if (!user) {
    const id = newId("user");
    const role = c.env.ADMIN_EMAIL && claims.email.toLowerCase() === c.env.ADMIN_EMAIL.toLowerCase() ? "admin" : "user";
    const ts = now();
    await db.run(
      `INSERT INTO users (id, supabase_uid, email, role, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?)`,
      id,
      claims.uid,
      claims.email,
      role,
      ts,
      ts,
    );
    await db.run(
      "INSERT INTO credits (user_id, balance, updated_at) VALUES (?, 100, ?)",
      id,
      ts,
    );
    await db.run(
      "INSERT INTO credit_transactions (id, user_id, amount, reason, balance_after, created_at) VALUES (?, ?, 100, 'signup_bonus', 100, ?)",
      newId("ctx"),
      id,
      ts,
    );
    user = { id, role, status: "active", email: claims.email };
  }

  if (user.status === "suspended") {
    return c.json({ error: "Account suspended" }, 403);
  }

  c.set("user", {
    id: user.id,
    supabaseUid: claims.uid,
    email: user.email,
    emailVerified: claims.emailVerified,
    role: user.role as "user" | "admin",
    status: user.status as "active" | "suspended",
  });

  await next();
}

export async function adminMiddleware(
  c: Context<{ Bindings: Env }>,
  next: Next,
) {
  const user = c.get("user");
  if (!user || user.role !== "admin") {
    return c.json({ error: "Admin access required" }, 403);
  }
  await next();
}

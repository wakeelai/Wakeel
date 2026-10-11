import type { Env } from "../types";

export interface SupabaseClaims {
  uid: string;
  email: string;
  emailVerified: boolean;
}

export class SupabaseAuthError extends Error {
  constructor(public status: 401 | 503, message: string) {
    super(message);
    this.name = "SupabaseAuthError";
  }
}

/**
 * Validates the bearer access token with Supabase Auth itself. This supports
 * both legacy HS256 tokens and projects using asymmetric signing keys without
 * storing a signing secret in the Worker. Only the publishable/anon API key is
 * sent; never use a Supabase secret/service-role key here.
 */
export async function verifySupabaseAccessToken(
  token: string,
  env: Env,
): Promise<SupabaseClaims> {
  const projectUrl = env.SUPABASE_URL?.trim();
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!projectUrl || !publishableKey) {
    throw new SupabaseAuthError(503, "Supabase Auth is not configured");
  }

  let endpoint: URL;
  try {
    endpoint = new URL("/auth/v1/user", projectUrl);
    if (endpoint.protocol !== "https:" && !(env.APP_ENV === "development" && endpoint.hostname === "localhost" && endpoint.protocol === "http:")) {
      throw new Error("SUPABASE_URL must use HTTPS");
    }
  } catch {
    throw new SupabaseAuthError(503, "SUPABASE_URL is invalid");
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "GET",
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new SupabaseAuthError(503, "Supabase Auth could not be reached");
  }

  if (response.status === 401 || response.status === 403) {
    throw new SupabaseAuthError(401, "Invalid or expired Supabase access token");
  }
  if (!response.ok) {
    throw new SupabaseAuthError(503, `Supabase Auth returned HTTP ${response.status}`);
  }

  const user = await response.json().catch(() => null) as {
    id?: unknown;
    email?: unknown;
    email_confirmed_at?: unknown;
    confirmed_at?: unknown;
  } | null;

  if (!user || typeof user.id !== "string" || !user.id || typeof user.email !== "string" || !user.email) {
    throw new SupabaseAuthError(401, "Supabase user token is missing a valid user identity");
  }

  return {
    uid: user.id,
    email: user.email,
    emailVerified: Boolean(user.email_confirmed_at || user.confirmed_at),
  };
}

import { afterEach, describe, expect, it, vi } from "vitest";
import { verifySupabaseAccessToken, SupabaseAuthError } from "../src/lib/supabaseAuth";
import type { Env } from "../src/types";

const env = {
  APP_ENV: "test",
  SUPABASE_URL: "https://wakeel-test.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_key",
} as unknown as Env;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Supabase Auth token verification", () => {
  it("validates the bearer token with Supabase Auth and returns verified claims", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "supabase-user-1",
      email: "verified@example.test",
      email_confirmed_at: "2026-10-10T10:00:00.000Z",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const claims = await verifySupabaseAccessToken("access-token", env);

    expect(claims).toEqual({ uid: "supabase-user-1", email: "verified@example.test", emailVerified: true });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://wakeel-test.supabase.co/auth/v1/user"),
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          apikey: "sb_publishable_test_key",
          Authorization: "Bearer access-token",
        }),
      }),
    );
  });

  it("rejects invalid access tokens", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 401 })));
    await expect(verifySupabaseAccessToken("expired-token", env)).rejects.toMatchObject({ status: 401 });
  });

  it("fails closed when Supabase is not configured", async () => {
    await expect(verifySupabaseAccessToken("token", { APP_ENV: "test" } as unknown as Env))
      .rejects.toBeInstanceOf(SupabaseAuthError);
  });
});

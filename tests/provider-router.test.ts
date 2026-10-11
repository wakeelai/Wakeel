import { describe, it, expect, vi, beforeEach } from "vitest";
import { routeCompletion, AllProvidersExhaustedError } from "../src/providers/router";
import { OPENROUTER_FREE_MODELS } from "../src/providers/openrouter";
import { createTestD1 } from "./testDb";
import type { Env } from "../src/types";
import { today } from "../src/lib/db";

function baseEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: createTestD1(),
    AI: undefined as unknown as Ai,
    ASSETS: {} as Fetcher,
    APP_NAME: "Wakeel",
    APP_ENV: "test",
    MAX_FREE_AI_CALLS_PER_DAY: "200",
    MAX_BROWSER_TASKS_PER_DAY: "20",
    MAX_TASK_RUNTIME_MS: "180000",
    MAX_FILE_SIZE_MB: "20",
    MAX_PROJECTS_PER_USER: "50",
    MAX_STORAGE_MB_PER_USER: "150",
    ...overrides,
  } as Env;
}

describe("AI Provider Router", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("uses Groq when configured and healthy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "hello from groq" } }],
            usage: { prompt_tokens: 5, completion_tokens: 3 },
          }),
          { status: 200 },
        ),
      ),
    );

    const env = baseEnv({ GROQ_API_KEY: "test-key" });
    const result = await routeCompletion(env, "user-1", {
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result.provider).toBe("groq");
    expect(result.text).toBe("hello from groq");
  });

  it("falls through to OpenRouter when Groq returns 429, and never touches a paid API", async () => {
    let call = 0;
    let requestedModel = "";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        call++;
        if (url.includes("groq.com")) {
          return new Response("rate limited", { status: 429 });
        }
        if (url.includes("openrouter.ai")) {
          requestedModel = JSON.parse(String(init?.body)).model;
          return new Response(
            JSON.stringify({
              choices: [{ message: { content: "hello from openrouter" } }],
              usage: { prompt_tokens: 4, completion_tokens: 2 },
            }),
            { status: 200 },
          );
        }
        throw new Error(`unexpected fetch to ${url}`);
      }),
    );

    const env = baseEnv({ GROQ_API_KEY: "k1", OPENROUTER_API_KEY: "k2" });
    const result = await routeCompletion(env, "user-1", {
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result.provider).toBe("openrouter");
    expect(OPENROUTER_FREE_MODELS).toContain(requestedModel);
    expect(requestedModel).toMatch(/:free$/);
    expect(call).toBeGreaterThanOrEqual(2);
  });

  it("throws AllProvidersExhaustedError (no paid fallback) when every free provider is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("rate limited", { status: 429 })),
    );

    // No GROQ/OPENROUTER keys, no AI binding configured either.
    const env = baseEnv({});

    await expect(
      routeCompletion(env, "user-1", { messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toBeInstanceOf(AllProvidersExhaustedError);
  });

  it("records usage per provider per day and enforces the daily cap without ever billing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              choices: [{ message: { content: "ok" } }],
              usage: { prompt_tokens: 1, completion_tokens: 1 },
            }),
            { status: 200 },
          ),
      ),
    );

    const env = baseEnv({ GROQ_API_KEY: "k1", MAX_FREE_AI_CALLS_PER_DAY: "2" });

    await routeCompletion(env, "user-1", { messages: [{ role: "user", content: "a" }] });
    await routeCompletion(env, "user-1", { messages: [{ role: "user", content: "b" }] });

    // Third call this day should hit the hard cap, not silently upgrade.
    await expect(
      routeCompletion(env, "user-1", { messages: [{ role: "user", content: "c" }] }),
    ).rejects.toBeInstanceOf(AllProvidersExhaustedError);
  });

  it("atomically caps simultaneous requests at the configured daily allowance", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "ok" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const DB = createTestD1();
    const env = baseEnv({ DB, GROQ_API_KEY: "k1", MAX_FREE_AI_CALLS_PER_DAY: "2" });
    const results = await Promise.allSettled(Array.from({ length: 12 }, (_, i) =>
      routeCompletion(env, "user-concurrent", { messages: [{ role: "user", content: `request ${i}` }] }),
    ));

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    expect(results.filter((result) => result.status === "rejected" && result.reason instanceof AllProvidersExhaustedError)).toHaveLength(10);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(DB._get("ai_daily_reservations", { user_id: "user-concurrent", day: today() })?.calls).toBe(2);
    expect(DB._get("usage", { user_id: "user-concurrent", provider: "groq", day: today() })?.calls).toBe(2);
  });
});

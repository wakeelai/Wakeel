import { describe, expect, it } from "vitest";
import app from "../src/index";
import type { Env } from "../src/types";
import { createTestD1 } from "./testDb";

function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: createTestD1(),
    AI: undefined as unknown as Ai,
    ASSETS: {} as Fetcher,
    APP_NAME: "Wakeel",
    APP_ENV: "production",
    MAX_FREE_AI_CALLS_PER_DAY: "200",
    MAX_BROWSER_TASKS_PER_DAY: "20",
    MAX_TASK_RUNTIME_MS: "180000",
    MAX_FILE_SIZE_MB: "20",
    MAX_PROJECTS_PER_USER: "50",
    MAX_STORAGE_MB_PER_USER: "150",
    ...overrides,
  } as Env;
}

async function originHeader(origin: string, env: Env, url = "https://api.example.test/api/health") {
  const response = await app.fetch(new Request(url, { headers: { Origin: origin } }), env);
  return response.headers.get("Access-Control-Allow-Origin");
}

describe("CORS origin policy", () => {
  it("allows same-origin requests but does not reflect an arbitrary production origin", async () => {
    const env = testEnv();
    expect(await originHeader("https://api.example.test", env)).toBe("https://api.example.test");
    expect(await originHeader("https://attacker.example", env)).toBeNull();
  });

  it("allows only explicitly configured exact production origins", async () => {
    const env = testEnv({ CORS_ALLOWED_ORIGINS: "https://frontend.example, https://admin.example" });
    expect(await originHeader("https://frontend.example", env)).toBe("https://frontend.example");
    expect(await originHeader("https://evil-frontend.example", env)).toBeNull();
  });

  it("allows localhost development origins only in development mode", async () => {
    const dev = testEnv({ APP_ENV: "development" });
    expect(await originHeader("http://localhost:5173", dev, "http://localhost:8787/api/health")).toBe("http://localhost:5173");
    expect(await originHeader("http://localhost:5173", dev, "https://api.example.test/api/health")).toBeNull();
    expect(await originHeader("http://localhost:5173", testEnv())).toBeNull();
  });
});

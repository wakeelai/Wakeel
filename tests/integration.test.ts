import { describe, expect, it } from "vitest";
import { OPENROUTER_FREE_MODELS } from "../src/providers/openrouter";

const enabled = process.env.RUN_EXTERNAL_INTEGRATION === "1";
describe.skipIf(!enabled)("external-service acceptance (real HTTP)", () => {
  it("reads a public page from Jina Reader anonymously (no key or payment profile)", async () => {
    const response = await fetch("https://r.jina.ai/http://example.com", { signal: AbortSignal.timeout(20_000) });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Example Domain");
  }, 25_000);

  it("confirms every OpenRouter model used by the app exists and has zero price, without a key", async () => {
    const response = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(20_000) });
    expect(response.status).toBe(200);
    const body = await response.json() as { data?: { id: string; pricing?: { prompt?: string; completion?: string } }[] };
    const catalog = new Map((body.data ?? []).map((model) => [model.id, model]));
    for (const id of OPENROUTER_FREE_MODELS) {
      const model = catalog.get(id);
      expect(model, `${id} must remain in the public catalog`).toBeDefined();
      expect(Number(model?.pricing?.prompt), `${id} prompt price`).toBe(0);
      expect(Number(model?.pricing?.completion), `${id} completion price`).toBe(0);
    }
  }, 25_000);

  const allowBrowser = process.env.ALLOW_BROWSER_RUN_INTEGRATION === "1";
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  it.skipIf(!(allowBrowser && account && token))("renders a public page using Cloudflare Browser Run (consumes free browser minutes)", async () => {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/browser-rendering/content`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
      signal: AbortSignal.timeout(30_000),
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Example Domain");
  }, 35_000);
});

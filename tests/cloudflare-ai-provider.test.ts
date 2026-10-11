import { describe, expect, it, vi } from "vitest";
import { CLOUDFLARE_FREE_MODELS, createCloudflareAiProvider } from "../src/providers/cloudflareAi";
import { ProviderUnavailableError } from "../src/providers/types";

function fakeAi(run: ReturnType<typeof vi.fn>): Ai {
  return { run } as unknown as Ai;
}

describe("Cloudflare Workers AI free-model fallback", () => {
  it("tries the current free reasoning models and returns the first successful result", async () => {
    const run = vi.fn()
      .mockRejectedValueOnce(new Error("HTTP 503: model capacity unavailable"))
      .mockResolvedValueOnce({ response: "Arabic-ready answer" });
    const provider = createCloudflareAiProvider(fakeAi(run));

    const result = await provider.complete({ messages: [{ role: "user", content: "مرحبا" }] });

    expect(CLOUDFLARE_FREE_MODELS[0]).toBe("@cf/zai-org/glm-4.7-flash");
    expect(run).toHaveBeenNthCalledWith(1, CLOUDFLARE_FREE_MODELS[0], expect.any(Object));
    expect(run).toHaveBeenNthCalledWith(2, CLOUDFLARE_FREE_MODELS[1], expect.any(Object));
    expect(result.model).toBe(CLOUDFLARE_FREE_MODELS[1]);
    expect(result.text).toBe("Arabic-ready answer");
  });

  it("fails closed after exhausting all known free model IDs", async () => {
    const run = vi.fn().mockRejectedValue(new Error("429 daily quota limit"));
    const provider = createCloudflareAiProvider(fakeAi(run));
    await expect(provider.complete({ messages: [{ role: "user", content: "hi" }] }))
      .rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(run).toHaveBeenCalledTimes(CLOUDFLARE_FREE_MODELS.length);
  });

  it("does not mask unexpected input/programming errors as free quota exhaustion", async () => {
    const run = vi.fn().mockRejectedValue(new Error("invalid messages field"));
    const provider = createCloudflareAiProvider(fakeAi(run));
    await expect(provider.complete({ messages: [{ role: "user", content: "hi" }] }))
      .rejects.toThrow("invalid messages field");
    expect(run).toHaveBeenCalledTimes(1);
  });
});

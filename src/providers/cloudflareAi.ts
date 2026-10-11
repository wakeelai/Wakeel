import type {
  AiProvider,
  CompletionRequest,
  CompletionResult,
} from "./types";
import { ProviderUnavailableError } from "./types";

/**
 * Free-plan-safe Workers AI model chain. These model IDs are listed as usable
 * on Workers Free in Cloudflare's current model docs. We never add a model
 * whose onboarding/usage requires upgrading to a paid plan.
 *
 * GLM is the default for multilingual agent work; Gemma is a strong fallback;
 * Nemotron is the final fallback for more demanding reasoning. Deprecated model
 * IDs are intentionally excluded.
 */
export const CLOUDFLARE_FREE_MODELS = [
  "@cf/zai-org/glm-4.7-flash",
  "@cf/google/gemma-4-26b-a4b-it",
  "@cf/nvidia/nemotron-3-120b-a12b",
] as const;

function unavailableReason(error: unknown): string | null {
  const message = String(error);
  // Don't swallow programming/model-input errors: fall through only for
  // upstream availability, free-quota, unsupported-model, and rate-limit cases.
  if (/\b(401|402|403|404|408|429|500|502|503|504)\b|limit|quota|capacity|overload|throttl|temporarily unavailable|not found|paid plan/i.test(message)) {
    return message.slice(0, 300);
  }
  return null;
}

/** Uses env.AI (no provider API key) and rotates only among known free models. */
export function createCloudflareAiProvider(ai: Ai | undefined): AiProvider {
  return {
    name: "cloudflare_ai",
    isConfigured: () => Boolean(ai),
    async complete(req: CompletionRequest): Promise<CompletionResult> {
      if (!ai) throw new ProviderUnavailableError("cloudflare_ai", "AI binding missing");

      const attempts: string[] = [];
      for (const model of CLOUDFLARE_FREE_MODELS) {
        try {
          const result = (await ai.run(model, {
            messages: req.messages,
            max_tokens: req.maxTokens ?? 1200,
            temperature: req.temperature ?? 0.4,
          })) as { response?: string; choices?: { message?: { content?: string } }[] };

          const text = result.response ?? result.choices?.[0]?.message?.content ?? "";
          if (!text.trim()) {
            attempts.push(`${model}: empty response`);
            continue;
          }
          return { text, provider: "cloudflare_ai", model };
        } catch (error) {
          const reason = unavailableReason(error);
          if (!reason) throw error;
          attempts.push(`${model}: ${reason}`);
        }
      }

      throw new ProviderUnavailableError(
        "cloudflare_ai",
        attempts.join("; ") || "all free Workers AI models unavailable",
      );
    },
  };
}

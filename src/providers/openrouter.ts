import type {
  AiProvider,
  CompletionRequest,
  CompletionResult,
} from "./types";
import { ProviderUnavailableError } from "./types";

// Explicit :free variants that are checked against OpenRouter's public catalog
// by the opt-in acceptance test. Never silently route to a paid variant.
export const OPENROUTER_FREE_MODELS = [
  "nvidia/nemotron-3.5-lightning:free",
  "google/gemma-4-26b-a4b-it:free",
  "google/gemma-4-31b-it:free",
] as const;

// The Nemotron free endpoint doesn't advertise JSON-mode support; the planner
// still asks it for JSON in the system prompt.
const JSON_MODE_MODELS = new Set<string>([
  "google/gemma-4-26b-a4b-it:free",
  "google/gemma-4-31b-it:free",
]);

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const RETRYABLE_FREE_STATUSES = new Set([401, 402, 403, 404, 408, 429, 500, 502, 503, 504]);

export function createOpenRouterProvider(
  apiKey: string | undefined,
): AiProvider {
  return {
    name: "openrouter",
    isConfigured: () => Boolean(apiKey),
    async complete(req: CompletionRequest): Promise<CompletionResult> {
      if (!apiKey) {
        throw new ProviderUnavailableError("openrouter", "not configured");
      }

      let lastReason = "all configured free models are unavailable";
      for (const model of OPENROUTER_FREE_MODELS) {
        let res: Response;
        try {
          res = await fetch(OPENROUTER_URL, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
              "HTTP-Referer": "https://wakeel.app",
              "X-Title": "Wakeel",
            },
            signal: AbortSignal.timeout(20_000),
            body: JSON.stringify({
              model,
              messages: req.messages,
              temperature: req.temperature ?? 0.4,
              max_tokens: req.maxTokens ?? 1200,
              ...(req.jsonMode && JSON_MODE_MODELS.has(model)
                ? { response_format: { type: "json_object" } }
                : {}),
            }),
          });
        } catch (e) {
          lastReason = `network error: ${e}`;
          continue;
        }

        if (RETRYABLE_FREE_STATUSES.has(res.status)) {
          lastReason = `${model} unavailable (${res.status})`;
          // Auth/quota/rate-limit errors are account-wide; don't burn more
          // requests probing model variants for a key or account that is blocked.
          if ([401, 402, 403, 408, 429].includes(res.status)) break;
          continue;
        }
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`openrouter error ${res.status} (${model}): ${body.slice(0, 300)}`);
        }

        const data = (await res.json()) as {
          model?: string;
          choices: { message: { content: string } }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        const text = data.choices?.[0]?.message?.content ?? "";
        if (!text.trim()) {
          lastReason = `${model} returned an empty completion`;
          continue;
        }
        return {
          text,
          provider: "openrouter",
          model: data.model ?? model,
          tokensIn: data.usage?.prompt_tokens,
          tokensOut: data.usage?.completion_tokens,
        };
      }

      throw new ProviderUnavailableError("openrouter", lastReason);
    },
  };
}

import type {
  AiProvider,
  CompletionRequest,
  CompletionResult,
} from "./types";
import { ProviderUnavailableError } from "./types";

// Groq's current GPT-OSS 20B model is substantially more capable for reasoning
// and JSON-mode planning than the deprecated Llama 3.1 8B endpoint. Keep the
// key on Groq's Free plan; the router never switches models to a paid tier.
export const GROQ_MODEL = "openai/gpt-oss-20b";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

export function createGroqProvider(apiKey: string | undefined): AiProvider {
  return {
    name: "groq",
    isConfigured: () => Boolean(apiKey),
    async complete(req: CompletionRequest): Promise<CompletionResult> {
      if (!apiKey) {
        throw new ProviderUnavailableError("groq", "not configured");
      }

      let res: Response;
      try {
        res = await fetch(GROQ_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          signal: AbortSignal.timeout(20_000),
          body: JSON.stringify({
            model: GROQ_MODEL,
            messages: req.messages,
            temperature: req.temperature ?? 0.4,
            max_tokens: req.maxTokens ?? 1200,
            ...(req.jsonMode ? { response_format: { type: "json_object" } } : {}),
          }),
        });
      } catch (e) {
        throw new ProviderUnavailableError("groq", `network error: ${e}`);
      }

      // Free-tier rate limit or quota exhausted -> let the router try the
      // next free provider. This is the ONLY case we treat as "unavailable".
      if ([401, 402, 403, 404, 408, 429, 500, 502, 503, 504].includes(res.status)) {
        const body = await res.text().catch(() => "");
        throw new ProviderUnavailableError("groq", `HTTP ${res.status}: ${body.slice(0, 180) || "provider unavailable"}`);
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`groq error ${res.status}: ${body.slice(0, 300)}`);
      }

      const data = (await res.json()) as {
        choices: { message: { content: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };

      const text = data.choices?.[0]?.message?.content ?? "";
      if (!text.trim()) {
        throw new ProviderUnavailableError("groq", "empty completion response");
      }
      return {
        text,
        provider: "groq",
        model: GROQ_MODEL,
        tokensIn: data.usage?.prompt_tokens,
        tokensOut: data.usage?.completion_tokens,
      };
    },
  };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionRequest {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** If true, ask the provider to return raw JSON (used by the planner). */
  jsonMode?: boolean;
}

export interface CompletionResult {
  text: string;
  provider: ProviderName;
  model: string;
  tokensIn?: number;
  tokensOut?: number;
}

export type ProviderName = "groq" | "openrouter" | "cloudflare_ai";

/**
 * Every provider throws ProviderUnavailableError when its free quota/rate
 * limit is hit, or when it isn't configured. The router catches this
 * specific error to fall through to the next FREE provider. Any other
 * error is treated as a real failure (not a "try next provider" signal),
 * so it surfaces to the caller / retry logic instead of masking bugs.
 */
export class ProviderUnavailableError extends Error {
  constructor(
    public provider: ProviderName,
    reason: string,
  ) {
    super(`${provider} unavailable: ${reason}`);
  }
}

export interface AiProvider {
  name: ProviderName;
  isConfigured(): boolean;
  complete(req: CompletionRequest): Promise<CompletionResult>;
}

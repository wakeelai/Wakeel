import type { Env } from "../types";
import { Db, newId, today } from "../lib/db";
import { loadSettings } from "../lib/settings";
import { createGroqProvider } from "./groq";
import { createOpenRouterProvider } from "./openrouter";
import { createCloudflareAiProvider } from "./cloudflareAi";
import type {
  AiProvider,
  CompletionRequest,
  CompletionResult,
  ProviderName,
} from "./types";
import { ProviderUnavailableError } from "./types";

export class AllProvidersExhaustedError extends Error {
  constructor(public attempts: { provider: ProviderName; reason: string }[]) {
    super(
      "All configured free AI providers are unavailable right now. " +
        "No paid fallback was used.",
    );
  }
}

/**
 * The AI Provider Router. Order matters: fastest/most-generous free tier
 * first. Add a 4th provider by pushing another AiProvider onto this list —
 * nothing else in the app needs to change.
 */
export function buildProviderChain(env: Env): AiProvider[] {
  return [
    createGroqProvider(env.GROQ_API_KEY),
    createOpenRouterProvider(env.OPENROUTER_API_KEY),
    createCloudflareAiProvider(env.AI),
  ];
}

async function recordUsage(
  db: Db,
  userId: string,
  provider: ProviderName,
  tokensIn: number,
  tokensOut: number,
) {
  const day = today();
  await db.run(
    `INSERT INTO usage (id, user_id, provider, day, calls, tokens_in, tokens_out)
     VALUES (?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT(user_id, provider, day) DO UPDATE SET
       calls = usage.calls + 1,
       tokens_in = usage.tokens_in + excluded.tokens_in,
       tokens_out = usage.tokens_out + excluded.tokens_out`,
    newId("usage"), userId, provider, day, tokensIn, tokensOut,
  );
}

async function reserveDailyCall(db: Db, userId: string, dailyCap: number): Promise<boolean> {
  const reservation = await db.first<{ calls: number }>(
    `INSERT INTO ai_daily_reservations (user_id, day, calls)
     VALUES (?, ?, 1)
     ON CONFLICT(user_id, day) DO UPDATE SET calls = ai_daily_reservations.calls + 1
     WHERE ai_daily_reservations.calls < ?
     RETURNING calls`,
    userId, today(), dailyCap,
  );
  return reservation !== null;
}

/**
 * Routes a completion request through the configured free providers in
 * order, falling through only on ProviderUnavailableError (quota/rate
 * limit/misconfigured). Any other error is a real bug and propagates.
 * Never calls a paid API and never retries past a hard daily cap.
 */
export async function routeCompletion(
  env: Env,
  userId: string,
  req: CompletionRequest,
): Promise<CompletionResult> {
  const db = new Db(env.DB);
  const dailyCap = (await loadSettings(env)).maxFreeAiCallsPerDay;
  const chain = buildProviderChain(env);
  if (!chain.some((provider) => provider.isConfigured())) {
    throw new AllProvidersExhaustedError(chain.map((provider) => ({ provider: provider.name, reason: "not configured" })));
  }
  if (!(await reserveDailyCall(db, userId, dailyCap))) {
    throw new AllProvidersExhaustedError([
      { provider: "groq", reason: "daily free-call cap reached for this account" },
    ]);
  }

  const attempts: { provider: ProviderName; reason: string }[] = [];

  for (const provider of chain) {
    if (!provider.isConfigured()) {
      attempts.push({ provider: provider.name, reason: "not configured" });
      continue;
    }
    try {
      const result = await provider.complete(req);
      await recordUsage(
        db,
        userId,
        provider.name,
        result.tokensIn ?? 0,
        result.tokensOut ?? 0,
      );
      return result;
    } catch (e) {
      if (e instanceof ProviderUnavailableError) {
        attempts.push({ provider: e.provider, reason: e.message });
        continue; // try next free provider
      }
      throw e; // real error — do not mask it as "try next provider"
    }
  }

  throw new AllProvidersExhaustedError(attempts);
}

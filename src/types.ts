export interface Env {
  DB: D1Database;
  AI: Ai;
  BROWSER?: BrowserRun;
  ASSETS: Fetcher;

  APP_NAME: string;
  APP_ENV: string;
  CORS_ALLOWED_ORIGINS?: string;
  ADMIN_EMAIL?: string;

  MAX_FREE_AI_CALLS_PER_DAY: string;
  MAX_BROWSER_TASKS_PER_DAY: string;
  MAX_TASK_RUNTIME_MS: string;
  MAX_STEPS_PER_INVOCATION?: string;
  MAX_FILE_SIZE_MB: string;
  MAX_PROJECTS_PER_USER: string;
  MAX_STORAGE_MB_PER_USER: string;

  GROQ_API_KEY?: string;
  OPENROUTER_API_KEY?: string;

  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;

  NOWPAYMENTS_API_KEY?: string;
  NOWPAYMENTS_IPN_SECRET?: string;

  TRUST_WALLET_ADDRESS?: string;
  TRUST_WALLET_NETWORK?: string;
  TRUST_WALLET_TOKEN?: string;
  BSC_RPC_URL?: string;
}

/** Attached to context after the Supabase Auth access token has been verified. */
export interface AuthUser {
  id: string; // internal users.id (uuid)
  supabaseUid: string;
  email: string;
  emailVerified: boolean;
  role: "user" | "admin";
  status: "active" | "suspended";
}

export type TaskStatus =
  | "queued"
  | "planning"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled";

export type StepPhase =
  | "planning"
  | "searching"
  | "reading"
  | "analyzing"
  | "generating"
  | "verifying"
  | "completed";

export type PermissionLevel =
  | "READ"
  | "WRITE"
  | "EXTERNAL_ACTION"
  | "FINANCIAL"
  | "DESTRUCTIVE";

export type PaymentStatus =
  | "created"
  | "pending"
  | "confirming"
  | "confirmed"
  | "finished"
  | "failed"
  | "expired"
  | "refunded"
  | "pending_review";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

import type { Env, PermissionLevel } from "../types";

export interface ToolContext {
  env: Env;
  userId: string;
  taskId: string;
  /** True once the user has explicitly confirmed a sensitive action. */
  confirmed: boolean;
}

export interface ToolResult {
  ok: boolean;
  output: unknown;
  /** Human-readable one-liner shown in the step timeline. */
  summary: string;
  /** Sources discovered (web_search/web_read populate this). */
  sources?: { title?: string; url: string; retrievedAt: number; excerpt?: string }[];
  /** Artifact metadata if this call produced a file. */
  artifact?: { type: string; title: string; content: string | ArrayBuffer; mime: string };
  error?: string;
}

export interface Tool<TInput = Record<string, unknown>> {
  name: string;
  description: string;
  permission: PermissionLevel;
  /** Client-only tools are executed in a dedicated browser worker, never on the Cloudflare Worker. */
  clientOnly?: boolean;
  /** JSON-schema-ish shape shown to the planner LLM; kept intentionally loose. */
  inputSchema: Record<string, unknown>;
  execute(input: TInput, ctx: ToolContext): Promise<ToolResult>;
}

/**
 * Tools with these permission levels can never auto-execute — the executor
 * must obtain an explicit user confirmation first (see agent/executor.ts).
 */
export const REQUIRES_CONFIRMATION: PermissionLevel[] = [
  "EXTERNAL_ACTION",
  "FINANCIAL",
  "DESTRUCTIVE",
];

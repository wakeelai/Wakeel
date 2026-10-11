import type { Env } from "../types";
import { Db } from "./db";
import { MAX_OBJECT_BYTES, MAX_TOTAL_OBJECT_BYTES } from "./objectStore";

const MAX_FILE_SIZE_MB = MAX_OBJECT_BYTES / (1024 * 1024);
const MAX_STORAGE_MB_PER_USER = MAX_TOTAL_OBJECT_BYTES / (1024 * 1024);

export interface AppSettings {
  maxFreeAiCallsPerDay: number;
  maxBrowserTasksPerDay: number;
  maxTaskRuntimeMs: number;
  maxStepsPerInvocation: number;
  maxFileSizeMb: number;
  maxProjectsPerUser: number;
  maxStorageMbPerUser: number;
  maintenanceMode: boolean;
}

type NumericKey = Exclude<keyof AppSettings, "maintenanceMode">;

export const NUMERIC_SETTING_KEYS: readonly NumericKey[] = [
  "maxFreeAiCallsPerDay",
  "maxBrowserTasksPerDay",
  "maxTaskRuntimeMs",
  "maxStepsPerInvocation",
  "maxFileSizeMb",
  "maxProjectsPerUser",
  "maxStorageMbPerUser",
] as const;

function num(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Defaults come from wrangler [vars]; admin overrides (agent_settings row) win over them. */
export function defaultSettings(env: Env): AppSettings {
  return {
    maxFreeAiCallsPerDay: num(env.MAX_FREE_AI_CALLS_PER_DAY, 200),
    maxBrowserTasksPerDay: num(env.MAX_BROWSER_TASKS_PER_DAY, 20),
    maxTaskRuntimeMs: num(env.MAX_TASK_RUNTIME_MS, 180000),
    maxStepsPerInvocation: num(env.MAX_STEPS_PER_INVOCATION, 1),
    maxFileSizeMb: Math.min(num(env.MAX_FILE_SIZE_MB, 20), MAX_FILE_SIZE_MB),
    maxProjectsPerUser: num(env.MAX_PROJECTS_PER_USER, 50),
    maxStorageMbPerUser: Math.min(num(env.MAX_STORAGE_MB_PER_USER, 150), MAX_STORAGE_MB_PER_USER),
    maintenanceMode: false,
  };
}

export async function loadSettings(env: Env): Promise<AppSettings> {
  const settings = defaultSettings(env);
  try {
    const row = await new Db(env.DB).first<{ settings_json: string }>(
      "SELECT settings_json FROM agent_settings WHERE id = 'global'",
    );
    if (!row) return settings;
    const overrides = JSON.parse(row.settings_json) as Record<string, unknown>;
    for (const key of NUMERIC_SETTING_KEYS) {
      const v = overrides[key];
      if (typeof v === "number" && Number.isFinite(v) && v > 0) settings[key] = v;
    }
    settings.maxFileSizeMb = Math.min(settings.maxFileSizeMb, MAX_FILE_SIZE_MB);
    settings.maxStorageMbPerUser = Math.min(settings.maxStorageMbPerUser, MAX_STORAGE_MB_PER_USER);
    if (typeof overrides.maintenanceMode === "boolean") settings.maintenanceMode = overrides.maintenanceMode;
  } catch {
    // Missing or malformed overrides must never take the app down — fall back to defaults.
  }
  return settings;
}

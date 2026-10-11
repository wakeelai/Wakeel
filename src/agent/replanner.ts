import type { Env, StepPhase } from "../types";
import { routeCompletion } from "../providers/router";
import { listTools, getTool } from "../tools/registry";
import type { PlanStep } from "./types";

const phases: StepPhase[] = ["planning", "searching", "reading", "analyzing", "generating", "verifying", "completed"];
const MAX_RECOVERY_STEPS = 5;

function parseJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(cleaned);
}

function parseSteps(value: unknown, limit = MAX_RECOVERY_STEPS): PlanStep[] {
  if (!Array.isArray(value)) return [];
  const result: PlanStep[] = [];
  for (const item of value.slice(0, limit)) {
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;
    const tool = s.tool === null ? null : typeof s.tool === "string" ? s.tool : null;
    if (!phases.includes(s.phase as StepPhase) || (tool && !getTool(tool))) continue;
    const input = s.toolInput && typeof s.toolInput === "object" && !Array.isArray(s.toolInput)
      ? s.toolInput as Record<string, unknown> : undefined;
    if (tool === "code_interpreter" && (typeof input?.code !== "string" || input.code.length > 20_000)) continue;
    if ((tool === "browser_browse" || tool === "browser_interact" || tool === "web_read") && typeof input?.url !== "string") continue;
    if ((tool === "web_search" || tool === "web_research") && (typeof input?.query !== "string" || !input.query.trim())) continue;
    result.push({
      phase: s.phase as StepPhase,
      title: typeof s.title === "string" ? s.title.slice(0, 120) : `Recovery ${result.length + 1}`,
      description: typeof s.description === "string" ? s.description.slice(0, 1000) : "Recover from the prior step failure.",
      tool,
      ...(input ? { toolInput: input } : {}),
    });
  }
  return result;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function toolCatalog(): string {
  return listTools().map((tool) =>
    `- ${tool.name} (${tool.permission}${tool.clientOnly ? ", client-only" : ""}): ${tool.description}; input=${JSON.stringify(tool.inputSchema)}`,
  ).join("\n");
}

/**
 * Reconsider the unfinished plan after a useful observation. This is bounded
 * to one review per task by the engine, and the current plan is kept whenever
 * the model/provider cannot give a valid, materially different replacement.
 */
export async function adaptPlanAfterObservation(
  env: Env,
  userId: string,
  prompt: string,
  observations: string[],
  completedSteps: PlanStep[],
  remainingSteps: PlanStep[],
  maxSteps: number,
): Promise<{ decision: "continue" | "replace"; reason: string; steps: PlanStep[] } | null> {
  if (!remainingSteps.length || maxSteps < 1) return null;
  try {
    const completion = await routeCompletion(env, userId, {
      messages: [
        {
          role: "system",
          content: [
            "You are the adaptive controller of an autonomous AI agent.",
            "Review new evidence and the unfinished plan. Do not redo completed actions. Prefer decision=continue if the current plan still achieves the goal; choose replace only when evidence reveals a gap, a better source, a failed assumption, or a more useful deliverable.",
            `Return ONLY JSON: {"decision":"continue"|"replace","reason":"brief explanation","steps":[...]}. Valid phases: ${phases.join(", ")}.`,
            `If replacing, return 1-${Math.min(maxSteps, MAX_RECOVERY_STEPS)} executable steps and end with a tool:null synthesis step. Existing tools and input schemas:\n${toolCatalog()}`,
            "For current/factual research, prefer web_research to read at least two independent sources where available and include a verification step when facts can conflict. Never invent evidence or use paid services.",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify({
            task: prompt,
            observations: observations.slice(-10),
            completedSteps: completedSteps.map((step) => ({ title: step.title, tool: step.tool, toolInput: step.toolInput })),
            unfinishedPlan: remainingSteps,
          }),
        },
      ],
      jsonMode: true,
      temperature: 0.1,
      maxTokens: 1400,
    });

    const parsed = parseJson(completion.text) as { decision?: unknown; reason?: unknown; steps?: unknown };
    const reason = typeof parsed.reason === "string" ? parsed.reason.slice(0, 300) : "Plan reviewed against new evidence";
    if (parsed.decision !== "replace") return { decision: "continue", reason, steps: [] };

    let steps = parseSteps(parsed.steps, Math.min(maxSteps, MAX_RECOVERY_STEPS));
    const alreadyDone = new Set(completedSteps.filter((step) => step.tool !== null).map((step) => `${step.tool}:${canonical(step.toolInput ?? {})}`));
    steps = steps.filter((step) => step.tool === null || !alreadyDone.has(`${step.tool}:${canonical(step.toolInput ?? {})}`));
    if (!steps.length) return { decision: "continue", reason: "Replacement plan repeated completed work; retaining current plan", steps: [] };

    const synthesisStep: PlanStep = [...steps].reverse().find((step) => step.tool === null) ?? {
      phase: "analyzing",
      title: "Synthesize verified results",
      description: "Combine the gathered evidence into the requested deliverable, identify limitations, and cite sources.",
      tool: null,
    };
    // Preserve only novel actions, remove duplicate actions, and always make
    // synthesis the final queued step (rather than merely checking it exists).
    const seenActions = new Set<string>();
    const uniqueActions = steps.filter((step) => {
      if (step.tool === null) return false;
      const key = `${step.tool}:${canonical(step.toolInput ?? {})}`;
      if (seenActions.has(key)) return false;
      seenActions.add(key);
      return true;
    });
    steps = [...uniqueActions.slice(0, Math.max(0, maxSteps - 1)), synthesisStep];
    return { decision: "replace", reason, steps: steps.slice(0, maxSteps) };
  } catch {
    // Adaptive review is an optimization, not a requirement. Keep working with
    // the durable existing plan if all free model quotas are exhausted.
    return null;
  }
}

/** Produce a bounded replacement plan from the error and accumulated evidence. */
export async function replanAfterFailure(
  env: Env,
  userId: string,
  prompt: string,
  failed: PlanStep,
  error: string,
  observations: string[],
  remaining: PlanStep[],
): Promise<PlanStep[]> {
  try {
    const completion = await routeCompletion(env, userId, {
      messages: [
        {
          role: "system",
          content: `You are an agent recovery planner. Return ONLY JSON {"steps":[...]}, containing 1-${MAX_RECOVERY_STEPS} executable replacement steps for unfinished work. Preserve the original goal, use evidence, never fabricate outputs, never repeat completed work or the failed action with identical input. ${`Valid phases: ${phases.join(", ")}`}\nTools:\n${toolCatalog()}`,
        },
        {
          role: "user",
          content: JSON.stringify({ task: prompt, failedStep: failed, error: error.slice(0, 1000), observations: observations.slice(-8), unfinishedPlan: remaining }),
        },
      ],
      jsonMode: true,
      temperature: 0.1,
      maxTokens: 1200,
    });
    const parsed = parseJson(completion.text) as { steps?: unknown };
    return parseSteps(parsed.steps).filter((step) => !(
      failed.tool !== null && step.tool === failed.tool && canonical(step.toolInput ?? {}) === canonical(failed.toolInput ?? {})
    ));
  } catch {
    return [];
  }
}

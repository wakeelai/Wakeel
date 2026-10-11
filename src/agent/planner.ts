import type { Env, StepPhase } from "../types";
import { routeCompletion } from "../providers/router";
import type { Plan, PlanStep } from "./types";
import type { TaskAnalysis } from "./analyzer";
import { getTool, listTools } from "../tools/registry";

const VALID_PHASES: StepPhase[] = ["planning", "searching", "reading", "analyzing", "generating", "verifying", "completed"];
const MAX_PLAN_STEPS = 8;

function normalizeSteps(input: unknown): PlanStep[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, MAX_PLAN_STEPS).flatMap((raw, index) => {
    if (!raw || typeof raw !== "object") return [];
    const s = raw as Record<string, unknown>;
    const tool = s.tool === null ? null : typeof s.tool === "string" ? s.tool : null;
    if (!VALID_PHASES.includes(s.phase as StepPhase) || (tool && !getTool(tool))) return [];
    const toolInput = s.toolInput && typeof s.toolInput === "object" && !Array.isArray(s.toolInput)
      ? s.toolInput as Record<string, unknown> : undefined;
    if (tool === "code_interpreter" && (typeof toolInput?.code !== "string" || toolInput.code.length > 20_000)) return [];
    if ((tool === "browser_browse" || tool === "browser_interact" || tool === "web_read") && typeof toolInput?.url !== "string") return [];
    if ((tool === "web_research" || tool === "web_search") && (typeof toolInput?.query !== "string" || !toolInput.query.trim())) return [];
    if (tool === "file_write" && (typeof toolInput?.filename !== "string" || typeof toolInput?.content !== "string")) return [];
    if (tool === "website_builder" && typeof toolInput?.brief !== "string") return [];
    return [{ phase: s.phase as StepPhase,
      title: typeof s.title === "string" ? s.title.slice(0, 120) : `Step ${index + 1}`,
      description: typeof s.description === "string" ? s.description.slice(0, 1000) : "Complete this task step.",
      tool, ...(toolInput ? { toolInput } : {}) } as PlanStep];
  });
}
function promptUrl(prompt: string): string {
  return prompt.match(/https?:\/\/[^\s)]+/i)?.[0]?.replace(/[.,;]+$/, "") ?? "https://example.com";
}
function fallbackPlan(prompt: string, analysis: TaskAnalysis): Plan {
  const steps: PlanStep[] = [];
  if (analysis.needsWebResearch) steps.push({ phase: "searching", title: "Research the web", description: `Find and read credible public sources relevant to: ${prompt}`, tool: "web_research", toolInput: { query: prompt, maxSources: 2 } });
  if (analysis.needsBrowser) steps.push({ phase: "reading", title: "Browse a public page", description: "Read dynamically rendered page text with a real browser.", tool: "browser_browse", toolInput: { url: promptUrl(prompt) } });
  if (analysis.needsCode) steps.push({ phase: "analyzing", title: "Run Python analysis", description: "Run Python in the isolated browser worker.", tool: "code_interpreter", toolInput: { language: "python", code: "print('Python interpreter ready. Please provide a concrete analysis request.')" } });
  steps.push({ phase: "analyzing", title: "Analyze and synthesize", description: "Reason over the observations and draft the answer.", tool: null });
  if (analysis.needsFileOutput) steps.push({ phase: "generating", title: "Generate output file", description: "Prepare the final result as a file artifact.", tool: null });
  return { steps: steps.slice(0, MAX_PLAN_STEPS) };
}

export async function createPlan(env: Env, userId: string, prompt: string, analysis: TaskAnalysis): Promise<Plan> {
  const toolCatalog = listTools().map((t) => `- ${t.name} (${t.permission}${t.clientOnly ? ", client-only" : ""}): ${t.description}; input=${JSON.stringify(t.inputSchema)}`).join("\n");
  const system = [
    "You are the planning module of an AI agent. Build an executable, evidence-driven plan of 2-7 concrete steps.",
    "Respond ONLY with JSON {\"steps\":[{\"phase\":string,\"title\":string,\"description\":string,\"tool\":string|null,\"toolInput\":object|null}]}; no markdown.",
    `Valid phases: ${VALID_PHASES.join(", ")}. Tools and exact input schemas:\n${toolCatalog}`,
    "For current facts, research, comparisons, or anything that may have changed, prefer web_research: it searches public results and reads up to three independent source pages. Cite evidence in the final answer and use web_read when a specific source needs a closer read.",
    "For multi-part tasks, plan distinct phases: gather evidence, execute/analyze, verify the result against the task requirements, then synthesize a complete deliverable. Use 2-7 concrete steps, no redundant analysis-only steps.",
    "If code/data analysis is requested, include code_interpreter with complete runnable Python in toolInput.code; code executes only in a disposable client-side Web Worker.",
    "Use browser_browse for dynamic public pages. browser_interact can only follow a public anchor link; forms, submissions, typing, and keypresses are unavailable.",
    "Never invent results. Preserve source URLs. Do not bypass site restrictions or plan a paid service.",
  ].join("\n");
  try {
    const result = await routeCompletion(env, userId, {
      messages: [{ role: "system", content: system }, { role: "user", content: `Task: ${prompt}\nTask signals: ${JSON.stringify(analysis)}` }],
      jsonMode: true, temperature: 0.15, maxTokens: 1400,
    });
    const parsed = JSON.parse(result.text.trim().replace(/^```json?/i, "").replace(/```$/, "")) as { steps?: unknown };
    const steps = normalizeSteps(parsed.steps);
    if (steps.length === 0) return fallbackPlan(prompt, analysis);
    if (analysis.needsWebResearch && !steps.some((s) => s.tool === "web_research" || s.tool === "web_search")) {
      steps.unshift({ phase: "searching", title: "Research credible public sources", description: `Find and read public sources relevant to: ${prompt}`, tool: "web_research", toolInput: { query: prompt, maxSources: 2 } });
    }
    if (analysis.needsCode && !steps.some((s) => s.tool === "code_interpreter")) {
      steps.push({ phase: "analyzing", title: "Run Python analysis", description: "Execute Python for this task.", tool: "code_interpreter", toolInput: { language: "python", code: `# Task: ${prompt.replace(/[\r\n]/g, " ").slice(0, 500)}\nprint("No runnable Python plan was returned; refine the request and retry.")` } });
    }
    if (analysis.needsBrowser && !steps.some((s) => s.tool === "browser_browse" || s.tool === "browser_interact")) {
      steps.push({ phase: "reading", title: "Browse a public page", description: "Read a dynamically rendered public web page.", tool: "browser_browse", toolInput: { url: promptUrl(prompt) } });
    }
    return { steps: steps.slice(0, MAX_PLAN_STEPS) };
  } catch {
    return fallbackPlan(prompt, analysis);
  }
}

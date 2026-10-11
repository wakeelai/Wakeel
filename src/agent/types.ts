import type { StepPhase } from "../types";

export interface PlanStep {
  phase: StepPhase;
  title: string;
  description: string;
  /** Tool to call, or null for a pure reasoning/synthesis step. */
  tool: string | null;
  toolInput?: Record<string, unknown>;
}

export interface Plan {
  steps: PlanStep[];
}

export interface AgentEvent {
  type:
    | "task_started"
    | "plan_created"
    | "plan_revised"
    | "step_started"
    | "step_progress"
    | "step_completed"
    | "step_failed"
    | "waiting_confirmation"
    | "client_tool_required"
    | "task_completed"
    | "task_failed"
    | "task_paused";
  data: Record<string, unknown>;
}

export type Emit = (event: AgentEvent) => void;

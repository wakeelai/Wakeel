export type TaskStatus = "queued" | "planning" | "running" | "waiting" | "completed" | "failed" | "cancelled";

export interface Task {
  id: string;
  project_id: string | null;
  title: string;
  prompt: string;
  status: TaskStatus;
  result_summary: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}
export interface Step {
  id: string;
  step_index: number;
  phase: string;
  title: string;
  description: string | null;
  tool_used: string | null;
  status: string;
  started_at: number | null;
  finished_at: number | null;
  duration_ms: number | null;
  details_json: string | null;
}
export interface Source { id: string; title: string | null; url: string; retrieved_at: number; excerpt: string | null }
export interface ArtifactRow {
  id: string; task_id: string; file_id: string | null; type: string; title: string;
  preview_text: string | null; created_at: number; task_title?: string;
}
export interface Message { id: string; role: string; content: string; created_at: number }
export interface FileRow {
  id: string; filename: string; mime_type: string; size_bytes: number; kind: string;
  project_id: string | null; task_id: string | null; created_at: number;
}
export interface LogRow { id: string; event: string; data_json: string | null; created_at: number }
export interface PlanRow {
  id: string; name: string; price_usd: number; credits_included: number;
  features_json: string | null; is_active: number; sort_order: number;
}
export interface Project { id: string; name: string; description: string | null; created_at: number; updated_at: number }

import { Hono } from "hono";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { Env } from "../types";
import { Db, newId, now } from "../lib/db";
import { runTaskEngine, resumeTaskEngine, TASK_CREDIT_COST } from "../agent/engine";
import type { Emit } from "../agent/types";
import { rateLimit, userKey } from "../middleware/rateLimit";
import { createTaskWithCreditReservation } from "../payments/credit";

export const tasksRoute = new Hono<{ Bindings: Env }>();
type Ctx = Context<{ Bindings: Env }>;

/** Streams engine events as SSE. Everything is also persisted in D1, so a dropped connection loses nothing. */
function sse(c: Ctx, work: (emit: Emit) => Promise<void>, taskId?: string) {
  return streamSSE(c, async (s) => {
    try {
      if (taskId) await s.writeSSE({ event: "task_id", data: taskId });
      await work((event) => {
        void s.writeSSE({ event: event.type, data: JSON.stringify(event.data) });
      });
    } catch (e) {
      const reason = (e instanceof Error ? e.message : String(e)).slice(0, 200);
      await s.writeSSE({ event: "task_failed", data: JSON.stringify({ reason }) });
    }
  });
}

async function ownTask(c: Ctx, id: string) {
  const user = c.get("user");
  return new Db(c.env.DB).first<{ id: string; status: string; project_id: string | null }>(
    "SELECT id, status, project_id FROM tasks WHERE id = ? AND user_id = ?",
    id,
    user.id,
  );
}

tasksRoute.get("/", async (c) => {
  const user = c.get("user");
  const tasks = await new Db(c.env.DB).all(
    "SELECT id, project_id, title, status, error, created_at, updated_at, completed_at FROM tasks WHERE user_id = ? ORDER BY created_at DESC LIMIT 100",
    user.id,
  );
  return c.json({ tasks });
});

tasksRoute.post("/", rateLimit({ windowSeconds: 60, max: 10, keyFn: userKey }), async (c) => {
  const user = c.get("user");
  if (!user.emailVerified && user.role !== "admin") {
    return c.json({ error: "Please verify your email before running tasks.", code: "email_not_verified" }, 403);
  }

  const body = await c.req
    .json<{ prompt: string; projectId?: string; webResearch?: boolean; browser?: boolean; code?: boolean }>()
    .catch(() => null);
  if (!body || typeof body.prompt !== "string" || body.prompt.trim().length === 0) {
    return c.json({ error: "prompt is required" }, 400);
  }
  if (body.prompt.length > 20000) return c.json({ error: "Prompt too long (max 20,000 characters)" }, 400);

  const db = new Db(c.env.DB);
  if (body.projectId) {
    const owns = await db.first("SELECT id FROM projects WHERE id = ? AND user_id = ?", body.projectId, user.id);
    if (!owns) return c.json({ error: "Project not found" }, 400);
  }

  const taskId = newId("task");
  const created = await createTaskWithCreditReservation(db, {
    id: taskId, userId: user.id, projectId: body.projectId ?? null,
    title: body.prompt.trim().slice(0, 80), prompt: body.prompt,
    webResearch: body.webResearch !== false, browser: Boolean(body.browser), code: Boolean(body.code),
  }, TASK_CREDIT_COST);
  if (!created) {
    return c.json({ error: "Not enough credits. This task needs 5 credits.", code: "insufficient_credits" }, 402);
  }

  return sse(
    c,
    (emit) =>
      runTaskEngine({
        env: c.env,
        userId: user.id,
        taskId,
        prompt: body.prompt,
        modeFlags: {
          webResearch: body.webResearch !== false,
          browser: Boolean(body.browser),
          code: Boolean(body.code),
        },
        emit,
      }),
    taskId,
  );
});

tasksRoute.get("/:id", async (c) => {
  const user = c.get("user");
  const db = new Db(c.env.DB);
  const id = c.req.param("id");

  const task = await db.first("SELECT * FROM tasks WHERE id = ? AND user_id = ?", id, user.id);
  if (!task) return c.json({ error: "Not found" }, 404);

  const [steps, sources, artifacts, messages] = await Promise.all([
    db.all("SELECT * FROM task_steps WHERE task_id = ? ORDER BY step_index ASC", id),
    db.all("SELECT * FROM sources WHERE task_id = ? ORDER BY retrieved_at ASC", id),
    db.all("SELECT * FROM artifacts WHERE task_id = ? ORDER BY created_at ASC", id),
    db.all("SELECT * FROM messages WHERE task_id = ? ORDER BY created_at ASC", id),
  ]);
  return c.json({ task, steps, sources, artifacts, messages });
});

tasksRoute.get("/:id/logs", async (c) => {
  const id = c.req.param("id");
  if (!(await ownTask(c, id))) return c.json({ error: "Not found" }, 404);
  const logs = await new Db(c.env.DB).all(
    "SELECT id, event, data_json, created_at FROM task_logs WHERE task_id = ? ORDER BY created_at ASC LIMIT 500",
    id,
  );
  return c.json({ logs });
});

tasksRoute.post("/:id/cancel", async (c) => {
  const id = c.req.param("id");
  if (!(await ownTask(c, id))) return c.json({ error: "Not found" }, 404);
  await new Db(c.env.DB).run(
    "UPDATE tasks SET status = 'cancelled', updated_at = ? WHERE id = ? AND status NOT IN ('completed', 'cancelled')",
    now(),
    id,
  );
  return c.json({ ok: true });
});

tasksRoute.post("/:id/resume", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const task = await ownTask(c, id);
  if (!task) return c.json({ error: "Not found" }, 404);
  if (task.status === "completed" || task.status === "cancelled") {
    return c.json({ error: `Task is already ${task.status}` }, 400);
  }
  return sse(c, (emit) => resumeTaskEngine({ env: c.env, userId: user.id, taskId: id, emit }));
});

tasksRoute.post("/:id/confirm", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const task = await ownTask(c, id);
  if (!task) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json<{ stepIndex: number; approve: boolean }>().catch(() => null);
  if (!body || !Number.isInteger(body.stepIndex)) return c.json({ error: "stepIndex is required" }, 400);

  const db = new Db(c.env.DB);
  const stepId = `${id}-step-${body.stepIndex}`;
  // Only a step that is genuinely waiting for confirmation can be confirmed.
  const step = await db.first<{ status: string }>("SELECT status FROM task_steps WHERE id = ?", stepId);
  if (!step || step.status !== "waiting") return c.json({ error: "No pending confirmation for this step" }, 400);

  if (!body.approve) {
    await db.run("UPDATE tasks SET status = 'cancelled', updated_at = ? WHERE id = ?", now(), id);
    await db.run("UPDATE task_steps SET status = 'cancelled' WHERE id = ?", stepId);
    return c.json({ ok: true, cancelled: true });
  }

  return sse(c, (emit) =>
    resumeTaskEngine({ env: c.env, userId: user.id, taskId: id, confirmStepIndex: body.stepIndex, emit }),
  );
});

tasksRoute.post("/:id/client-result", rateLimit({ windowSeconds: 60, max: 20, keyFn: userKey }), async (c) => {
  const user = c.get("user");
  const id = c.req.param("id") ?? "";
  if (!(await ownTask(c, id))) return c.json({ error: "Not found" }, 404);
  const body = await c.req.json<{ stepIndex: number; ok: boolean; output: string; error?: string }>().catch(() => null);
  if (!body || !Number.isInteger(body.stepIndex) || typeof body.ok !== "boolean" || typeof body.output !== "string") {
    return c.json({ error: "A valid interpreter result is required" }, 400);
  }
  const db = new Db(c.env.DB);
  const step = await db.first<{ status: string; tool_used: string }>(
    "SELECT status, tool_used FROM task_steps WHERE id = ? AND task_id = ?",
    `${id}-step-${body.stepIndex}`, id,
  );
  if (!step || step.status !== "waiting" || step.tool_used !== "code_interpreter") {
    return c.json({ error: "No matching Python interpreter step is waiting" }, 409);
  }
  return sse(c, (emit) => resumeTaskEngine({
    env: c.env, userId: user.id, taskId: id, emit,
    clientToolResult: { stepIndex: body.stepIndex, ok: body.ok, output: body.output.slice(0, 12_000), error: body.error?.slice(0, 2_000) },
  }));
});

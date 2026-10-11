import { Hono } from "hono";
import type { Env } from "../types";
import { Db, newId, now } from "../lib/db";
import { loadSettings } from "../lib/settings";

export const projectsRoute = new Hono<{ Bindings: Env }>();

projectsRoute.get("/", async (c) => {
  const user = c.get("user");
  const db = new Db(c.env.DB);
  const projects = await db.all(
    "SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC",
    user.id,
  );
  return c.json({ projects });
});

projectsRoute.post("/", async (c) => {
  const user = c.get("user");
  const db = new Db(c.env.DB);

  const count = await db.first<{ n: number }>(
    "SELECT COUNT(*) as n FROM projects WHERE user_id = ?",
    user.id,
  );
  const max = (await loadSettings(c.env)).maxProjectsPerUser;
  if ((count?.n ?? 0) >= max) {
    return c.json({ error: `Project limit reached (${max})` }, 400);
  }

  const body = await c.req.json<{ name: string; description?: string }>();
  if (!body.name?.trim()) return c.json({ error: "name is required" }, 400);

  const id = newId("proj");
  const ts = now();
  await db.run(
    "INSERT INTO projects (id, user_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    id,
    user.id,
    body.name.trim(),
    body.description ?? null,
    ts,
    ts,
  );
  return c.json({ id }, 201);
});

projectsRoute.get("/:id", async (c) => {
  const user = c.get("user");
  const db = new Db(c.env.DB);
  const id = c.req.param("id");
  const project = await db.first("SELECT * FROM projects WHERE id = ? AND user_id = ?", id, user.id);
  if (!project) return c.json({ error: "Not found" }, 404);
  const tasks = await db.all(
    "SELECT * FROM tasks WHERE project_id = ? AND user_id = ? ORDER BY created_at DESC",
    id,
    user.id,
  );
  return c.json({ project, tasks });
});

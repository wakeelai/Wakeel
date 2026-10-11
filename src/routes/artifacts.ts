import { Hono } from "hono";
import type { Env } from "../types";
import { Db } from "../lib/db";
import { D1ObjectStore } from "../lib/objectStore";

export const artifactsRoute = new Hono<{ Bindings: Env }>();

artifactsRoute.get("/", async (c) => {
  const user = c.get("user");
  const artifacts = await new Db(c.env.DB).all(
    `SELECT a.*, t.title as task_title FROM artifacts a
     JOIN tasks t ON t.id = a.task_id
     WHERE t.user_id = ? ORDER BY a.created_at DESC`,
    user.id,
  );
  return c.json({ artifacts });
});

/** Text content of an artifact, for the in-app preview. Ownership is enforced through the parent task. */
artifactsRoute.get("/:id/content", async (c) => {
  const user = c.get("user");
  const row = await new Db(c.env.DB).first<{
    type: string; title: string; preview_text: string | null; object_key: string | null; mime_type: string | null;
  }>(
    `SELECT a.type, a.title, a.preview_text, f.object_key, f.mime_type
       FROM artifacts a
       JOIN tasks t ON t.id = a.task_id
       LEFT JOIN files f ON f.id = a.file_id
      WHERE a.id = ? AND t.user_id = ?`,
    c.req.param("id"),
    user.id,
  );
  if (!row) return c.json({ error: "Not found" }, 404);

  let content = row.preview_text ?? "";
  if (row.object_key) {
    const obj = await new D1ObjectStore(c.env.DB).get(row.object_key);
    if (obj) {
      if (obj.size > 1_000_000) return c.json({ error: "Too large to preview — download it instead" }, 413);
      content = await obj.text();
    }
  }
  return c.json({ content, type: row.type, title: row.title, mime: row.mime_type ?? "text/plain" });
});

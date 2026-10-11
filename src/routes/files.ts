import { Hono } from "hono";
import type { Env } from "../types";
import { Db, newId, now } from "../lib/db";
import { loadSettings } from "../lib/settings";
import { D1ObjectStore, ObjectStorageQuotaError } from "../lib/objectStore";
import { rateLimit, userKey } from "../middleware/rateLimit";

export const filesRoute = new Hono<{ Bindings: Env }>();

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const ZIP_MAGIC = [0x50, 0x4b];

/** Allowed uploads. The extension decides the stored MIME; the client-supplied type is never trusted. */
const TYPES: Record<string, { mime: string; magic?: number[] }> = {
  pdf: { mime: "application/pdf", magic: [0x25, 0x50, 0x44, 0x46] },
  docx: { mime: DOCX, magic: ZIP_MAGIC },
  xlsx: { mime: XLSX, magic: ZIP_MAGIC },
  zip: { mime: "application/zip", magic: ZIP_MAGIC },
  png: { mime: "image/png", magic: [0x89, 0x50, 0x4e, 0x47] },
  jpg: { mime: "image/jpeg", magic: [0xff, 0xd8, 0xff] },
  jpeg: { mime: "image/jpeg", magic: [0xff, 0xd8, 0xff] },
  csv: { mime: "text/csv" },
  txt: { mime: "text/plain" },
  json: { mime: "application/json" },
};

function validateContent(ext: string, bytes: Uint8Array): string | null {
  const t = TYPES[ext];
  if (!t) return `File type .${ext} is not allowed`;
  if (t.magic) {
    if (!t.magic.every((b, i) => bytes[i] === b)) return `File content does not match its .${ext} extension`;
  } else if (bytes.subarray(0, 1024).includes(0)) {
    return `File content does not look like text (.${ext})`; // binary masquerading as text
  }
  return null;
}

filesRoute.get("/", async (c) => {
  const user = c.get("user");
  const db = new Db(c.env.DB);
  const taskId = c.req.query("taskId");
  const cols = "id, filename, mime_type, size_bytes, kind, project_id, task_id, created_at";
  const files = taskId
    ? await db.all(`SELECT ${cols} FROM files WHERE user_id = ? AND task_id = ? ORDER BY created_at DESC`, user.id, taskId)
    : await db.all(`SELECT ${cols} FROM files WHERE user_id = ? ORDER BY created_at DESC`, user.id);
  return c.json({ files });
});

filesRoute.post("/", rateLimit({ windowSeconds: 60, max: 30, keyFn: userKey }), async (c) => {
  const user = c.get("user");
  const db = new Db(c.env.DB);
  const settings = await loadSettings(c.env);

  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  const projectId = form?.get("projectId");
  if (!file || typeof file === "string") return c.json({ error: "file is required (multipart/form-data)" }, 400);

  if (file.size > settings.maxFileSizeMb * 1024 * 1024) {
    return c.json({ error: `File exceeds the max size (${settings.maxFileSizeMb}MB)` }, 400);
  }
  const used = await db.first<{ n: number }>("SELECT COALESCE(SUM(size_bytes), 0) AS n FROM files WHERE user_id = ?", user.id);
  if ((used?.n ?? 0) + file.size > settings.maxStorageMbPerUser * 1024 * 1024) {
    return c.json({ error: `Storage limit reached (${settings.maxStorageMbPerUser}MB)` }, 400);
  }

  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const problem = validateContent(ext, bytes);
  if (problem) return c.json({ error: problem }, 400);

  let project: string | null = null;
  if (typeof projectId === "string" && projectId) {
    const owns = await db.first("SELECT id FROM projects WHERE id = ? AND user_id = ?", projectId, user.id);
    if (!owns) return c.json({ error: "Project not found" }, 400);
    project = projectId;
  }

  const safeName = file.name.replace(/[^\p{L}\p{N}._ ()-]/gu, "_").slice(0, 120) || `file.${ext}`;
  const fileId = newId("file");
  const key = `users/${user.id}/uploads/${fileId}-${safeName}`;
  try {
    await new D1ObjectStore(c.env.DB).put(key, bytes, { httpMetadata: { contentType: TYPES[ext]?.mime } });
  } catch (error) {
    if (error instanceof ObjectStorageQuotaError) return c.json({ error: error.message }, 507);
    throw error;
  }
  try {
    await db.run(
      `INSERT INTO files (id, user_id, project_id, object_key, filename, mime_type, size_bytes, kind, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'upload', ?)`,
      fileId, user.id, project, key, safeName, TYPES[ext]?.mime ?? "application/octet-stream", bytes.byteLength, now(),
    );
  } catch (error) {
    await new D1ObjectStore(c.env.DB).delete(key);
    throw error;
  }
  return c.json({ id: fileId, key }, 201);
});

filesRoute.delete("/:id", rateLimit({ windowSeconds: 60, max: 30, keyFn: userKey }), async (c) => {
  const user = c.get("user");
  const db = new Db(c.env.DB);
  const fileId = c.req.param("id");
  const file = await db.first<{ object_key: string }>(
    "SELECT object_key FROM files WHERE id = ? AND user_id = ?",
    fileId, user.id,
  );
  if (!file) return c.json({ error: "Not found" }, 404);
  const results = await db.batch([
    db.stmt("UPDATE artifacts SET file_id = NULL WHERE file_id = ?", fileId),
    db.stmt("DELETE FROM files WHERE id = ? AND user_id = ?", fileId, user.id),
    db.stmt(`UPDATE object_blob_usage SET used_bytes = MAX(0, used_bytes -
      COALESCE((SELECT size_bytes FROM object_blobs WHERE object_key = ?), 0)) WHERE singleton_id = 1`, file.object_key),
    db.stmt("DELETE FROM object_blob_chunks WHERE object_key = ?", file.object_key),
    db.stmt("DELETE FROM object_blobs WHERE object_key = ?", file.object_key),
  ]);
  if ((results[1]?.meta?.changes ?? 0) !== 1) return c.json({ error: "Not found" }, 404);
  return c.json({ deleted: true });
});

filesRoute.get("/:id/download", async (c) => {
  const user = c.get("user");
  const file = await new Db(c.env.DB).first<{ object_key: string; mime_type: string; filename: string }>(
    "SELECT object_key, mime_type, filename FROM files WHERE id = ? AND user_id = ?",
    c.req.param("id"),
    user.id,
  );
  if (!file || !file.object_key) return c.json({ error: "Not found" }, 404);

  const obj = await new D1ObjectStore(c.env.DB).get(file.object_key);
  if (!obj) return c.json({ error: "File missing in storage" }, 404);

  // Header values must be Latin-1: send an ASCII fallback plus the RFC 5987 UTF-8 name (Arabic filenames).
  const ascii = file.filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new Response(obj.body, {
    headers: {
      "Content-Type": file.mime_type,
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
    },
  });
});

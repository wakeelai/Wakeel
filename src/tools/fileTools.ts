import type { Tool, ToolResult } from "./types";
import { newId } from "../lib/db";
import { Db } from "../lib/db";
import { D1ObjectStore, ObjectStorageQuotaError } from "../lib/objectStore";

export const fileWriteTool: Tool<{ filename: string; content: string; mime?: string }> = {
  name: "file_write",
  description: "Write a text/markdown/csv/json artifact file into the workspace.",
  permission: "WRITE",
  inputSchema: { filename: "string", content: "string", mime: "string?" },
  async execute(input, ctx): Promise<ToolResult> {
    const key = `users/${ctx.userId}/tasks/${ctx.taskId}/${newId()}-${input.filename}`;
    const mime = input.mime ?? "text/plain";
    try {
      await new D1ObjectStore(ctx.env.DB).put(key, input.content, {
        httpMetadata: { contentType: mime },
      });
    } catch (error) {
      if (error instanceof ObjectStorageQuotaError) return { ok: false, output: null, summary: error.message, error: "storage_quota" };
      throw error;
    }
    return {
      ok: true,
      output: { key },
      summary: `Wrote ${input.filename}`,
      artifact: { type: mimeToArtifactType(mime), title: input.filename, content: input.content, mime },
    };
  },
};

export const fileReadTool: Tool<{ key: string }> = {
  name: "file_read",
  description: "Read a previously stored file from the workspace by its storage key.",
  permission: "READ",
  inputSchema: { key: "string" },
  async execute(input, ctx): Promise<ToolResult> {
    const key = typeof input?.key === "string" ? input.key : "";
    // Do not treat knowledge of the internal storage key as authorization.
    // Enforce both the user namespace and the owner row at the tool boundary.
    if (key.length > 1024 || !key.startsWith(`users/${ctx.userId}/`)) {
      return { ok: false, output: null, summary: "File not found", error: "not_found" };
    }
    const owned = await new Db(ctx.env.DB).first<{ id: string }>(
      "SELECT id FROM files WHERE user_id = ? AND object_key = ? LIMIT 1",
      ctx.userId,
      key,
    );
    if (!owned) return { ok: false, output: null, summary: "File not found", error: "not_found" };

    const obj = await new D1ObjectStore(ctx.env.DB).get(key);
    if (!obj) {
      return { ok: false, output: null, summary: "File not found", error: "not_found" };
    }
    const text = await obj.text();
    return { ok: true, output: text, summary: `Read ${text.length.toLocaleString()} chars` };
  },
};

function mimeToArtifactType(mime: string): string {
  if (mime.includes("json")) return "json";
  if (mime.includes("csv")) return "csv";
  if (mime.includes("html")) return "html";
  if (mime.includes("markdown")) return "markdown";
  return "markdown";
}

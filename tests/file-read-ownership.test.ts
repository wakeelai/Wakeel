import { describe, expect, it } from "vitest";
import { D1ObjectStore } from "../src/lib/objectStore";
import { fileReadTool } from "../src/tools/fileTools";
import type { Env } from "../src/types";
import type { ToolContext } from "../src/tools/types";
import { createTestD1 } from "./testDb";

describe("file_read ownership boundary", () => {
  it("allows the owner and returns not_found to another user who knows the key", async () => {
    const DB = createTestD1();
    const key = "users/owner-1/tasks/task-1/secret.txt";
    await new D1ObjectStore(DB).put(key, "private content");
    DB.prepare(`INSERT INTO files (id, user_id, task_id, object_key, filename, mime_type, size_bytes, kind, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind("file-1", "owner-1", "task-1", key, "secret.txt", "text/plain", 15, "upload", Date.now()).run();
    const base = { env: { DB } as unknown as Env, taskId: "task-1", confirmed: false };

    const owner = await fileReadTool.execute({ key }, { ...base, userId: "owner-1" } as ToolContext);
    expect(owner.ok).toBe(true);
    expect(owner.output).toBe("private content");

    const otherUser = await fileReadTool.execute({ key }, { ...base, userId: "other-user" } as ToolContext);
    expect(otherUser).toMatchObject({ ok: false, output: null, error: "not_found" });
  });
});

import { describe, expect, it } from "vitest";
import { Db } from "../src/lib/db";
import { createTaskWithCreditReservation } from "../src/payments/credit";
import { createTestD1 } from "./testDb";

function setup(balance: number) {
  const raw = createTestD1();
  const userId = "user_atomic";
  raw._seed("users", { id: userId, supabase_uid: "sb_atomic", email: "atomic@example.test", created_at: 1, updated_at: 1 });
  raw._seed("credits", { user_id: userId, balance, updated_at: 1 });
  return { raw, db: new Db(raw), userId };
}
function task(id: string, userId: string) {
  return { id, userId, projectId: null, title: id, prompt: `prompt ${id}`, webResearch: true, browser: false, code: false };
}

describe("atomic task-credit accounting", () => {
  it("creates task, single debit, and balance_after ledger row in one D1 batch", async () => {
    const { raw, db, userId } = setup(10);
    expect(await createTaskWithCreditReservation(db, task("task_one", userId), 5)).toBe(true);
    expect(raw._get("tasks", { id: "task_one" })?.status).toBe("queued");
    expect(raw._get("credits", { user_id: userId })?.balance).toBe(5);
    expect(raw._get("credit_transactions", { ref_id: "task_one", reason: "task_run" })).toMatchObject({ amount: -5, balance_after: 5 });
  });

  it("does not create a task or ledger entry when funds are insufficient", async () => {
    const { raw, db, userId } = setup(4);
    expect(await createTaskWithCreditReservation(db, task("task_short", userId), 5)).toBe(false);
    expect(raw._get("tasks", { id: "task_short" })).toBeUndefined();
    expect(raw._get("credit_transactions", { ref_id: "task_short", reason: "task_run" })).toBeUndefined();
    expect(raw._get("credits", { user_id: userId })?.balance).toBe(4);
  });

  it("prevents simultaneous tasks from spending the same five credits", async () => {
    const { raw, db, userId } = setup(5);
    const results = await Promise.all([
      createTaskWithCreditReservation(db, task("task_race_a", userId), 5),
      createTaskWithCreditReservation(db, task("task_race_b", userId), 5),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(raw._get("credits", { user_id: userId })?.balance).toBe(0);
    await expect(raw.prepare("SELECT COUNT(*) AS n FROM credit_transactions WHERE user_id = ? AND reason = 'task_run'").bind(userId).first()).resolves.toMatchObject({ n: 1 });
  });
});

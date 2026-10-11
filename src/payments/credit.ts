import { Db, newId, now } from "../lib/db";

export interface NewTaskReservation {
  id: string; userId: string; projectId: string | null; title: string; prompt: string;
  webResearch: boolean; browser: boolean; code: boolean;
}

/** Create the task, debit credits, and record the ledger row atomically. */
export async function createTaskWithCreditReservation(db: Db, task: NewTaskReservation, cost: number): Promise<boolean> {
  const ts = now();
  const results = await db.batch([
    db.stmt(
      `INSERT INTO tasks (id, user_id, project_id, title, prompt, status, mode_web_research, mode_browser, mode_code, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM credits WHERE user_id = ? AND balance >= ?)`,
      task.id, task.userId, task.projectId, task.title, task.prompt, task.webResearch ? 1 : 0,
      task.browser ? 1 : 0, task.code ? 1 : 0, ts, ts, task.userId, cost,
    ),
    db.stmt(
      `UPDATE credits SET balance = balance - ?, updated_at = ? WHERE user_id = ? AND balance >= ?
       AND EXISTS (SELECT 1 FROM tasks WHERE id = ? AND user_id = ? AND status = 'queued')
       AND NOT EXISTS (SELECT 1 FROM credit_transactions WHERE reason = 'task_run' AND ref_id = ?)`,
      cost, ts, task.userId, cost, task.id, task.userId, task.id,
    ),
    db.stmt(
      `INSERT INTO credit_transactions (id, user_id, amount, reason, ref_id, balance_after, created_at)
       SELECT ?, ?, ?, 'task_run', ?, balance, ? FROM credits WHERE user_id = ? AND changes() = 1`,
      newId("ctx"), task.userId, -cost, task.id, ts, task.userId,
    ),
    db.stmt(`DELETE FROM tasks WHERE id = ? AND NOT EXISTS (SELECT 1 FROM credit_transactions WHERE reason = 'task_run' AND ref_id = ?)`, task.id, task.id),
  ]);
  return (results[0]?.meta?.changes ?? 0) === 1 && (results[1]?.meta?.changes ?? 0) === 1 && (results[2]?.meta?.changes ?? 0) === 1;
}

export interface FinalizeResult {
  credited: boolean;
  credits: number;
  /** True when this payment had already been credited before this call. */
  duplicate?: boolean;
}

/**
 * Marks a payment finished and grants the plan's credits EXACTLY ONCE, atomically.
 *
 * Everything runs in a single D1 batch (= one transaction): the optional idempotency-key insert
 * (UNIQUE — a replayed event aborts the whole batch), the status flip, the balance update and the
 * ledger row. `payments.credits_awarded IS NULL` is the latch that makes the credit single-use even
 * if two different paths (signed webhook + admin approval) race, and a crash can never leave the
 * event recorded but the credits missing.
 */
export async function finalizePaymentAndCredit(
  db: Db,
  opts: { paymentId: string; providerPaymentId?: string | null; event?: { id: string; raw: string } },
): Promise<FinalizeResult> {
  const p = await db.first<{ user_id: string; plan_id: string | null; credits_awarded: number | null }>(
    "SELECT user_id, plan_id, credits_awarded FROM payments WHERE id = ?",
    opts.paymentId,
  );
  if (!p) throw new Error("payment not found");
  if (p.credits_awarded !== null) return { credited: false, credits: 0, duplicate: true };

  const plan = p.plan_id
    ? await db.first<{ credits_included: number }>("SELECT credits_included FROM plans WHERE id = ?", p.plan_id)
    : null;
  const credits = plan?.credits_included ?? 0;
  const ts = now();

  const stmts: D1PreparedStatement[] = [];
  if (opts.event) {
    stmts.push(
      db.stmt(
        "INSERT INTO payment_events (id, payment_id, provider_event_id, raw_payload, processed_at) VALUES (?, ?, ?, ?, ?)",
        newId("pevt"), opts.paymentId, opts.event.id, opts.event.raw, ts,
      ),
    );
  }
  stmts.push(
    db.stmt(
      "UPDATE payments SET status = 'finished', provider_payment_id = COALESCE(?, provider_payment_id), updated_at = ? WHERE id = ?",
      opts.providerPaymentId ?? null, ts, opts.paymentId,
    ),
    db.stmt("INSERT OR IGNORE INTO credits (user_id, balance, updated_at) VALUES (?, 0, ?)", p.user_id, ts),
    db.stmt(
      "UPDATE credits SET balance = balance + ?, updated_at = ? WHERE user_id = ? AND (SELECT credits_awarded FROM payments WHERE id = ?) IS NULL",
      credits, ts, p.user_id, opts.paymentId,
    ),
    db.stmt(
      `INSERT INTO credit_transactions (id, user_id, amount, reason, ref_id, balance_after, created_at)
       SELECT ?, ?, ?, 'purchase', ?, (SELECT balance FROM credits WHERE user_id = ?), ?
       WHERE (SELECT credits_awarded FROM payments WHERE id = ?) IS NULL`,
      newId("ctx"), p.user_id, credits, opts.paymentId, p.user_id, ts, opts.paymentId,
    ),
    db.stmt("UPDATE payments SET credits_awarded = ? WHERE id = ? AND credits_awarded IS NULL", credits, opts.paymentId),
  );

  const results = await db.batch(stmts);
  const balanceUpdate = results[stmts.length - 3];
  const credited = (balanceUpdate?.meta?.changes ?? 0) > 0;
  return { credited, credits: credited ? credits : 0 };
}

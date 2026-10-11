import { describe, it, expect } from "vitest";
import { applyNowPaymentsWebhook, verifyNowPaymentsSignature } from "../src/payments/nowpayments";
import { finalizePaymentAndCredit } from "../src/payments/credit";
import { Db, now } from "../src/lib/db";
import { createTestD1 } from "./testDb";
import type { Env } from "../src/types";

function seeded() {
  const d1 = createTestD1();
  // "starter" (credits_included: 800) already exists — inserted by the migration itself.
  d1._seed("users", { id: "user_1", supabase_uid: "sb_1", email: "a@example.com", created_at: now(), updated_at: now() });
  d1._seed("credits", { user_id: "user_1", balance: 100, updated_at: now() });
  d1._seed("payments", {
    id: "pay_1", user_id: "user_1", plan_id: "starter", provider: "nowpayments",
    amount_usd: 5, pay_currency: "usdtbsc", status: "pending", created_at: now(), updated_at: now(),
  });
  const env = { DB: d1, NOWPAYMENTS_API_KEY: "key", NOWPAYMENTS_IPN_SECRET: "shh-secret" } as unknown as Env;
  return { env, d1 };
}

const basePayload = {
  payment_id: "np_123",
  payment_status: "finished",
  order_id: "pay_1",
  price_amount: 5,
  pay_currency: "usdtbsc",
};

describe("NOWPayments webhook idempotency", () => {
  it("credits the account exactly once on a 'finished' event", async () => {
    const { env, d1 } = seeded();
    const result = await applyNowPaymentsWebhook(env, basePayload);

    expect(result.applied).toBe(true);
    expect((d1._get("credits", { user_id: "user_1" }) as { balance: number }).balance).toBe(900); // 100 + 800
    const payment = d1._get("payments", { id: "pay_1" }) as { status: string; credits_awarded: number };
    expect(payment.status).toBe("finished");
    expect(payment.credits_awarded).toBe(800);
  });

  it("does NOT credit the account twice when the same webhook event is redelivered", async () => {
    const { env, d1 } = seeded();
    await applyNowPaymentsWebhook(env, basePayload);

    // NOWPayments (or any webhook sender) redelivers the exact same event — must be a no-op.
    const second = await applyNowPaymentsWebhook(env, basePayload);

    expect(second.applied).toBe(false);
    expect(second.reason).toBe("duplicate_event");
    expect((d1._get("credits", { user_id: "user_1" }) as { balance: number }).balance).toBe(900); // still 900, not 1700
  });

  it("rejects an amount that doesn't match the original payment (tamper protection)", async () => {
    const { env, d1 } = seeded();
    const result = await applyNowPaymentsWebhook(env, { ...basePayload, price_amount: 0.01 });
    expect(result.applied).toBe(false);
    expect(result.reason).toBe("amount_mismatch");
    expect((d1._get("credits", { user_id: "user_1" }) as { balance: number }).balance).toBe(100);
  });

  it("rejects a webhook whose HMAC signature does not match", async () => {
    const { env } = seeded();
    const body = JSON.stringify(basePayload);
    const validSig = await computeExpectedSignature(env, body);
    expect(await verifyNowPaymentsSignature(env, body, validSig)).toBe(true);
    expect(await verifyNowPaymentsSignature(env, body, "wrong-signature")).toBe(false);
    expect(await verifyNowPaymentsSignature(env, body, undefined)).toBe(false);
  });
});

describe("finalizePaymentAndCredit (shared by webhook + admin approval)", () => {
  it("is exactly-once: a second call for an already-credited payment is a safe no-op", async () => {
    // Simulates the signed webhook and an admin's manual approval both landing on the same
    // payment: whichever runs first grants credits; the second must find the `credits_awarded`
    // latch already set (the atomic WHERE ... IS NULL guard) and do nothing further.
    const { d1 } = seeded();
    const db = new Db(d1);

    const first = await finalizePaymentAndCredit(db, { paymentId: "pay_1" });
    const second = await finalizePaymentAndCredit(db, { paymentId: "pay_1" });

    expect(first.credited).toBe(true);
    expect(first.credits).toBe(800);
    expect(second.credited).toBe(false);
    expect(second.duplicate).toBe(true);
    expect((d1._get("credits", { user_id: "user_1" }) as { balance: number }).balance).toBe(900); // not 1700
  });
});

async function computeExpectedSignature(env: Env, body: string): Promise<string> {
  const sortedObj = Object.keys(JSON.parse(body))
    .sort()
    .reduce<Record<string, unknown>>((acc, k) => {
      acc[k] = JSON.parse(body)[k];
      return acc;
    }, {});
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.NOWPAYMENTS_IPN_SECRET as string),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(JSON.stringify(sortedObj)));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

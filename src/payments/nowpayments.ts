import type { Env } from "../types";
import { Db, newId, now } from "../lib/db";
import { finalizePaymentAndCredit } from "./credit";

const NOWPAYMENTS_API = "https://api.nowpayments.io/v1";

export function isNowPaymentsEnabled(env: Env): boolean {
  return Boolean(env.NOWPAYMENTS_API_KEY && env.NOWPAYMENTS_IPN_SECRET);
}

export async function createNowPayment(
  env: Env,
  opts: { orderId: string; amountUsd: number; payCurrency: string; callbackUrl: string },
) {
  if (!isNowPaymentsEnabled(env)) {
    throw new Error("NOWPayments is not configured");
  }
  const res = await fetch(`${NOWPAYMENTS_API}/payment`, {
    method: "POST",
    headers: {
      "x-api-key": env.NOWPAYMENTS_API_KEY as string,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      price_amount: opts.amountUsd,
      price_currency: "usd",
      pay_currency: opts.payCurrency,
      order_id: opts.orderId,
      ipn_callback_url: opts.callbackUrl,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`NOWPayments create-payment failed (${res.status}): ${body.slice(0, 300)}`);
  }

  return (await res.json()) as {
    payment_id: string;
    pay_address: string;
    pay_amount: number;
    pay_currency: string;
    payment_status: string;
  };
}

/** Sorts keys recursively — required by NOWPayments' HMAC signing scheme. */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

async function hmacSha512Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const sigBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sigBuffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyNowPaymentsSignature(
  env: Env,
  rawBody: string,
  signatureHeader: string | undefined,
): Promise<boolean> {
  if (!signatureHeader || !env.NOWPAYMENTS_IPN_SECRET) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return false;
  }
  const sortedJson = JSON.stringify(sortKeysDeep(parsed));
  const expected = await hmacSha512Hex(env.NOWPAYMENTS_IPN_SECRET, sortedJson);
  return expected === signatureHeader;
}

export interface NowPaymentsWebhookPayload {
  payment_id: string;
  payment_status: string;
  order_id: string;
  price_amount: number;
  pay_currency: string;
  actually_paid?: number;
}

const STATUS_MAP: Record<string, string> = {
  waiting: "pending",
  confirming: "confirming",
  confirmed: "confirmed",
  sending: "confirming",
  finished: "finished",
  failed: "failed",
  expired: "expired",
  refunded: "refunded",
  // NOTE: "partially_paid" is deliberately absent: an under-payment must never be credited automatically.
};

const isUniqueViolation = (e: unknown) => /UNIQUE constraint failed/i.test(String(e));

/**
 * Applies an already signature-verified webhook. Beyond the signature it validates order id, payment id,
 * amount, currency and status, and crediting is exactly-once + atomic (see finalizePaymentAndCredit).
 */
export async function applyNowPaymentsWebhook(
  env: Env,
  payload: NowPaymentsWebhookPayload,
): Promise<{ applied: boolean; reason?: string }> {
  const db = new Db(env.DB);
  const eventId = `${payload.payment_id}:${payload.payment_status}`;

  const payment = await db.first<{
    id: string;
    provider: string;
    status: string;
    amount_usd: number;
    pay_currency: string | null;
    provider_payment_id: string | null;
  }>(
    "SELECT id, provider, status, amount_usd, pay_currency, provider_payment_id FROM payments WHERE id = ?",
    payload.order_id,
  );
  if (!payment || payment.provider !== "nowpayments") return { applied: false, reason: "payment_not_found" };
  if (payment.provider_payment_id && payment.provider_payment_id !== String(payload.payment_id)) {
    return { applied: false, reason: "payment_id_mismatch" };
  }
  if (Math.abs(Number(payload.price_amount) - payment.amount_usd) > 0.01) {
    return { applied: false, reason: "amount_mismatch" };
  }
  if (
    payment.pay_currency &&
    payload.pay_currency &&
    payment.pay_currency.toLowerCase() !== payload.pay_currency.toLowerCase()
  ) {
    return { applied: false, reason: "currency_mismatch" };
  }

  const newStatus = STATUS_MAP[payload.payment_status];
  if (!newStatus) return { applied: false, reason: "ignored_status" };

  try {
    if (newStatus === "finished") {
      const r = await finalizePaymentAndCredit(db, {
        paymentId: payment.id,
        providerPaymentId: String(payload.payment_id),
        event: { id: eventId, raw: JSON.stringify(payload) },
      });
      return r.credited ? { applied: true } : { applied: false, reason: "duplicate_event" };
    }

    // A late "confirming" must never downgrade a finished payment.
    if (payment.status === "finished" && newStatus !== "refunded") {
      return { applied: false, reason: "already_finished" };
    }
    await db.batch([
      db.stmt(
        "INSERT INTO payment_events (id, payment_id, provider_event_id, raw_payload, processed_at) VALUES (?, ?, ?, ?, ?)",
        newId("pevt"), payment.id, eventId, JSON.stringify(payload), now(),
      ),
      db.stmt(
        "UPDATE payments SET status = ?, provider_payment_id = COALESCE(?, provider_payment_id), updated_at = ? WHERE id = ?",
        newStatus, String(payload.payment_id), now(), payment.id,
      ),
    ]);
    return { applied: true };
  } catch (e) {
    if (isUniqueViolation(e)) return { applied: false, reason: "duplicate_event" };
    throw e;
  }
}

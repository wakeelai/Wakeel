import { Hono } from "hono";
import type { Env } from "../types";
import { verifyNowPaymentsSignature, applyNowPaymentsWebhook } from "../payments/nowpayments";

export const webhooksRoute = new Hono<{ Bindings: Env }>();

webhooksRoute.post("/nowpayments", async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header("x-nowpayments-sig");

  const isValid = await verifyNowPaymentsSignature(c.env, rawBody, signature);
  if (!isValid) {
    // Never process an unsigned/incorrectly-signed payload — this is the
    // single most important check in the whole payments flow.
    return c.json({ error: "Invalid signature" }, 401);
  }

  let payload: {
    payment_id: string | number;
    payment_status: string;
    order_id: string;
    price_amount: number;
    pay_currency: string;
    actually_paid?: number;
  };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  if (!payload.order_id || !payload.payment_id || !payload.payment_status) {
    return c.json({ error: "Missing required fields" }, 400);
  }

  const result = await applyNowPaymentsWebhook(c.env, {
    payment_id: String(payload.payment_id),
    payment_status: payload.payment_status,
    order_id: payload.order_id,
    price_amount: payload.price_amount,
    pay_currency: payload.pay_currency,
    actually_paid: payload.actually_paid,
  });

  // Always 200 on a validly-signed, well-formed event (even if it was a
  // duplicate) so NOWPayments doesn't endlessly retry — the idempotency
  // guarantee lives in payment_events.provider_event_id, not in the HTTP code.
  return c.json({ ok: true, applied: result.applied, reason: result.reason });
});

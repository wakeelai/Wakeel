import { Hono } from "hono";
import type { Env } from "../types";
import { Db, newId, now } from "../lib/db";
import { createNowPayment, isNowPaymentsEnabled } from "../payments/nowpayments";
import { finalizePaymentAndCredit } from "../payments/credit";
import { getDirectWalletDetails, isDirectWalletEnabled } from "../payments/directWallet";
import { BSC_MIN_CONFIRMATIONS, verifyBscUsdtTransfer, type BscUsdtCheck } from "../payments/bscUsdt";
import { ensureBscPaymentScanCursor } from "../payments/bscAutoScanner";
import { rateLimit, userKey } from "../middleware/rateLimit";

export const paymentsRoute = new Hono<{ Bindings: Env }>();

function usdToBscUnits(amountUsd: number): string {
  const [whole = "0", fractional = ""] = amountUsd.toFixed(6).split(".");
  return (BigInt(whole) * (10n ** 18n) + BigInt(fractional.padEnd(6, "0")) * (10n ** 12n)).toString();
}

function candidateInvoiceAmount(baseUsd: number): number {
  // Add 1–9,999 micro-USDT (0.000001–0.009999) as an invoice discriminator.
  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  const suffixMicros = ((random[0] ?? 0) % 9999) + 1;
  return (Math.round(baseUsd * 1_000_000) + suffixMicros) / 1_000_000;
}

type DirectPaymentRow = {
  id: string;
  user_id: string;
  plan_id: string | null;
  provider: string;
  amount_usd: number;
  pay_amount_usdt: number | null;
  invoice_created_block: number | null;
  network: string | null;
  wallet_address: string | null;
  tx_hash: string | null;
  status: string;
};

paymentsRoute.get("/methods", (c) => {
  return c.json({
    nowpayments: isNowPaymentsEnabled(c.env),
    directWallet: isDirectWalletEnabled(c.env) ? getDirectWalletDetails(c.env) : null,
  });
});

paymentsRoute.post("/create", rateLimit({ windowSeconds: 60, max: 10, keyFn: userKey }), async (c) => {
  const user = c.get("user");
  const db = new Db(c.env.DB);
  const body = await c.req.json<{ planId: string; method: "nowpayments" | "direct_wallet"; payCurrency?: string }>();

  const plan = await db.first<{ id: string; price_usd: number }>(
    "SELECT id, price_usd FROM plans WHERE id = ? AND is_active = 1",
    body.planId,
  );
  if (!plan) return c.json({ error: "Unknown plan" }, 400);
  if (plan.price_usd <= 0) return c.json({ error: "This plan is free — no payment needed" }, 400);

  const paymentId = newId("pay");
  const ts = now();

  if (body.method === "nowpayments") {
    if (!isNowPaymentsEnabled(c.env)) {
      return c.json({ error: "NOWPayments is not configured on this server" }, 400);
    }
    await db.run(
      `INSERT INTO payments (id, user_id, plan_id, provider, amount_usd, status, created_at, updated_at)
       VALUES (?, ?, ?, 'nowpayments', ?, 'created', ?, ?)`,
      paymentId, user.id, plan.id, plan.price_usd, ts, ts,
    );

    const callbackUrl = `${new URL(c.req.url).origin}/api/webhooks/nowpayments`;
    try {
      const np = await createNowPayment(c.env, {
        orderId: paymentId,
        amountUsd: plan.price_usd,
        payCurrency: body.payCurrency ?? "usdtbsc",
        callbackUrl,
      });
      await db.run(
        "UPDATE payments SET provider_payment_id = ?, pay_currency = ?, status = 'pending', updated_at = ? WHERE id = ?",
        String(np.payment_id), np.pay_currency, now(), paymentId,
      );
      return c.json({
        paymentId,
        provider: "nowpayments",
        payAddress: np.pay_address,
        payAmount: np.pay_amount,
        payCurrency: np.pay_currency,
      });
    } catch (e) {
      await db.run("UPDATE payments SET status = 'failed', updated_at = ? WHERE id = ?", now(), paymentId);
      return c.json({ error: `Could not create NOWPayments payment: ${e}` }, 502);
    }
  }

  if (body.method === "direct_wallet") {
    const wallet = getDirectWalletDetails(c.env);
    if (!wallet) return c.json({ error: "USDT automatic payments are not configured on this server" }, 400);
    let invoiceCreatedBlock: number;
    try {
      // Establish a block checkpoint before the invoice exists, so an old transfer can
      // never be matched to a newly-created order by coincidence.
      invoiceCreatedBlock = await ensureBscPaymentScanCursor(db, c.env);
    } catch (error) {
      console.error("Could not initialize BSC payment scanner", String(error).slice(0, 180));
      return c.json({ error: "تعذّر الاتصال بشبكة BSC لتهيئة مراقبة الدفعات. أعد المحاولة بعد قليل." }, 503);
    }

    let payAmountUsdt: number | null = null;
    let inserted = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      const candidate = candidateInvoiceAmount(plan.price_usd);
      const collision = await db.first<{ id: string }>(
        "SELECT id FROM payments WHERE provider = 'direct_wallet' AND pay_amount_usdt = ?",
        candidate,
      );
      if (collision) continue;
      try {
        await db.run(
          `INSERT INTO payments (id, user_id, plan_id, provider, amount_usd, pay_amount_usdt, invoice_created_block, pay_currency, network, wallet_address, status, created_at, updated_at)
           VALUES (?, ?, ?, 'direct_wallet', ?, ?, ?, 'USDT', ?, ?, 'created', ?, ?)`,
          paymentId, user.id, plan.id, plan.price_usd, candidate, invoiceCreatedBlock, wallet.network, wallet.address, ts, ts,
        );
        payAmountUsdt = candidate;
        inserted = true;
        break;
      } catch (error) {
        if (/UNIQUE constraint failed/i.test(String(error))) continue;
        throw error;
      }
    }
    if (!inserted || payAmountUsdt === null) {
      return c.json({ error: "Could not allocate a unique USDT invoice amount. Use another payment method or contact support." }, 503);
    }

    return c.json({
      paymentId,
      provider: "direct_wallet",
      payAddress: wallet.address,
      network: wallet.network,
      payCurrency: "USDT (BEP20)",
      payAmount: payAmountUsdt,
      tokenContract: wallet.tokenContract,
      chainId: wallet.chainId,
      explorerUrl: "https://bscscan.com",
      // EIP-681 token-transfer payload; wallet apps that support it can prefill recipient + exact invoice amount.
      qrPayload: `ethereum:${wallet.tokenContract}@56/transfer?address=${wallet.address}&uint256=${usdToBscUnits(payAmountUsdt)}`,
    });
  }

  return c.json({ error: "Unknown payment method" }, 400);
});

/**
 * The checkout polls this endpoint. Once a submitted transfer reaches the required
 * confirmations, this read path finalizes it automatically without administrator action.
 */
paymentsRoute.get("/:id", async (c) => {
  const user = c.get("user");
  const db = new Db(c.env.DB);
  const id = c.req.param("id");
  const candidate = await db.first<DirectPaymentRow>(
    "SELECT id, user_id, plan_id, provider, amount_usd, pay_amount_usdt, invoice_created_block, network, wallet_address, tx_hash, status FROM payments WHERE id = ? AND user_id = ?",
    id, user.id,
  );
  if (!candidate) return c.json({ error: "Not found" }, 404);

  if (
    candidate.provider === "direct_wallet" && candidate.tx_hash &&
    candidate.status === "confirming" && candidate.wallet_address && candidate.pay_amount_usdt !== null && candidate.invoice_created_block !== null
  ) {
    try {
      const check = await verifyBscUsdtTransfer(c.env, candidate.tx_hash, candidate.wallet_address, candidate.pay_amount_usdt);
      if (check.valid && check.blockNumber > candidate.invoice_created_block && check.confirmations >= check.requiredConfirmations) {
        await finalizePaymentAndCredit(db, { paymentId: candidate.id });
      }
    } catch (error) {
      // A transient public-RPC failure must not mark a valid payment failed or grant credits early.
      console.warn("Automatic USDT payment verification temporarily unavailable", String(error).slice(0, 180));
    }
  }

  const payment = await db.first(
    "SELECT * FROM payments WHERE id = ? AND user_id = ?",
    id, user.id,
  );
  return c.json({ payment });
});

/**
 * Submit a transaction hash for automatic on-chain verification. A matching transfer
 * is recorded as confirming, then polling finalizes it after 15 BSC block confirmations.
 * This endpoint never trusts a client-side "I paid" assertion.
 */
paymentsRoute.post("/:id/submit-tx", async (c) => {
  const user = c.get("user");
  const db = new Db(c.env.DB);
  const id = c.req.param("id");
  const body = await c.req.json<{ txHash: string }>();
  const payment = await db.first<DirectPaymentRow>(
    "SELECT id, user_id, plan_id, provider, amount_usd, pay_amount_usdt, invoice_created_block, network, wallet_address, tx_hash, status FROM payments WHERE id = ? AND user_id = ?",
    id, user.id,
  );
  if (!payment) return c.json({ error: "Not found" }, 404);
  if (payment.provider !== "direct_wallet") {
    return c.json({ error: "This payment does not use direct USDT wallet mode" }, 400);
  }
  if (payment.status === "finished") return c.json({ ok: true, status: "finished", alreadyFinished: true });
  if (!["created", "pending", "confirming"].includes(payment.status)) {
    return c.json({ error: `Payment is already ${payment.status}` }, 409);
  }
  if (payment.pay_amount_usdt === null || payment.invoice_created_block === null) {
    return c.json({ error: "This is an older invoice without a unique on-chain boundary. Create a new checkout invoice before sending payment." }, 409);
  }

  const txHash = body.txHash?.trim().toLowerCase() ?? "";
  if (!/^0x[a-f0-9]{64}$/.test(txHash)) {
    return c.json({ error: "Enter a valid BSC transaction hash (0x followed by 64 hexadecimal characters)." }, 400);
  }
  if (payment.tx_hash && payment.tx_hash.toLowerCase() !== txHash) {
    return c.json({ error: "A transaction hash is already attached to this payment." }, 409);
  }

  const wallet = getDirectWalletDetails(c.env);
  if (!wallet || !payment.wallet_address) return c.json({ error: "USDT payments are not configured correctly" }, 503);
  const reused = await db.first<{ id: string }>(
    "SELECT id FROM payments WHERE lower(tx_hash) = ? AND id != ?",
    txHash, id,
  );
  if (reused) return c.json({ error: "This transaction hash was already used for another payment." }, 409);

  let check: BscUsdtCheck;
  try {
    check = await verifyBscUsdtTransfer(c.env, txHash, payment.wallet_address, payment.pay_amount_usdt);
  } catch (error) {
    console.error("BSC USDT verifier error", String(error).slice(0, 180));
    return c.json({ error: "تعذّر الاتصال بشبكة BSC للتحقق الآن. أعد المحاولة بعد قليل." }, 503);
  }

  if (check.valid && check.blockNumber <= payment.invoice_created_block) {
    return c.json({ error: "هذه المعاملة أقدم من الفاتورة ولا يمكن إعادة استخدامها لدفعها." }, 400);
  }

  if (!check.valid) {
    if (check.reason === "not_found") {
      return c.json({ error: "لم تُعثر على المعاملة بعد. انتظر حتى تُدرج في شبكة BSC ثم أرسل رقمها مجددًا." }, 409);
    }
    if (check.reason === "transaction_failed") {
      return c.json({ error: "هذه المعاملة فشلت على البلوكشين، ولم تُحتسب دفعة." }, 400);
    }
    if (check.reason === "amount_mismatch") {
      const expectedAmount = payment.pay_amount_usdt;
      return c.json({ error: `يجب أن يطابق المبلغ الفاتورة بدقة (${expectedAmount.toFixed(6)} USDT). أرسل المبلغ الصحيح أو تواصل مع الدعم إذا أرسلت مبلغًا مختلفًا.` }, 400);
    }
    return c.json({ error: "لم يتم العثور على تحويل الرمز الصحيح إلى عنوان الاستلام على شبكة BSC في هذه المعاملة." }, 400);
  }

  try {
    const update = await db.run(
      `UPDATE payments SET tx_hash = ?, status = 'confirming', updated_at = ?
       WHERE id = ? AND user_id = ? AND provider = 'direct_wallet'
         AND status IN ('created', 'pending', 'confirming')
         AND (tx_hash IS NULL OR tx_hash = ?)`,
      txHash, now(), id, user.id, txHash,
    );
    if ((update.meta?.changes ?? 0) === 0) {
      const latest = await db.first<{ status: string; tx_hash: string | null }>(
        "SELECT status, tx_hash FROM payments WHERE id = ? AND user_id = ?", id, user.id,
      );
      if (latest?.status === "finished") return c.json({ ok: true, status: "finished", alreadyFinished: true });
      return c.json({ error: "The payment changed while this transaction was being checked. Refresh and try again." }, 409);
    }
  } catch (error) {
    if (/UNIQUE constraint failed/i.test(String(error))) {
      return c.json({ error: "This transaction hash was already used for another payment." }, 409);
    }
    throw error;
  }

  if (check.confirmations >= check.requiredConfirmations) {
    const result = await finalizePaymentAndCredit(db, { paymentId: payment.id });
    return c.json({
      ok: true,
      status: "finished",
      confirmations: check.confirmations,
      requiredConfirmations: BSC_MIN_CONFIRMATIONS,
      creditsAwarded: result.credits,
    });
  }

  return c.json({
    ok: true,
    status: "confirming",
    confirmations: check.confirmations,
    requiredConfirmations: BSC_MIN_CONFIRMATIONS,
    message: "Transaction verified; waiting for more block confirmations.",
  }, 202);
});

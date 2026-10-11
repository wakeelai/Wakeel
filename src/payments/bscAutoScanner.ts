import type { Env } from "../types";
import { Db, now } from "../lib/db";
import { getDirectWalletDetails } from "./directWallet";
import { BSC_MIN_CONFIRMATIONS, getBscLatestBlockNumber, scanBscUsdtTransfers } from "./bscUsdt";
import { finalizePaymentAndCredit } from "./credit";

const SCAN_CHAIN_KEY = "bsc-mainnet";
const MAX_BLOCKS_PER_RUN = 500;

type ScanCursor = { last_scanned_block: number };
type CandidatePayment = { id: string; tx_hash: string | null; status: string; invoice_created_block: number | null };

/** Initialize just before a new invoice is issued so historical transfers cannot be mistaken for payment. */
export async function ensureBscPaymentScanCursor(db: Db, env: Env): Promise<number> {
  // Always take a fresh, validated block snapshot for the invoice. It also prevents a
  // pre-existing transfer from being attached to a newly-created invoice by amount alone.
  const latest = await getBscLatestBlockNumber(env);
  const existing = await db.first<ScanCursor>(
    "SELECT last_scanned_block FROM payment_scan_cursors WHERE chain = ?",
    SCAN_CHAIN_KEY,
  );
  if (!existing) {
    const safeBlock = Math.max(0, latest - BSC_MIN_CONFIRMATIONS + 1);
    await db.run(
      `INSERT INTO payment_scan_cursors (chain, last_scanned_block, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(chain) DO UPDATE SET
         last_scanned_block = MIN(payment_scan_cursors.last_scanned_block, excluded.last_scanned_block),
         updated_at = excluded.updated_at`,
      SCAN_CHAIN_KEY, safeBlock, now(),
    );
  }
  return latest;
}

/**
 * Passive payment detection. Every five minutes, inspect confirmed Transfer logs to the
 * configured wallet. A unique invoice amount and a globally unique transaction hash make
 * automatic matching safe for the shared receiving address without a memo field.
 */
export async function scanBscPaymentInvoices(env: Env): Promise<{ blocksScanned: number; paymentsCredited: number }> {
  const wallet = getDirectWalletDetails(env);
  if (!wallet || !env.DB) return { blocksScanned: 0, paymentsCredited: 0 };

  const db = new Db(env.DB);
  const latest = await getBscLatestBlockNumber(env);
  // A block is mature once currentBlock - transferBlock + 1 >= required confirmations.
  const matureBlock = latest - BSC_MIN_CONFIRMATIONS + 1;
  if (matureBlock < 0) return { blocksScanned: 0, paymentsCredited: 0 };

  let cursor = await db.first<ScanCursor>(
    "SELECT last_scanned_block FROM payment_scan_cursors WHERE chain = ?",
    SCAN_CHAIN_KEY,
  );
  if (!cursor) {
    await db.run(
      "INSERT OR IGNORE INTO payment_scan_cursors (chain, last_scanned_block, updated_at) VALUES (?, ?, ?)",
      SCAN_CHAIN_KEY, matureBlock, now(),
    );
    return { blocksScanned: 0, paymentsCredited: 0 };
  }

  const fromBlock = cursor.last_scanned_block + 1;
  if (fromBlock > matureBlock) return { blocksScanned: 0, paymentsCredited: 0 };
  const toBlock = Math.min(matureBlock, fromBlock + MAX_BLOCKS_PER_RUN - 1);
  const logs = await scanBscUsdtTransfers(env, wallet.address, fromBlock, toBlock);
  let paymentsCredited = 0;

  for (const log of logs) {
    const amount = Number(log.amountMicros) / 1_000_000;
    if (!Number.isFinite(amount) || amount <= 0) continue;

    const candidate = await db.first<CandidatePayment>(
      `SELECT id, tx_hash, status, invoice_created_block FROM payments
       WHERE provider = 'direct_wallet' AND lower(wallet_address) = lower(?) AND pay_amount_usdt = ?
         AND status IN ('created', 'pending', 'confirming')
       LIMIT 1`,
      wallet.address, amount,
    );
    if (!candidate || candidate.invoice_created_block === null || log.blockNumber <= candidate.invoice_created_block) continue;
    if (candidate.tx_hash && candidate.tx_hash.toLowerCase() !== log.transactionHash) continue;

    const reused = await db.first<{ id: string }>(
      "SELECT id FROM payments WHERE lower(tx_hash) = ? AND id != ?",
      log.transactionHash, candidate.id,
    );
    if (reused) continue;

    try {
      const attached = await db.run(
        `UPDATE payments SET tx_hash = COALESCE(tx_hash, ?), status = 'confirming', updated_at = ?
         WHERE id = ? AND provider = 'direct_wallet'
           AND status IN ('created', 'pending', 'confirming')
           AND (tx_hash IS NULL OR lower(tx_hash) = ?)`,
        log.transactionHash, now(), candidate.id, log.transactionHash,
      );
      if ((attached.meta?.changes ?? 0) === 0) continue;
      const finalized = await finalizePaymentAndCredit(db, { paymentId: candidate.id });
      if (finalized.credited) paymentsCredited += 1;
    } catch (error) {
      // Most commonly a concurrent scan attached the same hash. Keep the cursor where
      // it is so the next scheduled pass can safely retry the affected log.
      if (/UNIQUE constraint failed/i.test(String(error))) continue;
      throw error;
    }
  }

  await db.run(
    "UPDATE payment_scan_cursors SET last_scanned_block = MAX(last_scanned_block, ?), updated_at = ? WHERE chain = ?",
    toBlock, now(), SCAN_CHAIN_KEY,
  );
  return { blocksScanned: toBlock - fromBlock + 1, paymentsCredited };
}

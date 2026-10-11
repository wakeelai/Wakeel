-- The tx hash is globally unique, even if a user submits it concurrently from two sessions.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_tx_hash_unique
  ON payments(lower(tx_hash)) WHERE tx_hash IS NOT NULL;

-- Each direct-wallet invoice gets a unique amount with a tiny 6-decimal suffix. This
-- lets a shared receiving address bind transfers to one specific invoice without a memo.
-- Amounts are not reused across historical rows; if the invoice-amount space fills up,
-- payment creation fails closed rather than making an order ambiguous.
ALTER TABLE payments ADD COLUMN pay_amount_usdt REAL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_direct_wallet_invoice_amount_unique
  ON payments(pay_amount_usdt)
  WHERE provider = 'direct_wallet' AND pay_amount_usdt IS NOT NULL;

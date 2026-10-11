-- Store the latest BSC block observed at invoice creation. Older transfers cannot be replayed
-- to unlock a new invoice even if their amount happens to collide with a generated invoice.
ALTER TABLE payments ADD COLUMN invoice_created_block INTEGER;

-- Durable checkpoint for passive USDT transfer detection on BNB Smart Chain.
CREATE TABLE IF NOT EXISTS payment_scan_cursors (
  chain TEXT PRIMARY KEY,
  last_scanned_block INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

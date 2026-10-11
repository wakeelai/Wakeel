-- Atomic control tables: idempotent task debits/refunds, D1-backed request limits,
-- and an application ceiling aligned with the Cloudflare Workers Free browser allowance.
CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_task_debit_once
  ON credit_transactions(ref_id) WHERE reason = 'task_run' AND ref_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_task_refund_once
  ON credit_transactions(ref_id) WHERE reason = 'task_refund' AND ref_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS rate_limit_counters (
  bucket_key TEXT NOT NULL,
  window_id INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_key, window_id)
);

CREATE TABLE IF NOT EXISTS browser_daily_usage (
  day TEXT PRIMARY KEY,
  calls INTEGER NOT NULL DEFAULT 0,
  reserved_ms INTEGER NOT NULL DEFAULT 0,
  used_ms INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS browser_run_leases (
  lease_id TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_browser_run_leases_expiry ON browser_run_leases(expires_at);

-- R2 requires an account subscription checkout; move object storage to D1 so Workers Free remains cardless.
ALTER TABLE files RENAME COLUMN r2_key TO object_key;
CREATE TABLE object_blob_usage (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  used_bytes INTEGER NOT NULL DEFAULT 0 CHECK (used_bytes >= 0)
);
INSERT INTO object_blob_usage (singleton_id, used_bytes) VALUES (1, 0);
CREATE TABLE object_blobs (
  object_key TEXT PRIMARY KEY,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  content_type TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  complete INTEGER NOT NULL DEFAULT 0 CHECK (complete IN (0, 1))
);
CREATE TABLE object_blob_chunks (
  object_key TEXT NOT NULL REFERENCES object_blobs(object_key) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  chunk_data BLOB NOT NULL,
  PRIMARY KEY (object_key, chunk_index)
);
CREATE INDEX idx_object_blob_chunks_key ON object_blob_chunks(object_key, chunk_index);

-- Atomic per-user daily AI route reservations; avoids races between count and provider dispatch.
CREATE TABLE ai_daily_reservations (
  user_id TEXT NOT NULL REFERENCES users(id),
  day TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0 CHECK (calls >= 0),
  PRIMARY KEY (user_id, day)
);

-- Wakeel — initial schema. SQLite dialect (Cloudflare D1).

CREATE TABLE users (
  id TEXT PRIMARY KEY,                 -- uuid
  firebase_uid TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  locale TEXT NOT NULL DEFAULT 'ar',   -- 'ar' | 'en'
  theme TEXT NOT NULL DEFAULT 'system',
  role TEXT NOT NULL DEFAULT 'user',   -- 'user' | 'admin'
  status TEXT NOT NULL DEFAULT 'active', -- 'active' | 'suspended'
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  description TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_projects_user ON projects(user_id);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  project_id TEXT REFERENCES projects(id),
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
    -- queued | planning | running | waiting | completed | failed | cancelled
  mode_web_research INTEGER NOT NULL DEFAULT 1,
  mode_browser INTEGER NOT NULL DEFAULT 0,
  mode_code INTEGER NOT NULL DEFAULT 0,
  result_summary TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  locked_until INTEGER        -- execution lock so two requests never run one task concurrently
);
CREATE INDEX idx_tasks_user ON tasks(user_id);
CREATE INDEX idx_tasks_project ON tasks(project_id);

CREATE TABLE task_steps (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  step_index INTEGER NOT NULL,
  phase TEXT NOT NULL,        -- planning|searching|reading|analyzing|generating|verifying|completed
  title TEXT NOT NULL,
  description TEXT,
  tool_used TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  started_at INTEGER,
  finished_at INTEGER,
  duration_ms INTEGER,
  details_json TEXT,          -- expandable details, JSON-encoded
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_task_steps_task ON task_steps(task_id);

CREATE TABLE task_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  attempt INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  state_json TEXT,            -- serialized executor state, for resume
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_task_runs_task ON task_runs(task_id);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  role TEXT NOT NULL,          -- user|agent|system|tool
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_messages_task ON messages(task_id);

CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  title TEXT,
  url TEXT NOT NULL,
  retrieved_at INTEGER NOT NULL,
  excerpt TEXT
);
CREATE INDEX idx_sources_task ON sources(task_id);

CREATE TABLE files (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  project_id TEXT REFERENCES projects(id),
  task_id TEXT REFERENCES tasks(id),
  r2_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'upload',  -- upload | artifact
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_files_user ON files(user_id);
CREATE INDEX idx_files_task ON files(task_id);

CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  file_id TEXT REFERENCES files(id),
  type TEXT NOT NULL,          -- markdown|html|json|csv|xlsx|pdf|docx|image|chart|code|website
  title TEXT NOT NULL,
  preview_text TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_artifacts_task ON artifacts(task_id);

CREATE TABLE tool_calls (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  step_id TEXT REFERENCES task_steps(id),
  tool_name TEXT NOT NULL,
  input_json TEXT,
  output_json TEXT,
  permission_level TEXT NOT NULL, -- READ|WRITE|EXTERNAL_ACTION|FINANCIAL|DESTRUCTIVE
  confirmed INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'queued',
  attempt INTEGER NOT NULL DEFAULT 1,
  error TEXT,
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX idx_tool_calls_task ON tool_calls(task_id);

CREATE TABLE usage (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL,      -- groq|openrouter|cloudflare_ai|browser_use|jina
  day TEXT NOT NULL,           -- 'YYYY-MM-DD' (UTC)
  calls INTEGER NOT NULL DEFAULT 0,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, provider, day)
);

CREATE TABLE credits (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  balance INTEGER NOT NULL DEFAULT 100,
  updated_at INTEGER NOT NULL
);

CREATE TABLE credit_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL,      -- positive = credit, negative = debit
  reason TEXT NOT NULL,         -- 'task_run'|'purchase'|'admin_adjustment'|'signup_bonus'
  ref_id TEXT,                  -- task_id or payment_id
  balance_after INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_credit_tx_user ON credit_transactions(user_id);

CREATE TABLE usage_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  task_id TEXT REFERENCES tasks(id),
  event_type TEXT NOT NULL,
  metadata_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE plans (
  id TEXT PRIMARY KEY,          -- 'free'|'starter'|'pro'|'business'
  name TEXT NOT NULL,
  price_usd REAL NOT NULL,
  credits_included INTEGER NOT NULL,
  features_json TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  plan_id TEXT REFERENCES plans(id),
  provider TEXT NOT NULL,       -- 'nowpayments'|'direct_wallet'
  amount_usd REAL NOT NULL,
  pay_currency TEXT,            -- e.g. USDTBSC
  network TEXT,
  wallet_address TEXT,
  provider_payment_id TEXT,     -- NOWPayments payment_id, if applicable
  tx_hash TEXT,                 -- user-submitted hash (direct wallet mode)
  status TEXT NOT NULL DEFAULT 'created',
    -- created|pending|confirming|confirmed|finished|failed|expired|refunded|pending_review
  credits_awarded INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_payments_user ON payments(user_id);

CREATE TABLE payment_events (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL,
  provider_event_id TEXT UNIQUE, -- idempotency key (e.g. NOWPayments payment_id + status)
  raw_payload TEXT,
  processed_at INTEGER NOT NULL
);

CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,        -- sha-256 of the key, never store raw
  key_prefix TEXT NOT NULL,      -- first chars, for display
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
);
CREATE INDEX idx_api_keys_user ON api_keys(user_id);

CREATE TABLE agent_settings (
  id TEXT PRIMARY KEY,           -- 'global' singleton row, or user_id for per-user overrides
  scope TEXT NOT NULL DEFAULT 'global', -- 'global'|'user'
  settings_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE admin_logs (
  id TEXT PRIMARY KEY,
  admin_user_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  metadata_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE task_logs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  event TEXT NOT NULL,  -- TASK_STARTED|PLAN_CREATED|TOOL_CALLED|TOOL_FAILED|MODEL_CALLED|ARTIFACT_CREATED|TASK_COMPLETED
  data_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_task_logs_task ON task_logs(task_id);

INSERT INTO plans (id, name, price_usd, credits_included, features_json, sort_order) VALUES
  ('free', 'Free', 0, 100, '["basic tasks","web research","1 project"]', 0),
  ('starter', 'Starter', 5, 800, '["+browser automation","5 projects"]', 1),
  ('pro', 'Pro', 15, 3000, '["+priority queue","20 projects"]', 2),
  ('business', 'Business', 30, 8000, '["+team sharing (soon)","unlimited projects"]', 3);

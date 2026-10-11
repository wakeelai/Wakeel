# Wakeel (وكيل) — an AI Agent Platform

Write a task in plain language. The agent plans it, uses tools, executes each step live, and hands
you back a result plus files inside one workspace — built to run entirely on free infrastructure,
with free-tier services selected and usage caps documented below. No paid browser/search API key is used.

This is a real, working MVP: a Cloudflare Worker (Hono) backend with D1-backed data/object storage, a React/Vite
frontend, Supabase Authentication, a multi-provider AI router, a resumable agent engine, and crypto
payments (NOWPayments + direct BSC USDT with automatic on-chain verification) — not a mockup.

---

## 0. What's implemented vs. what's a documented next step

Being upfront, because this matters more than it looks good:

| Area | Status |
|---|---|
| Auth (Supabase email/password + Google OAuth, verification, reset) | ✅ Working |
| AI Provider Router (Groq → OpenRouter free models → Workers AI free-model rotation; hard daily cap, never falls back to paid) | ✅ Working, unit-tested |
| Adaptive agent engine (analyze → plan → execute → evidence review/replan → source-aware synthesis), resumable, retries+backoff | ✅ Working; adaptive review is bounded to one extra controller call per non-simple task |
| Tools: multi-source web_research, direct public HTML search + browser fallback, web_read (Jina Reader), calculator, file_read/write, website_builder | ✅ Working |
| Permission system (READ/WRITE/EXTERNAL_ACTION/FINANCIAL/DESTRUCTIVE) + confirmation gate | ✅ Working |
| Projects, Files (chunked D1 storage), Artifacts (with sandboxed live HTML preview), Usage & Limits | ✅ Working |
| Credits, plans, admin-editable pricing & limits, maintenance mode | ✅ Working |
| NOWPayments (signed webhook, exactly-once crediting) + BSC USDT direct wallet (on-chain verification, auto-credit after confirmations) | ✅ Implemented; chain-verifier tests added |
| Admin dashboard (users, payments, provider status, settings, logs) | ✅ Working |
| i18n (Arabic/English), RTL/LTR, dark/light theme, command palette (⌘K) | ✅ Working |
| Streaming task execution (SSE), step timeline, task recovery on reload | ✅ Working |
| **Browser automation** | ✅ Cloudflare Browser Run + Puppeteer, public-site browsing/link following, SSRF guardrails, 3-session and 10-minute/day app caps; no Browser Use Cloud key |
| **Code Interpreter (Python)** | ✅ Pyodide in a dedicated browser Web Worker; 8s timeout, 20KB code/12KB output caps, network APIs blocked, no server-side execution |
| Automatic detection of direct-wallet USDT transfers | ✅ A five-minute Cloudflare Cron Trigger scans confirmed BSC BEP-20 Transfer logs, matches the unique invoice amount, and credits automatically after 15 confirmations. Users may submit a tx hash to request an immediate check. |
| Rate limiting | ✅ Atomic D1 UPSERT counters per window/key with `Retry-After`; auth/files/payments/tasks/webhooks guarded |

Nothing above was stubbed out silently — anywhere the code takes a shortcut, there's a comment
explaining it and what a production hardening pass would add.

---

## 1. Architecture

```
Browser (React SPA)
   │  Supabase Auth access token (Bearer)
   ▼
Cloudflare Worker (Hono)  ──►  D1 (SQLite)      — app data, atomic controls, and chunked file blobs
   │                      ──►  Workers AI binding — one of 3 free LLM providers
   ├─ AI Provider Router  ──►  Groq / OpenRouter (optional API keys; Free plan only)
   ├─ Agent Engine (analyze → plan → execute → evidence-aware replanning → synthesize)
   ├─ Tools (real browser, local Python, web reading/search, calculator, files, website builder)
   └─ Payments (NOWPayments webhook, BSC USDT direct transfer + confirmation polling)
```

Everything is a single Cloudflare Worker that also serves the built frontend as static assets
(`[assets]` in `wrangler.toml`) — one `wrangler deploy`, one URL, no second hosting product needed.

### Why these specific defaults
- **Steps run one-at-a-time per HTTP request** (`MAX_STEPS_PER_INVOCATION=1`, admin-editable). Workers
  cap the work of a single invocation; rather than risk truncation mid-task, the engine persists its
  full state after every step and the frontend transparently calls `/resume` in a loop. You'll see the
  task progress in small increments — that's this design working as intended, not a bug.
- **Evidence-aware adaptation is deliberately bounded.** A non-simple task can get one controller review
  after a successful research/browser/code step. It may replace only the unfinished part of the plan,
  filters repeated completed actions, and preserves a final synthesis step. Failure recovery remains
  separately bounded to two repairs. This is not an unlimited background agent and cannot operate after
  all free inference quotas are exhausted.
- **Research no longer depends exclusively on browser minutes.** `web_search` first reads DuckDuckGo's
  public HTML endpoint without a key and uses Browser Run only as a fallback. `web_research` reads up to
  three independent public pages using Jina Reader, stores source URLs, and sends a numbered source list
  to final synthesis for citations.
- **A per-task lock** (`tasks.locked_until`) stops two tabs/requests from executing the same task
  concurrently.
- **Credits are granted through one atomic function** (`finalizePaymentAndCredit`, in
  `src/payments/credit.ts`) shared by the NOWPayments webhook, BSC scheduled scanner/on-chain confirmation path and the legacy admin manual-approval
  path, using a `credits_awarded IS NULL` latch inside a single D1 batch. Task creation also inserts
  the task, debits credits, and writes the ledger row in one atomic batch, preventing concurrent
  requests from spending the same balance and preventing completion-time double charges.

---

## 2. No-card / free-infrastructure policy

| Service | Free? | Card required? | Purpose |
|---|---|---|---|
| Cloudflare Workers + static assets | Yes (generous free tier) | **No** | Hosting the API + the built frontend |
| Cloudflare D1 (Workers Free) | Yes: 500 MB/database, 5 GB/account, 5M reads + 100K writes/day | **No** on Workers Free | App data and chunked object store; quota exhaustion blocks writes rather than auto-billing |
| Cloudflare Browser Run | Workers Free: 10 minutes/day, 3 concurrent sessions | **No** for Workers Free | Real Puppeteer browser; application additionally caps usage |
| Cloudflare Workers AI | Yes (free daily neuron allocation) | **No** | 3rd fallback AI provider |
| Supabase Auth (Free plan) | Yes, within limits | Usually no card for Free plan; account checks can vary | Email/password + optional Google OAuth |
| Groq API (`openai/gpt-oss-20b`) | Free Plan, rate-limited | Free tier does not require Developer-tier payment method | 1st AI provider; use only Free account tier |
| OpenRouter Free plan | Yes; free models, 50 requests/day | **No** (Free plan lists no payment options) | 2nd AI provider; pinned IDs all end in `:free`; live catalog test checks $0 input/output |
| Jina Reader (`r.jina.ai`) | 20 requests/min without a key | **No** | Read a public URL; live anonymous HTTP check passed |
| DuckDuckGo public search pages | Public HTML results first; Browser Run fallback only when needed | **No API key** | Bot challenges are not bypassed |
| Jina Search (`s.jina.ai`) | Anonymous API returned HTTP 401 | Not used | No paid/keyed search endpoint is configured |
| Browser Use Cloud | May offer trial credit; ongoing usage is metered | Not used | No Browser Use Cloud key or paid browser API call |
| Cloudflare R2 | Free monthly allowance, but official setup requires an R2 subscription checkout | **Not verified cardless; not used** | Deliberately removed from the default setup |
| NOWPayments | Optional checkout; provider transaction fees may apply | **Not verified cardless; not used by agent execution** | Disabled unless the deployer configures payment credentials |

These services have quotas and their terms may change. The table describes currently documented free-tier
requirements, not a guarantee about account verification: an external provider may request additional identity,
phone, or abuse-prevention checks depending on location/account. The app does not bypass those checks. Keep
Cloudflare on Workers Free, use Groq Free and OpenRouter's verified `:free` model IDs, and do not configure
optional payment credentials if cardless operation is required. See `docs/service-verification.md` for official
source links, endpoint behavior, budgets, and the limits of the app-level safeguards.

### The one rule the whole AI layer is built around
`src/providers/router.ts` tries Groq → OpenRouter → Workers AI, in that order, and falls through only when a
provider reports unavailability, rate limits, quota exhaustion, or an endpoint/configuration failure
(`ProviderUnavailableError`). Workers AI itself rotates
among free-plan-listed GLM-4.7-Flash, Gemma 4 26B A4B, and Nemotron 3 120B A12B; OpenRouter uses only explicit `:free` model IDs. If every configured
provider is unavailable, or the admin-configurable daily cap is hit, it throws
`AllProvidersExhaustedError` — full stop. There is no fourth branch that calls a paid API. This is
covered by `tests/provider-router.test.ts`.

---

## 3. Project layout

```
wakeel/
├── src/                    # Cloudflare Worker (Hono) — the backend
│   ├── index.ts            # app wiring: CORS, security headers, routes, maintenance guard
│   ├── routes/              # tasks, projects, files, artifacts, usage, payments, webhooks, admin, auth
│   ├── agent/               # analyzer, planner, engine (the resumable execution loop)
│   ├── providers/            # groq.ts, openrouter.ts, cloudflareAi.ts, router.ts
│   ├── tools/                # tool interface + registry + individual tools
│   ├── payments/             # NOWPayments, direct wallet, BSC transfer scanner, atomic credit grant
│   ├── middleware/           # auth (Supabase token verification), rateLimit, admin
│   └── lib/                   # db helpers, settings, supabaseAuth
├── web/                     # React + Vite + Tailwind — the frontend (builds into web/dist)
│   └── src/{pages,components,lib,i18n}
├── migrations/0001_init.sql  # full D1 schema (21 tables)
├── tests/                    # vitest, against a real embedded SQLite (not a hand-rolled mock)
├── wrangler.toml
├── .env.example
└── package.json
```

---

## 4. Setup, step by step

### 4.1 Prerequisites
- Node.js 20+ and npm
- A free Cloudflare account
- A free Supabase account
- A free Groq account and/or OpenRouter account (at least one recommended; Workers AI needs neither)

### 4.2 Install
```bash
npm install
npm --prefix web install
```

### 4.3 Cloudflare: Workers Free + D1 (no R2 subscription or KV namespace)
```bash
npx wrangler login

npx wrangler d1 create wakeel-db
# copy the returned database_id into wrangler.toml -> [[d1_databases]] -> database_id

```

File contents are stored as 64 KB BLOB chunks in D1; this avoids the separate R2 subscription checkout.
The app caps object storage at 200 MB total, 20 MB per object, and defaults to 150 MB per user. Delete
old uploads or generated files/artifacts in **Files** to reclaim the app-level object quota. D1 Free
allows 500 MB per database / 5 GB per account; Cloudflare rejects further writes after the free quota
instead of automatically charging. **This is a bounded MVP store for small files, not an archive or a
high-volume/large-object backend**; move to object storage if the no-card constraint is relaxed and
larger-scale storage becomes necessary.

**Existing R2 deployment:** the migration renames the file-key column but cannot copy object bytes from
R2. Export/re-upload any files you need before switching; legacy R2 objects are not readable by this build.

### 4.4 Run migrations
```bash
npm run db:migrate:local     # for local `wrangler dev`
npm run db:migrate:remote    # once you're ready to deploy
```

### 4.5 Supabase Authentication
1. Open the [Supabase dashboard](https://supabase.com/dashboard) and create a project on the Free plan. Email confirmation and password reset use Supabase’s built-in email sender, which is best-effort and currently limited to about two emails per hour; this is suitable for testing, not high-volume production mail.
2. In **Authentication → Providers**, enable **Email**. For Google sign-in, configure the Google provider and its OAuth credentials; this is optional.
3. In **Authentication → URL Configuration**, add your deployed app URL and local development URL to the allowed redirect URLs.
4. Copy the project URL and the public/publishable API key from **Project Settings → API**. Set the backend variables (use the publishable key, never a secret/service-role key):
   ```bash
   npx wrangler secret put SUPABASE_URL
   npx wrangler secret put SUPABASE_PUBLISHABLE_KEY
   ```
   When prompted, enter the project URL and public/publishable key, respectively. The Worker validates each access token through Supabase Auth's `/auth/v1/user` endpoint, which also supports projects still using legacy HS256 tokens.
5. Create `web/.env.local` for the frontend build:
   ```bash
   VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   ```
   A legacy public `anon` key also works, but never put a `sb_secret` or `service_role` key in the frontend or source control.
6. Set your own email as the admin bootstrap:
   ```bash
   npx wrangler secret put ADMIN_EMAIL   # the first new account with this email is auto-promoted to admin
   ```

**Existing accounts created under the previous authentication provider:** migration `0003_supabase_auth.sql` renames the stored provider-ID column while keeping rows intact. On first login with Supabase, an existing account is linked by email only after Supabase confirms that the email is verified. Unverified same-email accounts must be verified before they can be linked. Supabase Auth replaces Firebase Auth only; application data, credits, tasks, and file blobs remain in Cloudflare D1 in this version.

### 4.6 AI providers (configure at least one; all are optional and independently skippable)
```bash
npx wrangler secret put GROQ_API_KEY          # https://console.groq.com
npx wrangler secret put OPENROUTER_API_KEY    # https://openrouter.ai/keys
# Workers AI needs no key — it uses the [ai] binding already in wrangler.toml
```

### 4.7 Web research

No search API key is needed. Search parses DuckDuckGo public HTML directly first and uses Cloudflare Browser Run as a fallback; public URL reading
uses the anonymous Jina Reader endpoint (20 requests/minute). Jina Search is not used because its
anonymous API returns HTTP 401.

### 4.7.1 Production CORS

Same-origin browser requests need no extra setup. Cross-origin requests are denied by default in production;
if a separately hosted frontend is required, set `CORS_ALLOWED_ORIGINS` to exact origins only (comma-separated,
for example `https://app.example.com,https://admin.example.com`) in the Worker's `[vars]`. Wildcards are not
supported. A localhost origin is accepted only when `APP_ENV="development"` **and** the API request itself
is served from a loopback HTTP address; a deployed Worker will not grant CORS to localhost.

### 4.8 Payments
NOWPayments remains optional and must be enabled with its API key and IPN secret:
```bash
npx wrangler secret put NOWPAYMENTS_API_KEY
npx wrangler secret put NOWPAYMENTS_IPN_SECRET
```

Direct wallet payments are preconfigured for the receiving address shown in `wrangler.toml`:
- Network: **BNB Smart Chain mainnet (BEP-20), chain ID 56**.
- Accepted token contract: `0x55d398326f99059fF775485246999027B3197955` — BscScan labels it **Binance-Peg BSC-USD**. Some wallets label it USDT; it is not Ethereum ERC-20 or Tron TRC-20 USDT.
- **Automatic detection is enabled:** a Cloudflare Cron Trigger runs every five minutes, scans confirmed `Transfer` logs for this wallet, and matches the exact amount to an invoice. Each invoice includes a tiny unique amount suffix (less than 0.01 USDT) so incoming transfers can be matched without a memo. Credits are added after 15 confirmations; no transaction-hash submission or admin approval is required. Users may optionally paste the tx hash in checkout to request an immediate verification. Invoices created by an older version lack the new invoice-block boundary; create a fresh invoice after running all migrations.
- The receiving wallet is public configuration, not a secret. Change `TRUST_WALLET_ADDRESS` only to an address you control. `BSC_RPC_URL` can be changed to another trusted BNB Chain mainnet RPC endpoint. If this Worker previously had these names configured as secrets, remove the old secrets before deploying because a name cannot be both a secret and a plain `[vars]` entry.

In NOWPayments' dashboard, set the IPN callback URL to `https://<your-worker>.workers.dev/api/webhooks/nowpayments`.

### 4.9 Build and run
```bash
npm run web:build     # builds web/dist, which wrangler serves as static assets
npm run dev           # wrangler dev — http://127.0.0.1:8787
```
For frontend hot-reload during development, `npm run web:dev` (Vite) proxies `/api` to
`127.0.0.1:8787` (see `web/vite.config.ts`) — run `npm run dev` in one terminal and
`npm run web:dev` in another.

### 4.10 Deploy
```bash
npm run web:build
npm run deploy
```

---

## 5. Tests

```bash
npm run typecheck          # tsc --noEmit on the whole worker
npm test                   # vitest — real embedded SQLite, concurrent AI cap/credits/rate-limit, owner and CORS tests
npm --prefix web run build # frontend production build + type-check
npm --prefix web run test:python-browser # optional: requires Chromium; runs the actual compiled Worker + Pyodide
npm run test:integration   # real anonymous Jina Reader + OpenRouter model-catalog requests
```

The Cloudflare Browser Run acceptance test is opt-in: set `ALLOW_BROWSER_RUN_INTEGRATION=1`,
`CLOUDFLARE_ACCOUNT_ID`, and `CLOUDFLARE_API_TOKEN` only for a Workers Free account. It consumes a
browser minute; never point it at a paid account if avoiding charges is required.

### Mapping to the acceptance tests from the brief

| # | Scenario | Where it's proven |
|---|---|---|
| 1 | Signup → login → task | Supabase Auth (`web/src/lib/auth.tsx`) + `authMiddleware` auto-creates the `users`/`credits` rows on first verified request |
| 2 | Task → plan → model → result | `agent/engine.ts`; manually verify via `POST /api/tasks` once a provider key is set |
| 3 | Web URL → read → summarize → source | `tools/webSearch.ts` (`web_read`), sources saved to the `sources` table and shown in the workspace's Sources tab |
| 4 | File upload → analyze → artifact | `routes/files.ts` (upload) + `file_read` tool + `website_builder`/synthesis produce artifacts |
| 5 | Code task → sandbox → result | Pyodide Worker, task pause/result callback; `test:python-browser` verifies real Python output in headless Chromium |
| 6 | Browser task → browser agent → result | Cloudflare Browser Run + Puppeteer; live browser acceptance test is opt-in and consumes free-tier minutes |
| 7 | Create crypto payment | `POST /api/payments/create` |
| 8 | Receive webhook | `POST /api/webhooks/nowpayments` |
| 9 | Verify payment | HMAC-SHA512 signature check in `payments/nowpayments.ts`, unit-tested |
| 10 | Add credits exactly once | `payments/credit.ts` atomic latch, covered by `payment-idempotency.test.ts`, `bsc-usdt.test.ts`, and `bsc-auto-scanner.test.ts` |
| 11 | Duplicate webhook must NOT add credits twice | Same test file — asserts balance is 900, not 1700, after a replayed event |
| 12 | Admin sees payment | `/admin` → Payments tab (`routes/admin.ts` `GET /payments`) |
| 13 | Quota exhausted → fallback | `provider-router.test.ts` — Groq 429 → OpenRouter succeeds; parallel calls cannot overshoot the D1 daily cap |
| 14 | All free AI quotas exhausted → graceful message, no paid charge | `AllProvidersExhaustedError`, surfaced to the user as a plain-language message in both languages; verified in `provider-router.test.ts` |

The default unit suite and frontend build run offline. `test:integration` makes live, anonymous HTTP
requests to Jina Reader and OpenRouter's public free-model catalog; the Cloudflare Browser Run call
remains an opt-in acceptance test because it consumes account quota. Authentication, AI completion,
and payment callbacks still require the deployer's own Supabase/provider/payment sandbox configuration.

---

## 6. Security notes worth knowing before you rely on this

- Every route checks `user_id` ownership before returning or mutating a row — see any `routes/*.ts`.
- Payments are **never** marked paid by a client-side click. NOWPayments requires a valid HMAC-SHA512 signature
  (`payments/nowpayments.ts`). Direct BSC payment mode scans confirmed transfer logs via a scheduled Worker trigger and also verifies user-submitted transaction hashes through BSC JSON-RPC,
  rejects reused transaction hashes, and grants credits only after 15 confirmations. The Cron scanner associates transfers by exact, unique invoice amount; submitting a transaction hash is optional for faster verification. No admin approval is needed for new automatic-wallet payments.
- File uploads are validated by magic bytes against their extension, not by the client-supplied MIME
  type (`routes/files.ts`).
- Python runs in the user's browser in a terminable Web Worker, not on the backend; network APIs and
  dynamic script loaders are blocked after the local Pyodide runtime initializes. A same-origin browser
  worker is **not a high-assurance sandbox for hostile multi-tenant code**; workloads needing that threat
  model should run on a separate origin or stronger isolation boundary.
- `file_read` requires both the current user's storage-key namespace and an ownership row in `files`; knowing
  another user's internal key is not authorization.
- API CORS allows same-origin traffic, exact origins configured in `CORS_ALLOWED_ORIGINS`, and localhost only
  for a loopback development API. It no longer reflects arbitrary `Origin` headers.
- Uploaded/generated HTML artifacts render in an iframe with `sandbox="allow-scripts"` **without**
  `allow-same-origin` — generated pages can run their own JS but can never read your cookies, your
  API token, or call the API on your behalf.
- API secrets (`GROQ_API_KEY`, `NOWPAYMENTS_IPN_SECRET`, …) live only in `wrangler secret put`. The receiving
  wallet address and public BSC RPC URL are not secrets, but the address must be one you control.
- The platform will never ask you (or your users) for a seed phrase or private key — only a public
  wallet address is ever configured.

---

## 7. Extending it later (the upgrade paths this was built for)

- **Another AI provider**: implement the `AiProvider` interface in `src/providers/` and push it onto
  the array in `buildProviderChain()` — the router, retry/backoff, and usage tracking are unaffected.
- **Browser Use**: implement the `Tool` interface (`src/tools/types.ts`) with `permission:
  "EXTERNAL_ACTION"`, register it with `registerTool()` in `src/tools/registry.ts` — the confirmation
  gate in the agent engine already handles pausing for user approval on anything sensitive.
- **Another payment provider**: add an adapter beside `payments/nowpayments.ts` that calls the same
  `finalizePaymentAndCredit()` for the actual crediting step, so exactly-once semantics come for free.
- **Team accounts / subscriptions / custom domain**: the schema already separates `users` from
  `projects` from `credits`; a `teams` table and a `team_id` column is additive, not a rewrite.

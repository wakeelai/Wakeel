# External service and free-tier verification (updated 2026-10-10)

Wakeel must not silently call a metered service or imply that a free allowance guarantees cardless onboarding. This record distinguishes **verified free API access**, **optional integrations**, and **services deliberately not used**. Cloudflare service terms and quotas can change; use the Free plans specified here and check current official documentation before deployment.

## Services used by the default build

| Service | Verification and use | Guardrails / caveats |
|---|---|---|
| Cloudflare Workers Free + D1 | Cloudflare markets Workers/D1 free start without a card. Official D1 pricing lists 5 million rows read/day, 100,000 rows written/day, and 5 GB total account storage; Free limits stop D1 queries/writes instead of automatically billing. | Per D1 database the Free size limit is 500 MB. The app stores objects in 64 KB chunks, caps each object at 20 MB and all app objects at 200 MB, and defaults to 150 MB per user. Keep the Cloudflare account on Workers Free. |
| Cloudflare Browser Run | Official Browser Run pricing lists 10 browser minutes/day and 3 concurrent browsers on Workers Free; the app uses the Worker `BROWSER` binding and Puppeteer, not Browser Use Cloud. | App-level cap: at most 20 runs/day, three concurrent sessions, and a shared 10-minute daily reservation. It cannot see usage from other Workers in the Cloudflare account. The optional live acceptance test consumes browser time and is not run by default. |
| Groq | Uses `openai/gpt-oss-20b`, which Groq lists as an active model with a free-plan rate-limit table. Its billing FAQ says the Developer tier requires a valid payment method. | Configure only a Groq Free account when cardless operation is required. The code makes ordinary completions with the configured key; it cannot inspect account billing state. Use a Groq Free account with no billing details; the application itself never configures payment methods. |
| OpenRouter | Official Free plan lists free-model API access and 50 requests/day. The app pins three model IDs suffixed `:free`; each was present in the public catalog with zero prompt/completion price. The opt-in acceptance test checks all exact IDs and pricing without a key. | Keep the account on Free and do not top up/upgrade. If the test detects model catalog/pricing drift, update the model list before deployment; never replace these with paid IDs. |
| Supabase Authentication | Supabase Free includes Auth within plan limits; the app uses email/password and optional Google OAuth. The built-in email sender is best-effort and rate-limited (currently documented at 2 emails/hour). | Phone authentication is not used. The project may require additional signup checks depending on account and region; do not assume cardless onboarding is guaranteed for every account. |
| Jina Reader | Anonymous `https://r.jina.ai/http://example.com` returned HTTP 200 during implementation; the official Reader page documents 20 requests/minute without an API key. | Only public URL reading uses Reader. No Jina key is configured or required. |
| DuckDuckGo public search pages | First fetches the public HTML results page directly without a key; falls back to the real Browser Run session when the endpoint challenges or returns no parseable results. | The browser does not bypass bot challenges. |

D1 object storage is deliberately kept below the platform Free per-database ceiling. D1 caps are shared with relational application data and other databases on the Cloudflare account; reaching a Workers Free quota causes D1 errors rather than an automatic upgrade or charge. This is not a guarantee of uninterrupted operation after a quota is exhausted. The D1 blob store is a bounded MVP solution for small files, not a long-term high-volume object-storage design; the app caps it at 200 MB total and 20 MB per object, with hard admin-setting clamps. If the no-card constraint is relaxed and file volume grows, move blobs behind an object-store interface to a separately verified object-storage service rather than raising these D1 limits.

The Pyodide browser worker expects `/pyodide/pyodide.js`; the build copies that classic loader as well as `pyodide.mjs`, the WebAssembly module, standard library, and lockfile. `npm --prefix web run test:python-browser` serves the built artifacts locally and runs actual Python in headless Chromium; this requires a local Chromium binary and makes no external API calls.

Production CORS is same-origin by default, with exact comma-separated additional origins only when explicitly configured in `CORS_ALLOWED_ORIGINS`. Arbitrary origin reflection is not used. Development localhost CORS additionally requires the API URL itself to be a loopback HTTP URL, so a deployed Worker does not authorize `localhost` origins even if its environment variable is accidentally left as `development`. The `file_read` tool independently checks both the user namespace and a matching owner row before reading an object key. AI daily limits now use one conditional SQLite/D1 UPSERT with `RETURNING`, so concurrent requests cannot all pass a read-then-write quota check; provider usage statistics use a separate atomic UPSERT.

## Services deliberately not used

| Service | Reason |
|---|---|
| Cloudflare R2 | Although R2 has an included monthly free allowance, its official getting-started guide requires an R2 subscription and a checkout flow. The official materials reviewed do not establish that enabling that R2 subscription is cardless. To honor the no-card requirement, R2 has been removed from the default Worker bindings and object data is stored in D1 instead. |
| Jina Search (`s.jina.ai`) | A live anonymous request returned HTTP 401. The application does not call it and does not configure a paid/keyed Jina Search endpoint. |
| Browser Use Cloud | Its pricing describes metered browser time/network traffic; a trial credit does not make ongoing use a guaranteed free API. No Browser Use Cloud key or API call is part of the app. |
| NOWPayments | Payment checkout is an optional feature and may involve provider fees/account requirements. It is not used for agent execution and remains disabled unless the deployer configures credentials. Cardless eligibility is not claimed. |

## Real acceptance tests

`npm run test:integration` makes anonymous real HTTP requests to Jina Reader and `https://openrouter.ai/api/v1/models`, requiring a successful page read and confirming every exact OpenRouter model ID used by the app still has zero prompt and completion price. These checks do not use API keys or create paid completions. The suite is opt-in so the default test command remains offline-safe.

The Cloudflare Browser Run acceptance test is separately gated by `ALLOW_BROWSER_RUN_INTEGRATION=1`, `CLOUDFLARE_ACCOUNT_ID`, and `CLOUDFLARE_API_TOKEN`. It calls Cloudflare's real Browser Run content endpoint and consumes browser minutes; only run it with a Workers Free account when avoiding charges is required. No Cloudflare credentials were present in this environment, so that external browser call was not run.

## Existing R2 deployments

Migration `0002_atomic_controls.sql` renames `files.r2_key` to `files.object_key`, but SQL migrations cannot copy object bytes out of an existing R2 bucket. Existing deployments must export/re-upload any needed old files before switching to this build; otherwise legacy file rows will point to objects absent from D1. New deployments need only Workers Free and D1—no R2 subscription, bucket, or KV namespace.

## Official sources

| Source | URL |
|---|---|
| Cloudflare Workers product and free start | https://www.cloudflare.com/products/workers/ |
| Cloudflare D1 pricing/free limits | https://developers.cloudflare.com/d1/platform/pricing/ |
| Cloudflare D1 hard limits, including 500 MB Free database and 2 MB row/BLOB maximum | https://developers.cloudflare.com/d1/platform/limits/ |
| Cloudflare Browser Run pricing | https://developers.cloudflare.com/browser-run/pricing/ |
| Cloudflare Browser Run Quick Actions | https://developers.cloudflare.com/browser-run/quick-actions/ |
| Cloudflare R2 onboarding / subscription checkout | https://developers.cloudflare.com/r2/get-started/ |
| Cloudflare R2 pricing | https://developers.cloudflare.com/r2/pricing/ |
| Groq rate limits | https://console.groq.com/docs/rate-limits |
| Groq active models | https://console.groq.com/docs/models |
| Groq GPT-OSS 20B model | https://console.groq.com/docs/model/openai/gpt-oss-20b |
| Cloudflare GLM-4.7-Flash | https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/ |
| Cloudflare Gemma 4 26B A4B | https://developers.cloudflare.com/ai/models/%40cf/google/gemma-4-26b-a4b-it/ |
| Cloudflare Nemotron 3 120B A12B | https://developers.cloudflare.com/ai/models/%40cf/nvidia/nemotron-3-120b-a12b/ |
| Groq billing FAQ | https://console.groq.com/docs/billing-faqs |
| OpenRouter Free plan | https://openrouter.ai/pricing |
| OpenRouter pricing | https://openrouter.ai/pricing |
| OpenRouter model catalog API docs | https://openrouter.ai/docs/api/api-reference/models/get-models |
| Supabase pricing plans | https://supabase.com/docs/guides/platform/billing-on-supabase |
| Supabase Auth password/email sending limits | https://supabase.com/docs/guides/auth/passwords |
| Jina Reader | https://jina.ai/reader/ |

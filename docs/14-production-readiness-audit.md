# Production-Readiness Audit

_Audit date: 12 October 2026 · branch `claude/trendset-research-strategy-tfpd30`_

## Evidence vocabulary (used strictly throughout)

| Label | Meaning |
|---|---|
| **LIVE** | Exercised against the real external service (FASHN, hosted Supabase, Shopify, Stripe…). |
| **LOCAL STACK** | Exercised against the official Supabase service images run locally: `supabase/postgres:15.8.1.060`, `supabase/gotrue:v2.170.0`, `supabase/storage-api:v1.19.3`, `postgrest/postgrest:v12.2.8`. These are real Postgres, RLS, Auth and Storage, but **not** the hosted Supabase platform. |
| **E2E (stubbed provider)** | The built Next.js app on the local stack, with the AI provider replaced by a local FASHN *contract stub* (`scripts/fashn-stub.mjs`) that returns a placeholder image. It proves TrendSet's pipeline, **not** FASHN. |
| **UNIT** | In-process tests with mocked I/O. |
| **NOT TESTED** | Code exists but has not been executed in any of the above ways. |

> **No LIVE test has been run for any external service in this audit.** No credentials for FASHN, hosted Supabase, Vercel, Shopify, Stripe or Google Cloud were available. The live FASHN test harness exists and **skipped** (see `docs/evidence/live-tests.txt`).

Test evidence (raw outputs) is in [`docs/evidence/`](evidence/):

| Suite | File | Result |
|---|---|---|
| Unit + typecheck | `unit-tests.txt` | 110 / 110 passed |
| Integration (local stack) | `integration-tests.txt` | 37 / 37 passed |
| End-to-end (stubbed provider) | `e2e-tests.txt` | 12 / 12 passed |
| Staging access gate (local `next start`, `APP_ENV=staging`) | `staging-gate.txt` | 401 without auth, 200 with it, noindex, robots disallow |
| Live | `live-tests.txt` | 1 skipped. No credentials, no live call made. |

---

## Defects found and fixed during this audit

All six were found by the new tests, not by reading the code. Each fix is covered by a regression test.

| # | Severity | Defect | Found by | Fix |
|---|---|---|---|---|
| D1 | **High** | **Account deletion failed** ("Database error deleting user") for any shopper with ≥1 generation. The FK `set null` UPDATE ran as Supabase Auth's internal role and was blocked by the `generations` guard trigger. This breaks a privacy promise. | E2E `deleting the account…`; reproduced in integration before the fix | Migration `0007_fix_user_deletion.sql`. Guards now apply only to `authenticated`/`anon` sessions. |
| D2 | **High** | **Merchants could set their own `plan` / `monthly_generation_quota`** through the API. This is a billing and quota bypass. | Integration F2 | `0002`: column-level grants. Plan, quota and billing status are server-only. |
| D3 | Medium | **Shoppers could extend their photo retention** (`expires_at`, including by backdating `created_at`). This is a retention-policy bypass. | Integration F3 | `0002`: photo rows are immutable to users, `created_at` is not insertable, and a CHECK caps retention at 366 days. |
| D4 | Medium | **Shoppers could read internal cost data and raw provider error messages** (`generations.cost_usd`, `error_message`, `generation_stats_daily`). | Integration F1 | `0002`: column grants. Reporting views filter on `is_admin()`. The admin page reads logs with the service role after an admin check. |
| D5 | **High** | **Every form POST could be rejected as cross-site** behind a proxy or custom domain. `sameOrigin` compared `Origin` with `req.url`, which differs from the browser-visible host under `next start` and proxies. | E2E (merchant onboarding returned 403) | `lib/http.ts` now compares against `Host` / `X-Forwarded-Host` / the site URL. Unit tests added. |
| D6 | Low | Shopify product re-import would have re-paused products the merchant had set live, and the upsert target was a partial index PostgREST can't use. | Code review while writing integration tests | Full unique constraint; re-imports update catalog fields only. |

---

## Item-by-item status

### 1. Real FASHN integration & live end-to-end generation

| | |
|---|---|
| **Works** | `FashnProvider` implements FASHN's documented async API: `POST /v1/run` with `model_name` + `inputs.model_image/garment_image`, then poll `GET /v1/status/:id`. Request shape re-checked against FASHN's docs index this session. Timeout, moderation, 429 and 5xx mapping are unit-tested. The full TrendSet pipeline works E2E against a **contract stub**: consented upload → private storage → server-side provider call → result in a private bucket → signed URL → usage-ledger row → click tracking. A live test harness exists: `npm run test:live` (`tests/live/fashn.live.test.ts`). It refuses to run if `FASHN_BASE_URL` is overridden and writes metadata-only evidence (no key, no images). |
| **Incomplete** | No live generation has ever run. Output quality, latency, failure rate and real cost are **unknown**. FASHN rate limits (a third-party directory reports 50 `/run` per 60s and 6 concurrent) and output retention (reported 72h CDN) are unverified against FASHN's own docs. |
| **Needs credentials** | `FASHN_API_KEY` (smallest purchase $7.50 on-demand), plus 2 test images: one of a **consenting adult**, one garment you have rights to. |
| **Verified LIVE** | ❌ Nothing. |

### 2. Live Supabase migration & cross-tenant security testing

| | |
|---|---|
| **Works** | All 7 migrations apply cleanly, in order, inside transactions, on the official Supabase Postgres image *after* Auth and Storage ran their own migrations (`scripts/local-stack.sh up`). **37 integration tests** go through the real Auth, PostgREST and Storage APIs with real user JWTs. They cover shopper↔shopper, merchant↔merchant and merchant/admin↔shopper-photo isolation, storage object isolation (download, signed URL, list, overwrite, delete), server-only writes, column-level restrictions, role escalation, deletion cascades, experiments, ledger append-only, pilot limits and Shopify table lockout. |
| **Incomplete** | Not yet applied to a **hosted** Supabase project. Hosted-only behaviour is untested: email delivery, auth rate limits, Supavisor pooling, platform default grants on a fresh project, storage CDN. |
| **Needs credentials** | A Supabase project (Pro recommended for daily backups and to avoid pausing, ~$25/mo, verify) plus its URL, anon key and service-role key. |
| **Verified LIVE** | ❌ Hosted Supabase not touched. ✅ LOCAL STACK: 37/37. |

### 3. Secure staging deployment & environment validation

| | |
|---|---|
| **Works** | `npm run check:env` validates configuration. It prints names only, never values. It catches: a service-role key in the public anon variable, secrets in `NEXT_PUBLIC_*`, non-https URLs, weak `CRON_SECRET`, missing provider keys, partial Shopify config, `BILLING_MODE=live`, live Stripe keys, and FASHN base-URL overrides outside development. **Private-by-default access gate:** staging and production require HTTP Basic auth and send `noindex`, unless `SITE_ACCESS_MODE=public` **and** `PUBLIC_LAUNCH_APPROVED=true`. Verified on a real `next start` server: 401 without auth, 200 with it, `X-Robots-Tag: noindex`, `robots.txt Disallow: /`. Storefront-facing `/api/experiments/*`, Shopify webhooks, cron and health bypass the gate. They authenticate themselves or are public by design. `/api/health` returns `{ok}` publicly and a full report (DB, buckets, photo-bucket privacy) with `Bearer CRON_SECRET`. Verified on the local stack. |
| **Incomplete** | No staging deployment exists. No Sentry or alerting. No CSP header yet. A CI workflow was added but hasn't been observed running on GitHub. |
| **Needs credentials** | A Vercel project (or other host), the Supabase project from item 2, a staging domain. |
| **Verified LIVE** | ❌ No deployment made. |

### 4. Removal of simulated metrics & unsupported claims

| | |
|---|---|
| **Works** | Removed or rewritten in the shipped app: an unmeasured latency claim ("usually takes 10–30 seconds"); the "click-throughs" promise (it is now actually tracked rather than dropped); "controlled test design" (reworded to what exists); and two operational promises ("reply to every application", "within a week"). An **automated claims guard** (`tests/claims.test.ts`) fails CI if user-facing source contains percentages, multipliers, latency claims, testimonials, guarantees or outcome claims. A self-test proves it catches the legacy prototype's claims. The E2E test also checks the rendered landing page. Studio labels engagement counts as "not evidence of sales impact". |
| **Incomplete** | The **legacy prototype zip** (`Understanding Uploaded File Content.zip`) still contains fabricated stats, testimonials and a simulated generator. It was **preserved unchanged** as instructed, is not part of the app, and is documented in `docs/06`. Deleting or quarantining it is your call. |
| **Needs credentials** | None. |
| **Verified** | ✅ UNIT + E2E (rendered HTML). |

### 5. Shopify development-store integration

| | |
|---|---|
| **Works (code + unit tests)** | OAuth install and callback: HMAC verification, a one-time `state` with 10-minute TTL bound to the signed-in merchant, token exchange, and **AES-256-GCM token encryption at rest**. Webhooks: HMAC over the **raw** body (401 on mismatch), idempotency by `X-Shopify-Webhook-Id`, `app/uninstalled`, `orders/create` → experiment purchase attribution (same-tenant check), and the mandatory `customers/data_request`, `customers/redact` and `shop/redact`. Product import via Admin GraphQL creates products **paused** for quality review and skips unsupported categories. Deep link `/try-on?shop=…&shopify_product=…`. Theme app extension and widget **template**. Shopify tables are locked to the service role (integration-tested). The signed `orders/create` webhook path is exercised E2E with a locally generated HMAC. |
| **Incomplete** | Never run against Shopify. The theme extension has never been built with Shopify CLI. Embedded-app session tokens / App Bridge aren't implemented (the app is non-embedded). Shopify Billing API isn't implemented. App Store review requirements haven't been checked. |
| **Needs credentials** | Shopify Partner account (free), development store (free), app client ID and secret, Shopify CLI login. |
| **Verified LIVE** | ❌ Nothing. ✅ UNIT (13 tests) + E2E for the webhook attribution path. |

### 6. Instrumentation for randomized merchant experiments

| | |
|---|---|
| **Works** | `experiments`, `experiment_assignments` and `experiment_events` (migration 0003). **Deterministic visitor-level assignment** (SHA-256 of salt and visitor ID) with an even split verified over 20k simulated visitors. First exposure is logged once (intent-to-treat). Events must reference an existing assignment (FK). The arm comes from the server, never the client. **Purchases are accepted only from signed Shopify webhooks**, never the browser, and are deduplicated per order. Endpoints are CORS-restricted to the merchant's domains (E2E: foreign origin → 403). Status transitions are server-controlled and a stopped experiment can't restart. The readout gives a per-arm rate difference, 90% CI, sample-ratio-mismatch check (blocks verdicts), an "insufficient data" floor (1,000 visitors and 30 conversions per arm) and progress against plan. The sample-size helper reproduces the pilot plan's figure. |
| **Incomplete** | No real traffic yet. The browser widget is an unverified template. Add-to-cart capture depends on theme markup. No bot filtering. CIs use a normal approximation. No sequential or variance-reduction methods. Pooled cross-merchant analysis isn't implemented. |
| **Needs credentials** | Shopify dev store (to verify widget events and order attribution end to end). |
| **Verified** | ✅ UNIT (11) + LOCAL STACK (summary SQL, dedupe, isolation) + E2E (assign → event → signed order webhook). ❌ LIVE. |

### 7. Usage-based billing architecture & corrected unit economics

| | |
|---|---|
| **Works** | A `plans` catalog with **test prices flagged `is_test_price`**. An append-only `usage_events` ledger: one row per successful generation, unique per generation, immutable except `reported_to_billing_at`. **Per-merchant monthly quotas enforced before any provider spend** (hard cap for the pilot; overage allowed on paid tiers). `merchant_usage_summary()` gives the estimated invoice. Merchants can't alter plan, quota or billing status. `BILLING_MODE` is limited to `disabled` / `shadow`. `live` is rejected by both `check:env` and the code, and **no payment provider code exists**. The corrected margin model is in code (`lib/billing.ts`) with tests. |
| **Incomplete (by design: stop before live billing)** | No Stripe or Shopify Billing integration. No invoices, dunning, tax or refunds. |
| **Needs credentials** | Stripe test-mode keys (for a shadow-to-test-mode dry run), or Shopify Partner credentials for the Billing API. |
| **Verified** | ✅ UNIT + LOCAL STACK + E2E (quota blocks before the provider call; ledger row written). ❌ LIVE (intentionally). |

**Corrected unit economics:** see [`13-billing-architecture.md`](13-billing-architecture.md). The main changes from the earlier model:
- adds Stripe Billing's ~0.7% (third-party sourced, verify)
- adds Shopify's 15% revenue share above $1M lifetime (0% below; Shopify changelog)
- **Pro at full use with on-demand FASHN pricing is 39% gross margin, below the 60% gate.** Its $0.12 overage is too low.

### 8. Pilot onboarding & measurable merchant feedback

| | |
|---|---|
| **Works** | `pilot_enrollments`: status, dates, product limit, offered post-pilot price, agreement and DPA timestamps, and internal notes hidden from merchants by column grants. The **pilot product limit is enforced by the database**. `merchant_feedback`: a weekly structured form (0–10 likelihood to recommend, value 1–5, quality 1–5, would-pay yes/maybe/no, a named price, top issue), one per week. Studio shows an onboarding checklist and the feedback form. The admin **pilot scorecard** maps directly to go/no-go gates G3/G6/G7/G9. Admin enrollment goes through `POST /api/admin/pilots`. |
| **Incomplete** | No admin UI form (API only). No email reminders. The pilot agreement and DPA documents themselves need counsel. |
| **Needs credentials** | Hosted Supabase (item 2) and SMTP for magic links. |
| **Verified** | ✅ LOCAL STACK (limits, privacy, one-per-week, scorecard). ❌ LIVE. |

---

## Prioritized execution backlog

Costs are **estimates**: AI cost uses FASHN's $0.075 on-demand list price; platform prices should be verified.

| P | Task | Acceptance criteria | Est. cost | Depends on | Evidence required | Status |
|---|---|---|---|---|---|---|
| **P0-1** | Create hosted Supabase **staging** project and apply migrations 0001–0007 | `supabase db push` succeeds. `npm run test:integration` passes against **staging** (37/37), with output saved to `docs/evidence/` labeled LIVE. | ~$25/mo (Pro, verify) or $0 (free tier, pauses) | Supabase account | Integration log against `*.supabase.co` | Needs credentials |
| **P0-2** | **Live FASHN smoke test** | `npm run test:live` passes with a real key. Output image passes validation and a human rubric. Evidence JSON committed (no image, no key). | ~$7.50 minimum credit purchase | FASHN key; consented photo | `docs/evidence/fashn-live-*.json` | Harness ready; needs credentials |
| **P0-3** | Deploy **private staging** (Vercel, root `app/`) | `check:env` passes with `APP_ENV=staging`. Gate returns 401 without auth. `/api/health` with secret returns all checks true. Cron purge returns 200 with the secret. | ~$20/mo Vercel Pro (verify), domain ~$15/yr | P0-1 | curl transcript in evidence | Needs credentials |
| **P0-4** | Live E2E on staging with **real FASHN** | `npm run test:e2e` against staging with `FASHN_BASE_URL` unset. The generation test passes with `provider_job_id` not `stub-*`. | ~$1 | P0-2, P0-3 | E2E log labeled LIVE | Needs credentials |
| **P0-5** | Custom SMTP for magic links | Sign-in email arrives within 1 minute on 3 providers (Gmail, Outlook, iCloud). | $0–$20/mo | P0-1 | Screenshot/log | Needs credentials |
| P1-1 | 100-pair provider benchmark (FASHN v1.6, FASHN Max, Vertex) | Rubric scored by 2 raters. G4 (≥85% usable) and G5 (median <15s) computed from `generation_stats_daily`. | FASHN ~$7.50 (v1.6) + ~$22.50 (Max at 3 credits); Vertex ~$6 | P0-2; consented models | Benchmark report | Not started |
| P1-2 | Shopify dev store: install, import, theme block, signed webhooks | OAuth completes. Token stored encrypted. Import creates paused products. Block renders on the PDP. A real `orders/create` attributes a purchase to the experiment. `app/uninstalled` and the 3 compliance webhooks return 200 (401 on bad HMAC). | $0 (Partner + dev store) | P0-3 | Dev-store transcript | Code ready; needs credentials |
| P1-3 | Sentry + cost alert at 80% of daily budget | A test error appears in Sentry. An alert fires at a synthetic 80% spend. | $0 (free tier) | P0-3 | Screenshot | Not started |
| P1-4 | Legal: privacy policy, pilot agreement, DPA template, BIPA/GDPR review | Counsel sign-off. Consent version bumped if the text changes. | ~$3–8k (estimate) | — | Signed docs | Not started |
| P1-5 | Atomic quota/rate-limit RPC (fix check-then-insert race) | 20 concurrent requests at quota-1 produce exactly 1 success (integration test). | $0 | — | Integration test | Not started |
| P1-6 | Admin UI for pilot enrollment and merchant suspension | Admin can enroll, suspend and record conversion without the API. Merchant can't (integration test). | $0 | — | Integration + E2E | API only today |
| P2-1 | Stripe **test-mode** shadow billing | Ledger rows reported to a Stripe test meter. Invoice preview matches `merchant_usage_summary` to the cent. **No live keys** (check:env enforces this). | $0 (test mode) | P0-3 | Test-mode invoice preview | Stop before live |
| P2-2 | CSP with nonces; dependency audit in CI | No CSP violations on all pages. `npm audit --omit=dev` shows no high or critical issues. | $0 | — | CI log | Not started |
| P2-3 | Experiment readout: pooled analysis across merchants, bot filtering | Unit tests with simulated data. Documented method. | $0 | P1-2 traffic | Unit tests | Not started |
| **GATE** | **Live billing** | Requires: G3/G9 met, counsel-approved terms, a reviewed release that removes the `live` guard. | — | P2-1 | — | 🛑 Stopped here, as instructed |
| **GATE** | **Public launch** | Requires: P0–P1 complete, the legal review, and an explicit `PUBLIC_LAUNCH_APPROVED=true`. | — | All above | — | 🛑 Stopped here, as instructed |

## What I'd do with the first credentials

1. FASHN key + 2 consented images → `npm run test:live` (10 minutes, under $10).
2. Supabase project → `supabase db push` → `npm run test:integration` against it.
3. Vercel → private staging → `npm run test:e2e` against staging with real FASHN.

Each step writes LIVE-labeled evidence into `docs/evidence/`.

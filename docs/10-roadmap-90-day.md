# Next 90 Days: Roadmap & Implementation Backlog

Principle: **evidence before features.** Each block ends at a decision point tied to the gates in [`09-merchant-pilot-plan.md`](09-merchant-pilot-plan.md).

## Days 1–30: validate & benchmark

| Week | Product/engineering | Commercial |
|---|---|---|
| 1 | Create the Supabase project and Vercel deploy (staging). Apply the migration. Two-user RLS test. Custom SMTP. | Launch the landing page; $300–500 targeted traffic; StoreLeads export; competitor app teardown |
| 2 | **Live provider smoke test** (FASHN, Vertex). Fix any adapter mismatch. Add p95 latency to the stats view. | 10 merchant + 15 shopper interviews |
| 3 | 100-pair benchmark per provider, scored with the rubric. Pick the primary provider. Per-category routing config. | Synthesis; pilot shortlist |
| 4 | Hardening: Sentry, product edit/deactivate, admin merchant suspend, atomic rate-limit RPC | **Decision memo on G1–G5** |

## Days 31–60: pilot launch

| Work | Detail |
|---|---|
| Embeddable "See it on you" entry point | A hosted try-on deep link per product (`/try-on?product=…`), then an iframe widget |
| Shopify theme app extension (v0) | PDP app block that opens the TrendSet widget; product import via Admin API |
| Pilot ops | Weekly merchant report (email from the SQL views); 48h fix SLA |
| Privacy | DPA with the provider; counsel-reviewed privacy page; BIPA/GDPR check |
| Commercial | 3–5 pilots live; weekly check-ins |

## Days 61–90: measure & monetize

| Work | Detail |
|---|---|
| Randomized holdout | Visitor-hash assignment in the widget; exposure logging; `orders/create` webhook attribution |
| Billing | Stripe (or Shopify Billing) with recommended test tiers + overage; quotas enforced from `merchants.monthly_generation_quota` |
| Merchant dashboard v1 | Try-ons per 1k PDP views, completion, ratings, click-through, experiment readout with CIs |
| Commercial | Pilot exit interviews; paid conversion; **go/no-go memo on G6–G10** |

## Explicitly NOT in the next 90 days

Consumer marketplace or checkout · native iOS/Android · live AR · footwear/eyewear engines · size or fit prediction · enterprise SSO/SLA · multi-garment outfits · training custom models.

---

## Implementation backlog (prioritized)

| # | Item | Size | Priority | Depends on |
|---|---|---|---|---|
| 1 | Live provider smoke test + adapter fixes | S | P0 | API keys |
| 2 | Two-user RLS verification (pgTAP or scripted) | S | P0 | Supabase project |
| 3 | Sentry + structured error alerts; cost alert when daily spend > 80% of budget | S | P0 | — |
| 4 | Atomic rate-limit + budget check (SQL function with `FOR UPDATE` / advisory lock) | S | P1 | — |
| 5 | p95 latency in `generation_stats_daily` | XS | P1 | — |
| 6 | Product edit / deactivate / delete (removes garment image) | S | P1 | — |
| 7 | Admin: suspend merchant, role management UI | S | P1 | — |
| 8 | Per-category provider routing (`TRYON_PROVIDER_TOPS=…`) and automatic failover on `provider_error` | M | P1 | #1 |
| 9 | Deep link `/try-on?product=` + iframe widget with postMessage resize | M | P1 | — |
| 10 | Shopify theme app extension + product import | L | P1 | #9 |
| 11 | Visitor-level holdout + exposure events + order webhook attribution | L | P1 | #10 |
| 12 | Stripe/Shopify billing; quota enforcement per merchant | M | P1 | — |
| 13 | Weekly merchant report email | S | P2 | — |
| 14 | Async job queue (pgmq/Inngest) + client polling for p95 > 30s | M | P2 | #1 data |
| 15 | Image pre-processing (EXIF strip, resize to provider-optimal size) | S | P2 | — |
| 16 | CSP with nonces | S | P2 | — |
| 17 | Playwright E2E on staging | M | P2 | Staging |
| 18 | Quality evaluation table + internal rating UI (from the legacy schema idea) | M | P2 | #1 |
| 19 | WooCommerce plugin | L | P3 | #9 |
| 20 | Public REST API + API keys + JS SDK | L | P3 | Evidence |

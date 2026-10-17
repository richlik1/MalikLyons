# TrendSet

AI virtual try-on for independent fashion brands. Shoppers preview garments on themselves, and merchants find out whether it actually helps them sell.

> **Status (12 Oct 2026, after the production-readiness audit):**
> - Tests: 124 unit · 41 integration on a **local** Supabase stack · 24 end-to-end with a **stubbed** AI provider · **0 live tests**.
> - New: public **REST API v1** (secret keys) and a **2-line website widget** (publishable keys). See [docs/16-api-and-pricing.md](docs/16-api-and-pricing.md).
> - No credentials for FASHN, hosted Supabase, Shopify or Stripe have been available, so **no real try-on image has ever been generated** and nothing has been deployed.
> - Billing is disabled by design and staging is private by default.
> - Demand is **not validated**.
>
> Start with [docs/14-production-readiness-audit.md](docs/14-production-readiness-audit.md).

## Repository layout

| Path | What |
|---|---|
| `app/` | Next.js 15 + Tailwind + Supabase MVP (try-on slice, merchant studio, admin, waitlist) |
| `app/supabase/migrations/` | Postgres schema, RLS, storage buckets |
| `app/tests/` | Vitest unit and contract tests |
| `docs/` | Research, PRD, architecture, financials, pilot plan, roadmap |
| `Understanding Uploaded File Content.zip` | Earlier prototype. Kept unchanged; reviewed in `docs/06`. |

## Deliverables

| # | Deliverable | File |
|---|---|---|
| 1 | Research report (market, competitors, ICP, risks, recommendation) | [docs/01-research-report.md](docs/01-research-report.md) · [competitor spreadsheet](docs/data/competitors.csv) |
| 2 | Product requirements document | [docs/02-prd.md](docs/02-prd.md) |
| 3 | Database schema | [docs/03-database-schema.md](docs/03-database-schema.md) · [SQL](app/supabase/migrations/0001_init.sql) |
| 4 | Technical architecture (MVP + enterprise target) | [docs/04-technical-architecture.md](docs/04-technical-architecture.md) |
| 5 | UI design system | [docs/05-design-system.md](docs/05-design-system.md) |
| 6 | Working MVP | [app/](app/) |
| 7 | Deployment instructions | [docs/07-deployment.md](docs/07-deployment.md) |
| 8 | Testing report | [docs/08-testing-report.md](docs/08-testing-report.md) |
| 9 | Merchant pilot plan, interview scripts, go/no-go thresholds | [docs/09-merchant-pilot-plan.md](docs/09-merchant-pilot-plan.md) |
| 10 | 90-day roadmap + implementation backlog | [docs/10-roadmap-90-day.md](docs/10-roadmap-90-day.md) |
| — | Financial model | [docs/11-financial-model.md](docs/11-financial-model.md) · [CSV](docs/data/financial-model.csv) |
| — | Review of the earlier prototype | [docs/06-legacy-prototype-review.md](docs/06-legacy-prototype-review.md) |
| — | **Production-readiness audit + prioritized backlog** | [docs/14-production-readiness-audit.md](docs/14-production-readiness-audit.md) · [test evidence](docs/evidence/) |
| — | Randomized experiments | [docs/12-experiments.md](docs/12-experiments.md) |
| — | Billing architecture + corrected unit economics | [docs/13-billing-architecture.md](docs/13-billing-architecture.md) |
| — | Pilot onboarding & merchant feedback | [docs/15-pilot-onboarding.md](docs/15-pilot-onboarding.md) |
| — | Shopify app scaffold (unverified) | [app/shopify/](app/shopify/) |
| — | **Public API, widget, status & pricing** | [docs/16-api-and-pricing.md](docs/16-api-and-pricing.md) · `/developers` · `/api/v1/openapi.json` |

## Quick start

```bash
cd app
cp .env.example .env.local    # Supabase + provider keys (server-only keys never get NEXT_PUBLIC_)
npm install
npm test && npm run typecheck   # unit
npm run check:env                # configuration check (names only, never values)
npm run dev
```

Integration and E2E tests run against a local Supabase-compatible stack. See [docs/07-deployment.md §7](docs/07-deployment.md).

Then follow [docs/07-deployment.md](docs/07-deployment.md) to set up Supabase and the AI provider.

## Ground rules baked into the code

- AI calls run **server-side only**, behind a provider abstraction (FASHN, Google Vertex).
- **No simulated AI.** With no provider configured, the UI says try-on is unavailable.
- Every result carries an "AI-generated, not a fit or size prediction" notice.
- Shopper photos need explicit, versioned consent. They are private, auto-deleted after 30 days, deletable in one click, and invisible to admins and merchants.
- No fabricated metrics or testimonials anywhere.

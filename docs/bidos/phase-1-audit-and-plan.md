# Lyons BidOS — Phase 1 audit and plan

Date: 2026-10-28. No code has been written yet. This document is the "first response" the Phase 1 brief asks for before any implementation.

Repositories read (read-only, nothing pushed to them):

| Repo | Commit | What it is |
|---|---|---|
| `richlik1/keen-prospect-ai` | `6aa6210` (2026-08-22) | Lyons AI Prospector. TanStack Start + React 19, Supabase project `psiqupvlywfbigtnqscc`, Lovable-synced |
| `richlik1/stay-pro-ops` | `a276564` (2026-10-22) | StayOps. Same stack, **separate** Supabase project `txcydgsadcfzcwcbcqmp`, Lovable-synced |
| `richlik1/MalikLyons` | `6513def` | Only a zip containing an unrelated MySQL "virtual try-on" app. Not part of BidOS |
| `paytriot45/Xcape-Key` | `3201344` | Unrelated iOS Xcode projects (FakeCallPro). Not part of BidOS |

What I could not verify: the live database state of either Supabase project, which migrations are applied, the production deployment, and any secrets. I only read the code in the repos.

---

## 1. Verified repository audit

### Prospector (`keen-prospect-ai`)

**Baseline checks I ran:**

- `tsc --noEmit`: passes.
- `vite build`: passes.
- `eslint .`: 1,620 problems. About 1,606 of them are Prettier formatting; the rest are 3 `no-explicit-any`, 4 regex lint errors and 7 warnings. This is the existing state before any BidOS work.
- **Tests: none.** There is no test runner, no test files and no CI workflow. "Existing features must keep passing their tests" has nothing to check against today.

**Database:** 10 migrations.

- Tables: `leads`, `lead_signals`, `outreach`, `follow_ups`, `activity_log` (append-only, with UPDATE and DELETE revoked), `discovery_runs`, `app_settings`, `company_profile` (singleton), `proposals`, `proposal_media`, `proposal_projects`, `proposal_testimonials`, `proposal_attachments`, `proposal_events`, `proposal_comments`, `media_assets`, `portfolio_projects`, `testimonials`, `company_documents` and `user_roles`.
- Roles: `app_role` enum with the values `owner` and `member`.
- Helpers: `is_member()` and `has_role()`, both SECURITY DEFINER.
- **There is no tenant column anywhere.** The app is single-workspace by design.
- `leads` is the customer record. It mixes the company and a single address. There is no separate property entity.
- `proposals.status` has 15 enum values. Pricing lives in `proposals.pricing` (jsonb), and the AI writes it (`src/lib/proposal.server.ts`) against a target monthly value. No cost model sits behind those prices.

**Authentication: effectively off.**

- Every `*.functions.ts` server function imports `requireSupabaseAuth` from `src/lib/demo-auth.ts`. That middleware does no authentication. It hands every caller the **service-role client** and a hard-coded demo user.
- There is no login page.
- `GET /api/proposals/$id/pdf` is unauthenticated and uses the service role.
- So RLS does not protect anything today: every server-side read and write bypasses it. The README says the same ("switch to real Supabase Auth before production expansion").

**RLS findings (from the migrations; not checked against the live database):**

1. **High: the anon policies on `proposals` leak data.** `"anon read shared proposal"` is `USING (share_enabled AND share_token IS NOT NULL)`, and `share_enabled` defaults to `true`.
   - Anyone who has the publishable key, which ships in the browser bundle and is in the committed `.env`, can run `select * from proposals` and get every proposal: client names, emails, pricing and signature data. They don't need a token.
   - `"anon sign shared proposal"` grants anon an UPDATE on *any column* of those rows.
   - The portal (`src/lib/portal.functions.ts`) already goes through server functions keyed on the token using the service role. `src/routes/p.$token.tsx` does not query Supabase directly. So these anon policies look unnecessary, but that needs confirming against the live app before anything is dropped.
2. **Medium:** migration `20260630173021` revokes EXECUTE on `is_member()` and `has_role()` from `authenticated`. Every member RLS policy calls those functions, so once real auth is turned on, member queries are likely to fail with "permission denied for function". It is hidden today only because everything runs as the service role.
3. Low: `.env` (publishable key and project id) is committed. A publishable key is public by design, so this is not a leaked secret, but it makes finding 1 trivially exploitable.

**Integrations:**

- Lovable AI Gateway (required).
- Google Places, Apollo and Gmail are optional.
- OSM, Overpass and Nominatim are free.
- Cron routes check `x-cron-secret`.
- `AGENTS.md` warns that commits to the connected branch sync into Lovable: never rewrite pushed history.

### StayOps (`stay-pro-ops`)

- Much more mature: 128 migrations, 47 tables with RLS on every table, `vitest` and 435 tests (per its own audit), and a CI workflow that builds a throwaway Postgres from every migration and runs a 52-check security suite (`scripts/qa-turnover.sh`, `scripts/qa-security.sql`).
- Tenancy is `host_id`, which is an `auth.users` id in the StayOps project. Roles are `admin`, `host` and `cleaner`.
- It has its own `clients` (`host_id`, name, company, email, phone, status) and `properties` (55 columns, unique `slug`) tables. Neither has any external or source reference column.
- `docs/financial-contract.md` and `src/lib/finance.ts` define revenue → direct costs → gross profit → overhead → net operating profit, and forbid calling revenue "profit". BidOS should use the same vocabulary so that bid-vs-actual comparisons line up.
- Its own audit (2026-09-20) lists 6 repo migrations not applied to the live database. That may be out of date; I did not check it.

**Implication:** Prospector and StayOps are **two separate Supabase databases with separate user tables**. "Shared identifiers" therefore have to be explicit reference columns plus an idempotent handoff. A foreign key or a shared login is not possible.

---

## 2. Existing functionality to reuse

| Need | Reuse from Prospector |
|---|---|
| Opportunity source | `leads` (BidOS opportunity → `lead_id` FK); manual create reuses lead dedupe logic in `crm.server.ts` / discovery |
| Pipeline stage | `pipeline_stage` already has `walkthrough_scheduled`, `proposal_generated`, `proposal_sent`, `won` |
| Branding / company data | `company_profile` (logo, colors, terms, insurance, payment terms) |
| PDF | `pdf-lib` + `src/lib/pdf/doc.server.ts` layout helpers + `proposal-pdf.server.ts` |
| Client deal room, e-signature, open tracking | `proposals` share token + `portal.functions.ts` + `p.$token.tsx` |
| Photos / documents | `media_assets`, `company_documents`, `proposal_attachments` |
| Audit pattern | `activity_log` append-only pattern (revoked UPDATE/DELETE) |
| UI | shadcn/ui components, `page-header`, `stat-card`, `workflow-rail`, react-hook-form + zod |
| Real auth middleware | `src/integrations/supabase/auth-middleware.ts` (generated, currently unused) |

From StayOps (patterns, not code sharing): `finance.ts` vocabulary, the throwaway-Postgres SQL test harness, and the `vitest` setup.

---

## 3. Architecture recommendation

**Build BidOS as a module inside `keen-prospect-ai`, under a `bid_` table prefix. Do not build a separate app. Integrate with StayOps through a signed, idempotent handoff.**

Why:

- An opportunity *is* a lead plus a property. Living in the same database means a real foreign key to `leads.id`, with no duplicated customer records and no sync.
- The things Phase 3 needs (PDF, e-signature, deal room, branding, media) already exist there.
- A separate app would mean a third Supabase project, a third auth system and a lead-sync integration before any estimating work could start.

Tradeoffs and mitigations:

- **The repo grows and it is Lovable-synced.** All BidOS code lives in `src/lib/bidos/` and `src/routes/_authenticated/bids*`, with `bid_*` tables. Changes go through PRs on branches, never straight to the connected branch.
- **The Prospector has no auth.** BidOS holds wage rates and margins, which are more sensitive than lead data. **BidOS server functions must use the real `requireSupabaseAuth` from day one, not `demo-auth`.** That means adding a login page, which is a prerequisite PR. Existing pages keep `demo-auth` until you decide to switch them.
- **StayOps stays separate.** BidOS never writes into StayOps' database.

### Integration contracts

**Prospector → BidOS (same DB):**

- `bid_opportunities.lead_id uuid NOT NULL REFERENCES leads(id)`.
- Creating an opportunity never inserts a lead silently. "Manual create" first runs the existing lead dedupe (place id, normalized name + address, phone, email). The user either picks the existing lead or explicitly creates a new one.

**BidOS → StayOps (cross-project), outbox pattern:**

1. When a proposal moves to `accepted`, a trigger writes a `bid_integration_events` row:
   - `event_type = 'proposal.accepted'`
   - `idempotency_key = proposal_id || ':' || version`
   - payload: `customer_ref`, `property_ref`, the accepted price, cadence, scope and the budget lines
   - `status = 'pending'`
2. **Nothing is sent automatically in Phase 1.** An owner clicks "Send to StayOps" (Phase 4). A server function POSTs the event to a new StayOps webhook (`/api/public/hooks/bidos`), signed with HMAC-SHA256 using a shared `BIDOS_WEBHOOK_SECRET` and carrying a timestamp to block replays.
3. StayOps stores the reference on its side (new nullable columns `clients.source_system` / `source_customer_ref`, plus `properties.source_property_ref`, each with a unique partial index), then:
   - If a client with that `source_customer_ref` exists, it reuses it.
   - Otherwise it puts the event into a **review queue** with candidate matches (by email or phone or name). An owner confirms "link to existing" or "create new".
   - It never auto-merges and never auto-creates jobs. It creates **no** turnover jobs: the event only provisions the client and property and stores the approved budget. Job creation stays in StayOps' existing workflows.
4. StayOps → BidOS (Phase 5, profit intelligence) works the same way in reverse: StayOps exposes read-only actuals per `source_property_ref`, computed by its own `finance.ts`. BidOS never computes "actual" numbers itself.

### Shared identifiers

| Identifier | Minted by | Meaning |
|---|---|---|
| `customer_ref` | = `leads.id` (Prospector) | The customer/account across all systems |
| `property_ref` | `bid_properties.id` (BidOS) | A service location; one lead can have many |
| `opportunity_id`, `proposal_id` | BidOS | Bid lifecycle only |
| StayOps `clients.id` / `properties.id` | StayOps | Stay internal; StayOps stores the refs above, BidOS stores StayOps ids it receives back in an ack event |

I'm adding one small table that the brief did not list, `bid_properties` (lead_id, address, type, sqft, units, floors, access notes). Without it, a property id is not really "established": `leads` holds only a single address, and make-ready or janitorial bids often cover several buildings.

### Roles

- I recommend leaving the existing `app_role` (`owner`/`member`) alone so current behaviour doesn't change.
- Add `bid_role` enum with the values `owner`, `estimator`, `sales` and `operations`, held in `bid_org_members(org_id, user_id, role)`.

| Action | owner | estimator | sales | operations |
|---|---|---|---|---|
| View opportunities, walkthroughs | ✓ | ✓ | ✓ | ✓ |
| Create/edit opportunity, walkthrough | ✓ | ✓ | ✓ | – |
| Edit cost inputs, line items, create estimate versions | ✓ | ✓ | – | – |
| See wage rates / cost breakdown / margin | ✓ | ✓ | – (sees price only) | ✓ (read) |
| Change target margin below company floor | ✓ | – | – | – |
| Send proposal | ✓ | ✓ | ✓ | – |
| Mark accepted (authorized acceptance) | ✓ | – | ✓ (client-signed only) | – |
| Release accepted job to StayOps | ✓ | – | – | ✓ |
| Manage templates, members, cost categories | ✓ | – | – | – |

"Sales sees price only" is enforced by keeping cost detail in tables that sales has no SELECT policy on. The UI does not decide it.

---

## 4. Database migration plan

All new tables go in `keen-prospect-ai/supabase/migrations/`. Each one is additive: no existing table, enum or policy is altered in the BidOS migrations. The security fixes for the existing `proposals` policies are a **separate PR that needs your approval**.

### Migration A: `bidos_tenancy_and_roles`

- `bid_organizations(id, name, default_target_margin numeric(5,4) default 0.35, min_target_margin, default_payroll_burden_pct, default_overhead_pct, default_contingency_pct, currency default 'USD')`.
- One seed row for Lyons Cleaning Solutions LLC.
- `bid_role` enum and `bid_org_members(org_id, user_id → auth.users, role, unique(org_id, user_id, role))`.
- Helpers, all SECURITY DEFINER with `search_path = public`:
  - `bid_is_member(org uuid)`
  - `bid_has_role(org uuid, roles bid_role[])`
  - EXECUTE granted to `authenticated` only. This avoids repeating the existing `is_member` revoke problem.

### Migration B: `bidos_core_tables`

Every table carries `org_id uuid NOT NULL REFERENCES bid_organizations`, `created_by`, `created_at` and `updated_at`. Money is stored as `bigint` cents and rates as `numeric`.

| Table | Key columns / rules |
|---|---|
| `bid_properties` | lead_id FK, address fields, property_type, sqft, unit_count, floors |
| `bid_opportunities` | lead_id FK NOT NULL, property_id FK, service_type enum (`airbnb_turnover`, `commercial_janitorial`, `post_construction`, `apartment_make_ready`, `specialty`), source (`prospector`, `manual`, `bid_invite`), due_at, status (`open`, `walkthrough`, `estimating`, `proposed`, `won`, `lost`, `no_bid`) |
| `bid_walkthroughs` | opportunity_id, performed_at, performed_by, measurements jsonb (validated by template schema in app), conditions, scope_notes |
| `bid_service_templates` | service_type, version, name, input_schema jsonb, default rates (production sqft/hr, laundry per load, etc.), is_active; unique(org_id, service_type, version) |
| `bid_cost_categories` | code (`labor`, `payroll_burden`, `subcontractor`, `supplies`, `equipment`, `transportation`, `overhead`, `contingency`, `owner_supplied`), is_cost boolean (`owner_supplied` = false) |
| `bid_estimates` | opportunity_id, template_id, current_version_id, status (`draft`, `final`, `superseded`) |
| `bid_estimate_versions` | estimate_id, version_no (unique per estimate), inputs jsonb, computed totals (cost_cents, price_cents, target_margin, projected_margin, markup, monthly_value_cents, annual_value_cents), engine_version, locked_at. **Immutable after insert:** a trigger rejects UPDATE/DELETE. A revision is a new row |
| `bid_line_items` | version_id, category_id, description, qty, unit, unit_cost_cents, extended_cost_cents, is_owner_supplied, subcontractor_quote_id. Immutable with its version |
| `bid_subcontractor_quotes` | opportunity_id, vendor_name, scope, amount_cents, valid_until, attachment_id, status (`requested`, `received`, `selected`, `rejected`) |
| `bid_proposals` | estimate_version_id NOT NULL (pins the price), proposal_id → existing `proposals(id)` (reuses the PDF/portal/e-sign), status (`draft`, `sent`, `accepted`, `declined`, `expired`), sent_at, accepted_at, accepted_by, acceptance_method (`client_signature`, `owner_recorded`), expires_at |
| `bid_attachments` | owner_table + owner_id, storage_path in **private** bucket `bid-attachments`, kind (photo/quote/plan), caption |
| `bid_activity_log` | append-only: entity, entity_id, from_status, to_status, actor_user, payload; UPDATE/DELETE revoked and denied by policy, the same as the existing `activity_log` |
| `bid_integration_events` | direction, event_type, idempotency_key UNIQUE, payload, status (`pending`, `sent`, `acked`, `failed`), attempts, last_error |

### Migration C: `bidos_rls`

- Every table gets RLS enabled.
- SELECT is granted via `bid_is_member(org_id)`. Writes are granted per the role matrix via `bid_has_role(org_id, ...)`.
- Cost tables (`bid_line_items`, the cost columns of versions through a view, and `bid_subcontractor_quotes`) are not readable by `sales`.
- `anon` gets no grants at all. Public proposal access keeps going through the existing token-keyed server functions.

### Migration D: `bidos_status_transitions`

- A `bid_assert_transition(entity, from, to)` table of allowed transitions, plus BEFORE UPDATE triggers on `bid_opportunities`, `bid_proposals` and `bid_estimates`.
- An illegal transition raises an error. Every legal one writes to `bid_activity_log`.

Proposal transitions:

- `draft → sent`
- `sent → accepted | declined | expired`
- `sent → draft` is **not** allowed: a revision creates a new proposal pinned to a new version.
- `accepted` requires `accepted_by` and `acceptance_method`. The pinned estimate version must be locked.
- Only the transition into `accepted` inserts the `bid_integration_events` row (status `pending`), and **nothing creates a StayOps job**.

### Migration E (later PR): `bidos_seed_templates`

Inserts the five service templates and the cost categories as data.

### Migrations do not run against production from these PRs

Each PR adds SQL files and tests only. You apply them through Lovable Cloud after approval.

---

## 5. Estimating engine (pure TypeScript, no DB)

The engine lives at `src/lib/bidos/pricing.ts`. Everything is in integer cents and is validated with zod.

```
labor            = Σ crew_hours × hourly_rate                     (W-2 staff)
payroll_burden   = labor × burden_pct                              (not applied to subs)
direct_cost      = labor + payroll_burden + subcontractors + supplies + equipment + transportation
overhead_alloc   = direct_cost × overhead_pct   (or fixed amount)
contingency      = (direct_cost + overhead_alloc) × contingency_pct
total_cost       = direct_cost + overhead_alloc + contingency      (owner-supplied materials excluded)
required_price   = total_cost / (1 − target_margin)                 0 ≤ target_margin < 1, else error
markup           = (price − total_cost) / total_cost               shown separately, labelled "markup"
projected_margin = (price − total_cost) / price                    labelled "projected margin (estimate)"
recurring:       per_visit × visits_per_month (= visits_per_week × 52/12), monthly and annual value
custom price:    projected_margin of the custom price + warning if below target or below org floor
```

The example from your calculator works out: a $650 cost at a 35% margin gives a $1,000.00 price, $350 projected profit and a 53.8% markup. That will be a test case.

**Wording rule:** the engine and UI never say "profit" or "net profit" without "projected". Actual figures only ever come from StayOps (Phase 5).

**Per-service input adapters** (Phase 2 builds these out; Phase 1 defines the types):

- **Janitorial:** labor hours = sqft ÷ production rate.
- **Airbnb:** per-turn labor + laundry + consumables + travel.
- **Make-ready:** a per-unit scope, plus `requires_sub_quote`. You can't finalize the estimate while required quotes are missing.
- **Post-construction:** phases × crew-hours + debris and glass factors.
- **Specialty:** equipment and chemical lines.

---

## 6. Exact files to create or modify (all in `keen-prospect-ai`)

**PR 1 (pricing engine):**

- Create:
  - `src/lib/bidos/pricing.ts`
  - `src/lib/bidos/pricing.test.ts`
  - `src/lib/bidos/types.ts`
  - `vitest.config.ts`
- Modify `package.json`:
  - add the dev dependency `vitest` (free, MIT)
  - add the script `"test": "vitest run"`
  - update `bun.lock` with `bun install`

**PR 2 (schema and RLS):**

- Create:
  - `supabase/migrations/<ts>_bidos_tenancy_and_roles.sql`
  - `supabase/migrations/<ts>_bidos_core_tables.sql`
  - `supabase/migrations/<ts>_bidos_rls.sql`
  - `supabase/migrations/<ts>_bidos_status_transitions.sql`
  - `scripts/bidos-db-test.sh` (initdb a throwaway Postgres 16, stub `auth.users`/`auth.uid()`, apply every migration, run the SQL tests; the same approach as StayOps' `qa-turnover.sh`)
  - `supabase/tests/bidos_rls.sql`, covering:
    - cross-org reads and writes are denied
    - `sales` cannot read cost lines
    - anon is denied
    - illegal status transitions raise errors
    - versions are immutable
    - acceptance creates exactly one pending integration event and no other side effect
  - `.github/workflows/bidos-ci.yml` (tsc, vitest, DB suite; scoped so it does not fail on the existing 1,600 Prettier issues)

**PR 3 (real auth for BidOS only):**

- Create:
  - `src/routes/login.tsx`
  - `src/lib/bidos/auth.ts` (wraps the generated `requireSupabaseAuth` and resolves `org_id` and the role)
- Modify:
  - `src/routes/_authenticated.tsx` (add a "Bids" nav item only)

**PR 4 (opportunities and walkthroughs, workflow steps 1–2):**

- Create:
  - `src/lib/bidos/opportunities.functions.ts`
  - `src/routes/_authenticated/bids.index.tsx`
  - `src/routes/_authenticated/bids.$opportunityId.tsx`
  - walkthrough form components under `src/components/bidos/`

**PR 5 (estimates and versions, workflow steps 3–6):**

- Create:
  - `src/lib/bidos/estimates.functions.ts`
  - estimate editor components
- Uses the engine from PR 1 on the server, so totals are never trusted from the client.

**PR 6 (proposal, workflow steps 7–8):**

- Create:
  - `src/lib/bidos/proposals.functions.ts`, which creates or links an existing `proposals` row, writes pricing rows from the locked version, and reuses `buildProposalPdf`
  - status tracking UI
- Modify `src/lib/pdf/proposal-pdf.server.ts` only if a cost-free "pricing from estimate" section is needed.

**Separate security PR (needs your approval; touches existing behaviour):**

- Drop the anon SELECT/UPDATE policies on `proposals` after confirming the live portal doesn't use them.
- Restore EXECUTE on `is_member`/`has_role` for `authenticated`.
- Put auth on `/api/proposals/$id/pdf`.

`src/integrations/supabase/types.ts` is generated by Lovable. I regenerate it after migrations are applied and do not hand-edit it.

---

## 7. Smallest testable Phase 1 pull request

**PR 1: the pricing engine plus a test runner, with no database, no UI and no changes to existing behaviour.**

- `computeEstimate(input)` covers labor, burden, subcontractors, supplies, equipment, transportation, overhead, contingency, owner-supplied exclusion, required price from target margin, markup and projected margin, monthly and annual value for recurring work, and custom-price margin with below-target warnings.
- Tests:
  - the $650 → $1,000 case
  - margin vs markup (35% margin ≠ 35% markup)
  - rounding to cents
  - zero cost
  - owner-supplied materials excluded from cost
  - burden not applied to subcontractors
  - visits/week → monthly/annual
  - custom price below cost reports a negative projected margin
  - invalid inputs rejected: margin ≥ 100%, a negative margin, negative costs, NaN/Infinity, a missing rate
- Done when: `vitest run` passes, `tsc` still passes, `vite build` still passes and no existing file changes except `package.json`, `bun.lock` and the added config.

The risk to the running app is zero, it is reviewable in about 15 minutes, and every later PR builds on it.

---

## 8. Risks and required configuration

**Risks:**

1. **Prospector has no real authentication** and runs as the service role everywhere. The BidOS RLS work only means something once BidOS calls run under the user's JWT (PR 3). Until the separate security PR lands, the existing CRM data stays exposed as described in §1.
2. **Anon policies on `proposals`** (see §1, finding 1). Recommend fixing before BidOS sends any proposal through the portal.
3. **Lovable sync:** commits to the connected branch appear in the Lovable editor. Work stays on feature branches and never force-pushes. Lovable may regenerate `types.ts` and `client*.ts`.
4. **Two databases:** customer matching across Prospector and StayOps can't be enforced by a foreign key. That's why the plan uses the reference columns and the human review queue.
5. **No existing tests in Prospector** means a regression in existing features is only caught by tsc and build until tests are added.
6. **StayOps unapplied migrations** (per its own 2026-09-20 audit). Phase 4 should not start until StayOps' live schema matches its repo.
7. **Lint baseline is red** (about 1,620 issues, mostly formatting). A repo-wide `eslint` gate would fail on day one. Scope CI to tsc + tests, or run a separate formatting-only PR.

**Configuration needed from you:**

- Approval to add `vitest` as a dev dependency (free).
- Supabase Auth enabled for the Prospector project (email/password or magic link; free tier), and real user accounts for each staff member, with their BidOS role.
- A private Storage bucket `bid-attachments` (created by migration or in the dashboard).
- Phase 4 only: a generated `BIDOS_WEBHOOK_SECRET` stored as a secret in **both** Lovable Cloud projects, never in source.
- Who applies migrations to the live database, and when. I will not apply them.
- Confirmation of the company margin floor (the brief says a 35% default; what is the minimum an estimator may go to without the owner?).

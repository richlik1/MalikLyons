# Randomized Merchant Experiments: Design & Instrumentation

Purpose: produce credible evidence for go/no-go gate **G10** (incremental lift), instead of comparing self-selected try-on users with everyone else.

## Design

| Element | Decision | Implementation |
|---|---|---|
| Unit | Visitor (first-party random ID in the storefront's `localStorage`) | `experiment_assignments` (PK: experiment, visitor) |
| Assignment | Deterministic `sha256(salt:visitor) mod 10000 < pct×100`. The salt is server-generated and never sent to clients. | `lib/experiments.ts#assignArm`, `/api/experiments/assign` |
| Exposure | Logged once, at first assignment (intent-to-treat) | upsert `ignoreDuplicates` |
| Treatment | The try-on button is shown. Control: no button. | Theme widget template |
| Events | `tryon_open`, `tryon_success`, `add_to_cart`, `checkout_started` from the browser. **`purchase` only from signed Shopify `orders/create` webhooks**, deduplicated per order. | `/api/experiments/events`, `/api/shopify/webhooks` |
| Integrity | The arm is read from the stored assignment, not the client. Events require an existing assignment (FK). CORS is limited to the merchant's domains. Same-tenant check on order attribution. | Routes and migration 0003 |
| Lifecycle | draft → running → stopped, server-controlled timestamps. No restarts. | `/api/merchant/experiments/[id]` |
| Primary metric | Chosen **before** start (`primary_metric`) | Column is insert-only for merchants |

## Analysis (`lib/experiments.ts#analyze`)

- Per-arm visitor-level conversion. Difference with a **90% CI** (normal approximation). Relative lift.
- **Sample-ratio mismatch** check (χ², p < 0.001). If it trips, every verdict becomes "insufficient data".
- **Minimum data floor:** at least 1,000 visitors and 30 conversions per arm, or the verdict is "insufficient data".
- Verdicts:
  - `positive`: CI excludes 0 on the positive side
  - `negative`: point estimate ≤ 0
  - `inconclusive`: otherwise
- Progress against `planned_visitors_per_arm`. Fixed horizon, so **don't stop early on a promising result.**
- `requiredVisitorsPerArm(0.06, 0.10)` = 25,740 per arm, which matches the pilot plan.

## Known limitations (be honest in merchant reports)

- Most single independent stores won't reach 25k visitors per arm in 6 weeks. Plan to **pool across pilot merchants** (stratified by merchant; not yet implemented) or report CIs without claiming significance.
- Browser events (`tryon_open`, `add_to_cart`, `checkout_started`) can be blocked by ad blockers, broken by theme changes, or **spoofed**: CORS limits browsers, not scripted clients, and experiment IDs are visible in storefront HTML. **Purchase events come only from HMAC-verified Shopify webhooks, so use purchase as the decision metric** wherever traffic allows. Treat add-to-cart as supporting evidence.
- No bot filtering yet.
- The visitor ID is per device and browser, so cross-device journeys can contaminate arms.

## Evidence

- UNIT: 11 tests (determinism, split balance, salt re-randomization, SRM, verdict rules, sample size).
- LOCAL STACK: summary SQL, order dedupe, orphan-event rejection, tenant isolation.
- E2E (stubbed provider): CORS rejection, stable assignment, browser event, rejected browser "purchase", signed webhook attribution.
- LIVE: **none**. Needs a Shopify development store.

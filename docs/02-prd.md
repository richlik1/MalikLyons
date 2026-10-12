# TrendSet — Product Requirements Document (v0.1)

**Problem.** Independent apparel brands lose online sales because shoppers can't picture a garment on themselves. Existing try-on tools rarely prove that they increase sales.

**Goal of v0.1.** Put real AI try-on in front of real shoppers for 3–5 pilot merchants, and measure completion, satisfaction, cost and conversion with a controlled design.

**Non-goals.** Size or fit prediction, a marketplace checkout, native apps, AR, footwear and eyewear.

Status key: ✅ built in this repo · 🟡 partially built · ⬜ not built

---

## Personas

| Persona | Need |
|---|---|
| **Shopper (Maya, 24, mobile)** | "Will this oversized hoodie look good on me?" Fast, private, honest. |
| **Merchant (Dre, founder of a 300-orders/month streetwear brand)** | "Does this sell more hoodies? What does it cost me? Will it embarrass my brand?" |
| **Admin (TrendSet team)** | "Is it working? What is it costing? What's failing?" |

---

## Release phases

| Phase | Scope | Exit criteria |
|---|---|---|
| **MVP (now → day 45)** | Hosted try-on, merchant product upload, admin log, waitlist | 3 pilot merchants live; quality and latency gates met |
| **Growth (day 45 → 180)** | Shopify theme extension and JS widget, A/B holdout, billing (Stripe), merchant reports, WooCommerce | 3 paying merchants; credible lift result |
| **Enterprise (after evidence)** | REST API + SDK, webhooks, SSO/SAML, audit export, SLAs, multi-store orgs, data-residency options | First enterprise LOI |

---

## MVP user stories & acceptance criteria

### Shopper

| ID | Story | Acceptance criteria | Status |
|---|---|---|---|
| S1 | As a shopper I can sign in securely | Email magic link (Supabase Auth). Protected pages redirect to `/login?next=`. Session cookie is httpOnly and refreshed by middleware. | ✅ |
| S2 | As a shopper I give informed consent before uploading | The upload button is disabled until consent is checked. The server rejects uploads without `consent=true` and the current `consentVersion`. Consent version and timestamp are stored per photo. | ✅ |
| S3 | As a shopper I upload a photo | JPEG/PNG/WebP only, detected by magic bytes. ≤8 MB. Shortest side ≥512px. Stored privately under `<user_id>/`. Clear error messages. | ✅ |
| S4 | As a shopper I browse a garment catalog | Active products with image, name, brand and price. Mobile grid with 44px+ touch targets. | ✅ |
| S5 | As a shopper I generate a try-on | Runs server-side only. Shows a "10–30 seconds" message. Errors are human-readable. Shows "unavailable" when no provider is configured, never a fake image. | ✅ |
| S6 | As a shopper I compare before and after | Side-by-side on desktop, tab toggle on mobile. The "AI-generated" label and fit disclaimer are always shown. | ✅ |
| S7 | As a shopper I can buy from the retailer | "Shop this item" opens the merchant's https URL (`noopener`). | ✅ |
| S8 | As a shopper I can save looks | Save toggle. Saved looks appear on the Account page with signed URLs. | ✅ |
| S9 | As a shopper I can rate a preview | 1–5 rating stored once per generation (upsert). | ✅ |
| S10 | As a shopper I can delete a photo | Deletes the photo and every result generated from it. Generation log rows are kept without personal data. | ✅ |
| S11 | As a shopper I can delete my account | Removes storage folders, then the auth user. Rows cascade. Signs out. | ✅ |
| S12 | Photos auto-expire | `expires_at` = upload + `PERSON_PHOTO_RETENTION_DAYS` (default 30). A daily cron purges expired photos. Expired photos can't be used. | ✅ |

### Merchant

| ID | Story | Acceptance criteria | Status |
|---|---|---|---|
| M1 | Onboarding | Create a store (name, https URL). Role becomes `merchant` via the server only. | ✅ |
| M2 | Product upload | Name, category (tops/bottoms/one-pieces), price, https purchase URL and image (validated). | ✅ |
| M3 | Product management | Edit, deactivate, delete | 🟡 list only; edit/deactivate in backlog |
| M4 | Basic analytics | Try-ons started, generated and saved, per product. Never shows shopper identities or photos. | ✅ |
| M5 | Subscription-ready account | `plan` and `monthly_generation_quota` on `merchants`; Stripe later | 🟡 schema only |
| M6 | Purchase attribution | Click-through and order matching | ⬜ needs storefront integration |

### Admin

| ID | Story | Acceptance criteria | Status |
|---|---|---|---|
| A1 | Generation log | Provider, model, status, latency, cost, error code and message per attempt | ✅ |
| A2 | Cost monitoring | Daily cost, cost per successful image, completion %, median latency (SQL view + `/admin`) | ✅ |
| A3 | Error tracking | Error codes in the log plus structured JSON server logs. Sentry in backlog. | 🟡 |
| A4 | Usage limits | Per-user per minute and per day; global daily USD budget; `429` + `Retry-After` | ✅ |
| A5 | User/merchant management | Merchant list | 🟡 list only; suspend in backlog |
| A6 | Feedback dashboard | Response count and average rating | ✅ |
| A7 | Landing conversion | Daily visitors, signups and conversion % | ✅ |
| A8 | Admins cannot see shopper photos | No RLS policy grants admin access to `person_photos` or result objects | ✅ |

---

## Functional requirements (MVP)

1. All AI calls go through `TryOnProvider`. Selection is by `TRYON_PROVIDER` env. No simulated provider exists in runtime code.
2. A generation row is inserted **before** the provider call (it reserves budget and counts toward limits) and completed with status, latency, cost and error.
3. Failed provider calls record a cost of $0 (FASHN documents no charge for failures; revisit for each provider).
4. Every write that affects cost or analytics uses the service role on the server. Users can only toggle `saved`, enforced by a DB trigger.
5. Landing analytics are first-party, with an anonymous visitor ID only. No third-party trackers.

## Non-functional requirements

| Area | Requirement |
|---|---|
| Performance | p50 try-on under 15s, p95 under 40s (to be measured). Landing page JS under 110 kB first load (currently 108 kB). |
| Availability | Pilot: best effort. Growth: 99.5%. |
| Security | RLS on every table; private buckets; server-only keys; same-origin checks; security headers; magic-byte validation. |
| Privacy | Consent versioning; 30-day default retention; delete in one click; DPAs with AI vendors before the pilot. |
| Accessibility | WCAG 2.1 AA target: labels, focus rings, 44px targets, alt text, `role=status`/`alert`. |
| Honesty | No fabricated metrics or testimonials. Fit disclaimer on every result. |

## Technical dependencies

Supabase (Auth, Postgres, Storage), Vercel (hosting and cron), FASHN API and/or Google Vertex AI, and (later) Stripe and the Shopify Admin API.

## Growth & enterprise features (not in MVP)

- **Growth:**
  - Shopify theme app extension
  - an embeddable widget (`<script>` + iframe)
  - a randomized holdout (by visitor hash)
  - add-to-cart / order webhooks for attribution
  - Stripe metered billing
  - weekly merchant email reports
  - product edit/deactivate
  - Sentry
  - async job queue (for p95 and retries)
  - provider routing per category
  - result moderation
- **Enterprise:**
  - org/store/role hierarchy
  - REST API keys with scopes
  - SDK (JS/React)
  - webhooks
  - SSO/SAML
  - SCIM
  - audit log export
  - configurable retention
  - region pinning
  - SLA and status page
  - SOC 2 readiness

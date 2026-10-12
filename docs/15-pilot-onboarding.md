# Pilot Onboarding & Merchant Feedback Process

Feeds the pre-registered gates in [`09-merchant-pilot-plan.md`](09-merchant-pilot-plan.md): **G3** (≥3 real pilots), **G6** (completion), **G7** (shopper satisfaction) and **G9** (willingness to pay).

## Onboarding steps

| # | Step | Owner | System of record | Done when |
|---|---|---|---|---|
| 1 | Qualify a waitlist applicant (Shopify, 50–5,000 orders/mo, tops-heavy) | TrendSet | `waitlist_signups` | Fit confirmed on the call |
| 2 | Merchant signs in and creates their store in Studio | Merchant | `merchants` | Row exists |
| 3 | Admin enrolls them: `POST /api/admin/pilots` `{merchantId, status:"onboarding", startDate, endDate, offeredPrice}` | Admin | `pilot_enrollments` | Status `onboarding` |
| 4 | Pilot agreement and DPA signed (counsel-approved templates) | Both | `agreement_signed_at`, `dpa_signed_at` | Both timestamps set |
| 5 | Connect Shopify and import, **or** add products manually (max 20, enforced by the DB) | Merchant | `products` | ≥5 products |
| 6 | QA each product's preview against the rubric. Only passing products go live. | Both | Product status toggle | Live products pass the rubric |
| 7 | Set status `live`. Add the theme block (or share the deep link). | Admin / merchant | `pilot_enrollments.status` | First shopper try-on |
| 8 | **Weekly feedback** in Studio (one per week) | Merchant | `merchant_feedback` | 6 submissions |
| 9 | Exit interview. Record `converted_to_paid` against the pre-agreed price. | Admin | `pilot_enrollments` | Decision recorded |

Studio shows an onboarding checklist for steps 2–8 and the weekly form.

## Weekly feedback instrument

| Field | Scale | Gate |
|---|---|---|
| Likelihood to recommend | 0–10 | Leading indicator |
| Value to the store this week | 1–5 | Leading indicator |
| Preview quality for their products | 1–5 | Cross-check against G4 |
| Would pay to keep it if the pilot ended today | yes / maybe / no | **G9** |
| Fair monthly price | USD (optional) | **G9** (named price) |
| Biggest problem / missing feature | free text | Backlog input |

## Scorecard (admin page → `pilot_scorecard` view)

One row per pilot merchant: status, live products, try-on attempts, completion % (G6), shopper ratings ≥4 % (G7), clicks to product pages, latest likelihood to recommend, latest would-pay, latest price named, feedback count, offered price, converted.

**Reading it honestly:** clicks and try-on counts are engagement, not lift. Lift comes only from experiments ([`12-experiments.md`](12-experiments.md)).

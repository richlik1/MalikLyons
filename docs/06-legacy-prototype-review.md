# Review of the Existing Prototype

`Understanding Uploaded File Content.zip` (14 files, dated 2026-08-05) was inspected and **left unchanged** in the repository root. The new MVP lives in `app/` and does not overwrite it.

## What it contains

A Vite + React + wouter front end with tRPC and Drizzle (MySQL) back-end fragments: `LandingPage`, `OnboardingWizard`, a dashboard (`Overview`, `Products`, `TryOnStudio`, `Integrations`), `schema.ts`/`schema_v2.sql` (about 30 tables), a `ProviderAdapter` interface, and a `demo` router with a test.

It is **not runnable on its own**. It imports modules that are not in the archive (`_core/trpc`, `db`, `components/ui/*`, `useAuth`, and so on).

## Issues that had to be fixed rather than carried forward

| Issue | Where | Why it matters |
|---|---|---|
| **Simulated AI generation.** "Generate Preview" runs a `setInterval` progress animation and then shows pre-made looks. No model is called. | `TryOnStudio.tsx` (`handleGenerate`) | It violates the "no fake AI demo presented as functioning" requirement |
| **Fabricated performance stats**: "2.4× conversion lift", "68% return reduction", "< 5 min setup" | `LandingPage.tsx` (hero stats) | Unsupported claims. Potential FTC/ASA exposure. |
| **Fabricated testimonials**: "reduced our return rate by 60%", "2.1× lift in add-to-cart" | `LandingPage.tsx` | The same. There are no customers yet. |
| **Hard-coded analytics** presented as real (23.8% conversion, $14,200 revenue lift, fixed session counts) | `demo.ts` `analytics` | Looks like real data in a dashboard |
| Demo seed uses a fake brand ("Lumière Boutique (Demo)") with `sessionsUsed: 1725` | `demo.ts` | Fine as a demo only if clearly labeled. It isn't. |
| Generation result type exposes `qualityScore`, `productFidelityScore` and `identityPreservationScore` with no method behind them | `types.ts` | These imply measured quality that doesn't exist |

## What was worth keeping (as ideas)

- The `ProviderAdapter` concept, with cost and latency metadata. Re-implemented as `TryOnProvider`.
- The future-phase schema ideas: quality evaluations, purchases and returns, storefront events, pilot accounts, size charts. Referenced in `03-database-schema.md` for the Growth phase.
- The Integrations and Onboarding UX, as a reference when building the Shopify app.

## Recommendation

Archive the zip under `legacy/` when convenient, and do not deploy it. If any of its UI is reused, strip every hard-coded metric and testimonial first.

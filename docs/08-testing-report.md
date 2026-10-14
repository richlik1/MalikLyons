# Testing Report

> **Superseded by the production-readiness audit (12 Oct 2026).** Current results: **110 unit, 37 integration (local Supabase stack), 12 E2E (stubbed provider), 0 live**. Raw outputs are in [`evidence/`](evidence/) and the analysis is in [`14-production-readiness-audit.md`](14-production-readiness-audit.md). The audit also closed the "RLS against a real Postgres" and "end-to-end flows" gaps listed below, using the local stack. **Live AI generation is still untested.** The original report follows.

_Run on 2026-10-12 in the development container (Node 22.22, Next 15.5.27)._

## Summary

| Check | Command | Result |
|---|---|---|
| Unit and contract tests | `npm test` | ✅ **33 passed / 33** (5 files) |
| Type check | `npm run typecheck` | ✅ no errors |
| Production build | `next build` | ✅ 20 routes compiled; landing first load 108 kB |
| Secret leakage | grep `.next/static` for server env names | ✅ none found |
| HTTP smoke test (`next start`, placeholder Supabase) | curl | ✅ see below |

## Unit and contract tests

| File | What it covers |
|---|---|
| `tests/image.test.ts` (5) | Accepts PNG/JPEG/WebP by magic bytes and reads dimensions. Rejects HTML/GIF disguised as images, empty files, files over 8 MB, below-minimum or over-maximum dimensions, and truncated headers. |
| `tests/limits.test.ts` (5) | Per-minute, per-day and global-budget decisions. Safe defaults for bad env values. |
| `tests/service.test.ts` (8) | Happy path stores the result privately and logs cost, latency and job ID. 503 when no provider. Cross-user photo access refused. Expired photo refused (410). Unsupported category refused **before any spend**. Rate limit blocks **before** the provider call. Content rejection logged at $0 with a user-safe message (no raw provider text leaked). Unexpected errors map to 502. |
| `tests/providers.test.ts` (9) | FASHN: request shape, polling, base64 decode, moderation and 429 mapping, timeout, no-key guard. Vertex: endpoint URL, payload shape, safety-filter handling. `createProvider` returns `null`, never a mock, when unconfigured or when set to `"mock"`. |
| `tests/schemas.test.ts` (6) | Email normalization, honeypot, URL validation, https-only purchase URLs, price format. |

## HTTP smoke test (production server)

| Request | Expected | Observed |
|---|---|---|
| `GET /` | Renders honest landing copy | ✅ 200, headline present, no performance stats |
| `GET /try-on` (signed out) | Redirect to login | ✅ 307 → `/login?next=%2Ftry-on` |
| `POST /api/try-on` (no session) | 401 | ✅ 401 `unauthenticated` |
| `POST /api/waitlist` with `Origin: https://evil.example` | 403 | ✅ 403 `bad_origin` |
| `GET /api/cron/purge` (no secret) | 401 | ✅ 401 |
| Response headers | nosniff, frame DENY | ✅ present |

## Not tested yet (be explicit)

| Gap | Why | Plan |
|---|---|---|
| **Live AI generation** with FASHN or Vertex | No API credentials in this environment | Week 3: live smoke test, then the 100-image benchmark |
| RLS policies against a real Postgres | No Supabase instance here | Run `supabase start` locally plus pgTAP or two-user manual tests (see the go-live checklist) |
| End-to-end browser flows (Playwright) | Needs Supabase and a provider | Add once a staging project exists |
| Load/concurrency on rate limits | Pilot scale doesn't need it yet | Atomic RPC before scaling |
| Accessibility audit with a screen reader | Time | axe and VoiceOver pass before the pilot |

**Bottom line:** the code compiles, its logic is unit-tested, and its security boundaries behave correctly at the HTTP layer. **It has not yet generated a real try-on image.** Treat it as "ready for staging", not "proven in production".

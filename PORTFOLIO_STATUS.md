# Portfolio status

**As of 2026-10-28.** Five active products. Out of scope: `paytriot45/Xcape-Key` (a fork of another author's FakeCallPro iOS app) and the old TrendSet prototype zip in this repository (made-up statistics, per TrendSet `docs/06`).

Labels: **✅ Verified** (run or observed on 2026-10-28) · **📄 Documented** (the repo's own docs) · **❓ Unverified** (needs the owner, a credential or a device).

Each product has its own `PRODUCT_STATUS.md` and `ROADMAP.md` in the PRs listed at the end. This page is the summary.

## At a glance

| Product | Repository | Deployed | Tests (✅ run today) | P0 blockers | Running cost |
|---|---|---|---|---|---|
| **StayOps** | `richlik1/stay-pro-ops` | 📄 Lovable (`stay-pro-ops.lovable.app`), staging on Vercel | 528/528 unit · 67/67 finance · 59/59 Postgres security/turnover · build ✅ | Schedulers down since 17 Oct; CI red on `main` (lockfile) | ❓ Lovable Cloud + Twilio (dashboards) |
| **Keen Prospect AI** | `richlik1/keen-prospect-ai` | ❓ was published without login in July (commit history); current state unknown | No tests on `main`. Auth PR: 15 Node + 24/24 Postgres auth checks ✅ | **No authentication; anonymous proposal read/update via the API** | ❓ usage-based: Google Places, Lovable AI, Apollo |
| **MY LIBRARY AI** | `richlik1/my-library-` | ✅ GitHub Pages; last deploy 2026-10-23 after tests | 119/119 unit · build ✅ · Chromium + WebKit e2e passed in repo CI on the same commit | None in code. **A real iPhone has never been tested.** | **$0** |
| **TrendSet** | `richlik1/Trendset-` | ✅ none | 124/124 unit · typecheck · build ✅; integration/E2E green in CI (stubbed AI) | Never generated a real image; **critical `next` advisory** blocks deploy; demand unvalidated | **$0** |
| **Growth OS** | `richlik1/growth-os` | none | nothing to test (one-line README) | No problem statement | **$0** |

## P0 blockers, in order

1. **Keen Prospect AI: security.**
   - **What:** login is a stub that gives every caller the service-role database client. Nine `anon` policies let anyone holding the public key list and update every proposal.
   - **Evidence:** ✅ reproduced on a database built from the migrations (10/24 checks pass before the fix, 24/24 after).
   - **Not checked:** ❓ the live database wasn't queried.
   - **Fix:** PR keen-prospect-ai#1.
   - **Today:** check Lovable → Publish and unpublish or protect the app until #1 is merged.
2. **StayOps: automation down.**
   - **What:** calendar sync, dispatch and reminders have failed every run since 17 Oct because `APP_BASE_URL` is unset in GitHub. Even when set, GitHub runs these `*/15` schedules about 6 times a day, not 96 (✅ measured from run history).
   - **Fix:** [StayOps `docs/scheduler-recovery.md`](https://github.com/richlik1/stay-pro-ops/blob/claude/portfolio-audit-roadmaps-jnc0z5/docs/scheduler-recovery.md) covers both steps: set the GitHub values today, then move to pg_cron after staging checks.
3. **StayOps: CI red on `main`.** `package-lock.json` is out of sync. PR stay-pro-ops#9 fixes it (✅ `npm ci` succeeds with it).
4. **TrendSet: before any deploy.** Critical `next` advisory (unauthenticated RCE with SVG images), fixed in `next@15.5.28`.

## Security scan across the portfolio (✅ gitleaks, full history, on GitHub's runners)

No real secret found anywhere. Every hit was reviewed:

| Repo | Hits | What they were |
|---|---|---|
| StayOps | 4 | Supabase **anon** keys, role claim decoded without printing the key; one test fixture |
| Keen Prospect AI | 2 | Supabase **anon** keys in the committed `.env` |
| TrendSet | 2 | An experiment name; a `ts_pk_` publishable demo key |

Each is listed with its reason in the repo's `.gitleaksignore`, so any new finding fails the weekly check.

Dependency audit (production dependencies): TrendSet 1 critical + 2 high; StayOps 0 critical + 7 high; MY LIBRARY 0 critical + 3 high (no fix available).

## Costs

- **Spent this session: $0.** No paid API call, no purchase, no deploy, no production database change.
- **Awaiting your approval:**
  - TrendSet FASHN smoke test, Phase 1: **$7.50** minimum credit purchase (covers Phases 1–2).
  - MY LIBRARY App Store: **$99/yr** Apple Developer Program (week 4 decision).
  - StayOps pg_cron: **$0** expected (❓ plan limits).
- **GitHub Actions minutes (estimate):** the new weekly health checks take about 1–2 minutes per repo per run, so about 5–9 min/month each. StayOps' three schedulers use about 540 min/month at the cadence GitHub actually runs them. GitHub Free includes 2,000 private-repo minutes a month (verify your plan). Public repos (MY LIBRARY, this one) are free.
- **Unknown (❓ check dashboards):** Lovable Cloud plans, Twilio, Google Places, Lovable AI usage, Apollo.

## Next actions (owner)

| # | Action | Product | Time |
|---|---|---|---|
| 1 | Check Lovable → Publish for Keen Prospect; protect or unpublish | Keen | 5 min |
| 2 | Set `APP_BASE_URL` + `CALENDAR_SYNC_CRON_TOKEN`, run the three workflows by hand, check for HTTP 200 | StayOps | 10 min |
| 3 | Review and merge stay-pro-ops#9, then #10, #14 | StayOps | review |
| 4 | Bootstrap your owner invite, then review and merge keen-prospect-ai#1 | Keen | review |
| 5 | Run the week-1 iPhone checklist items | MY LIBRARY | 30 min |
| 6 | Start merchant interviews; decide on the $7.50 smoke test | TrendSet | ongoing |
| 7 | Keep a two-week marketing task log | Growth OS | ongoing |

## Pull requests from this review (none merged)

| Repository | PR | Contents |
|---|---|---|
| keen-prospect-ai | #1 | **P0 auth remediation** with tests |
| keen-prospect-ai | #2 | Status, roadmap, health check |
| stay-pro-ops | #19 | Status, roadmap, scheduler recovery, PR review order, health check |
| Trendset- | #2 | Status, roadmap, smoke-test plan, health check |
| my-library- | #1 | Status, roadmap, health check |
| growth-os | #1 | Status, roadmap, health check |
| MalikLyons | this PR | This report |

Other open PRs found and **not** modified: stay-pro-ops #3, #5–#18 (including draft #17, which overlaps #19, and #18, from another tool), and MalikLyons #1.

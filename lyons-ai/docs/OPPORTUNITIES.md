# Opportunity Intelligence Department

A durable background department that researches opportunities twice a day, at **7:00 AM and 7:00 PM America/Detroit**. It covers contracts, grants, ventures, real estate, personal growth and technology. Each item is verified against an authoritative source and scored on a 100-point model. Only the ones worth your time reach Telegram. It never submits, applies, pays, signs or contacts anyone without your approval.

## Pipeline

```
DISCOVERED ─▶ VERIFIED ─▶ SCORED ─▶ SAVED ─▶ ACTION PREPARED ─▶ REPORTED
 registry      authority   7 factors  Postgres  checklist +       morning brief /
 source        re-fetch    + bands    evidence  internal task     evening review /
                                      history                     rare alert
```

Every stage transition is written to `opportunity_status_history`. Rejections are kept with their reason, and you never see them.

Dedupe happens before verification, on the source id plus a title+organization fingerprint. A duplicate costs no verification calls and is never reported twice.

## Effort allocation (not spending)

| Department | Share of research effort |
|---|---|
| Cleaning contracts & clients | 30% |
| Grants & financing | 20% |
| Ventures & investments | 15% |
| Real estate | 15% |
| Personal growth | 10% |
| AI & technology | 10% |

The allocation is applied to the per-cycle web-research units (`OPP_WEB_UNITS_PER_CYCLE`, default 3). Allocation is deficit-based: the departments furthest below their share over the last 7 days go first. The plan is persisted per slot so a restart doesn't re-pick.

To change the shares, set `opportunity.allocation` in settings. They are normalised to 100%.

## Source registry (`research_sources`, editable)

| Id | Source | How it's read | Notes |
|---|---|---|---|
| `grants_gov` | Grants.gov | Official API (`search2` + `fetchOpportunity`) | No key. Forecasted items are labelled *projected*. |
| `sam_gov` | SAM.gov Contract Opportunities | Official API v2 | `SAM_API_KEY` (free). Presolicitation and sources-sought notices are labelled *forecast*. |
| `github` | GitHub repositories | Official REST API | `GITHUB_TOKEN` optional: 60 requests/hour without one, 5,000/hour with one. |
| `mi_sigma_vss` | Michigan SIGMA VSS | **Official alert emails** in your Gmail, accepted only from the official sender domain with DMARC/SPF pass | SIGMA requires login. LYONS AI never logs in to it. |
| `detroit_bonfire_alerts` | City of Detroit bids (Bonfire) | **Official alert emails** | Requires a Bonfire supplier account with commodity codes. |
| `mi_vendor_dashboard` | Michigan Vendor Opportunity Dashboard | Registry-scoped web research | A forecast tool, so items are always *projected*, never *open*. |
| `detroit_ocp` | City of Detroit OCP | Web research (public pages) | |
| `sba`, `medc` | SBA, MEDC | Web research | Loans are labelled loans, never grants. |
| `mi_sbdc` | Michigan SBDC | Web research | |
| `detroit_land_bank`, `detroit_property_portal` | Detroit Land Bank, Property Portal | Web research (public listings only) | |
| `property_managers` | Metro Detroit PMs / STR operators | Web research (lead research only) | Outreach always needs your approval. |
| `ventures`, `eventbrite`, `personal_resources`, `ai_docs` | Ideas, events, family/community resources, official AI docs | Web research | |

Web research uses Claude with web search, restricted to each entry's `domains` list (`allowed_domains`). The verifier then downloads the primary page itself (https only, SSRF-safe, redirects re-checked hop by hop). It confirms the title, and confirms the deadline and amount appear on the page. Anything not found on the page is labelled an estimate or dropped.

Telegram commands:
- `/sources` lists health, failures and last success.
- `/source_enable <id>` and `/source_disable <id>` turn a source on or off.
- `/opp_runs` shows recent runs, and `/opp_costs` shows API calls and LLM dollars per source.
- `/opp_retry <job>` retries a dead-lettered job.

**Access rules (enforced):** official APIs, RSS and email come first. There is no login to access-controlled portals, no CAPTCHA or MFA bypass, and no scraping against terms. Every request goes through a counting fetch with per-run and per-day request caps (`max_requests_per_run/day`). If a source is unavailable, the brief says so. **Nothing is ever fabricated.**

## Scoring (100 points, `opportunity.scoring` setting)

| Factor | Max |
|---|---|
| Strategic fit | 20 |
| Financial upside (conservative; estimates discounted) | 20 |
| Execution probability (eligibility, registrations, competition, load) | 20 |
| Capital affordability (vs `maxUpfrontInvestmentUsd`) | 15 |
| Time & effort (vs `weeklyHoursAvailable`) | 10 |
| Timing / urgency | 10 |
| Evidence quality (official API > verified official page > alert email) | 5 |

**Bands:**

| Score | Band | Status |
|---|---|---|
| ≥ 85 | High priority | `qualified`, alert-eligible |
| ≥ 70 | Investigate | `qualified`, appears in briefs |
| ≥ 50 | Watchlist | `verified`, kept but not pushed |
| < 50 | Archive | `archived` |

**Hard disqualifications** (status `rejected`, with a reason):
- failed verification
- an expired deadline, or fewer than `minDaysToDeadline` days left
- known ineligibility
- capital above your limit
- a closed or cancelled status at the source
- scam signals

**Learning:** your Pursue, Not for me and outcome feedback (`user_feedback`) can shift a factor by at most ±20%, and only after 3 or more decisions in the same category or source.

**Honesty rules:**
- Grants are distinguished from loans, reimbursements and paid programs (`funding_type`).
- Projected procurements are distinguished from open solicitations (`opportunity_type`).
- Projected returns are always labelled estimates and are never guaranteed.

## Twice-daily cycles

| Cycle | Time (America/Detroit) | Jobs |
|---|---|---|
| Morning | `OPP_MORNING_HOUR` = 7 | Discovery for all enabled API and email sources, then this slot's web-research units, then the **🌅 Morning Intelligence Brief** |
| Evening | `OPP_EVENING_HOUR` = 19 | Re-verification of open items, more web research, then the **🌙 Evening Intelligence Review** |
| Weekly (optional) | `OPP_WEEKLY_ENABLED`, Monday 08:00 | Top 5, with no repeats unless you're pursuing the item |

**Morning brief:**
- the top 3, each with why it matters, a link, score and band, the deadline, cost and upside, and the next action
- **one recommended action** for the day
- **changes since the last brief** (new, deadline changes, closed)
- source problems

**Evening review:**
- today's counts (discovered, verified, rejected, archived, qualified)
- what was prepared
- changes
- the highest-value step for tomorrow

**Exceptional alerts** go out only when one of these holds, deduplicated per (reason, item, information) in `notification_history.dedupe_key`, and capped by `OPP_MAX_ALERTS_PER_DAY`:
- a high-band, non-forecast item closing within 14 days
- a deadline change on an item you're pursuing
- an item you're pursuing that no longer verifies
- an item you're pursuing that closes within 3 days

## Autonomy

| Allowed alone | Requires your approval (policy engine) |
|---|---|
| Research, verify, score, update records, draft, build checklists (`opportunity_actions`), create internal tasks | Sending any external message, submitting applications, sharing confidential data, paying, committing, signing, deleting important records |

When you tap **Pursue** with `STAYOPS_TASKS_ENABLED=true`, a StayOps task is created through the scoped task API. That is an internal task, never a client message. It is idempotent via `externalRef = lyons-opportunity:<id>`.

## Reliability

- **Durable slots.** Each `(job, slot)` succeeds at most once, with slot = `YYYY-MM-DD#morning|evening`. If the server was down at 7 AM, the job runs on start. A morning missed entirely still runs its discovery, but the stale brief is skipped and the evening review covers it.
- **No duplicate concurrent runs.** A Postgres advisory lock is held per `(job, slot)`, so multiple app instances are safe.
- **Restart recovery.** Runs left `running` by a crashed process are marked failed and retried. This only happens when no live worker holds the lock.
- **Retries and dead letters.** Retries back off at 5 and then 10 minutes. After 3 attempts the run goes to `dead_letter` and you get one Telegram notice. Use `/opp_retry` to retry it.
- **Circuit breaker.** A source is disabled after 6 consecutive failed runs, and the brief says so. A missing setup, such as no Google connection or no key, is a *skip*, not a failure.
- **Checkpointing.** `research_runs.checkpoint` records progress. Inserts are idempotent (unique source/source_id and actions).
- **Timeouts.** Each job is aborted at the workflow timeout. The kill switch and the `opportunities` module pause stop everything.
- **Costs.** `research_costs` stores API calls and LLM tokens and dollars per run and source. Web research stops at `OPP_DAILY_RESEARCH_BUDGET_USD` and the global daily spend limit.
- **Health.** `/healthz` reports the scheduler's last tick, disabled sources and dead letters in the last 24 hours.

## Demo

```bash
DATABASE_URL=... MASTER_ENCRYPTION_KEY=... [SAM_API_KEY=...] [GITHUB_TOKEN=...] npm run opp:demo
DEMO_AT=2026-10-15T11:05:00Z npm run opp:demo   # pretend it's 07:05 Detroit
# Docker: docker compose exec lyons-ai node dist/scripts/opportunity-demo.js
```

The demo runs one real scheduler tick against the real network. It prints:
- the runs and source health
- the best stored opportunity, with its stage history and prepared actions
- the costs

Briefs go to Telegram when it is configured.

**Results so far** (see `docs/demo/`):
- `opportunity-test-evidence.txt`: the full stage chain on Postgres, duplicate suppression, restart recovery, advisory-lock exclusion, retry → dead letter → circuit breaker, the API limit, kill switch and pause, approval enforcement, and cost tracking. Every item passes, with the real Grants.gov adapter parsing fixture HTTP in the documented shape.
- `opportunity-live-run-sandbox.log`: a real-network run from the build sandbox.
  - Grants.gov was blocked by the sandbox egress policy (`network error`), and GitHub returned 401 from the sandbox proxy. Both were retried twice and then dead-lettered, and the morning brief honestly listed them under *Source issues*.
  - SAM.gov was skipped (no key) and the email-alert sources were skipped (Google not connected).
  - **No real opportunity has been discovered yet.** That needs the VM, or allowed domains in this environment.

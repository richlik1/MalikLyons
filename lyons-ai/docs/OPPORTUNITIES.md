# Opportunity Intelligence

A background service that looks for opportunities (contracts, grants, programs, real estate, business ideas, development, personal), verifies each one against an authoritative source, scores it against your profile, and tells you only about the ones worth your time.

## How it works

```
 Discover ──▶ Dedupe ──▶ Verify ──▶ Eligibility ──▶ Hard filters ──▶ Score ──▶ Store ──▶ Notify (rarely)
 sources      source id   re-fetch   deterministic   expired, too     0–100     Postgres   alerts ≤ 2/day
              + title     from the   rules, never    soon, failed     with a              daily: new items only
              fingerprint authority  "assumes yes"   verification,    breakdown           weekly: top 5, no repeats
                                                     ineligible
```

| Source | Covers | Verification | Needs |
|---|---|---|---|
| **Grants.gov** (`api.grants.gov`) | Federal grants open to small businesses / "others" / unrestricted | Re-reads the record via `fetchOpportunity`: title, still open, award floor/ceiling, applicant types, cost sharing | Nothing (public API) |
| **SAM.gov** (`api.sam.gov`) | Federal contract notices for NAICS 561720 (janitorial), 561790, 561210 with place of performance in MI | Re-reads the notice by id: title, active, response deadline | Free API key (`SAM_API_KEY`) from SAM.gov → Account Details |
| **Web research** (Claude + web search) | Local RFPs (city, county, schools, housing, hospitals), Michigan/Detroit programs, real estate, business ideas, mentorship/training, community and parenting resources, operational changes | Downloads the primary URL itself (SSRF-safe, https only), checks the title is on the page, confirms the deadline and amount appear on the page (otherwise they're labeled estimates or dropped), and rejects pages with scam signals | `ANTHROPIC_API_KEY`; capped by `OPP_DAILY_RESEARCH_BUDGET_USD` (default $1.50/day) |

### Discipline rules (enforced in code)
- **No unverified items reach you.** If verification fails, the item is stored as `rejected` with the reason, and you never see it.
- **Facts vs estimates:** amounts and deadlines are "confirmed" only when they came from the authoritative record or appeared verbatim on the official page. Anything else is labeled **ESTIMATE** or **UNCONFIRMED**, or dropped.
- **Eligibility is never assumed.** Unknowns, like whether you're registered in SAM.gov, make the result "unclear" and generate a question; `/profile` lists them.
- **Hard filters:** expired items, deadlines closer than `minDaysToDeadline` (7 days), ineligible applicant types, closed or inactive notices, and scam patterns.
- **Notification budget:**
  - At most `OPP_MAX_ALERTS_PER_DAY` (2) immediate alerts, and only for scores ≥ 80 closing within 21 days.
  - The daily briefing shows at most 5 items you haven't seen, and sends **nothing** when nothing is new.
  - The weekly top five never repeats an item unless you're pursuing it.
- **Learning:** your Pursue / Not for me / outcome feedback shifts scores for the same category and source by at most ±10 points, and only after 3 or more decisions.

### Scoring (0–100)

| Factor | Points |
|---|---|
| Value | up to 30 (log scale on the confirmed amount; 10 if not stated) |
| Fit | up to 25 (category weight, keyword and NAICS match, Metro Detroit location) |
| Feasibility | up to 20 (eligibility; −5 if you're already pursuing 5 or more) |
| Timing | up to 15 (7–45 days ideal) |
| Cost/effort | up to 10 (cost sharing lowers it) |
| Learned | ±10 |

Qualified = 55 or more. Every card shows the breakdown in its notes.

### What every recommendation contains
Name and source · why it fits · upside (confirmed or estimate) · investment · effort · deadline (confirmed or not) · eligibility with notes · prerequisites · risks · documents (typical, to be confirmed) · the specific next action · source URL · verification checks · confidence · last verification date. It comes with **Pursue / Prepare / Not for me** buttons. **Prepare** creates a task that builds an application checklist and draft. Nothing is ever submitted or sent.

## Schedule (owner's timezone)

| Job | When | Notes |
|---|---|---|
| Discovery (Grants.gov, SAM.gov) | every 12 h | Up to 40 new verifications per run |
| Web research | every 12 h, rotating 2 categories | Stops at the daily research budget or the global daily limit |
| Re-check | daily from 06:00 | Re-verifies open items; closes dead ones; warns you only about ones you're pursuing |
| Daily briefing | 07:00 | Skipped when nothing is new |
| Weekly top 5 | Monday 08:00 | |

Each job runs once per slot. Failures retry with backoff (5, 10 min) up to 3 attempts, and every run is logged in `research_runs` and shown in the Control Center. Nothing runs while the kill switch or the `opportunities` module pause is on.

## Telegram
`/opps` pipeline · `/opp <id>` full card with buttons · `/opp_done <id> <result>` record the outcome · `/profile` shows what it knows and what it still needs. You can also just say "I'm registered in SAM.gov now" or "I have 6 employees", and the agent updates the profile.

## Live end-to-end demo
```bash
DATABASE_URL=... MASTER_ENCRYPTION_KEY=... [SAM_API_KEY=...] npm run opp:demo
# in Docker: docker compose exec lyons-ai node dist/scripts/opportunity-demo.js
```
It discovers from Grants.gov (and SAM.gov if a key is set), verifies each item against the authoritative API, scores and stores it, prints the best card with its full verification record, and sends the daily briefing (to Telegram if configured). It uses only real API responses. If a source is unreachable it says so and doesn't fabricate output.

> **Status:** the demo has **not** completed a live run yet. The build environment's network policy blocks `api.grants.gov` and `api.sam.gov`. The parsers follow the published API docs and are tested with fixtures in that shape. Run the demo once on your VM to confirm the live field names (see `docs/STATUS.md`).

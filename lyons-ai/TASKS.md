# LYONS AI: prioritized backlog

**Priority key:**
- **P0:** blocks first production use.
- **P1:** needed for a reliable product.
- **P2:** planned enhancements.

Every task must also meet the global criteria in `AGENTS.md`: no secrets, approval gates intact, tests added, and real results reported.

Items marked **(owner)** need the owner's accounts, money or approval. Coding agents prepare those and stop.

## P0: go live

| # | Task | Acceptance criteria |
|---|---|---|
| P0-1 | **(owner)** Create the Telegram bot, Anthropic key (with billing) and VM, then run `sudo bash deploy/setup.sh` (`docs/DEPLOYMENT.md` §2, §4b) | `/healthz` returns `ok:true` and migrations through 006 are applied. `/status` replies in Telegram only to the owner. Other Telegram users get no response. |
| P0-2 | Verify the live Claude request shape (Opus 5.5, adaptive thinking, effort, caching, `fallbacks`, beta header) against the real API on the VM, then fix any rejected field | One real Telegram task completes. Its spend is recorded in `spend_ledger`. The result goes in `docs/STATUS.md`. |
| P0-3 | **(owner)** Create the Google OAuth client and connect the business and personal accounts | `/connect_google business` and `/connect_google personal` succeed. Calendar listing and a Gmail draft work. Approve and Reject on `calendar_create_event` behave correctly. Each check is recorded in the `docs/STATUS.md` acceptance log. |
| P0-4 | Fix the date-dependent integration test `twice-daily scheduler > skips a source once its daily API limit is reached`. It failed on 2026-10-28 (174 pass, 1 fail). `SourceRegistry.apiCallsToday()` uses the DB clock `now()` while the scheduler uses its injected clock. | Pass the scheduler's `now` into `apiCallsToday` (`src/opportunities/registry.ts`, `src/opportunities/scheduler.ts`). The full suite passes on any date. Add a test that runs with a clock far from the DB date. |
| P0-5 | Run `npm run opp:demo` on the VM with real network access | At least one genuine Grants.gov record goes DISCOVERED → VERIFIED → SCORED → SAVED → ACTION PREPARED → REPORTED, with stage history and logs saved in `docs/demo/`. If the live API field names differ from the parsers, fix them with fixtures. |
| P0-6 | **(owner)** Decide the visibility of `richlik1/MalikLyons`. It is currently **public** and contains the full agent source and business docs. | The owner decides between private and public. If private, the setup instructions are updated for a token-based clone. |

## P1: reliability and real integrations

| # | Task | Acceptance criteria |
|---|---|---|
| P1-1 | **Re-base the StayOps adapter on the real app.** The adapter (`src/integrations/stayops/stayops.ts`) targets a *proposed* REST contract (`docs/STAYOPS_INTEGRATION.md`). The real StayOps app (`richlik1/stay-pro-ops`, TanStack Start + Supabase) exposes `/api/public/hooks/*` cron endpoints, not that contract. | Write a read-only contract proposal PR in **stay-pro-ops**: a scoped token, a staging-first rollout, and no production changes without owner approval. Then update the adapter with contract tests. `stayops_list` works against staging. |
| P1-2 | Treat transient Claude and Google errors (429/5xx) as retryable instead of failing the task | The task is re-queued with backoff and capped attempts. Covered by a runner test. |
| P1-3 | Add CI to this repo: typecheck, unit tests, Postgres integration tests (service container), and `npm audit` | CI is green on the PR. No secrets are needed in CI. |
| P1-4 | Store backups off the server | A nightly encrypted `pg_dump` with 14-day retention. A restore is tested once and documented in `docs/RECOVERY.md`. |
| P1-5 | Reconcile `spend_ledger` with the Anthropic usage data, and add a weekly cost line to the evening brief | The reported cost is within 5% of the provider's figure. |
| P1-6 | Remove the deprecated config keys `OPP_DISCOVERY_EVERY_HOURS`, `OPP_DAILY_HOUR` and `OPP_DAILY_ITEMS` | They are removed from `src/config.ts` and `.env.example`, and the tests pass. |
| P1-7 | **(owner)** Register for Michigan SIGMA VSS and Detroit Bonfire supplier alerts, and add the official sender domains to the email-alert registry entries | Alert emails are parsed only when they pass the DMARC/SPF check. The `mi_sigma_vss` and `detroit_bonfire_alerts` sources report success instead of `skipped`. |
| P1-8 | Do the Mac bridge dry run on the owner's Mac (`LYONS_BRIDGE_DRY_RUN=1`) | Inbound iMessages appear on client timelines and nothing is sent. Results are recorded in `docs/STATUS.md`. |
| P1-9 | **(owner)** Make a receptionist test call through a Twilio number | Normal and "emergency" calls behave as documented in `docs/RECEPTIONIST.md`. The Twilio signature is validated. |

## P2: enhancements (each needs owner approval of scope)

| # | Task | Acceptance criteria |
|---|---|---|
| P2-1 | WhatsApp channel through the **official WhatsApp Business Cloud API** (not unofficial WhatsApp Web automation) | A `Notifier` and intake for WhatsApp. Only allowlisted senders are accepted. Outbound messages go through the approval policy. No ban-risk libraries. |
| P2-2 | Slack channel for employees and cleaners | Coordinate with the StayOps Slack work (`stay-pro-ops` PRs #4 and #6) to avoid duplicate bots. |
| P2-3 | A sandboxed workspace container (Ubuntu or Kali) for agent code execution | No host mounts, no secrets, network off by default, resource limits. Commands go through an approval-gated tool. No security tooling is aimed at systems the owner doesn't own. |
| P2-4 | Google Drive documents with the `drive.file` scope: invoices, proposals and reports as drafts | Sending is a separate approval-gated step. |
| P2-5 | Specialist agents `finance`, `sales` and `personal_admin`, plus a `delegate_task` tool using `tasks.parent_task_id` | Each agent has a restricted tool and data-class allowlist, with tests for the policy boundaries. |
| P2-6 | Move the browser to its own container with no DB or secret access (milestone M4) | Work arrives over a queue and screenshots are returned. Policy tests pass. |

## Out of scope by owner policy and safety
These are explicitly not to be built:
- An "uncensored" or unrestricted agent with host shell access
- Unofficial WhatsApp Web, QR-session bots
- Instagram mass-unfollow automation
- Full iPhone takeover
- Logging into portals or bypassing CAPTCHA or MFA

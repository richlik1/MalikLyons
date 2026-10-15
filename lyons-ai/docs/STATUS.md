# Verification Status

This file is the honest record of what has and hasn't been verified. **An integration is not "working" until it has been authenticated with real credentials and exercised.**

Last updated: 2026-10-15 (v0.2: communications, opportunities, control center)

## Verified in the build environment

| Area | How it was verified |
|---|---|
| TypeScript build / typecheck | `npm run build`, `npm run typecheck`: clean |
| Unit tests (41) | Crypto (tamper, AAD binding), untrusted-content wrapping, webhook HMAC/replay, policy engine, tool registry/JSON schema, spend math, calendar conflict detection, Gmail MIME/body parsing and header-injection guard, browser URL allowlist, StayOps client (fake HTTP), Telegram parsing, briefing dates |
| Agent loop on real PostgreSQL 16 (18 tests) | Fake (scripted) Claude: completion, read tools, approval → execute exactly once, rejection, expiry, crash mid-tool (non-idempotent → `outcome_unknown`, idempotent → re-run), resume without repeating model calls, kill switch halt/resume, daily and per-task spend limits, timeout, turn limit, scope separation, unknown tool / bad input, refusal, cancel, untrusted memory recall, append-only audit log |
| HTTP + store on real PostgreSQL (11 tests) | Health, signed briefing webhook (once-per-day idempotency), unsigned/tampered/replayed requests rejected, kill switch returns 423, n8n payload wrapped as untrusted + dedupe, OAuth state single-use, Google consent URL scopes, tokens encrypted at rest, single-winner tool-call and task claims |
| Isolated browser workflow (5 tests, real headless Chromium) | Page text + 2 screenshots captured; off-allowlist subresources blocked; stops at a login form and at a CAPTCHA page; off-allowlist URL refused; off-allowlist redirect blocked |
| Compiled app smoke test | `node dist/src/index.js` boots, runs migrations, `/healthz` OK, signed webhook creates a briefing task, task fails cleanly because no Claude key is set |
| n8n 2.43.5 workflow | Imported `deploy/n8n/lyons-briefings.workflow.json` into a real n8n container, executed it, and the agent accepted the HMAC-signed request and queued the briefing |
| Deployment config | `caddy validate` passes for `deploy/Caddyfile`; `docker compose config` passes; `deploy/postgres-init.sh` run in `postgres:16-alpine` creates the `n8n` role/db, and n8n is refused CONNECT to the `lyons` database |
| Claude error mapping | A deliberately invalid key against the live API returns the "Claude rejected the API key (401)" task failure |

### v0.2 additions verified in the build environment

| Area | How it was verified |
|---|---|
| Totals | **163 TypeScript tests** (unit, real PostgreSQL 16, real headless Chromium) and **13 Python tests** for the Mac bridge, all passing; typecheck clean |
| Opportunity engine (≈44 tests) | Eligibility rules (Grants.gov applicant types, SAM set-asides, location), hard filters, deterministic bounded scoring, bounded learning; Grants.gov and SAM.gov clients against fixtures in the documented response shape (HTTP-200 body errors, key never leaked in errors); web research loop with `pause_turn` resume; page verification (dates in Eastern time, amounts, title coverage, scam signals, **SSRF incl. redirect hops**); pipeline on Postgres: dedupe, alert cap, daily "new only", weekly no-repeat, feedback learning, recheck closing/deadline change, scheduler slots, retries with backoff, module pause |
| Control Center (10 tests) | Login, lockout after 5 failures, signed session bound to token, CSRF on every action, emergency stop/resume, module pause, approvals from the dashboard, HTML escaping, JSON state; mobile layout screenshot (`docs/images/control-center-mobile.png`) from the compiled app |
| Data-class guard / module pause | Restricted agent never sees client/message tools and is denied if it calls them; paused module denies tools |
| Gmail cleanup | Classification and protection (incl. mutation-tested protection rule), exact-count approval check, archive/trash/revert, idempotent apply, one-click unsubscribe with sender check and SSRF refusal (fake Gmail + fake HTTP) |
| Clients & comms | Exact-match auto-linking, suggestions and conflicts, owner confirmation, timeline, unanswered detection, reply tracking (draft → sent → replied), Gmail/Contacts sync (only client mail stored, idempotent), owner-activated automation policies with recipient/subject/cap enforcement through the real task runner |
| iMessage bridge | Server endpoints (signatures, client-only storage, outbox empty when paused, acks); Python bridge against a synthetic `chat.db` (attributedBody decoding, client-only upload, first-run no backfill, journaled sends, no resend after crash, dry run); signature algorithm identical to the server's |
| Receptionist | Twilio signatures **cross-checked against the official `twilio` package**; AI disclosure; price/commitment/terms filter (mutation-tested); emergency transfer without a model call; voicemail fallback when paused; owner summary |
| Storage | Python scanner on real files (true duplicates only, Photos-library skip, re-hash before moving); server report/approval/queue/ack |
| Compiled app | Boots with all five migrations on a fresh database; Control Center renders all 12 sections without errors |

### v0.3 Opportunity Intelligence Department, verified in the build environment (2026-10-15)
- Migration `006` applies on Postgres 16. It adds research_sources, research_runs (+ checkpoint, api_calls, dead_letter), opportunities (+ blueprint fields), opportunity_evidence, opportunity_scores, opportunity_status_history, opportunity_actions, notification_history (dedupe keys), user_feedback and research_costs.
- 16 opportunity integration tests pass (`docs/demo/opportunity-test-evidence.txt`). They cover:
  - the full DISCOVERED → VERIFIED → SCORED → SAVED → ACTION PREPARED → REPORTED chain
  - bands and statuses, duplicate suppression, and hard exclusions
  - morning and evening briefs, feedback learning, and the StayOps task sink
  - recheck alerts that never repeat
  - 7 AM / 7 PM cycles that run once each, the advisory lock against concurrent runs, and restart recovery
  - retry → dead letter → circuit breaker, the daily API cap, kill switch and pause, and per-run cost rows
  - skipping email-alert sources while Google is not connected
- Real-network sandbox run (`docs/demo/opportunity-live-run-sandbox.log`):
  - Grants.gov was blocked by the sandbox egress policy, and GitHub returned 401 from the sandbox proxy. Both were retried with backoff, dead-lettered, and reported in the morning brief's *Source issues*.
  - SAM.gov and the email-alert sources were correctly *skipped* (no key, no Google connection).
  - **No real opportunity was produced. None was fabricated.**
- Full suite: 175 TypeScript tests (5 skipped, which need a real browser or optional services) and 13 Python tests pass. Typecheck and build pass.

## NOT yet verified (need your credentials or deployment)

| Area | Status | What's needed |
|---|---|---|
| Claude API (real reasoning) | ❌ Not authenticated | `ANTHROPIC_API_KEY`. The request shape (Opus 5.5, adaptive thinking, effort, caching, `fallbacks: "default"`) has not been accepted by the live API yet. |
| Telegram bot | ❌ Not authenticated | `TELEGRAM_BOT_TOKEN` + `TELEGRAM_OWNER_USER_ID`. Commands are implemented but not exercised against Telegram. |
| Google OAuth / Gmail / Calendar | ❌ Not authenticated | Google OAuth client + `/connect_google`. API calls are written against the official client libraries but have not run against real accounts. |
| StayOps | ❌ No API available | Contract is a proposal (`STAYOPS_INTEGRATION.md`). |
| Docker image build | ⚠️ Partially verified | The build stage (`npm ci` + compile) succeeded. The runtime stage's `playwright-core install --with-deps` could not finish here because this sandbox's proxy blocks the Debian package mirrors. Expected to work on a normal VM; verify with `docker compose build`. |
| Full Compose stack end-to-end (TLS certificate issuance, all services together) | ❌ Not run end-to-end | A real VM + DNS |
| **Opportunity live demo** (a real opportunity end to end) | ❌ Not run live | The sandbox blocks `api.grants.gov`, `api.sam.gov`, `michigan.gov`, `detroitmi.gov`, `sba.gov` and others, and GitHub search is blocked by the sandbox proxy. Run `npm run opp:demo` on the VM (`DEPLOYMENT.md` §4b), or add these hosts to this environment's allowed domains. Confirm the live response field names match the parsers. |
| SIGMA VSS / Detroit Bonfire alert emails | ❌ Not connected | Supplier registrations plus `/connect_google business` |
| Production 7 AM / 7 PM schedules | ❌ Not activated | A deployed VM (`DEPLOYMENT.md` §4b) |
| Opportunity web research | ❌ Not run live | `ANTHROPIC_API_KEY` |
| Gmail cleanup / Contacts sync | ❌ Not run on real mailboxes | Reconnect Google with the new `gmail.modify` and `contacts.readonly` scopes, then run `/cleanup` (scan only) first |
| iMessage bridge on a real Mac | ❌ Not run on macOS | A Mac with Full Disk Access and Automation permission; start with `LYONS_BRIDGE_DRY_RUN=1` |
| Mac storage "move to Trash" via Finder | ❌ Not run on macOS | A Mac |
| Receptionist on a real call | ❌ Not run | Twilio number + `TWILIO_AUTH_TOKEN`; place a test call |

## Live acceptance log (fill in after deployment)

| Date | Check | Result | Notes |
|---|---|---|---|
| | `/status` | | |
| | Google business connected | | |
| | Google personal connected | | |
| | Calendar today matches reality | | |
| | Unread email summary | | |
| | Gmail draft created and visible | | |
| | Calendar event via approval | | |
| | Reject path (no event created) | | |
| | `/pause` / `/resume` | | |
| | Scheduled morning briefing from n8n | | |
| | Browser snapshot of an allowlisted site | | |
| | `npm run opp:demo` produces a verified Grants.gov opportunity | | |
| | First 07:00 Morning Intelligence Brief received | | |
| | First 19:00 Evening Intelligence Review received | | |
| | Control Center sign-in, emergency stop, module pause | | |
| | `/cleanup` scan report on the real inbox (no changes) | | |
| | Apply + revert a small cleanup plan | | |
| | `clients_sync` timeline for one real client | | |
| | iMessage bridge dry run on the Mac | | |
| | Receptionist test call (normal + "emergency") | | |
| | Mac storage scan report | | |

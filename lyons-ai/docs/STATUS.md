# Verification Status

This file is the honest record of what has and hasn't been verified. **An integration is not "working" until it has been authenticated with real credentials and exercised.**

Last updated: 2026-10-14 (initial build)

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

## NOT yet verified (need your credentials or deployment)

| Area | Status | What's needed |
|---|---|---|
| Claude API (real reasoning) | ❌ Not authenticated | `ANTHROPIC_API_KEY`. The request shape (Opus 5.5, adaptive thinking, effort, caching, `fallbacks: "default"`) has not been accepted by the live API yet. |
| Telegram bot | ❌ Not authenticated | `TELEGRAM_BOT_TOKEN` + `TELEGRAM_OWNER_USER_ID`. Commands are implemented but not exercised against Telegram. |
| Google OAuth / Gmail / Calendar | ❌ Not authenticated | Google OAuth client + `/connect_google`. API calls are written against the official client libraries but have not run against real accounts. |
| StayOps | ❌ No API available | Contract is a proposal (`STAYOPS_INTEGRATION.md`). |
| Docker image build | ⚠️ Partially verified | The build stage (`npm ci` + compile) succeeded. The runtime stage's `playwright-core install --with-deps` could not finish here because this sandbox's proxy blocks the Debian package mirrors. Expected to work on a normal VM; verify with `docker compose build`. |
| Full Compose stack end-to-end (TLS certificate issuance, all services together) | ❌ Not run end-to-end | A real VM + DNS |

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

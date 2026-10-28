# LYONS AI — Implementation Milestones

Each milestone ends with a demo you can do from your iPhone. "Done" means automated tests pass **and** the live integration is authenticated and exercised. Code alone doesn't count.

## M1 — MVP core (this delivery)
**Built and tested in code:** Telegram control (owner-only), persistent tasks, Claude agent loop, approval gates, kill switch, spend limits, timeouts, crash-safe resume, append-only audit log, long-term memory, encrypted Google OAuth, Gmail read and draft, Calendar read/conflicts/create (with approval), read-only StayOps adapter (proposed contract), isolated browser page-snapshot workflow, morning/evening briefings via n8n, Docker Compose deployment.

**To finish M1 (needs you):**
1. Provide secrets on the server (`docs/SETUP.md`): Telegram bot token and owner id, Anthropic API key, Google OAuth client.
2. Deploy to a VM (`docs/DEPLOYMENT.md`), then send `/status`.
3. `/connect_google business`, then `/connect_google personal`.
4. Live acceptance checks: "what's on my calendar today", "summarise unread email", "draft a reply to …", `/brief morning`, a calendar event that goes through approval, and `/pause` then `/resume`.
5. Record results in `docs/STATUS.md`.

## v0.2 (delivered in code): communications, opportunities, control
Opportunity Intelligence (Grants.gov, SAM.gov, verified web research, scheduler, reports, feedback learning), Control Center dashboard with per-module pauses, data-class guard for agents, Gmail cleanup (reversible), client timeline with confidence-based identity matching, outbound tracking, owner-activated automation policies, macOS iMessage bridge (prototype), AI receptionist on Twilio, Mac storage assistant. Live acceptance steps are in `docs/STATUS.md`.

## M2 — Business documents and hardening (≈1–2 weeks)
- **Google Drive:** read and create documents in a dedicated "LYONS AI" folder (`drive.file` scope only).
- **Invoices, proposals, client reports:** template-driven generation (Google Docs/PDF) as **drafts** in Drive. Sending them is a separate, approval-gated step.
- ~~Email send tool~~: delivered in v0.2 (`gmail_send_draft`, approval-gated, re-checks the draft before sending).
- **Retryable errors:** re-queue tasks on transient Claude/Google errors (429/5xx) with backoff instead of failing them.
- **Ops:** CI (typecheck, tests, `npm audit`), Dependabot, nightly encrypted Postgres backups, off-box audit log shipping.
- **Spend:** reconcile the ledger with the Anthropic Usage API, and add a weekly cost report to the evening briefing.

## M3 — StayOps integration (≈1–2 weeks, needs StayOps authorization)
- Agree on the agent API contract with StayOps (`docs/STAYOPS_INTEGRATION.md`). Issue a **read-only, scoped** token and test against staging first.
- Operations specialist: daily turnover review, unassigned-cleaner alerts, inspection follow-ups.
- n8n event triggers: StayOps webhooks (job created, inspection failed) go to the signed `/hooks/task` endpoint.
- Write actions (e.g. reassign cleaner) only after a separate review, as approval-gated tools with idempotency keys.

## M4 — Authorized website workflows (≈2 weeks per site class)
- Move the browser into a separate container with no DB or secret access. It gets work over a queue and returns screenshots and text.
- Per-site workflows (e.g. supplier portal order status, licensing portal checks), each with an explicit allowlist, a step script, screenshots at each step, and approval before any submit.
- Logged-in sites: use official APIs or OAuth where they exist. Otherwise use a human-in-the-loop session where you log in yourself and the agent never sees or stores the password. MFA and CAPTCHA are never bypassed.

## M5 — More specialist agents
- `finance` (invoices, receivables follow-ups; payments always approval-gated), `sales` (proposals, lead follow-up), `personal_admin` (personal scope only).
- A `delegate_task` tool lets the chief of staff hand subtasks to specialists. `tasks.parent_task_id` already exists.
- Optional: a small web dashboard for the audit log, tasks, and approvals.

## Acceptance criteria that apply to every milestone
- No plaintext secrets in source code or logs.
- Every side effect visible to the outside world is approval-gated, audited, and idempotent or marked `outcome_unknown`.
- New tools ship with unit tests, and with integration tests where an API can be faked.
- An integration isn't marked "working" until it has been authenticated and exercised live.

# LYONS AI: Architecture (handoff summary)

This is a summary for a new engineering owner. The detailed design is in `docs/ARCHITECTURE.md`. The opportunity engine is in `docs/OPPORTUNITIES.md`, communications in `docs/COMMUNICATIONS.md`, the receptionist in `docs/RECEPTIONIST.md`, Apple devices in `docs/APPLE_AND_DEVICE.md`, and the threat model in `docs/THREAT_MODEL.md`.

## Components

| Component | Where | Role |
|---|---|---|
| `lyons-ai` service | `src/index.ts` → `src/app.ts` | One Node 22 process: Telegram bot, HTTP server, task worker, opportunity scheduler |
| Telegram bot | `src/telegram/bot.ts` (grammY, long-polling) | Owner-only command interface and approval buttons; replies only to `TELEGRAM_OWNER_USER_ID` |
| HTTP server | `src/http/server.ts` (Fastify) | `/healthz`, `/oauth/google/callback`, signed `/hooks/*` (n8n), `/voice/*` (Twilio, signature-checked), `/bridge/*` (Mac bridge, HMAC), `/control` (Control Center) |
| Worker and TaskRunner | `src/core/worker.ts`, `src/core/runner.ts` | Durable agent loop: Postgres-leased tasks, append-only transcript, safe resume, approvals, budgets, timeouts, kill-switch checkpoints |
| Policy engine | `src/core/policy.ts` | Deterministic allow / require-approval / deny by tool risk, task scope, data class and module pause |
| LLM client | `src/core/llm.ts` | Claude (`CLAUDE_MODEL`, default `claude-opus-5-5`), adaptive thinking, effort, prompt caching, server-side fallbacks |
| Store | `src/db/store.ts`, `src/opportunities/store.ts`, `migrations/001–006` | All SQL. Migrations run at startup (`src/db/migrate.ts`). |
| Security | `src/security/` | AES-256-GCM secret box (`MASTER_ENCRYPTION_KEY`), webhook HMAC with timestamp, untrusted-content wrapping |
| Opportunity scheduler | `src/opportunities/scheduler.ts` | 7 AM / 7 PM America/Detroit cycles, advisory locks, retries, dead letters, circuit breaker |
| n8n | `docker-compose.yml`, `deploy/n8n/` | Cron for executive briefings, posted to signed `/hooks/briefing`; event-driven `/hooks/task` |
| Caddy | `deploy/Caddyfile` | TLS. Only public paths: the OAuth callback and `/voice/*`. |
| Mac bridge (optional) | `deploy/macos-bridge/*.py` | Runs on the owner's Mac. Reads and sends iMessages (sending needs approval) and scans storage. Talks to `/bridge/*` with HMAC. |

## Agents (`src/agents/index.ts`)
| Agent | Purpose | Data access |
|---|---|---|
| `chief_of_staff` (default) | Email, calendar, memory, clients, briefings | All classes for its scope |
| `operations` | Business operations and StayOps read | Business |
| `opportunity_analyst` | Opportunity pipeline | Public, business, financial and the classes carried by mail and memory |
| `software_engineer` | StayOps engineering reporting | **public and business_internal only**, with no client or personal data |

## Tools and risk classes
A risk of `external_communication`, `destructive`, `financial`, `permissions` or `legal` **always requires owner approval** (`src/core/types.ts`).

| Risk | Tools |
|---|---|
| read | gmail_search, gmail_read, calendar_list_events, calendar_find_conflicts, browser_page_snapshot, stayops_list, memory_search, client_timeline, client_followups, client_identity_review, opportunity_search, storage_report |
| write_internal | gmail_create_draft, memory_save, send_progress_update, client_upsert, clients_sync, comms_policy_propose, gmail_cleanup_scan, gmail_cleanup_revert, opportunity_update, opportunity_profile_update, opportunity_research_now |
| external_communication (approval) | calendar_create_event, gmail_send_draft, imessage_send, gmail_unsubscribe, receptionist_knowledge_update |
| destructive (approval) | memory_forget, gmail_cleanup_apply (archive or trash only, reversible), storage_trash_duplicates (moves to Trash) |

## Data flow
```
Owner (Telegram / Control Center) ─┐
n8n cron or event (HMAC)          ─┼─▶ tasks (queued) ─▶ Worker lease ─▶ TaskRunner
Twilio call (/voice, signed)       │                         │
Mac bridge (/bridge, HMAC)        ─┘                         ├─▶ Claude (messages API)
                                                             ├─▶ policy: allow → tool.run
                                                             │           approve → Telegram buttons → approvals → resume
                                                             │           deny → error back to model
                                                             └─▶ tool_calls, audit_log (append-only), spend_ledger
Opportunity scheduler (in-process, 1-min tick) ─▶ registry sources ─▶ verify ─▶ score ─▶ Postgres ─▶ Telegram briefs and alerts
```

## Memory system
- **Durable task memory:** `task_messages` holds the full append-only transcript, so a task resumes after a restart or approval without repeating model calls.
- **Long-term memory:** the `memories` table (`kind`, `subject`, `content`, `scope`, `source`), via `memory_save`, `memory_search` and `memory_forget` (which needs approval).
  - Core memories for the scope go into the system prompt.
  - Memories the agent saved itself are marked **untrusted** when recalled.
- **Domain state:**
  - clients and their identities and events
  - opportunities and their evidence, scores and history
  - the cleanup plans and their items
  - receptionist calls
  - settings, including the opportunity profile, scoring and allocation

## Integrations: status
| Integration | Mechanism | Status |
|---|---|---|
| Telegram | Bot API long-polling | Implemented; **not tested against real Telegram** |
| Claude | Anthropic SDK | Implemented; **no live call made** (no key in the build environment) |
| Google Gmail, Calendar, Contacts | OAuth 2.0 with separate business and personal grants, tokens encrypted | Implemented; **not authenticated** |
| StayOps | `src/integrations/stayops/stayops.ts`, read-only plus optional `createTask` | **Not connected.** It codes against a *proposed* REST contract (`docs/STAYOPS_INTEGRATION.md`) that the real `richlik1/stay-pro-ops` app does **not** expose. See `TASKS.md` P1. |
| Grants.gov, SAM.gov, GitHub | Official public APIs | Implemented with fixtures; **live calls blocked in the build sandbox** |
| Web research | Claude `web_search` server tool with per-source `allowed_domains` | Implemented; not run live |
| Twilio receptionist | TwiML webhooks with signature validation | Prototype; not run on a real call |
| iMessage, Mac storage | Python bridge on the owner's Mac | Prototype; not run on macOS |
| WhatsApp, Slack, Instagram | — | **Not implemented.** Owner discussed; see `TASKS.md` P2. |

## Deployment architecture
- One Ubuntu 24.04 VM (2 vCPU, 4 GB RAM) running Docker Compose with `lyons-ai`, `postgres:16`, `n8n` and `caddy`.
- `deploy/setup.sh` performs a one-step install: it prompts for the Telegram token, owner id and Claude key, generates all other secrets into a `chmod 600` `.env`, uses an `<ip>.sslip.io` hostname, sets up the ufw firewall, and runs `docker compose up -d --build`.
- Postgres is never published. n8n listens on `127.0.0.1:5678` (reach it by SSH tunnel). `lyons-ai` listens on `127.0.0.1:8080`, and Caddy is public on 80 and 443.
- Backups: a nightly `pg_dump` encrypted off-box (`docs/DEPLOYMENT.md` §5, `docs/RECOVERY.md`).
- Monthly cost estimates are in `docs/COSTS.md`: about $24 for the VM, plus Claude usage limited by `DAILY_SPEND_LIMIT_USD`.

## Database tables (migrations 001–006)
- **Core:** settings, tasks, task_messages, tool_calls, approvals, audit_log, memories, oauth_credentials, oauth_states, spend_ledger, browser_runs, scheduled_runs
- **Opportunities:** opportunities, opportunity_events, research_runs, research_sources, opportunity_evidence, opportunity_scores, opportunity_status_history, opportunity_actions, user_feedback, research_costs, notification_history (renamed from notification_log)
- **Communications:** clients, client_identities, identity_suggestions, client_events, outbound_messages, automation_policies
- **Gmail cleanup:** cleanup_plans, cleanup_items, unsubscribe_candidates
- **Receptionist, device:** calls, storage_reports, storage_actions

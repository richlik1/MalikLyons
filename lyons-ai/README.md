# LYONS AI — Autonomous Personal Chief of Staff

A self-hosted AI agent for the owner of Lyons Cleaning Solutions LLC / StayOps, controlled from Telegram on iPhone. It reads and drafts email, manages the calendar, reviews operations, remembers clients and preferences, runs morning and evening briefings, and asks for your approval before anything leaves the building.

> **Status:** MVP code complete and tested (75 automated tests, including real PostgreSQL and real headless Chromium). The live integrations (Claude, Telegram, Google, StayOps) are **not yet authenticated**; see [`docs/STATUS.md`](docs/STATUS.md).

## What it does today
- **Telegram control:** send any request in plain English and it becomes a task with progress updates and a completion report. Only your Telegram user id is accepted.
- **Email (Gmail):** search, read, summarise, and save reply **drafts**. Nothing is sent.
- **Calendar:** list events, find conflicts, and create events (approval required, since invites email people).
- **Memory:** clients, projects, goals, preferences (`/remember …` or just tell it).
- **Briefings:** morning and evening, triggered by n8n on a schedule, once per day.
- **Browser:** an isolated, read-only "page snapshot" of allowlisted sites, with screenshots. It stops at logins, MFA, and CAPTCHAs.
- **StayOps:** read-only adapter for turnovers, jobs, and inspections, ready once a scoped API exists.
- **Safety:** approval gates, kill switch (`/pause`), daily and per-task spend limits, timeouts, crash-safe resume without duplicate actions, append-only audit log, encrypted OAuth tokens, business/personal separation, and prompt-injection containment.

## Telegram commands
`/status` `/tasks` `/task <id>` `/cancel <id>` `/approvals` `/brief morning|evening [personal]` `/personal <request>` `/agent <name> <request>` `/agents` `/remember <kind> <subject>: <details>` `/connect_google business|personal` `/disconnect_google …` `/pause` `/resume` `/help`

## Docs
| Doc | Contents |
|---|---|
| [Architecture](docs/ARCHITECTURE.md) | Components, request lifecycle, resume semantics, how to add specialist agents/tools |
| [Threat model](docs/THREAT_MODEL.md) | Threats, mitigations, approval rules |
| [Milestones](docs/MILESTONES.md) | M1 (this) → M5 roadmap |
| [Costs](docs/COSTS.md) | Estimated monthly costs |
| [Setup](docs/SETUP.md) | Creating the Telegram bot, Anthropic key, Google OAuth client |
| [Deployment](docs/DEPLOYMENT.md) | VM + Docker Compose + n8n + operations |
| [StayOps](docs/STAYOPS_INTEGRATION.md) | Proposed read-only API contract |
| [Status](docs/STATUS.md) | What's verified vs. pending live credentials |

## Quick start (development)
```bash
npm ci
cp .env.example .env            # fill in; see docs/SETUP.md
npm run dev                     # needs DATABASE_URL to a Postgres 16 database
npm test                        # unit tests; set TEST_DATABASE_URL for integration tests
```

Production: `docker compose up -d --build` (see [Deployment](docs/DEPLOYMENT.md)).

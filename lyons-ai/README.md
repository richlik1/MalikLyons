# LYONS AI — Autonomous Personal Chief of Staff

A self-hosted AI agent for the owner of Lyons Cleaning Solutions LLC / StayOps, controlled from Telegram on iPhone. It reads and drafts email, manages the calendar, reviews operations, remembers clients and preferences, runs morning and evening briefings, and asks for your approval before anything leaves the building.

> **Status:** v0.2 code complete and tested (163 TypeScript tests including real PostgreSQL and headless Chromium, plus 13 Python tests for the Mac bridge). The live integrations (Claude, Telegram, Google, StayOps) are **not yet authenticated**; see [`docs/STATUS.md`](docs/STATUS.md).

## What it does today
- **Telegram control:** send any request in plain English and it becomes a task with progress updates and a completion report. Only your Telegram user id is accepted.
- **Email (Gmail):** search, read, summarise, and save reply **drafts**. Nothing is sent.
- **Calendar:** list events, find conflicts, and create events (approval required, since invites email people).
- **Memory:** clients, projects, goals, preferences (`/remember …` or just tell it).
- **Briefings:** morning and evening, triggered by n8n on a schedule, once per day.
- **Browser:** an isolated, read-only "page snapshot" of allowlisted sites, with screenshots. It stops at logins, MFA, and CAPTCHAs.
- **StayOps:** read-only adapter for turnovers, jobs, and inspections, ready once a scoped API exists.
- **Safety:** approval gates, kill switch (`/pause`), daily and per-task spend limits, timeouts, crash-safe resume without duplicate actions, append-only audit log, encrypted OAuth tokens, business/personal separation, and prompt-injection containment.

### v0.2 modules
- **Opportunity Intelligence:** a background engine that finds grants, contracts, local RFPs, programs and ideas. Each one is verified against an authoritative source, scored against your profile, and reported only when it's worth your time (daily, weekly, and rare urgent alerts). Live demo: `npm run opp:demo`.
- **Control Center:** a dashboard with an emergency stop, per-module pauses, approvals, actions, automations, communications, cleanup and storage recommendations, and calls.
- **Communications hub:** client timelines across Gmail, Calendar, Contacts, iMessage (Mac bridge) and calls; confidence-checked identity matching; unanswered-request detection; draft-first replies; sends need approval unless you activate a narrow automation policy.
- **Gmail cleanup:** classifies mail, protects financial, legal, receipt, invoice and client mail, archives reversibly, trashes only if you opt in, uses one-click unsubscribe with approval, and never deletes permanently.
- **AI receptionist** (Twilio): discloses that it's an AI, transcribes the call, escalates emergencies to your phone, and never states prices, availability or commitments.
- **Apple and storage:** honest capability map, plus a duplicate-file assistant on your Mac that only moves files to the Trash, after your approval.

## Telegram commands
`/status` `/tasks` `/task <id>` `/cancel <id>` `/approvals` `/brief morning|evening [personal]` `/personal <request>` `/agent <name> <request>` `/agents` `/remember <kind> <subject>: <details>` `/connect_google business|personal` `/disconnect_google …` `/pause` `/resume` `/help`
v0.2: `/opps` `/opp <id>` `/opp_done <id> <result>` `/profile` `/followups` `/identities` `/identity <id> yes|no` `/policies` `/policy_activate <id>` `/policy_revoke <id>` `/cleanup` `/modules` `/pause_module <name>` `/resume_module <name>`

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
| [Opportunities](docs/OPPORTUNITIES.md) | Opportunity Intelligence engine |
| [Communications](docs/COMMUNICATIONS.md) | Client timeline, sending policies, Gmail cleanup, iMessage bridge |
| [Receptionist](docs/RECEPTIONIST.md) | Twilio evaluation, call flow, compliance, costs |
| [Apple & storage](docs/APPLE_AND_DEVICE.md) | What's possible on iPhone/Mac/iCloud; storage assistant |
| [Recovery](docs/RECOVERY.md) | What to do when something goes wrong |
| [Status](docs/STATUS.md) | What's verified vs. pending live credentials |

## Quick start (development)
```bash
npm ci
cp .env.example .env            # fill in; see docs/SETUP.md
npm run dev                     # needs DATABASE_URL to a Postgres 16 database
npm test                        # unit tests; set TEST_DATABASE_URL for integration tests
```

Production: `docker compose up -d --build` (see [Deployment](docs/DEPLOYMENT.md)).

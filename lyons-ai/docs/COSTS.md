# LYONS AI — Estimated Monthly Costs

These are estimates for planning. They are **not** measured from your usage; real numbers will come from the `spend_ledger` table once the agent is live. Prices are list prices as of October 2026; check current pricing before committing.

## Claude API (largest variable cost)

Model: **Claude Opus 5.5** at $4 per million input tokens and $20 per million output tokens. Cache reads cost $0.20 per million; 5-minute cache writes cost about 1.25× input. The system prompt, tool definitions, and the growing task transcript are all prompt-cached.

| Task type | Typical shape | Est. cost per task |
|---|---|---|
| Quick question / single lookup | 1–2 model turns, ~8–15K input, ~1K output | $0.03 – $0.08 |
| Email triage + 1–2 drafts | 4–6 turns, ~40–80K input (mostly cached), ~3–5K output | $0.10 – $0.30 |
| Morning/evening briefing | 5–8 turns across calendar, email, StayOps | $0.15 – $0.45 |
| Browser page snapshot task | 2–3 turns + up to 15K chars of page text | $0.05 – $0.15 |

| Usage profile | Assumptions | Claude / month |
|---|---|---|
| Light | 2 briefings/day + 5 ad-hoc tasks/day | **$20 – $45** |
| Moderate | 2 briefings/day + 15 tasks/day | **$45 – $100** |
| Heavy | 2 briefings/day + 40 tasks/day, long email threads | **$120 – $250** |

**Built-in caps:** `DAILY_SPEND_LIMIT_USD=5` (at most about $150/month) and `TASK_SPEND_LIMIT_USD=1`. Also set a hard monthly limit in the Anthropic Console.

**Levers, in order:**
1. Caching (already on).
2. `CLAUDE_EFFORT=low` for routine work. The default is `medium`.
3. Narrower briefings.
4. A cheaper model for simple routes. This is a quality trade-off; measure it first.

## Infrastructure

| Item | Option | Monthly |
|---|---|---|
| VM (2 vCPU, 4 GB RAM, 40–80 GB SSD) | Hetzner CPX21/CX32 ≈ $8–12 · DigitalOcean/Lightsail 4 GB ≈ $20–24 · GCP e2-medium ≈ $25–30 | **$8 – $30** |
| PostgreSQL | Self-hosted in Compose (included). Managed alternative: $15–30 | $0 (or $15–30) |
| n8n | Self-hosted Community Edition | $0 |
| Backups | Object storage (B2/S3/R2) + VM snapshots | $1 – $5 |
| Domain + TLS | Domain ≈ $12/yr. TLS free (Caddy / Let's Encrypt) | ≈ $1 |
| Telegram Bot API | Free | $0 |
| Google Gmail / Calendar / Drive APIs | Free within quotas (uses your existing Google accounts) | $0 |
| StayOps API | Your own platform | $0 marginal |
| Secret manager (optional, M2) | GCP Secret Manager / AWS SM | < $2 |

## Expansion modules (v0.2)

| Item | Monthly | Notes |
|---|---|---|
| Opportunity web research (Claude + web search) | ≤ $45 | Hard cap `OPP_DAILY_RESEARCH_BUDGET_USD` = $1.50/day; Grants.gov and SAM.gov APIs are free |
| AI receptionist (Twilio) | ≈ $10–25 at ~100 calls/mo | Number ≈ $1–2, minutes and speech recognition a few cents per minute, Claude ≈ $0.01–0.05 per call; check twilio.com/pricing |
| Mac for the iMessage/storage bridge | $0 if you use your Mac; ≈ $600 one-time for a Mac mini | Needs to stay awake for iMessage |
| Tailscale (private Mac ↔ VM link) | $0 (personal plan) | |
| iOS companion app (optional, later) | $99/yr | Apple Developer Program |
| Gmail cleanup, client timeline, Control Center | $0 extra | Uses existing Google APIs and the VM |

## Total

| Profile | Monthly total |
|---|---|
| Light (core only) | **≈ $30 – $80** |
| Moderate | **≈ $55 – $135** |
| Heavy | **≈ $130 – $290** (capped by your spend limits) |

## Not included
- Google Workspace seats, which you already pay for.
- Your time for initial setup, about 1–2 hours following `docs/SETUP.md`.
- Optional managed services: managed Postgres, or n8n Cloud at about $20+/month if you don't want to self-host it.

With all v0.2 modules on (opportunity research at its cap, ~100 receptionist calls), add roughly **$25–70/month**, plus the optional one-time Mac mini.

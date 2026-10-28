# LYONS AI: engineering handoff

**Prepared:** 2026-10-28. **Receiving team:** Grok Build. **Status:** code complete for v0.3 and tested in a sandbox. **Not deployed. No live integration verified.**

> Do not merge, deploy, spend API credits or touch production data without the owner's explicit approval. Read `AGENTS.md` before changing anything.

## 1. Where the code is
| Item | Value |
|---|---|
| Repository | `https://github.com/richlik1/MalikLyons` (**public**, see TASKS P0-6) |
| Project folder | `lyons-ai/` (everything for LYONS AI lives here) |
| Active branch | `claude/lyons-ai-agent-tks9og`. All LYONS AI work is here and **has never been merged to `main`**. |
| Review PR | Opened from `claude/lyons-ai-agent-tks9og` into `main` together with this handoff. **Do not merge without owner approval.** |
| Commits (oldest first) | `7c708ed` MVP core · `0f75559` opportunities, Control Center, module pauses · `b2b0bf0` communications hub, Gmail cleanup, receptionist, Mac bridge, storage · `133800a` Opportunity Intelligence Department · `81229aa` one-step `deploy/setup.sh` · plus this handoff commit |
| Uncommitted changes | **None.** At handoff, `git status` was clean on the branch. |

### Other branches in the repository (not part of LYONS AI; leave untouched)
| Branch | Content |
|---|---|
| `main` (`6513def`, 2026-08-05) | Only an uploaded `Understanding Uploaded File Content.zip` (TrendSet UI and schema files). No LYONS AI code. |
| `gh-pages` | Deployed "My Library" web app |
| `claude/my-library-audiobook-app-xfi4ne` | My Library offline audiobook PWA plus iOS app |
| `claude/trendset-research-strategy-tfpd30` | TrendSet research and try-on MVP |
| `claude/featured-music-go-up-81q19q` | Artist website |

The second repository attached to the original session, `paytriot45/Xcape-Key`, is an unrelated iOS app (FakeCallPro / Safe Swype). It has **no LYONS AI or StayOps code** and was not modified.

## 2. What works (verified in the build sandbox, 2026-10-28)
| Check | Result |
|---|---|
| `npm run typecheck` | ✅ clean |
| Unit and integration tests on Postgres 16 (`vitest`) | **174 passed, 1 failed, 5 skipped** (the skips need a real Chromium or optional services). The one failure is date-dependent (TASKS **P0-4**). It passed on 2026-10-15 and fails when the real date ≠ the test's fake date. |
| Python Mac bridge tests | ✅ 13/13 |
| `deploy/setup.sh` | ✅ syntax check passes, and a dry run writes `.env` with `chmod 600`. The Docker part has not run on a real VM. |
| Runner safety | Integration tests cover approvals executing exactly once, crash-safe resume with no duplicate side effects, the kill switch, spend limits, timeouts, the turn limit, scope separation, module pause, data-class restrictions, and an append-only audit log. |
| Opportunity department | 16 integration tests cover the full DISCOVERED→REPORTED chain, duplicate suppression, 7 AM/7 PM cycles, advisory locks, restart recovery, retry, dead letters and the circuit breaker, plus API caps and cost rows. |
| Live network run (sandbox) | Grants.gov and GitHub were blocked by sandbox egress. The system retried, dead-lettered, and reported honestly. **No real opportunity has been produced yet.** Logs are in `docs/demo/`. |

## 3. What is NOT verified (needs credentials or deployment)
- **Never run against the real services:** Telegram, the Claude API, Google OAuth (Gmail, Calendar, Contacts), SAM.gov, the Twilio receptionist, the Mac bridge on macOS, and StayOps.
- **Not built end to end:** the Docker runtime image (only the build stage was verified), and Caddy TLS on a real host.
- Full list and acceptance log: `docs/STATUS.md`.

## 4. Telegram commands (`src/telegram/bot.ts`)
| Command | Purpose |
|---|---|
| `/start`, `/help` | Help |
| `/status` | Health, spend, integrations |
| `/pause`, `/resume` | Kill switch |
| `/modules`, `/pause_module <name>`, `/resume_module <name>` | Module status and per-module pause |
| `/tasks`, `/task <id>`, `/cancel <id>` | Tasks |
| `/approvals` | Pending approvals (Approve and Reject buttons) |
| `/brief morning\|evening` | Executive briefing now |
| `/personal <request>` | Run a request in the personal scope |
| `/agents`, `/agent <name> <request>` | Specialist agents |
| `/remember <fact>` | Save a memory |
| `/connect_google business\|personal`, `/disconnect_google …` | Google OAuth |
| `/opps`, `/opp <id>`, `/opp_done <id> <result>`, `/profile` | Opportunity pipeline |
| `/sources`, `/source_enable <id>`, `/source_disable <id>`, `/opp_runs`, `/opp_costs`, `/opp_retry <job>` | Research operations |
| `/followups`, `/identities`, `/identity <id> yes\|no`, `/policies`, `/policy_activate <id>`, `/policy_revoke <id>` | Clients and owner-approved automation policies |
| `/cleanup` | Gmail cleanup scan, apply, revert |

Plain text messages become tasks for the `chief_of_staff` agent.

## 5. Architecture, tools, integrations, memory, approvals
See `ARCHITECTURE.md`, which covers the components, the four agents, all tools with their risk classes, the integration status table, data flow, the memory system, the deployment layout and the database tables.

## 6. Credentials required (names only; see `ENVIRONMENT.example`)
| Need | Variables | Who provides it |
|---|---|---|
| Minimum to run | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_OWNER_USER_ID`, `ANTHROPIC_API_KEY` | Owner (setup.sh asks for these) |
| Generated by setup.sh | `MASTER_ENCRYPTION_KEY`, `POSTGRES_PASSWORD`, `N8N_DB_PASSWORD`, `N8N_ENCRYPTION_KEY`, `WEBHOOK_SHARED_SECRET`, `CONTROL_CENTER_TOKEN`, `LYONS_DOMAIN`, `PUBLIC_BASE_URL` | Automatic |
| Optional | `GOOGLE_CLIENT_ID/SECRET`, `SAM_API_KEY`, `GITHUB_TOKEN`, `STAYOPS_API_BASE_URL/TOKEN`, `TWILIO_AUTH_TOKEN`, `OWNER_PHONE`, `MAC_BRIDGE_SECRET` | Owner |

**No credentials exist in this repository, and none were handed over.** No credentials have been issued yet: the owner has not created the Telegram bot, Anthropic key, VM or Google client.

## 7. Server requirements
- Ubuntu 24.04 VM with 2 vCPU, 4 GB RAM and 40 GB disk, such as a DigitalOcean 4 GB droplet (about $24/month).
- Docker Engine with the Compose plugin; `setup.sh` installs it from get.docker.com.
- Outbound HTTPS to `api.anthropic.com`, `api.telegram.org`, Google APIs, `api.grants.gov`, `api.sam.gov`, `api.github.com`, plus the registry domains.
- Inbound: 80 and 443 only. `lyons-ai` is on `127.0.0.1:8080`; n8n is on `127.0.0.1:5678` and is reached by SSH tunnel.
- Optional: an always-on Apple Silicon Mac for the iMessage and storage bridge.

## 8. Decisions already made (don't re-litigate without the owner)
1. **Manual agent loop with state in Postgres**, not an SDK tool runner. Approvals pause for hours and survive restarts.
2. **Approval is a property of the tool's risk class**, enforced in code. The model can only *propose*.
3. **Telegram long-polling.** The only public endpoints are the OAuth callback and the signed `/voice/*`.
4. **StayOps is read-only from LYONS AI.** No StayOps production code is modified from here.
5. **Official sources only for opportunities.** Login-gated portals are read through their official alert emails, and nothing is fabricated.
6. **Declined:**
   - an unrestricted or "uncensored" agent with host shell access over WhatsApp
   - unofficial WhatsApp Web bots
   - Instagram mass-unfollow automation
   - iPhone takeover
   - CAPTCHA or MFA bypass

## 9. Next exact actions
1. **Owner:** create the Telegram bot (@BotFather), get the Telegram user id (@userinfobot), get an Anthropic key with billing, and create the VM (TASKS P0-1).
2. **Owner, with Grok Build guiding:** on the VM, run `git clone -b claude/lyons-ai-agent-tks9og https://github.com/richlik1/MalikLyons.git && cd MalikLyons/lyons-ai && sudo bash deploy/setup.sh`, then send `/status` in Telegram.
3. **Grok Build:** fix P0-4 (the clock in `apiCallsToday`) in a PR, with the full suite green on Postgres.
4. **Grok Build:** verify the live Claude request shape (P0-2), then run the live opportunity demo (P0-5) on the VM. Record the results in `docs/STATUS.md`.
5. **Owner:** connect Google (P0-3) and decide repository visibility (P0-6).
6. **Grok Build:** propose the real StayOps read-only contract (P1-1) as a PR in `richlik1/stay-pro-ops`, coordinated with the StayOps handoff there.

## 10. Instructions for Grok Build
- Clone with `git clone -b claude/lyons-ai-agent-tks9og https://github.com/richlik1/MalikLyons.git`. Work in `lyons-ai/`. Create your own feature branches **from this branch** and open PRs **into this branch** until the owner approves merging it to `main`.
- Local test setup: Node 22 and Postgres 16. Then run `npm ci`, `createdb lyons_test`, and `TEST_DATABASE_URL=postgres://…/lyons_test npm test`. See the Commands section of `AGENTS.md`.
- Follow `AGENTS.md`. Most importantly:
  - never weaken approval gates or risk classes
  - never commit secrets or real personal data
  - never claim an integration works without live evidence
  - never merge or deploy without the owner
- Work through `TASKS.md` in priority order. Each PR should name the task id and paste real test output.

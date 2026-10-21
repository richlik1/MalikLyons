# LYONS AI — Deployment

Target: one small Linux VM (Ubuntu 24.04, 2 vCPU / 4 GB RAM) running Docker Compose with four services: `lyons-ai`, `postgres`, `n8n`, and `caddy`.

## 1. Provision the VM
1. Create the VM (Hetzner, DigitalOcean, Lightsail, or GCP; see `COSTS.md`). Use SSH-key login only.
2. Create a DNS **A record** for your agent domain (e.g. `agent.lyonscleaning.com`) pointing at the VM.
3. Harden the host:
   ```bash
   sudo apt update && sudo apt -y upgrade
   sudo apt -y install ufw unattended-upgrades fail2ban
   sudo ufw default deny incoming && sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw enable
   sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config && sudo systemctl restart ssh
   ```
4. Install Docker Engine and the Compose plugin: https://docs.docker.com/engine/install/ubuntu/

## 2. Install
**Easiest:** after cloning, run `sudo bash deploy/setup.sh`. It asks for your Telegram token, your Telegram user id and your Claude key, generates every other secret, writes `.env` (`chmod 600`), opens the firewall for SSH, 80 and 443, and starts everything. It uses a free `<ip>.sslip.io` hostname, so you don't need to buy a domain.

Manual steps:
```bash
git clone https://github.com/richlik1/MalikLyons.git && cd MalikLyons/lyons-ai
cp .env.example .env && chmod 600 .env    # fill in per docs/SETUP.md
docker compose up -d --build
docker compose logs -f lyons-ai           # expect "telegram bot started" and "http server listening"
```

Migrations run automatically at startup. Database tables are created on first boot.

## 3. Network exposure
| Service | Exposure |
|---|---|
| Caddy | Ports 80/443 public. Serves **only** `/oauth/google/callback`; everything else returns 404. TLS is automatic. |
| lyons-ai | `127.0.0.1:8080` on the host, plus the internal Docker network. Telegram uses outbound long-polling, so no inbound port is needed. |
| n8n | `127.0.0.1:5678` only. Open the editor via SSH tunnel: `ssh -L 5678:localhost:5678 you@vm`, then browse to http://localhost:5678 |
| Postgres | Internal network only. Never published. |

## 3b. Public paths (Caddy)
Public: `/oauth/google/callback` and `/voice/*` (Twilio; signature-checked). Everything else is private.
- **Control Center:** reach it via SSH tunnel or Tailscale (`/control`).
- **Mac bridge:** connect the Mac to the VM over Tailscale and set `LYONS_BASE_URL=http://<vm-tailscale-ip>:8080`. Only if that's impossible, uncomment `/bridge/*` in `deploy/Caddyfile`.

## 4. n8n scheduled briefings
1. Open the n8n editor through the tunnel and create the owner account.
2. **Workflows → Import from file →** `deploy/n8n/lyons-briefings.workflow.json`.
3. Check the times (07:00 and 18:30) and the workflow timezone, then toggle **Active**.
4. The Code nodes sign each request with `WEBHOOK_SHARED_SECRET`. Compose passes it to n8n as `LYONS_WEBHOOK_SECRET`. The HTTP node posts to `http://lyons-ai:8080/hooks/briefing`.
5. **Event-driven tasks:** any n8n workflow can POST a signed JSON body `{ "instruction": "...", "payload": {...}, "scope": "business", "dedupe_key": "..." }` to `/hooks/task`. Copy the signing Code node. `payload` is always treated as untrusted data.

Briefings are idempotent per day: if n8n retries, it won't create a duplicate.

## 4b. Opportunity Intelligence: activate the 7 AM and 7 PM schedules

These cycles run **inside the `lyons-ai` process**, not in n8n. They are durable: they are recorded in Postgres, guarded by advisory locks, and caught up after a restart.

1. **Set these in `.env`:**
   ```
   TIMEZONE=America/Detroit
   OPP_ENABLED=true
   OPP_MORNING_HOUR=7
   OPP_EVENING_HOUR=19
   OPP_WEB_UNITS_PER_CYCLE=3
   OPP_MAX_ALERTS_PER_DAY=2
   OPP_DAILY_RESEARCH_BUDGET_USD=1.5
   ANTHROPIC_API_KEY=...                 # web research (the 30/20/15/15/10/10 departments)
   SAM_API_KEY=...                       # sam.gov → Account Details → Public API Key
   GITHUB_TOKEN=...                      # optional; fine-grained token with no scopes
   TELEGRAM_BOT_TOKEN=... TELEGRAM_OWNER_USER_ID=...
   ```
2. **Allow outbound HTTPS** from the VM to:
   - `api.grants.gov`, `www.grants.gov` and `api.sam.gov`
   - `api.github.com`
   - `api.anthropic.com` and `api.telegram.org`
   - plus the registry domains: `michigan.gov`, `detroitmi.gov`, `sba.gov`, `michiganbusiness.org`, `michigansbdc.org`, `buildingdetroit.org`, `eventbrite.com`, and the rest of the `domains` lists in `src/opportunities/registry.ts`

   A default VM allows all of these. Only egress-filtered hosts need the list.
3. **Restart** with `docker compose up -d`. Then check the logs (`docker compose logs lyons-ai | grep -i opportunit`) and `curl -s localhost:8080/healthz | jq .opportunities`. `schedulerLastTick` should update every minute.
4. **Verify once by hand before the first scheduled run:**
   ```bash
   docker compose exec lyons-ai node dist/scripts/opportunity-demo.js
   ```
   Expect `discover:grants_gov` with status `succeeded` and at least one stored, verified Grants.gov record, with its stage history and prepared checklist. If it shows `network error`, fix egress (step 2).
5. **Optional: connect alert emails.**
   - Michigan SIGMA VSS: register at https://www.michigan.gov/dtmb/procurement/contractconnect/how-to-register and pick your commodity codes.
   - City of Detroit: register as a supplier at https://detroitmi.gov/supplier (Bonfire).
   - Then run `/connect_google business` in Telegram. Until Google is connected, these two sources show as *skipped*, not failed.
6. **Set your profile** in Telegram: `/profile`, then answer the listed gaps. Examples: "I'm registered in SAM.gov", "max upfront $5,000", "10 hours a week". Eligibility scoring depends on it.
7. **Confirm in Telegram:**
   - `/sources` shows all sources as enabled.
   - The 🌅 Morning brief arrives after 07:00 and the 🌙 Evening review after 19:00.
   - `/opp_runs` shows one succeeded run per job per slot.
8. **Two messages at 7 AM:** the n8n executive briefing (section 4) and the opportunity brief are separate. If you prefer one, move the n8n morning time, e.g. to 07:15.

To pause: `/pause` (everything) or the Control Center's `opportunities` module toggle. To turn the schedules off: `OPP_ENABLED=false`, then restart.

## Final deployment checklist
- [ ] VM provisioned, DNS A record set, host hardened (section 1)
- [ ] `.env` filled in and `chmod 600`. `MASTER_ENCRYPTION_KEY` generated and backed up offline.
- [ ] `docker compose up -d --build` is healthy: `/healthz` returns ok and migrations through `006` have been applied
- [ ] Telegram: `/status` replies only to your user id
- [ ] Google business and personal connected; the Gmail draft and calendar checks in `STATUS.md` pass
- [ ] Opportunity demo stored a real verified record (section 4b, step 4). Record it in `STATUS.md`.
- [ ] First 07:00 Morning brief and 19:00 Evening review received
- [ ] Approval path tested: tapping Reject causes no external action
- [ ] Kill switch tested: `/pause` stops running work and `/resume` continues it
- [ ] Nightly encrypted `pg_dump` cron in place, with one restore tested
- [ ] n8n editor reachable only via SSH tunnel. Control Center reachable only via tunnel or Tailscale.

## 5. Operations
| Task | Command |
|---|---|
| Status | `/status` in Telegram, or `curl -s localhost:8080/healthz` |
| Emergency stop (soft) | `/pause` in Telegram |
| Emergency stop (hard) | `docker compose stop lyons-ai` |
| Logs | `docker compose logs -f --since 1h lyons-ai` |
| Update | `git pull && docker compose up -d --build` (in-flight tasks resume after restart) |
| Backup DB | `docker compose exec -T postgres pg_dump -U lyons lyons \| gzip > lyons-$(date +%F).sql.gz` (encrypt, e.g. with `age`, before copying off-box) |
| Restore DB | `gunzip -c file.sql.gz \| docker compose exec -T postgres psql -U lyons lyons` |
| Audit trail | `docker compose exec postgres psql -U lyons -c "select at, actor, event, details from audit_log order by id desc limit 50"` |
| Browser screenshots | Docker volume `lyons-ai_artifacts` → `/data/artifacts/browser/<run-id>/` |
| Rotate webhook secret | Change `WEBHOOK_SHARED_SECRET` in `.env`, then `docker compose up -d` (n8n picks it up via env) |
| Revoke Google access | `/disconnect_google business` (also revokes the token at Google) |

Schedule a nightly backup with cron and keep 14 days. Test a restore once.

## 6. Running without Docker (development)
```bash
npm ci
createdb lyons && export DATABASE_URL=postgres://localhost/lyons
cp .env.example .env   # fill in; for local dev, PUBLIC_BASE_URL=http://localhost:8080
npx playwright-core install chromium   # or set BROWSER_EXECUTABLE_PATH
npm run dev
```

## 7. Tests
```bash
npm test                                                  # unit tests (no services needed)
TEST_DATABASE_URL=postgres://localhost/lyons_test npm test # + Postgres integration tests (DESTROYS that DB's public schema)
BROWSER_EXECUTABLE_PATH=/path/to/chromium npm test         # + real-browser tests
npm run typecheck
```

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

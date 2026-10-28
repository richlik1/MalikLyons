#!/usr/bin/env bash
# One-step LYONS AI setup for a fresh Ubuntu server.
# Run from the lyons-ai folder:   sudo bash deploy/setup.sh
# Asks for 3 things (Telegram token, your Telegram user id, Claude API key),
# generates every other secret, writes .env (chmod 600), and starts the stack.
# SETUP_DRY_RUN=1 writes .env only (no Docker/firewall changes).
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31mError: %s\033[0m\n' "$*" >&2; exit 1; }
DRY="${SETUP_DRY_RUN:-0}"

[ -f .env.example ] || die "run this from the lyons-ai folder"
command -v openssl >/dev/null || die "openssl is missing (sudo apt install -y openssl)"

if [ -f .env ]; then
  read -r -p ".env already exists. Overwrite it? Existing secrets will be lost [y/N] " ow
  [[ "$ow" =~ ^[Yy]$ ]] || die "kept the existing .env; nothing changed"
fi

say "1/3  Telegram bot token (from @BotFather, looks like 123456:ABC...)"
read -r -s -p "> " TG_TOKEN; echo
[[ "$TG_TOKEN" =~ ^[0-9]+:[A-Za-z0-9_-]{30,}$ ]] || die "that doesn't look like a Telegram bot token"

say "2/3  Your Telegram user id (a number, from @userinfobot)"
read -r -p "> " TG_OWNER
[[ "$TG_OWNER" =~ ^[0-9]{4,15}$ ]] || die "the user id should be digits only"

say "3/3  Claude API key (from console.anthropic.com, starts with sk-ant-)"
read -r -s -p "> " ANTHROPIC_KEY; echo
[[ "$ANTHROPIC_KEY" == sk-ant-* ]] || die "that doesn't look like a Claude API key"

IP="${SETUP_PUBLIC_IP:-$(curl -fsS --max-time 10 https://api.ipify.org || true)}"
[[ "$IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || read -r -p "Server public IPv4 address: " IP
DOMAIN="${IP//./-}.sslip.io" # free hostname that points at this server, for HTTPS

cp .env.example .env
chmod 600 .env
setenv() { # key value: replace KEY=... line safely (values may contain any character)
  K="$1" V="$2" awk 'BEGIN{k=ENVIRON["K"]; v=ENVIRON["V"]} index($0, k"=")==1 {print k"="v; done=1; next} {print} END{if(!done) print k"="v}' .env >.env.tmp
  mv .env.tmp .env
  chmod 600 .env
}
setenv TELEGRAM_BOT_TOKEN "$TG_TOKEN"
setenv TELEGRAM_OWNER_USER_ID "$TG_OWNER"
setenv ANTHROPIC_API_KEY "$ANTHROPIC_KEY"
setenv MASTER_ENCRYPTION_KEY "$(openssl rand -base64 32)"
setenv POSTGRES_PASSWORD "$(openssl rand -hex 24)"
setenv N8N_DB_PASSWORD "$(openssl rand -hex 24)"
setenv N8N_ENCRYPTION_KEY "$(openssl rand -hex 32)"
setenv WEBHOOK_SHARED_SECRET "$(openssl rand -hex 32)"
setenv CONTROL_CENTER_TOKEN "$(openssl rand -hex 32)"
setenv LYONS_DOMAIN "$DOMAIN"
setenv PUBLIC_BASE_URL "https://$DOMAIN"
say "Wrote .env (only root can read it). Back up MASTER_ENCRYPTION_KEY somewhere safe and offline."

if [ "$DRY" = "1" ]; then say "Dry run: skipped Docker and firewall."; exit 0; fi

if ! command -v docker >/dev/null; then
  say "Installing Docker (official script from get.docker.com)..."
  curl -fsSL https://get.docker.com | sh
fi
if command -v ufw >/dev/null; then
  ufw allow OpenSSH >/dev/null && ufw allow 80,443/tcp >/dev/null && ufw --force enable >/dev/null
fi

say "Building and starting LYONS AI (first time takes 5-10 minutes)..."
docker compose up -d --build

say "Waiting for the agent to come up..."
for _ in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:8080/healthz >/dev/null 2>&1; then
    say "✅ LYONS AI is running. Open Telegram, find your bot, and send /status"
    echo "Logs:          docker compose logs -f lyons-ai"
    echo "Stop:          docker compose stop"
    echo "Google later:  see docs/SETUP.md (redirect URL: https://$DOMAIN/oauth/google/callback)"
    exit 0
  fi
  sleep 5
done
die "the agent didn't answer within 5 minutes. Run: docker compose logs --tail 80 lyons-ai"

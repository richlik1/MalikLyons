# LYONS AI — Setup (credentials and accounts)

All secrets go into `.env` **on the server**, never into source code, Telegram, or chat. Start from `.env.example`:

```bash
cp .env.example .env && chmod 600 .env
```

## 1. Generate local secrets

```bash
echo "MASTER_ENCRYPTION_KEY=$(openssl rand -base64 32)"
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
echo "N8N_DB_PASSWORD=$(openssl rand -hex 24)"
echo "WEBHOOK_SHARED_SECRET=$(openssl rand -hex 32)"
echo "N8N_ENCRYPTION_KEY=$(openssl rand -hex 32)"
```

Paste the output into `.env`. Store `MASTER_ENCRYPTION_KEY` in your password manager as well. If you lose it, you'll have to re-connect your Google accounts.

## 2. Telegram bot
1. In Telegram, open **@BotFather**, send `/newbot`, and pick a name (e.g. "LYONS AI") and a username.
2. Copy the token into `TELEGRAM_BOT_TOKEN`.
3. Open **@userinfobot** and copy your numeric id into `TELEGRAM_OWNER_USER_ID`. Only this id can control the agent.
4. Recommended: in BotFather run `/setjoingroups` and choose **Disable**. In Telegram settings, turn on **Two-Step Verification**.

## 3. Anthropic (Claude)
1. Go to https://console.anthropic.com → **API Keys** and create a dedicated key named `lyons-ai`.
2. Under **Billing → Limits**, set a monthly spend limit (see `docs/COSTS.md`).
3. Put the key in `ANTHROPIC_API_KEY`.

## 4. Google OAuth (Gmail and Calendar)
One OAuth client serves both accounts. You'll connect business and personal separately from Telegram.

1. Go to https://console.cloud.google.com and create a project named `lyons-ai`.
2. **APIs & Services → Library:** enable the **Gmail API** and **Google Calendar API**.
3. **OAuth consent screen:**
   - User type: **External**, unless both accounts are in your Workspace, in which case use Internal.
   - App name: LYONS AI. Use your email for support and developer contact.
   - Scopes: `openid`, `userinfo.email`, `gmail.readonly`, `gmail.compose`, `calendar.events`.
   - Test users: add **both** your business and personal Gmail addresses.
   - Publishing status: leaving it in **Testing** is fine for personal use. Note that in Testing mode Google expires refresh tokens after 7 days. To avoid weekly re-connects, move to **In production**. For an unverified personal app you'll see an "unverified app" warning that you can click through.
4. **Credentials → Create credentials → OAuth client ID:**
   - Application type: **Web application**.
   - Authorised redirect URI: `https://<LYONS_DOMAIN>/oauth/google/callback`. This must exactly match `PUBLIC_BASE_URL` + `/oauth/google/callback`.
5. Put the client id and secret into `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
6. After deployment, send `/connect_google business` in Telegram, open the link, and sign in with the **business** account. Repeat with `/connect_google personal`.

## 5. Browser allowlist (optional)
Set `BROWSER_ALLOWED_DOMAINS` to the sites the agent may open, e.g. `lyonscleaning.com,airbnb.com`. Subdomains are included. Leave it empty to disable the browser.

## 6. StayOps (optional, later)
See `docs/STAYOPS_INTEGRATION.md`. Leave `STAYOPS_*` empty until a read-only agent token exists.

## 7. First run checklist
- `/status` shows Claude key present, Telegram OK, and the kill switch off.
- `/connect_google business` succeeds, and `/status` then shows "connected (you@…)".
- Send "What's on my calendar today?" and check the answer against your real calendar.
- Send "Summarise my unread email from today".
- Send "Draft a reply to the latest email from <client> saying …", then check Gmail → Drafts.
- Send "Put a 15-minute test event on my calendar tomorrow at 9am". You should get an approval prompt. Approve it and confirm the event appears.
- `/pause` → "✅ Kill switch ON". `/resume`.
- In n8n, import the workflow, run it once manually, and confirm a briefing arrives.

Record each result in `docs/STATUS.md`.

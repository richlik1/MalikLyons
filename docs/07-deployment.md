# Deployment Instructions

Stack: **Next.js 15 on Vercel** + **Supabase** (Auth, Postgres, Storage) + **FASHN** or **Google Vertex AI**.

## 1. Supabase

1. Create a project at supabase.com. Pick the region closest to your shoppers (EU brands → an EU region).
2. **SQL editor:** run `app/supabase/migrations/0001_init.sql`. You can also use the CLI: `supabase link` then `supabase db push`. This creates the tables, RLS policies, triggers, views and the three storage buckets.
3. **Auth → URL configuration:**
   - set Site URL to `https://<your-domain>`
   - add redirect URL `https://<your-domain>/auth/callback` (and `http://localhost:3000/auth/callback` for development)
4. **Auth → Email:** keep magic link enabled. Configure custom SMTP before the pilot, because Supabase's built-in mailer is heavily rate-limited.
5. **Make yourself admin** after signing in once:
   ```sql
   update public.profiles set role = 'admin' where id = (select id from auth.users where email = 'you@example.com');
   ```
6. Copy the project URL, the anon key and the **service role key** (keep this one secret).

## 2. AI provider

**FASHN (recommended for the pilot)**
1. Create an API key at fashn.ai and buy a small credit pack, or Tier I.
2. Sign or review FASHN's data-processing terms. Confirm the output retention period.
3. Set `TRYON_PROVIDER=fashn`, `FASHN_API_KEY=…`, `FASHN_COST_PER_IMAGE_USD=0.075`. Use the effective rate for your tier.

**Google Vertex AI (benchmark/fallback)**
1. Enable the Vertex AI API in a GCP project. Create a service account with the `Vertex AI User` role.
2. Set:
   - `TRYON_PROVIDER=google-vertex`
   - `GOOGLE_CLOUD_PROJECT`
   - `GOOGLE_CLOUD_LOCATION=us-central1`
   - `GOOGLE_APPLICATION_CREDENTIALS_JSON` (the key JSON on one line), or use workload identity federation
3. ⚠️ `virtual-try-on-001` lists **retirement on 2027-03-15**. Do not make it the only provider.

## 3. Vercel

1. Import the repo. Set **Root Directory = `app`**.
2. Add the environment variables from `app/.env.example`:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`, `TRYON_PROVIDER` and the provider keys
   - `TRYON_LIMIT_PER_USER_PER_MINUTE`, `TRYON_LIMIT_PER_USER_PER_DAY`, `TRYON_GLOBAL_DAILY_BUDGET_USD`
   - `PERSON_PHOTO_RETENTION_DAYS`
   - `CRON_SECRET` (a long random string; Vercel sends it as `Authorization: Bearer` to cron routes)
3. Deploy. `vercel.json` schedules `/api/cron/purge` daily at 03:17 UTC.
4. `/api/try-on` sets `maxDuration = 120`. Make sure your Vercel plan allows functions to run that long.

## 4. Local development

```bash
cd app
cp .env.example .env.local   # fill in values
npm install
npm run dev                  # http://localhost:3000
npm test                     # unit tests
npm run typecheck
npm run build
```

Without Supabase variables, the landing page renders, but sign-in, upload and try-on show "not configured". Without a provider key, try-on shows "unavailable". **There is no fake fallback by design.**

## 5. Go-live checklist

- [ ] Migration applied; RLS verified. As a second test user, confirm you cannot read another user's `person_photos` or storage objects.
- [ ] A live smoke test generates one real image with your provider. Check the `/admin` log shows latency and cost.
- [ ] Budget cap set low (e.g. $20/day) for the pilot.
- [ ] Custom SMTP configured.
- [ ] Privacy page reviewed by counsel (BIPA/GDPR if you serve IL or EU shoppers).
- [ ] DPA signed with the AI vendor.
- [ ] Cron purge tested: `curl -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/purge`
- [ ] At least one merchant product uploaded with an https purchase URL.

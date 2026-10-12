-- 0002: findings from the cross-tenant integration tests (tests/integration/tenancy.int.test.ts).
--
-- F1  Shoppers could read internal cost/provider data: generation_stats_daily was
--     security_invoker, so it aggregated a shopper's own rows; generations.cost_usd and the
--     raw provider error_message were also readable on their own rows.
-- F2  Merchants could set their own plan / monthly_generation_quota (billing bypass).
-- F3  Shoppers could extend expires_at on their photos (retention bypass).
--
-- Supabase grants ALL on public tables to anon/authenticated by default, so we narrow to
-- column-level grants. RLS still decides which ROWS are visible; grants decide which COLUMNS.

-- F1: generations — users see their own rows but not internal cost/diagnostic columns.
revoke all on public.generations from anon, authenticated;
grant select (id, user_id, merchant_id, product_id, person_photo_id, status, result_path, saved, created_at, completed_at)
  on public.generations to authenticated;
grant update (saved) on public.generations to authenticated;

-- F1: reporting views run as owner but only return rows to admins.
drop view if exists public.landing_conversion_daily;
drop view if exists public.generation_stats_daily;

create view public.landing_conversion_daily as
select
  date_trunc('day', created_at)::date as day,
  count(distinct visitor_id) filter (where event = 'page_view') as visitors,
  count(distinct visitor_id) filter (where event = 'waitlist_submit') as signups,
  round(
    100.0 * count(distinct visitor_id) filter (where event = 'waitlist_submit')
    / nullif(count(distinct visitor_id) filter (where event = 'page_view'), 0), 2
  ) as conversion_pct
from public.landing_events
where public.is_admin()
group by 1
order by 1 desc;

create view public.generation_stats_daily as
select
  date_trunc('day', created_at)::date as day,
  provider,
  count(*) as attempts,
  count(*) filter (where status = 'succeeded') as succeeded,
  count(*) filter (where status = 'failed') as failed,
  count(*) filter (where status = 'rejected') as rejected,
  round(100.0 * count(*) filter (where status = 'succeeded') / nullif(count(*), 0), 2) as completion_pct,
  percentile_cont(0.5) within group (order by latency_ms) filter (where status = 'succeeded') as median_latency_ms,
  percentile_cont(0.95) within group (order by latency_ms) filter (where status = 'succeeded') as p95_latency_ms,
  sum(cost_usd) as cost_usd,
  round(sum(cost_usd) / nullif(count(*) filter (where status = 'succeeded'), 0), 4) as cost_per_success_usd
from public.generations
where public.is_admin()
group by 1, 2
order by 1 desc, 2;

revoke all on public.landing_conversion_daily, public.generation_stats_daily from anon;
grant select on public.landing_conversion_daily, public.generation_stats_daily to authenticated;

-- F2: merchants may only set descriptive fields; plan/quota/status are server-controlled.
revoke insert, update on public.merchants from anon, authenticated;
grant insert (owner_id, name, website_url) on public.merchants to authenticated;
grant update (name, website_url) on public.merchants to authenticated;

-- F3: photo rows are immutable for users (they can still delete them), and retention is capped.
revoke insert, update on public.person_photos from anon, authenticated;
grant insert (user_id, storage_path, mime_type, byte_size, width, height, consent_version, consented_at, expires_at)
  on public.person_photos to authenticated;  -- created_at stays server-defaulted so the cap below holds
alter table public.person_photos
  add constraint person_photos_retention_cap check (expires_at <= created_at + interval '366 days');

-- Defense in depth: anonymous users never write these tables.
revoke insert, update, delete on public.person_photos, public.feedback, public.products, public.profiles from anon;
revoke all on public.waitlist_signups, public.landing_events from anon, authenticated;
grant select on public.waitlist_signups, public.landing_events to authenticated; -- RLS limits to admins

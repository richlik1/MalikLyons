-- TrendSet MVP schema (Supabase / Postgres)
-- Principles: RLS on every table, private-by-default storage, server-only writes for
-- anything that affects cost, billing or analytics integrity.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Profiles & roles
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('shopper', 'merchant', 'admin');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.app_role not null default 'shopper',
  display_name text,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- ---------------------------------------------------------------------------
-- Merchants (tenants) and products
-- ---------------------------------------------------------------------------
create table public.merchants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  website_url text,
  -- Subscription-ready: billing is not implemented in the MVP.
  plan text not null default 'pilot' check (plan in ('pilot', 'starter', 'growth', 'pro', 'enterprise')),
  monthly_generation_quota integer not null default 500,
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now()
);
create index merchants_owner_idx on public.merchants (owner_id);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  category text not null check (category in ('tops', 'bottoms', 'one-pieces')),
  price_cents integer check (price_cents is null or price_cents >= 0),
  currency text not null default 'USD',
  purchase_url text not null check (purchase_url ~* '^https://'),
  image_path text not null,             -- path inside the "garments" bucket
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index products_merchant_idx on public.products (merchant_id);

-- ---------------------------------------------------------------------------
-- Person photos (sensitive) — consent is recorded per photo
-- ---------------------------------------------------------------------------
create table public.person_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  storage_path text not null unique,    -- path inside the private "person-photos" bucket
  mime_type text not null,
  byte_size integer not null,
  width integer,
  height integer,
  consent_version text not null,
  consented_at timestamptz not null,
  expires_at timestamptz not null,      -- retention limit; purge job deletes after this
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create index person_photos_user_idx on public.person_photos (user_id);

-- ---------------------------------------------------------------------------
-- Generations: one row per try-on attempt. Doubles as the AI generation log.
-- ---------------------------------------------------------------------------
create table public.generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  merchant_id uuid references public.merchants (id) on delete set null,
  product_id uuid references public.products (id) on delete set null,
  person_photo_id uuid references public.person_photos (id) on delete set null,
  provider text not null,
  model text not null,
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed', 'rejected')),
  result_path text,                     -- path inside the private "tryon-results" bucket
  latency_ms integer,
  cost_usd numeric(10, 4) not null default 0,  -- estimate, from provider config
  error_code text,
  error_message text,
  provider_job_id text,
  saved boolean not null default false,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index generations_user_created_idx on public.generations (user_id, created_at desc);
create index generations_created_idx on public.generations (created_at desc);
create index generations_merchant_idx on public.generations (merchant_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Feedback on results (customer satisfaction metric)
-- ---------------------------------------------------------------------------
create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  generation_id uuid not null references public.generations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text check (comment is null or char_length(comment) <= 1000),
  created_at timestamptz not null default now(),
  unique (generation_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Landing page validation: waitlist + first-party events (no third-party trackers)
-- ---------------------------------------------------------------------------
create table public.waitlist_signups (
  id uuid primary key default gen_random_uuid(),
  visitor_id text not null,
  email text not null,
  brand_name text not null,
  store_url text,
  platform text check (platform in ('shopify', 'woocommerce', 'bigcommerce', 'custom', 'other')),
  monthly_orders text check (monthly_orders in ('0-50', '51-500', '501-5000', '5000+')),
  biggest_problem text check (biggest_problem is null or char_length(biggest_problem) <= 1000),
  utm_source text,
  utm_campaign text,
  created_at timestamptz not null default now(),
  unique (email)
);

create table public.landing_events (
  id bigint generated always as identity primary key,
  visitor_id text not null,
  event text not null check (event in ('page_view', 'cta_click', 'waitlist_submit')),
  variant text,
  path text,
  utm_source text,
  created_at timestamptz not null default now()
);
create index landing_events_created_idx on public.landing_events (created_at);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.merchants enable row level security;
alter table public.products enable row level security;
alter table public.person_photos enable row level security;
alter table public.generations enable row level security;
alter table public.feedback enable row level security;
alter table public.waitlist_signups enable row level security;
alter table public.landing_events enable row level security;

-- profiles: read/update own row; role changes only by admin (column guarded by trigger below)
create policy profiles_select_own on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy profiles_update_own on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

create or replace function public.prevent_role_escalation()
returns trigger language plpgsql as $$
begin
  if new.role is distinct from old.role and not public.is_admin() and auth.role() <> 'service_role' then
    raise exception 'role changes require admin';
  end if;
  return new;
end;
$$;
create trigger profiles_role_guard before update on public.profiles
  for each row execute function public.prevent_role_escalation();

-- merchants: owner manages own merchant; admins see all
create policy merchants_select on public.merchants for select using (owner_id = auth.uid() or public.is_admin());
create policy merchants_insert on public.merchants for insert with check (owner_id = auth.uid());
create policy merchants_update on public.merchants for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- products: catalog is public-readable when active; merchants manage their own
create policy products_public_read on public.products for select using (
  is_active or exists (select 1 from public.merchants m where m.id = merchant_id and (m.owner_id = auth.uid() or public.is_admin()))
);
create policy products_merchant_write on public.products for all using (
  exists (select 1 from public.merchants m where m.id = merchant_id and m.owner_id = auth.uid())
) with check (
  exists (select 1 from public.merchants m where m.id = merchant_id and m.owner_id = auth.uid())
);

-- person_photos: owner only. Admins deliberately get NO access to personal photos.
create policy person_photos_owner_select on public.person_photos for select using (user_id = auth.uid());
create policy person_photos_owner_insert on public.person_photos for insert with check (user_id = auth.uid());
create policy person_photos_owner_update on public.person_photos for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy person_photos_owner_delete on public.person_photos for delete using (user_id = auth.uid());

-- generations: users read their own (admins read logs); writes happen server-side with the service role
create policy generations_select on public.generations for select using (user_id = auth.uid() or public.is_admin());
create policy generations_update_saved on public.generations for update using (user_id = auth.uid()) with check (user_id = auth.uid());
-- Users may only toggle "saved"; everything else is server-controlled.
create or replace function public.generations_user_update_guard()
returns trigger language plpgsql as $$
begin
  if auth.role() = 'service_role' then return new; end if;
  if (new.status, new.cost_usd, new.provider, new.model, new.result_path, new.user_id)
     is distinct from (old.status, old.cost_usd, old.provider, old.model, old.result_path, old.user_id) then
    raise exception 'only "saved" may be changed by users';
  end if;
  return new;
end;
$$;
create trigger generations_update_guard before update on public.generations
  for each row execute function public.generations_user_update_guard();

-- merchant analytics: merchants can read aggregate try-on counts for their products via view below
-- feedback: users manage their own; admins read all
create policy feedback_select on public.feedback for select using (user_id = auth.uid() or public.is_admin());
create policy feedback_insert on public.feedback for insert with check (
  user_id = auth.uid() and exists (select 1 from public.generations g where g.id = generation_id and g.user_id = auth.uid())
);

-- waitlist & landing events: no anon access at all; inserted by server routes, read by admins
create policy waitlist_admin_read on public.waitlist_signups for select using (public.is_admin());
create policy landing_events_admin_read on public.landing_events for select using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Reporting views (security_invoker so RLS of the caller applies)
-- ---------------------------------------------------------------------------
create view public.landing_conversion_daily with (security_invoker = true) as
select
  date_trunc('day', created_at)::date as day,
  count(distinct visitor_id) filter (where event = 'page_view') as visitors,
  count(distinct visitor_id) filter (where event = 'waitlist_submit') as signups,
  round(
    100.0 * count(distinct visitor_id) filter (where event = 'waitlist_submit')
    / nullif(count(distinct visitor_id) filter (where event = 'page_view'), 0), 2
  ) as conversion_pct
from public.landing_events
group by 1
order by 1 desc;

create view public.generation_stats_daily with (security_invoker = true) as
select
  date_trunc('day', created_at)::date as day,
  provider,
  count(*) as attempts,
  count(*) filter (where status = 'succeeded') as succeeded,
  count(*) filter (where status = 'failed') as failed,
  round(100.0 * count(*) filter (where status = 'succeeded') / nullif(count(*), 0), 2) as completion_pct,
  percentile_cont(0.5) within group (order by latency_ms) filter (where status = 'succeeded') as median_latency_ms,
  sum(cost_usd) as cost_usd,
  round(sum(cost_usd) / nullif(count(*) filter (where status = 'succeeded'), 0), 4) as cost_per_success_usd
from public.generations
group by 1, 2
order by 1 desc, 2;

-- Merchant-facing aggregate (no personal data): try-ons per product.
create or replace function public.merchant_product_stats(p_merchant uuid)
returns table (product_id uuid, product_name text, tryons bigint, succeeded bigint, saved bigint)
language sql stable security definer set search_path = public as $$
  select p.id, p.name,
         count(g.id), count(g.id) filter (where g.status = 'succeeded'), count(g.id) filter (where g.saved)
  from public.products p
  join public.merchants m on m.id = p.merchant_id
  left join public.generations g on g.product_id = p.id
  where p.merchant_id = p_merchant and (m.owner_id = auth.uid() or public.is_admin())
  group by p.id, p.name;
$$;

-- ---------------------------------------------------------------------------
-- Storage buckets & policies
-- Objects are stored under "<auth.uid()>/<file>" so the first path segment is the owner.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('person-photos', 'person-photos', false, 8388608, array['image/jpeg', 'image/png', 'image/webp']),
  ('tryon-results', 'tryon-results', false, 15728640, array['image/jpeg', 'image/png', 'image/webp']),
  ('garments', 'garments', true, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "person photos: owner read" on storage.objects for select
  using (bucket_id = 'person-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "person photos: owner write" on storage.objects for insert
  with check (bucket_id = 'person-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "person photos: owner delete" on storage.objects for delete
  using (bucket_id = 'person-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "results: owner read" on storage.objects for select
  using (bucket_id = 'tryon-results' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "results: owner delete" on storage.objects for delete
  using (bucket_id = 'tryon-results' and (storage.foldername(name))[1] = auth.uid()::text);
-- Results are written by the server (service role) after the provider responds.

create policy "garments: public read" on storage.objects for select using (bucket_id = 'garments');
create policy "garments: merchant write" on storage.objects for insert
  with check (bucket_id = 'garments' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "garments: merchant delete" on storage.objects for delete
  using (bucket_id = 'garments' and (storage.foldername(name))[1] = auth.uid()::text);

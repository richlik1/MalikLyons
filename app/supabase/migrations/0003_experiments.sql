-- 0003: randomized merchant experiments + click-through tracking.
-- Design: visitor-level random assignment (deterministic hash of salt + visitor id), first
-- exposure logged once per visitor, intent-to-treat analysis. See docs/12-experiments.md.

create table public.experiments (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants (id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9-]{3,40}$'),
  hypothesis text not null check (char_length(hypothesis) between 10 and 500),
  primary_metric text not null default 'add_to_cart' check (primary_metric in ('add_to_cart', 'purchase', 'checkout_started')),
  treatment_pct smallint not null default 50 check (treatment_pct between 1 and 99),
  salt text not null default encode(gen_random_bytes(8), 'hex'),
  status text not null default 'draft' check (status in ('draft', 'running', 'stopped')),
  planned_visitors_per_arm integer check (planned_visitors_per_arm is null or planned_visitors_per_arm > 0),
  started_at timestamptz,
  stopped_at timestamptz,
  created_at timestamptz not null default now(),
  unique (merchant_id, key)
);

create table public.experiment_assignments (
  experiment_id uuid not null references public.experiments (id) on delete cascade,
  visitor_id text not null check (char_length(visitor_id) between 8 and 64),
  arm text not null check (arm in ('treatment', 'control')),
  first_exposed_at timestamptz not null default now(),
  primary key (experiment_id, visitor_id)
);

create table public.experiment_events (
  id bigint generated always as identity primary key,
  experiment_id uuid not null references public.experiments (id) on delete cascade,
  visitor_id text not null check (char_length(visitor_id) between 8 and 64),
  arm text not null check (arm in ('treatment', 'control')),
  event text not null check (event in ('tryon_open', 'tryon_success', 'add_to_cart', 'checkout_started', 'purchase')),
  product_id uuid references public.products (id) on delete set null,
  value_cents integer check (value_cents is null or value_cents >= 0),
  external_order_id text,
  source text not null default 'browser' check (source in ('browser', 'server', 'shopify_webhook')),
  occurred_at timestamptz not null default now(),
  foreign key (experiment_id, visitor_id) references public.experiment_assignments (experiment_id, visitor_id) on delete cascade
);
create index experiment_events_lookup_idx on public.experiment_events (experiment_id, event, visitor_id);
-- An order is counted at most once per experiment, whichever source reports it first.
create unique index experiment_events_order_uniq on public.experiment_events (experiment_id, external_order_id) where external_order_id is not null;

alter table public.experiments enable row level security;
alter table public.experiment_assignments enable row level security;
alter table public.experiment_events enable row level security;

-- Merchants manage their own experiments (descriptive fields + status); salt is server-generated.
create policy experiments_owner_select on public.experiments for select using (
  public.is_admin() or exists (select 1 from public.merchants m where m.id = merchant_id and m.owner_id = auth.uid())
);
create policy experiments_owner_insert on public.experiments for insert with check (
  exists (select 1 from public.merchants m where m.id = merchant_id and m.owner_id = auth.uid())
);
create policy experiments_owner_update on public.experiments for update using (
  exists (select 1 from public.merchants m where m.id = merchant_id and m.owner_id = auth.uid())
) with check (
  exists (select 1 from public.merchants m where m.id = merchant_id and m.owner_id = auth.uid())
);
revoke all on public.experiments from anon, authenticated;
grant select (id, merchant_id, key, hypothesis, primary_metric, treatment_pct, status, planned_visitors_per_arm, started_at, stopped_at, created_at)
  on public.experiments to authenticated;
grant insert (merchant_id, key, hypothesis, primary_metric, treatment_pct, planned_visitors_per_arm) on public.experiments to authenticated;
grant update (hypothesis, planned_visitors_per_arm) on public.experiments to authenticated;
-- Status transitions (draft→running→stopped) go through the server so started_at/stopped_at are trustworthy.

-- Raw assignments/events: server writes only; nobody reads raw rows except admins.
create policy experiment_assignments_admin on public.experiment_assignments for select using (public.is_admin());
create policy experiment_events_admin on public.experiment_events for select using (public.is_admin());
revoke all on public.experiment_assignments, public.experiment_events from anon, authenticated;
grant select on public.experiment_assignments, public.experiment_events to authenticated; -- RLS: admins only

-- Intent-to-treat summary per arm. Events count only if they happened at/after first exposure.
create or replace function public.experiment_summary(p_experiment uuid)
returns table (arm text, visitors bigint, tryon_open bigint, tryon_success bigint, add_to_cart bigint, checkout_started bigint, purchasers bigint, revenue_cents bigint)
language sql stable security definer set search_path = public as $$
  with allowed as (
    select e.id from public.experiments e join public.merchants m on m.id = e.merchant_id
    where e.id = p_experiment and (m.owner_id = auth.uid() or public.is_admin())
  ),
  ev as (
    select x.* from public.experiment_events x
    join public.experiment_assignments a on a.experiment_id = x.experiment_id and a.visitor_id = x.visitor_id
    where x.experiment_id in (select id from allowed) and x.occurred_at >= a.first_exposed_at - interval '5 seconds'
  )
  select a.arm,
         count(distinct a.visitor_id),
         count(distinct ev.visitor_id) filter (where ev.event = 'tryon_open'),
         count(distinct ev.visitor_id) filter (where ev.event = 'tryon_success'),
         count(distinct ev.visitor_id) filter (where ev.event = 'add_to_cart'),
         count(distinct ev.visitor_id) filter (where ev.event = 'checkout_started'),
         count(distinct ev.visitor_id) filter (where ev.event = 'purchase'),
         coalesce(sum(ev.value_cents) filter (where ev.event = 'purchase'), 0)::bigint
  from public.experiment_assignments a
  left join ev on ev.visitor_id = a.visitor_id and ev.experiment_id = a.experiment_id
  where a.experiment_id in (select id from allowed)
  group by a.arm
  order by a.arm;
$$;

-- Click-through from a try-on result to the merchant's product page (server-recorded).
alter table public.generations add column shop_clicked_at timestamptz;

drop function if exists public.merchant_product_stats(uuid);
create function public.merchant_product_stats(p_merchant uuid)
returns table (product_id uuid, product_name text, tryons bigint, succeeded bigint, saved bigint, shop_clicks bigint)
language sql stable security definer set search_path = public as $$
  select p.id, p.name,
         count(g.id), count(g.id) filter (where g.status = 'succeeded'), count(g.id) filter (where g.saved),
         count(g.id) filter (where g.shop_clicked_at is not null)
  from public.products p
  join public.merchants m on m.id = p.merchant_id
  left join public.generations g on g.product_id = p.id
  where p.merchant_id = p_merchant and (m.owner_id = auth.uid() or public.is_admin())
  group by p.id, p.name;
$$;

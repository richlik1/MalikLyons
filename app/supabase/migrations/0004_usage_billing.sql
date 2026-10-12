-- 0004: usage metering ledger, plan catalog and per-merchant quotas.
-- Billing is NOT live: no payment provider is called. billing_status defaults to
-- 'not_billing'; 'shadow' computes estimated invoices only. See docs/13-billing-architecture.md.

create table public.plans (
  key text primary key check (key in ('pilot', 'starter', 'growth', 'pro', 'enterprise')),
  name text not null,
  monthly_price_cents integer not null check (monthly_price_cents >= 0),
  included_generations integer not null check (included_generations >= 0),
  overage_cents_per_generation integer check (overage_cents_per_generation is null or overage_cents_per_generation >= 0),
  hard_cap boolean not null default true,          -- true: block at quota; false: allow overage
  is_test_price boolean not null default true,     -- hypotheses from docs/11-financial-model.md, not validated
  active boolean not null default true
);

insert into public.plans (key, name, monthly_price_cents, included_generations, overage_cents_per_generation, hard_cap) values
  ('pilot',      'Pilot (free, 6 weeks)', 0,     500,  null, true),
  ('starter',    'Starter',               4900,  250,  15,   false),
  ('growth',     'Growth',                14900, 1000, 15,   false),
  ('pro',        'Pro',                   39900, 3000, 12,   false),
  ('enterprise', 'Enterprise (custom)',   0,     0,    null, true);

alter table public.merchants
  add constraint merchants_plan_fk foreign key (plan) references public.plans (key),
  add column billing_status text not null default 'not_billing'
    check (billing_status in ('not_billing', 'shadow', 'active', 'past_due', 'canceled')),
  add column billing_customer_ref text;  -- e.g. Stripe customer id, once billing exists

-- Merchant-level quota override (null = use plan). Server-controlled (see 0002 column grants).
alter table public.merchants alter column monthly_generation_quota drop not null;
alter table public.merchants alter column monthly_generation_quota drop default;
update public.merchants set monthly_generation_quota = null where monthly_generation_quota = 500;

-- Append-only usage ledger: one row per billable (successful) generation.
create table public.usage_events (
  id bigint generated always as identity primary key,
  merchant_id uuid references public.merchants (id) on delete set null,
  generation_id uuid unique references public.generations (id) on delete set null,
  metric text not null default 'tryon_generation' check (metric in ('tryon_generation')),
  quantity integer not null default 1 check (quantity > 0),
  unit_cost_usd numeric(10, 4) not null,  -- our provider cost estimate (COGS), not the price
  billing_period date not null,           -- first day of the UTC month
  reported_to_billing_at timestamptz,     -- set when sent to the billing provider (never, while disabled)
  created_at timestamptz not null default now()
);
create index usage_events_merchant_period_idx on public.usage_events (merchant_id, billing_period);

alter table public.plans enable row level security;
alter table public.usage_events enable row level security;
create policy plans_read on public.plans for select using (active);
create policy usage_admin_read on public.usage_events for select using (public.is_admin());
revoke all on public.plans from anon, authenticated;
grant select on public.plans to anon, authenticated;
revoke all on public.usage_events from anon, authenticated;
grant select on public.usage_events to authenticated; -- RLS: admins only

-- Ledger rows can't be edited or deleted except by the service role (append-only for apps).
create or replace function public.usage_events_append_only()
returns trigger language plpgsql as $$
begin
  if auth.role() = 'service_role' and tg_op = 'UPDATE' and new.reported_to_billing_at is distinct from old.reported_to_billing_at
     and (new.merchant_id, new.generation_id, new.quantity, new.unit_cost_usd, new.billing_period) is not distinct from
         (old.merchant_id, old.generation_id, old.quantity, old.unit_cost_usd, old.billing_period) then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.merchant_id is not null and new.merchant_id is null and new.generation_id is not distinct from old.generation_id then
    return new; -- FK on delete set null
  end if;
  if tg_op = 'UPDATE' and old.generation_id is not null and new.generation_id is null and new.merchant_id is not distinct from old.merchant_id then
    return new; -- FK on delete set null
  end if;
  raise exception 'usage_events is append-only';
end;
$$;
create trigger usage_events_no_update before update or delete on public.usage_events
  for each row execute function public.usage_events_append_only();

-- Merchant-facing usage + estimated invoice for a period (no personal data).
create or replace function public.merchant_usage_summary(p_merchant uuid, p_period date default date_trunc('month', now() at time zone 'utc')::date)
returns table (billing_period date, plan text, used bigint, included integer, overage_units bigint,
               base_cents integer, overage_cents bigint, estimated_total_cents bigint, hard_cap boolean, billing_status text)
language sql stable security definer set search_path = public as $$
  select p_period, m.plan,
         coalesce(u.used, 0),
         coalesce(m.monthly_generation_quota, pl.included_generations),
         greatest(coalesce(u.used, 0) - coalesce(m.monthly_generation_quota, pl.included_generations), 0),
         pl.monthly_price_cents,
         case when pl.hard_cap then 0
              else greatest(coalesce(u.used, 0) - coalesce(m.monthly_generation_quota, pl.included_generations), 0) * coalesce(pl.overage_cents_per_generation, 0) end,
         pl.monthly_price_cents + case when pl.hard_cap then 0
              else greatest(coalesce(u.used, 0) - coalesce(m.monthly_generation_quota, pl.included_generations), 0) * coalesce(pl.overage_cents_per_generation, 0) end,
         pl.hard_cap, m.billing_status
  from public.merchants m
  join public.plans pl on pl.key = m.plan
  left join (select merchant_id, sum(quantity) as used from public.usage_events
             where billing_period = p_period group by merchant_id) u on u.merchant_id = m.id
  where m.id = p_merchant and (m.owner_id = auth.uid() or public.is_admin());
$$;

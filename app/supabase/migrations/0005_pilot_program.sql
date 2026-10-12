-- 0005: pilot onboarding + measurable merchant feedback (feeds go/no-go gates G3 and G9).

create table public.pilot_enrollments (
  merchant_id uuid primary key references public.merchants (id) on delete cascade,
  status text not null default 'invited' check (status in ('invited', 'onboarding', 'live', 'completed', 'withdrawn')),
  waitlist_signup_id uuid references public.waitlist_signups (id) on delete set null,
  start_date date,
  end_date date,
  products_limit integer not null default 20 check (products_limit > 0),
  offered_price_cents integer check (offered_price_cents is null or offered_price_cents >= 0), -- pre-agreed conversion price
  agreement_signed_at timestamptz,
  dpa_signed_at timestamptz,
  converted_to_paid boolean,
  admin_notes text,
  created_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);

create table public.merchant_feedback (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants (id) on delete cascade,
  submitted_by uuid not null references auth.users (id) on delete cascade,
  pilot_week smallint not null check (pilot_week between 0 and 12),
  likelihood_to_recommend smallint not null check (likelihood_to_recommend between 0 and 10),
  value_rating smallint not null check (value_rating between 1 and 5),
  quality_rating smallint not null check (quality_rating between 1 and 5),
  would_pay text not null check (would_pay in ('yes', 'maybe', 'no')),
  price_named_cents integer check (price_named_cents is null or price_named_cents between 0 and 10000000),
  top_issue text check (top_issue is null or char_length(top_issue) <= 1000),
  comment text check (comment is null or char_length(comment) <= 2000),
  created_at timestamptz not null default now(),
  unique (merchant_id, pilot_week)
);

alter table public.pilot_enrollments enable row level security;
alter table public.merchant_feedback enable row level security;

create policy pilot_owner_read on public.pilot_enrollments for select using (
  public.is_admin() or exists (select 1 from public.merchants m where m.id = merchant_id and m.owner_id = auth.uid())
);
revoke all on public.pilot_enrollments from anon, authenticated;
grant select (merchant_id, status, start_date, end_date, products_limit, offered_price_cents, agreement_signed_at, dpa_signed_at, created_at)
  on public.pilot_enrollments to authenticated;   -- admin_notes and conversion outcome stay internal

create policy feedback_owner_read on public.merchant_feedback for select using (
  public.is_admin() or exists (select 1 from public.merchants m where m.id = merchant_id and m.owner_id = auth.uid())
);
create policy feedback_owner_insert on public.merchant_feedback for insert with check (
  submitted_by = auth.uid() and exists (select 1 from public.merchants m where m.id = merchant_id and m.owner_id = auth.uid())
);
revoke all on public.merchant_feedback from anon, authenticated;
grant select, insert (merchant_id, submitted_by, pilot_week, likelihood_to_recommend, value_rating, quality_rating, would_pay, price_named_cents, top_issue, comment)
  on public.merchant_feedback to authenticated;
grant select on public.merchant_feedback to authenticated;

-- Enforce the pilot product limit at the database level.
create or replace function public.enforce_pilot_product_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare lim integer; cnt integer;
begin
  select products_limit into lim from public.pilot_enrollments
   where merchant_id = new.merchant_id and status in ('invited', 'onboarding', 'live');
  if lim is null then return new; end if;
  select count(*) into cnt from public.products where merchant_id = new.merchant_id and is_active and id <> new.id;
  if new.is_active and cnt >= lim then
    raise exception 'pilot product limit (%) reached', lim using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger products_pilot_limit before insert or update of is_active on public.products
  for each row execute function public.enforce_pilot_product_limit();

-- Admin scorecard: one row per pilot merchant with the inputs to gates G3, G6, G7, G9.
create view public.pilot_scorecard as
select
  m.id as merchant_id, m.name, pe.status, pe.start_date, pe.end_date, pe.offered_price_cents, pe.converted_to_paid,
  (select count(*) from public.products p where p.merchant_id = m.id and p.is_active) as live_products,
  (select count(*) from public.generations g where g.merchant_id = m.id) as tryon_attempts,
  (select round(100.0 * count(*) filter (where g.status = 'succeeded') / nullif(count(*), 0), 1) from public.generations g where g.merchant_id = m.id) as completion_pct,
  (select round(100.0 * count(*) filter (where f.rating >= 4) / nullif(count(*), 0), 1)
     from public.feedback f join public.generations g on g.id = f.generation_id where g.merchant_id = m.id) as shopper_rating_4plus_pct,
  (select count(*) from public.generations g where g.merchant_id = m.id and g.shop_clicked_at is not null) as shop_clicks,
  (select mf.likelihood_to_recommend from public.merchant_feedback mf where mf.merchant_id = m.id order by mf.pilot_week desc limit 1) as latest_ltr,
  (select mf.would_pay from public.merchant_feedback mf where mf.merchant_id = m.id order by mf.pilot_week desc limit 1) as latest_would_pay,
  (select mf.price_named_cents from public.merchant_feedback mf where mf.merchant_id = m.id and mf.price_named_cents is not null order by mf.pilot_week desc limit 1) as latest_price_named_cents,
  (select count(*) from public.merchant_feedback mf where mf.merchant_id = m.id) as feedback_count
from public.pilot_enrollments pe
join public.merchants m on m.id = pe.merchant_id
where public.is_admin();
revoke all on public.pilot_scorecard from anon;
grant select on public.pilot_scorecard to authenticated;

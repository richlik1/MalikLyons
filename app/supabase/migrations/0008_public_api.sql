-- 0008: public developer API + embeddable widget.
--   * api_keys: secret keys (server-to-server REST API) and publishable keys (website widget).
--     Only a SHA-256 hash is stored; the plaintext is shown once at creation.
--   * generations gain source/api_key_id/external_ref so API and widget usage is attributable.
--   * Pro test tier corrected per docs/13 (allowance 2,500, overage $0.15).

create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants (id) on delete cascade,
  kind text not null check (kind in ('secret', 'publishable')),
  name text not null default 'Default' check (char_length(name) between 1 and 60),
  prefix text not null,                       -- first characters, safe to display (e.g. ts_sk_3fA9…)
  key_hash text not null unique,              -- sha256(plaintext) hex
  allowed_origins text[] not null default '{}', -- publishable keys: sites allowed to open the widget
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index api_keys_merchant_idx on public.api_keys (merchant_id);

alter table public.api_keys enable row level security;
create policy api_keys_owner_read on public.api_keys for select using (
  public.is_admin() or exists (select 1 from public.merchants m where m.id = merchant_id and m.owner_id = auth.uid())
);
revoke all on public.api_keys from anon, authenticated;
grant select (id, merchant_id, kind, name, prefix, allowed_origins, created_at, last_used_at, revoked_at)
  on public.api_keys to authenticated;   -- key_hash is never exposed; creation/revocation is server-side

alter table public.generations
  add column source text not null default 'app' check (source in ('app', 'api', 'embed')),
  add column api_key_id uuid references public.api_keys (id) on delete set null,
  add column external_ref text check (external_ref is null or char_length(external_ref) <= 200);
create index generations_api_key_created_idx on public.generations (api_key_id, created_at desc) where api_key_id is not null;

update public.plans set included_generations = 2500, overage_cents_per_generation = 15 where key = 'pro';

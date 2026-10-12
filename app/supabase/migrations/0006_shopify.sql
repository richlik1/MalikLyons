-- 0006: Shopify app installation records. Server-only tables: no client access at all.
-- Access tokens are stored encrypted (AES-256-GCM, key in SHOPIFY_TOKEN_ENCRYPTION_KEY).

create table public.shopify_installations (
  shop_domain text primary key check (shop_domain ~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$'),
  merchant_id uuid references public.merchants (id) on delete set null,
  access_token_ciphertext text,
  scopes text,
  installed_at timestamptz not null default now(),
  uninstalled_at timestamptz,
  updated_at timestamptz not null default now()
);
create unique index shopify_installations_merchant_uniq on public.shopify_installations (merchant_id) where merchant_id is not null and uninstalled_at is null;

create table public.shopify_oauth_states (
  state text primary key,
  shop_domain text not null,
  user_id uuid references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.shopify_webhook_deliveries (
  webhook_id text primary key,       -- X-Shopify-Webhook-Id, for idempotency
  topic text not null,
  shop_domain text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text
);

alter table public.products
  add column external_source text check (external_source is null or external_source in ('shopify')),
  add column external_id text;
-- Full constraint (NULLs stay distinct, so manually added products are unaffected); usable as an upsert target.
alter table public.products add constraint products_external_uniq unique (merchant_id, external_source, external_id);

alter table public.shopify_installations enable row level security;
alter table public.shopify_oauth_states enable row level security;
alter table public.shopify_webhook_deliveries enable row level security;
revoke all on public.shopify_installations, public.shopify_oauth_states, public.shopify_webhook_deliveries from anon, authenticated;

create or replace function public.shopify_status(p_merchant uuid)
returns table (shop_domain text, installed_at timestamptz, scopes text)
language sql stable security definer set search_path = public as $$
  select s.shop_domain, s.installed_at, s.scopes from public.shopify_installations s
  join public.merchants m on m.id = s.merchant_id
  where s.merchant_id = p_merchant and s.uninstalled_at is null and (m.owner_id = auth.uid() or public.is_admin());
$$;

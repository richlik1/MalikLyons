# Shopify app (development-store scaffold) — UNVERIFIED

These files are a starting point for the Shopify app configuration and theme app extension.
They have **not** been deployed to a Shopify Partner account or development store, because no
Shopify credentials were available. Treat everything here as untested until the checklist in
`docs/14-production-readiness-audit.md` (item 5) passes on a dev store.

What is implemented and unit-tested in the Next.js app:

| Piece | Where | Status |
|---|---|---|
| OAuth install + callback (HMAC, one-time state, 10-min TTL, encrypted token) | `src/app/api/shopify/install`, `.../callback`, `src/lib/shopify.ts` | Unit-tested, not live-tested |
| Webhooks: HMAC over raw body, idempotency, `app/uninstalled`, `orders/create` attribution, `customers/data_request`, `customers/redact`, `shop/redact` | `src/app/api/shopify/webhooks` | Unit-tested helpers, not live-tested |
| Product import (Admin GraphQL) → paused products | `src/app/api/shopify/import` | Mapping unit-tested, not live-tested |
| Deep link from PDP → TrendSet try-on | `/try-on?shop=…&shopify_product=…` | Implemented |
| Theme app extension block + widget | `extensions/trendset-tryon/` | Template only |

## Setup on a development store (when credentials exist)

1. Create a Partner account and an app; copy the client ID/secret into `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET`.
2. `SHOPIFY_SCOPES=read_products,read_orders` and `SHOPIFY_TOKEN_ENCRYPTION_KEY=$(openssl rand -base64 32)`.
3. Copy `shopify.app.toml.example` to `shopify.app.toml`, set `client_id` and URLs, then `shopify app deploy`.
4. Install on the dev store from TrendSet Studio → Shopify → Connect.
5. Add the "TrendSet try-on" app block to the product template in the theme editor.

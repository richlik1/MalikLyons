# TrendSet as a SaaS Fashion API: Status & Pricing

_Updated 17 Oct 2026._

## How customers plug it in

| Integration | Who it's for | What they do | Status |
|---|---|---|---|
| **Website widget** | Any store (Shopify, WooCommerce, Wix, custom) | Create a *publishable key* in Studio and paste 2 lines on the product page | ✅ Built, E2E-tested locally |
| **REST API** | Brands and platforms with developers, apps, marketplaces | Call `POST /api/v1/try-ons` from their server with a *secret key* | ✅ Built, E2E-tested locally |
| **Shopify app** | Shopify merchants who want one-click install | Install the app, import products, add the theme block | 🟡 Code written, not run on a real Shopify store |

```html
<script src="https://YOUR-TRENDSET-HOST/widget.js" data-key="ts_pk_…" defer></script>
<button data-trendset-product="PRODUCT_ID">See it on you</button>
```

```bash
curl -X POST https://YOUR-TRENDSET-HOST/api/v1/try-ons \
  -H "Authorization: Bearer ts_sk_…" -H "Content-Type: application/json" \
  -d '{"person_image_url":"https://…/shopper.jpg","product_id":"PRODUCT_ID"}'
```

The developer reference is at `/developers`, and the OpenAPI spec at `/api/v1/openapi.json`.

## API design decisions

| Decision | Why |
|---|---|
| Two key types: `ts_sk_` (server) and `ts_pk_` (browser) | Secret keys never reach browsers. A secret key sent with an `Origin` header is rejected. |
| Keys stored as SHA-256 hashes, shown once, revocable, max 10 active | A database leak doesn't leak working keys |
| Publishable keys list allowed websites | Another site can't open your widget (soft check via `Referer`) |
| Widget opens a **new window**, not an iframe | Safari and Chrome block third-party cookies inside iframes; a popup is first-party and works everywhere |
| Widget shoppers get an **anonymous session** | No account needed; same privacy rules and one-click deletion |
| Synchronous `POST /try-ons` (≤120 s) | Simplest to integrate. An async mode with webhooks is in the backlog. |
| Image URLs fetched with **SSRF protection** | https only, port 443, public IPs only, no redirects, ≤8 MB, magic-byte check |
| API input photos **not stored**; results kept 30 days | The merchant is the data controller for their shopper's photo |
| Per-key rate limit (30/min default), monthly allowance, global budget cap | Abuse and cost protection before any AI spend |
| Usage metered per key (`source`, `api_key_id` on every generation) | Per-customer billing and analytics |

## Working / not working / needed

### ✅ Working (tested locally on real Supabase services; AI provider stubbed)
- REST API v1: create try-on (catalog product, garment URL or base64), retrieve, list products, usage
- API keys: create, show once, hash-only storage, revoke, tenant isolation
- Website widget, anonymous shopper sessions, usage attributed to the publishable key
- Merchant Studio: products, Shopify import, keys, usage, experiments, pilot feedback
- Admin: generation log, cost, conversion, pilot scorecard
- Security: row-level security on every table, 6 earlier defects fixed, SSRF guard, private-by-default staging
- Metering ledger and monthly allowances (billing intentionally off)
- CI on GitHub: unit, integration and E2E all pass

### ❌ Not working yet / not built
| Gap | Why it matters | Effort |
|---|---|---|
| **No real AI generation has ever run** | Quality and speed are unproven | 10 minutes once you provide a FASHN key |
| Not deployed anywhere | Nobody can use it | ~1 hour once you provide accounts |
| **Billing (Stripe)** not connected | Can't charge yet | ~3–5 days; deliberately not started without your go-ahead |
| Self-serve signup → plan → card checkout | Needed for "plug in and charge monthly" at scale | Part of billing work |
| Async API + webhooks (`try_on.succeeded`) | Large customers prefer not to hold connections open | ~2 days |
| Idempotency keys, SDKs (JS/Python), status page | Expected by enterprise developers | ~1 week |
| Shopify app never run on a real store | Biggest distribution channel | ~1–2 days with a dev store |
| Legal: Terms of Service, DPA, privacy policy review | Required to sell; biometric laws (Illinois BIPA, GDPR) | Lawyer, ~$3–8k |
| Footwear and eyewear | Different technology (3D/AR) | Partner later, not now |

### 🔑 What I need from you
| # | Item | Cost | Unblocks |
|---|---|---|---|
| 1 | **FASHN API key** + 2 test images (a consenting adult; a garment you own rights to) | ~$7.50 minimum | First real try-on; quality and speed numbers |
| 2 | **Supabase project** (URL, anon key, service-role key) | $0 free tier / ~$25/mo Pro | Real database |
| 3 | **Vercel account** (or invite me to a project) + a domain | ~$20/mo + ~$15/yr | Private staging site |
| 4 | **Shopify Partner account** + development store | Free | Shopify app testing |
| 5 | **Stripe account** (test mode first) and your go-ahead to build billing | Free in test mode | Charging customers |
| 6 | Your decisions: company name/domain, whether to start with pilots (free) or paid from day 1 | — | Launch plan |

## Recommended pricing (to test, not validated)

Cost per generated image is **$0.075** (FASHN pay-as-you-go) or **≈$0.049** (FASHN $1,249/mo commitment). Margins include card fees (2.9% + $0.30), Stripe Billing (~0.7%) and $2/merchant infrastructure.

| Plan | Price | Includes | Overage | Gross margin at full use ($0.075 / $0.049 cost) | For |
|---|---|---|---|---|---|
| **Free trial** | $0 | 25 try-ons, 14 days | — | cost ≤ $1.88 per trial | Lead generation |
| **Starter** (widget) | **$49/mo** | 250 try-ons | $0.15 each | 53% / 67% | Small stores |
| **Growth** (widget) | **$149/mo** | 1,000 | $0.15 | 45% / 62% | Growing brands |
| **Pro** (widget + API) | **$399/mo** | 2,500 | $0.15 | 49% / 65% | Established brands |
| **API pay-as-you-go** | **$0.20 per try-on** | No minimum | — | 47% / 60% | Developers, apps |
| **API Scale** | **$599/mo** | 4,000 | $0.15 | 46% / 63% | Platforms, marketplaces |
| **Enterprise** | Custom (≥ $2,000/mo, annual) | Volume, SLA, SSO, DPA | Negotiated, ≥ $0.10 | Requires negotiated AI cost ≤ ~$0.035 | Large retailers |

**Rules that keep this profitable:**
1. **Never unlimited.** Every plan has an allowance and overage, and the code already enforces allowances.
2. **Move to the FASHN commitment tier** once you pass ~4,000 images/month. That alone lifts margin about 15 points and clears the 60% target.
3. **Don't bill failed generations.** FASHN doesn't charge you for them either.
4. **Annual prepay discount** of up to 2 months free, to fund growth.
5. **Re-price after the pilot** using real cost and real willingness-to-pay from the pilot scorecard.

**Path to $10k MRR (illustrative, not a forecast):** 40 Starter + 25 Growth + 8 Pro + 2 API Scale ≈ **$10,075/mo**.

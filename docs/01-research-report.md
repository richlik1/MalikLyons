# TrendSet — Research Report & Strategic Recommendation

_Research date: 12 October 2026. Prepared before the MVP build._

## How to read this report

Every material claim is labeled:

| Label | Meaning |
|---|---|
| **Verified** | Confirmed from a primary source (official docs, pricing page, filing). |
| **Vendor claim** | Published by a company about its own product. Not independently checked, usually self-selected users. |
| **Forecast** | An analyst market projection. Definitions vary widely. |
| **Assumption** | Our own working estimate, still to be validated. |

Confidence: **High** = primary source read directly. **Medium** = primary source seen through search results only, or a vendor case study with a disclosed method. **Low** = third-party or competitor source, or dated.

> **Limitation.** Our network sandbox blocked direct fetches of `docs.cloud.google.com`, `docs.fashn.ai` and `help.fashn.ai`, so those pages were read through search-engine extracts. Re-check every price and date on the live page before signing anything.

---

## 1. Executive summary

1. **Demand for try-on is plausible but not proven for TrendSet.** Most public numbers come from vendors and compare self-selected users with everyone else. That shows engagement, not lift. The best controlled evidence we found is Faslet × Garcia: **+7.06% relative conversion** and **−5.54% returns** in an A/B test. That is a vendor case study, the baseline rate is not disclosed, and both arms already had a sizing tool. (Medium confidence)
2. **Basic image generation is a commodity.** Google offers try-on free in Search. FASHN sells it at about $0.05–$0.075 per image. Google Vertex sells it at $0.06. More than a dozen Shopify apps charge $15–$300 a month. **TrendSet cannot win on "we generate try-on images."**
3. **The model lifecycle is a real dependency risk.** Google's `virtual-try-on-001` reached GA in January 2026, and its model page lists a **retirement date of 15 March 2027**, about 5 months from today. (Your brief said "deprecated 14 Sept 2026". We found no primary source for that date.) Vendor abstraction is required, not optional.
4. **Where TrendSet can plausibly win** is the merchant side: measurement, economics and trust. Specifically:
   - **(a) Honest, controlled lift measurement**, built in. Almost every competitor quotes correlational numbers. Merchants who have been burned want proof.
   - **(b) Predictable pricing with cost guardrails.**
   - **(c) Privacy-first handling of shopper photos.**
   - **(d) Provider-agnostic quality.** We route each garment type to the best model and can switch when a model retires.

   This is a hypothesis to validate, not an established advantage.
5. **Recommendation:**
   - Start B2B with **independent streetwear and apparel brands on Shopify** (roughly 50–5,000 orders a month), selling **tops, hoodies and jackets** first.
   - Use **FASHN as the primary provider** and Vertex as the benchmark and fallback.
   - Ship a measurement-first pilot, not a marketplace.
   - Footwear and eyewear need different technology (3D/AR, face and foot tracking). Defer both and partner rather than build.

---

## 2. Market intelligence

### 2.1 Market size: forecasts disagree by up to 5×

| Source | 2024 base | Projection | CAGR | Label | Confidence |
|---|---|---|---|---|---|
| ResearchAndMarkets (via Business Wire, Mar 2025) | $12.5B | $48.8B by 2030 | 25.5% | Forecast | Medium |
| Grand View Research (via distributor listing) | — | $46.42B by 2030 | 26.4% | Forecast | Medium |
| Market.us | $12.6B | $245.9B by 2034 | 34.6% | Forecast | Low |
| Valuates | $5.77B | $27.7B by 2031 | — | Forecast | Low |

**Segments.** Market.us puts "Apparel & Footwear" as the largest application at 35.1%, followed by beauty and eyewear. Grand View says apparel had the largest share in 2023. A narrower "virtual mirror" report (HTF MI) puts fashion and apparel at 66%. **None of these split apparel, footwear, eyewear and beauty with comparable definitions.** Some include AR hardware and smart mirrors.

**Our position:** do not put a TAM number in a pitch as if it were fact. These reports are not decision-grade for a seed-stage B2B SaaS. A bottom-up model is more useful.

### 2.2 Bottom-up TAM / SAM / SOM (all values are assumptions)

| Layer | Definition | Estimate | Basis |
|---|---|---|---|
| TAM | Online apparel merchants worldwide who could buy try-on SaaS | Not estimated with confidence | Needs store-count data by category (e.g. StoreLeads/BuiltWith). Purchase that before fundraising. |
| SAM | US/UK/EU Shopify apparel stores with 50–5,000 orders/month | **Assumption:** tens of thousands of stores | To verify with a StoreLeads export filtered by category and traffic. |
| SOM (24 months) | Paying merchants TrendSet could realistically win | **Assumption:** 50–300 merchants, about $70k–$400k ARR | Founder-led sales plus Shopify app store. Assumes about $114 blended ARPU (see financial model). |

**Data limitation:** we have no verified count of target merchants yet. **Action:** buy one StoreLeads/BuiltWith export (Week 1 of the research program).

### 2.3 Adoption, behaviour and barriers

| Finding | Source | Label | Confidence |
|---|---|---|---|
| 156K+ completed try-ons across 577 Shopify stores in Q2 2026. About 90% on phones. Try-on users add to cart 3× more often. | Genlook "State of Virtual Try-On Q2 2026" via Sept 2026 press release | Vendor claim. The 3× compares self-selected users, so it is **not** causal. | Medium |
| A StoreLeads listing showed Genlook on 427 Shopify stores, up 2.6% QoQ (about 2 months before research date). | storeleads.app | Third-party data | Medium |
| Garcia: +7.06% conversion, −5.54% returns. Controlled A/B on live traffic, >5,000 items ordered per arm. Both arms had Faslet's size tool. 80% of try-on users rated it positively. | faslet.me case study | Vendor case study with a disclosed design | Medium |
| OFM: a 3.5% conversion lift and 13.1% fewer returns are quoted. An earlier note said "1.6× higher conversion among VTO users… further validation needed." | Faslet / Emerce | Vendor claim | Low-Medium |
| DRESSX reports +40% conversion, −30% returns, 3× add-to-cart, and integration in about 24 hours. | dressx.com | Vendor claim | Low-Medium |
| Google's consumer try-on uses a full-length personal photo. At launch it excluded shoes, lingerie, swimwear and accessories, and Google said fit and details "may not always be accurate". Doppl shut down on 30 April 2026. | TechCrunch Jul 2025; labs.google | Verified (vendor statements) | High / Medium |

**Barriers (hypotheses for interviews):**
- privacy anxiety about uploading body photos
- distrust of AI accuracy ("it doesn't look like me")
- latency on mobile
- the expectation that try-on also tells you your size, which it does not
- merchants' fear of misleading customers and increasing returns

**Takeaway:** mobile-first is non-negotiable. Measuring incremental lift with randomization is the market gap.

---

## 3. Competitor intelligence

The full spreadsheet is [`data/competitors.csv`](data/competitors.csv), with pricing, API access, integrations, claims, privacy, source and confidence for each company.

### 3.1 Summary matrix

| Player | Focus | Type | Public price | API | Threat to TrendSet |
|---|---|---|---|---|---|
| Google Search try-on | Apparel | Free consumer feature | Free | No | **High** for discovery. Low inside a brand's own store. |
| Google Vertex VTO | Apparel and footwear | Dev API | $0.06/image | Yes | Supplier, not a competitor. Retirement risk. |
| FASHN | Apparel | Dev API | ~$0.049–$0.075/image | Yes | Supplier. Could go direct to merchants. |
| Genlook | Apparel | Shopify app | Free plan; paid tiers unverified | ? | **High**. The same ICP, already scaling. |
| Tolstoy | Video + try-on | Shopify suite | ~$19–$299/mo (third-party) | No | Medium. Bundled feature. |
| DRESSX | Fashion/luxury | B2B API + suite | Undisclosed | Yes | Medium. Targets larger brands. |
| Perfect Corp | Beauty, eyewear, jewelry | API/SDK | Not public | Yes | Low now. High if we enter eyewear. |
| Banuba | Face AR | SDK + Shopify | $49–$349/mo self-serve | SDK | Low now. Partner candidate for eyewear. |
| FittingBox | Eyewear | SDK | Quote | SDK | Low now. |
| Kivisense | Footwear 3D/AR | Platform | Not found | ? | Low now. Partner candidate for footwear. |
| Zakeke | Configurators/AR | SaaS | Not verified | ? | Low. |
| Walmart / Amazon | In-house | n/a | n/a | No | Validate the category. They don't sell to independents. |
| Faslet | Fit + try-on | Widget | Not verified | ? | Medium. The strongest evidence of method. |
| Long tail of Shopify apps | Apparel | Shopify apps | $15–$300/mo | Mostly no | High price pressure. |

### 3.2 Where competitors are weak (hypotheses, need validation)

1. **Evidence quality.** Lift claims are almost always users versus non-users. Few vendors offer merchants a built-in randomized holdout.
2. **Cost unpredictability.** Usage overages, and per-product as well as per-try-on fees (e.g. Dimenso).
3. **Single-model lock-in.** Most apps wrap one model, so a retirement or a quality regression hits every customer.
4. **Privacy posture.** Retention periods and training use are often unclear (Walmart drew press questions in 2022).
5. **Streetwear specifics.** Oversized silhouettes, graphics and logos, and layering. Logo and print fidelity is where generic models visibly fail. This is a testable quality benchmark.

---

## 4. Unmet needs

### Independent streetwear brands (hypotheses)

- Product pages often use a single model shot, or flat-lays only. Shoppers can't picture an oversized fit on their own body.
- Brands drop limited releases and have small photo budgets. They can't shoot every size on every body type.
- They want proof before paying another monthly app fee, and they want to avoid misleading customers.
- Their teams are small, so setup has to take minutes, not a developer sprint.

### Online shoppers (hypotheses)

- They want to see whether a piece "works on me" (colour, proportion, style), separately from what size to buy.
- They want speed (under 15s), privacy (no photo kept for ever) and honesty (don't pretend it's exact).

All of these are untested. The interview scripts in [`09-merchant-pilot-plan.md`](09-merchant-pilot-plan.md) are designed to confirm or kill them.

---

## 5. Business model comparison

| Model | Pros | Cons | Fit for TrendSet now |
|---|---|---|---|
| **Consumer subscription** | Direct relationship with shoppers | Requires solving consumer acquisition *and* catalog supply. Google gives the same thing away free. | ❌ Not first |
| **Pay-per-generation (pure usage)** | Margin protected. Easy to start. | Merchants dislike unpredictable bills. Weak recurring revenue. | ⚠️ As an overage component |
| **Retailer SaaS (tiered subscription with included generations plus overage)** | Predictable revenue. Matches how Shopify merchants buy. | Wrong quotas destroy margin (see below). | ✅ **Recommended** |
| **API / enterprise** | Large contracts | Long sales cycles, security reviews, SSO and SLAs | Later (after pilots) |

**Critical finding from the financial model** ([`11-financial-model.md`](11-financial-model.md)): the illustrative tiers in your brief ($49 for 500, $149 for 2,000, $399 for 6,000 generations) have **negative gross margin on Growth and Pro at full utilization** at on-demand API prices. **Recommended test tiers:** $49 for 250, $149 for 1,000, $399 for 3,000, with overage at $0.15. That keeps margin at or above 40% even at 100% utilization and $0.075 per image. These are hypotheses to test, not validated prices.

---

## 6. Ideal first customer & differentiation

**ICP v1 (hypothesis):**
- an independent streetwear or contemporary apparel brand
- selling on **Shopify**, with **50–5,000 online orders a month**
- whose hero products are **tops, hoodies, jackets and tees**
- run by a founder or a small team, with at least 20% of traffic on mobile
- with a return rate they care about, and willingness to run a 6-week controlled pilot

**Why not enterprise first?** Long cycles and heavy security and SSO requirements, and it gives us no learning in 90 days.

**Why not a consumer marketplace first?** It means two cold starts at once, and Google already gives consumers try-on free.

**Differentiation thesis (to validate):**

> "Try-on that proves whether it works for *your* store: a built-in randomized holdout, transparent per-try-on cost, shopper photos deleted by default, and garment-fidelity tuned for streetwear graphics, with no lock-in to any one AI model."

---

## 7. Technical & API research

### 7.1 Provider comparison (apparel)

| Criterion | FASHN (tryon-v1.6) | Google Vertex (virtual-try-on-001) | Notes |
|---|---|---|---|
| Availability | Public REST API, async (submit, then poll) | GA on Vertex AI, synchronous `:predict` | Both server-side only |
| Price | $0.075/credit on-demand. 1 credit per v1.6 image. Tier III is about $0.049. **Failed predictions not charged.** | **$0.06/image** | Verified via official pages (through search) |
| Categories | Tops, bottoms, one-pieces | Tops, bottoms, footwear (per docs) | |
| Lifecycle | Versioned models (v1.5 → v1.6 → Max) | **Retirement 2027-03-15** on model page. A community report says some pages show 2027-01-20. | ⚠️ Plan migration |
| Inputs | URL or base64 | base64 or GCS URI. 1–4 samples. | |
| Watermark | Not by default | `addWatermark` (defaults true per one reference) | |
| Data retention | Outputs kept for a limited time (see FASHN data retention guide) | Google Cloud data terms (verify no training use) | **Get DPAs before the pilot** |
| Rate limits | Not confirmed (docs page not retrievable) | Vertex project quotas | Confirm with vendors |
| Latency | **Unmeasured**. Benchmark in Week 3. | **Unmeasured** | Gate: median under 15s |
| Quality | **Unmeasured** on our dataset | **Unmeasured** | Gate: at least 85% usable |

**Initial choice:**
- **FASHN is primary.** It isn't charged on failure, has a clear version path, a developer focus, and a commitment tier that brings cost under $0.05.
- **Vertex is the benchmark and fallback** until its retirement date.
- **Evaluate next:** Gemini image models as Vertex successors (a community suggestion, not official Google guidance), and fal.ai-hosted models.

Both adapters are implemented behind `TryOnProvider` (see [`04-technical-architecture.md`](04-technical-architecture.md)). Neither has been run against a live API key yet.

### 7.2 Separate engines by category

| Engine | Technology | Build vs. partner |
|---|---|---|
| Apparel | Diffusion-based try-on APIs; garment preservation; pose handling | **Integrate APIs now** |
| Footwear | Foot tracking, 3D models, camera calibration, web AR | **Partner** (e.g. Kivisense-type vendors) after apparel pilots |
| Eyewear | Face landmarks, real-time tracking, frame geometry | **Partner** (Banuba, FittingBox, Perfect Corp) |
| Size & fit | Measurement estimation, size-chart reasoning, return data | **Research only**. Never implied by try-on images. |

### 7.3 Flagged as outdated or deprecated

- Google `virtual-try-on-preview-08-04`: replaced by `virtual-try-on-001`.
- Google `virtual-try-on-001`: retirement on 2027-03-15. Verify the date.
- Google Doppl app: shut down 2026-04-30.
- Walmart "Be Your Own Model": most coverage dates from 2022. Current state unverified.
- Amazon apparel try-on: no current primary source found.

---

## 8. Risk analysis

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | Google free try-on makes the category "free" in shoppers' minds | High | High | Sell in-store conversion and measurement to merchants, not try-on to shoppers |
| 2 | Provider model retirement or price change | High | High | Provider abstraction; second adapter live; monthly vendor review |
| 3 | No measurable lift in pilots | Medium | Critical | Randomized holdout; pre-registered go/no-go; stop if it fails |
| 4 | Gross margin collapse from heavy usage | Medium | High | Quotas, per-user limits, global daily budget cap (implemented), overage pricing |
| 5 | Privacy incident with body photos | Low-Med | Critical | Private buckets, RLS, auto-deletion, no admin access to photos, DPAs, consent versioning |
| 6 | Misleading-fit complaints or regulatory exposure (FTC/ASA) | Medium | Medium | A fit disclaimer on every result; no sizing claims; no fabricated stats |
| 7 | Biometric-privacy laws (e.g. Illinois BIPA, GDPR special categories if a face is processed for identification) | Medium | High | Legal review before launch in IL/EU; no face templates; written consent |
| 8 | Poor quality on streetwear graphics and oversized fits | Medium | High | A Week-3 benchmark on a streetwear set; only enable products that pass |
| 9 | Genlook or Tolstoy out-execute on Shopify distribution | High | Medium | Niche focus plus a measurement wedge; ship the Shopify app by day 90 |
| 10 | Minors uploading photos | Medium | High | 18+ attestation; moderation; no public sharing in MVP |

---

## 9. Final strategic recommendation

| Question | Recommendation |
|---|---|
| Best first customer | Independent streetwear/contemporary apparel brands on Shopify, 50–5,000 orders a month |
| Best initial category | Tops: hoodies, tees, jackets |
| Strongest differentiation (hypothesis) | Built-in controlled lift measurement + predictable pricing + privacy-by-default + provider-agnostic routing |
| Best initial AI provider | FASHN primary; Vertex benchmark and fallback (until retirement) |
| Integration strategy | Standalone hosted try-on (MVP, already built), then a Shopify theme app extension, then a JS widget, then WooCommerce |
| Minimum viable feature set | Consent upload → garment select → generate → before/after → shop link; merchant product upload; basic counts; admin cost/error log; deletion |
| Key risks | Commodity pricing, model lifecycle, unproven lift, privacy law |
| **What NOT to build yet** | Consumer marketplace or checkout; native apps; live AR; footwear/eyewear engines; size prediction; enterprise SSO/SLA; multi-garment outfits; custom model training |
| Evidence required before investing further | ≥3 merchants in a real pilot; ≥2 naming a price; ≥85% usable outputs; median latency under 15s; GM ≥60% at expected usage; a randomized test with a credible positive lift (see thresholds in the pilot plan) |

---

## 10. Sources

| Source | Used for | Date |
|---|---|---|
| Google Cloud, Virtual Try-On model page — https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/vto/virtual-try-on-001 | GA, release and retirement dates | 2026 |
| Google Cloud pricing — https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing | $0.06/image | 2026 |
| Vertex AI release notes — https://docs.cloud.google.com/vertex-ai/generative-ai/docs/release-notes | `-001` replaces `preview-08-04` | Jan 2026 |
| Virtual Try-On API reference — https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/virtual-try-on-api | Request format | 2026 |
| GitHub issue: vertex-ai-creative-studio #1891 — https://github.com/GoogleCloudPlatform/vertex-ai-creative-studio/issues/1891 | Retirement-date inconsistency; successor suggestion | 2026 |
| FASHN API pricing — https://help.fashn.ai/plans-and-pricing/api-pricing | Credits and tiers | 2026 |
| FASHN Try-On Max changelog — https://fashn.ai/changelog/api-try-on-max-endpoint-now-available | Max credits | 2026 |
| Genlook press release — https://itbusinessnet.com/2026/09/genlook-launches-new-ai-virtual-try-on-model-for-fashion-stores-any-garment-on-the-shopper-in-under-10-seconds/ | Q2 2026 report figures | Sep 2026 |
| StoreLeads Genlook listing — https://storeleads.app/reports/shopify/app/genlook-virtual-try-on | Install count | 2026 |
| Faslet × Garcia — https://faslet.me/cases/business-case-garcia/ | Controlled A/B result | 2025–26 |
| DRESSX VTO report — https://dressx.com/b2b/vto-report | Vendor claims, B2B pivot | 2026 |
| TechCrunch, Google try-on — https://techcrunch.com/2025/07/24/googles-new-ai-feature-lets-you-virtually-try-on-clothes | Consumer feature scope | Jul 2025 |
| Google Labs Doppl — https://labs.google/doppl | Shutdown | 2026 |
| Banuba pricing — https://www.banuba.com/solutions/e-commerce/virtual-try-on | Self-serve tiers | 2026 |
| Retail Dive, Walmart — https://retaildive.com/news/walmart-expands-virtual-try-on-functionality-with-be-your-own-model | Be Your Own Model | 2022 |
| Business Wire / ResearchAndMarkets — https://www.businesswire.com/news/home/20250327363387/en | Market forecast | Mar 2025 |
| Market.us — https://market.us/report/virtual-try-on-market/ | Forecast, segments | 2025 |
| Shopify App Store listings (TryItOn, TryOn AI, Otryon, Tolstoy, Genlook) | Price points | 2026 |

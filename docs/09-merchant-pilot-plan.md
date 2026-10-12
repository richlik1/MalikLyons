# Validation Program, Merchant Pilot & Go/No-Go Criteria

> **Rule:** the thresholds below are set **before** any data is collected. We do not move them after seeing results. Estimated demand is not proven demand: until these gates are met, TrendSet has **no** validated demand.

## 1. Metrics & instrumentation

| Metric | Definition | Where it's measured | Status |
|---|---|---|---|
| Landing conversion | Distinct visitors with `waitlist_submit` ÷ distinct visitors with `page_view` | `landing_conversion_daily` view | ✅ instrumented |
| Merchant interviews | Count of completed 30-min interviews using the script below | Interview tracker sheet | Manual |
| Pilot merchants | Merchants with ≥1 live product **and** ≥50 shopper try-ons | `merchants` + `generations` | ✅ data available |
| Try-on completion rate | `succeeded` ÷ attempts (all statuses) | `generation_stats_daily.completion_pct` | ✅ |
| Funnel completion | Shoppers who generated ≥1 preview ÷ shoppers who uploaded a photo | `person_photos` ⋈ `generations` | ✅ queryable |
| Cost per generated image | `sum(cost_usd)` ÷ succeeded | `generation_stats_daily.cost_per_success_usd` | ✅ (estimate from configured rate; reconcile monthly against the vendor invoice) |
| Latency | Median and p95 `latency_ms` for succeeded | `generation_stats_daily` | ✅ median; add p95 |
| Customer satisfaction | Mean rating (1–5) and % rating ≥4 | `feedback` | ✅ |
| Merchant willingness to pay | % of pilot merchants naming a specific monthly price, and % signing a paid conversion | Pilot exit interview | Manual |
| Incremental conversion | Treatment vs. holdout conversion (see §5) | Requires storefront integration | ⬜ Growth phase |

## 2. Go / No-Go thresholds (pre-registered)

| Gate | Metric | **Go** | **Iterate** | **No-go / pivot** |
|---|---|---|---|---|
| G1 Landing | Visitor → waitlist conversion (merchant-targeted traffic, n ≥ 500 visitors) | ≥ 5% | 2–5% | < 2% |
| G2 Discovery | Merchants interviewed (target 10) who rate "seeing products on yourself" as a top-3 problem | ≥ 6 / 10 | 4–5 | ≤ 3 |
| G3 Pilot recruitment | Merchants agreeing to a real 6-week pilot | ≥ 3 | 2 | ≤ 1 |
| G4 Quality | Usable outputs on our 100-image streetwear benchmark (blind rubric, 2 raters) | ≥ 85% | 70–85% | < 70% |
| G5 Latency | Median generation time | < 15 s | 15–25 s | > 25 s |
| G6 Completion | Try-on attempts that succeed in the pilot | ≥ 90% | 80–90% | < 80% |
| G7 Satisfaction | Shopper ratings ≥ 4/5 | ≥ 60% | 45–60% | < 45% |
| G8 Economics | Gross margin at observed usage | ≥ 60% | 40–60% | < 40% |
| G9 Willingness to pay | Pilot merchants naming a specific price ≥ $49/mo after the pilot | ≥ 2 | 1 | 0 |
| G10 Lift | Randomized test: add-to-cart (primary) or conversion, treatment vs. holdout | Positive, with 90% CI excluding 0 | Positive point estimate, CI includes 0 | Point estimate ≤ 0 |

**Decision rule:**
- **Go** (raise or invest in Growth) requires G3, G4, G8 and G9 **plus** at least an "iterate" result on G10.
- Any single **no-go** on G4, G8 or G10 triggers a written pivot review.
- Note that try-on users converting more than non-users is **not** evidence for G10, because of self-selection.

## 3. 30-day research program

| Week | Work | Output |
|---|---|---|
| 1 | Competitive teardown: install 5 Shopify try-on apps on a dev store and record setup time, quality and pricing. Buy a StoreLeads export for SAM. Launch the landing page with $300–$500 of targeted traffic (streetwear founder communities, IG/TikTok ads to Shopify founders). | Scored matrix (update `data/competitors.csv`); SAM count; G1 data starts |
| 2 | 10 merchant + 15 shopper interviews (scripts below) | Interview synthesis; G2 |
| 3 | Live provider benchmark: 20 consenting models × 5 streetwear garments = 100 pairs per provider (FASHN v1.6, FASHN Max, Vertex). Blind rubric scoring. Latency and cost logged via the app. | Benchmark report; G4, G5; provider choice confirmed |
| 4 | Update the financial model with measured cost and latency. Pilot agreements. Go/no-go memo on gates G1–G5. | Decision memo |

### Quality rubric (G4): each output scored 1–5 by 2 raters, blind to provider

1. Identity preserved (face, skin tone, body shape)
2. Garment color accuracy
3. Graphic, logo and print fidelity
4. Silhouette/drape plausible (oversized reads as oversized)
5. No artifacts (hands, limbs, background)

**"Usable"** means every criterion ≥ 3 **and** both raters would show it to a shopper.

## 4. Merchant pilot (6 weeks)

**Recruitment (target 5, need ≥3):**
- **Sources:** the waitlist; warm intros; streetwear founder Discords and Slacks; Shopify Partners directory; DMs to brands with flat-lay-only product pages.
- **Screening:** Shopify, 50–5,000 orders a month, tops-heavy catalog, ≥1,000 monthly PDP sessions on chosen products, and a founder who will join 3 calls.
- **Offer:** free for 6 weeks, up to 20 products, a weekly report, and **a pre-agreed paid conversion price to be accepted or declined at the end** (tests G9 honestly).
- **Agreement must cover:** data roles (merchant is controller of shopper data on its site, TrendSet is processor), photo retention, no fit claims, the merchant's right to remove try-on at any time, and permission to publish anonymized aggregate results (only if they agree).

**Timeline:**

| Week | Activity |
|---|---|
| 0 | Kickoff. Pick 10–20 products. Upload and QA every product output (only enable products that pass the rubric). |
| 1 | Soft launch: hosted try-on link on the PDP ("See it on you"). |
| 2–5 | Live. Weekly report: try-ons, completion, ratings, click-throughs. Fix issues within 48h. |
| 6 | Exit interview: value, price, would-you-pay, what's missing. Decide on paid conversion. |

**Merchant success metrics:** try-ons per 1,000 PDP sessions; completion %; rating ≥4 share; click-through to the product page; (Growth) add-to-cart and conversion lift versus holdout; return-rate delta when 60+ days of data exist.

## 5. Controlled conversion experiment (Growth phase, requires the Shopify integration)

- **Unit:** visitor, assigned deterministically by `hash(visitor_id, experiment_id) mod 100`. 50% see the try-on button (treatment) and 50% don't (holdout). Analysis is **intent-to-treat**: everyone assigned to treatment counts, whether or not they use try-on.
- **Primary metric:** add-to-cart rate on enabled PDPs. **Secondary:** order conversion, revenue per visitor, return rate (lagging).
- **Sample size (assumption-based):**
  - With a 6% baseline add-to-cart rate, detecting a +10% relative lift (6.0% → 6.6%) at α=0.05 and 80% power needs about **25,700 visitors per arm** (about 51,000 total, two-sided two-proportion z-test).
  - Most single independent brands **cannot** reach this in 6 weeks. So we will (a) pool across pilot merchants with merchant as a stratum, and (b) report confidence intervals honestly rather than claiming significance.
- **Guardrails:** no peeking-based stopping (fixed horizon); exclude bots; sample-ratio-mismatch check.
- **Alternative if traffic is too low:** a store-level switchback (alternate weeks on and off) with clearly stated limitations.

## 6. Interview scripts

### 6a. Store owner interview (10 interviews, ~30 min)

_Intro (2 min):_ "We're researching how independent brands sell clothing online. We're not selling anything today. There are no right answers, and we'd rather hear what's not working."

**Context (5 min)**
1. Tell me about your brand: what you sell, how long, and where most sales happen.
2. Roughly how many online orders a month? What share is mobile?
3. Who handles product photography, and what does a typical shoot cost?

**Problem (10 min)**
4. Walk me through the last time a product underperformed online. What did you think the reason was?
5. What do customers ask before buying? (Probe: fit, how it looks on, sizing, fabric.)
6. What's your return rate, and the top return reasons? How do you know?
7. If you could fix one thing about how shoppers experience your products online, what would it be?
8. Rank these problems (show card): sizing uncertainty · can't picture it on themselves · photo costs · traffic · checkout drop-off · returns.

**Current solutions (5 min)**
9. What have you tried (apps, size charts, more photos, UGC)? What happened?
10. Have you tried or looked at any virtual try-on app? Why or why not? What would make you uninstall one?

**Value and price (6 min)**
11. _(Show a real try-on output on their product, if available.)_ What's your honest reaction? Would you put this on your store? What worries you?
12. How would you decide whether it's working? What number would you need to see, and over what period?
13. What do you pay monthly for your current top 3 apps?
14. At what monthly price would this be **too expensive to consider**? At what price **so cheap you'd doubt it**? (Van Westendorp, short form.)
15. Would you join a free 6-week pilot with a pre-agreed price at the end? What would stop you?

**Close (2 min)**
16. Who else should we talk to? Can we follow up?

_Note-taking: record exact quotes and avoid leading prompts. Tag each pain as Severe, Moderate or Mild. Log answers to Q8, Q14 and Q15 in the tracker._

### 6b. Shopper interview (15 interviews, ~20 min)

_Recruit:_ 18–35, bought clothing online in the last 3 months, ≥ half on mobile. Mix of genders and body types. Pay a $20 gift card.

**Behaviour (5 min)**
1. Tell me about the last piece of clothing you bought online. How did you decide?
2. Have you ever not bought something online because you weren't sure how it would look on you? What did you do instead?
3. How often do you return clothing? Why?

**Concept (8 min)**
4. _(Show the try-on flow on a phone.)_ What do you think this does? What would you expect to happen?
5. How would you feel about uploading a photo of yourself to a brand's site? What would make you comfortable or uncomfortable? (Probe: deletion, who sees it, AI training.)
6. _(Show consent screen.)_ Is this clear? Is anything missing?
7. _(Show a real result.)_ Does this help you decide? What would you trust or not trust about it?
8. Does this tell you what size to buy? _(We're checking whether people misread try-on as fit. We want the answer "no".)_

**Value (5 min)**
9. Would you use this before buying? On which kinds of items?
10. How long would you wait for the preview before giving up?
11. Would this make you more likely to buy from a small brand you don't know?

**Close (2 min)**
12. Anything that would stop you using this entirely?

_Synthesis: % comfortable uploading (target ≥50%), max acceptable wait, % who misread the result as a size recommendation (target ≤20%; above that means stronger disclaimers or UX changes)._

## 7. Tracking sheet columns (for interviews)

`date, type (merchant/shopper), name/alias, segment, orders_per_month, top_problem, problem_severity, current_tools, reaction_to_output (1-5), price_too_expensive, price_too_cheap, pilot_yes_no, objections, quotes, follow_up`

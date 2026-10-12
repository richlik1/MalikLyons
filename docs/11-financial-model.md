# Financial Model (illustrative)

> **Correction (12 Oct 2026):** see [`13-billing-architecture.md` §3](13-billing-architecture.md#3-corrected-unit-economics). It adds billing-platform and app-store fees. It also shows that **Growth and Pro miss the 60% margin gate at full use on on-demand AI pricing** (Pro: 39%), and that the Pro overage of $0.12 is too low.

> **Every number on this page is an assumption or estimate unless marked Verified.** Prices are hypotheses to test in pilots, not validated market rates. Raw scenario output: [`data/financial-model.csv`](data/financial-model.csv).

## 1. Unit cost per successful try-on

| Component | Conservative | Base | Aggressive | Basis |
|---|---|---|---|---|
| AI generation per image | $0.075 | $0.060 | $0.049 | **Verified list prices:** FASHN on-demand $0.075; Vertex $0.06; FASHN Tier III ≈ $0.049 |
| Failed generations | $0 | $0 | $0 | FASHN: failures not charged (verified). Vertex: **verify**. |
| Regenerations per satisfied shopper | 1.4 | 1.25 | 1.1 | Assumption. Measure in the pilot. |
| **Effective AI cost per satisfied try-on** | **$0.105** | **$0.075** | **$0.054** | Derived |
| Storage + egress per try-on | < $0.001 | < $0.001 | < $0.001 | Assumption: ~2 MB of images, 30-day retention |

## 2. Fixed platform costs (monthly)

| Item | Lean | Funded | Note |
|---|---|---|---|
| Supabase Pro | ~$25 | ~$25–$100 | Verify current pricing |
| Vercel Pro | ~$20/seat | ~$40–$100 | Verify current pricing |
| Email, monitoring, domain, tools | ~$100 | ~$400 | Assumption |
| Contractors, legal, misc. | ~$1,355 | — | Assumption |
| Salaries (2 FTE, loaded) | $0 (founders unpaid) | ~$29,000 | Assumption |
| **Total** | **≈ $1,500** | **≈ $30,000** | |

## 3. Gross margin by tier

### 3a. Tiers from your brief: **margin trap at high usage**

COGS = included generations × utilization × AI cost + payment fees (2.9% + $0.30) + $2 infrastructure allocation.

| Tier | Price/mo | Included | Conservative (100% used, $0.075) | Base (50% used, $0.06) | Aggressive (30% used, $0.049) |
|---|---|---|---|---|---|
| Starter | $49 | 500 | 16% | 62% | 77% |
| Growth | $149 | 2,000 | **−5%** | 55% | 76% |
| Pro | $399 | 6,000 | **−16%** | 51% | 74% |

The illustrative mix from your brief (30 Starter, 15 Growth, 5 Pro) gives **$5,700 MRR / $68,400 ARR**, but blended gross margin swings from **−4%** (conservative) to **56%** (base) to **76%** (aggressive). This is the single biggest pricing risk.

### 3b. Recommended test tiers: margin-safe even at 100% utilization

| Tier | Price/mo | Included generations | Overage | GM at 100% use, $0.075 | GM at 100% use, $0.06 | GM at 100% use, $0.049 |
|---|---|---|---|---|---|---|
| Starter | $49 | 250 | $0.15 | 54% | 62% | 67% |
| Growth | $149 | 1,000 | $0.15 | 45% | 55% | 63% |
| Pro | $399 | 3,000 | $0.12 | 40% | 51% | 60% |
| Enterprise / API | Custom | Committed volume | ≥ $0.10 | Target ≥ 60% | | |

Overage at $0.12–$0.15 against $0.05–$0.075 cost is a 50–67% margin on incremental usage. Moving to FASHN commitment tiers once volume exceeds about 4,000 images a month is the main lever for reaching the ≥60% gate.

## 4. Unit economics (tiers from brief, blended ARPU $114)

| Scenario | Blended GM | Monthly churn | CAC | LTV (ARPU × GM ÷ churn) | CAC payback |
|---|---|---|---|---|---|
| Conservative | −4% | 8% | $600 | negative | never |
| Base | 56% | 5% | $300 | ≈ $1,270 | ≈ 4.7 mo |
| Aggressive | 76% | 3% | $150 | ≈ $2,880 | ≈ 1.7 mo |

**Churn sensitivity (base GM 56%, ARPU $114):**

| Monthly churn | LTV |
|---|---|
| 3% | ≈ $2,130 |
| 5% | ≈ $1,270 |
| 8% | ≈ $800 |
| 12% | ≈ $530 |

At 12% churn, which is common for low-price Shopify apps, LTV only covers about 1.8× a $300 CAC. **Retention evidence matters as much as conversion lift.**

**CAC assumptions:** founder-led outreach and Shopify App Store organic. $150 (aggressive), $300 (base), $600 (conservative, with paid acquisition). Measure from day 1: (outreach hours × hourly value + ad spend) ÷ pilots signed.

## 5. Break-even

| Scenario | Lean (≈ $1,500/mo fixed) | Funded (≈ $30,000/mo fixed) |
|---|---|---|
| Conservative | Not reachable (negative GM) | Not reachable |
| Base | ≈ **24 merchants** | ≈ **473 merchants** |
| Aggressive | ≈ 17 merchants | ≈ 347 merchants |

## 6. Development cost & capital requirement (estimates)

| Item | Lean path | Funded path |
|---|---|---|
| MVP (this repo) to staging | Done (founder time) | — |
| Pilot hardening: Shopify extension, widget, billing, holdout (≈ 8–10 engineering weeks) | Founder time + ~$5–15k contractors | Included in salaries |
| AI spend during research + pilots (≈ 10–20k images) | ~$600–$1,500 | ~$1,500 |
| Legal (privacy policy, DPA templates, pilot agreement) | ~$3–8k | ~$8–15k |
| 12-month runway | ~$18k fixed + above ≈ **$30–45k** | ~$360k + above ≈ **$400–450k** |

**Recommendation:** run the 30-day research and 6-week pilot on the **lean path** (under ~$15k cash). Raise only after the go/no-go gates in [`09-merchant-pilot-plan.md`](09-merchant-pilot-plan.md) are met.

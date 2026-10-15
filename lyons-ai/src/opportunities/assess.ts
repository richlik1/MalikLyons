import type { Candidate, Confidence, Eligibility, OwnerProfile, ScoreBreakdown, VerificationResult } from "./types.js";

/** Grants.gov applicant-type descriptions that include a for-profit small business LLC. */
const SMALL_BIZ_OK = [/^small businesses$/i, /^unrestricted/i];
const OTHERS = /^others\b/i;
const FOR_PROFIT_NOT_SMALL = /for profit organizations other than small businesses/i;

const SET_ASIDE_CERTS: Record<string, string> = {
  "8A": "8(a)",
  "8AN": "8(a)",
  WOSB: "WOSB",
  EDWOSB: "EDWOSB",
  SDVOSBC: "SDVOSB",
  SDVOSBS: "SDVOSB",
  HZC: "HUBZone",
  HZS: "HUBZone",
  VSA: "VOSB",
  VSS: "VOSB",
};

export interface EligibilityResult {
  eligibility: Eligibility;
  notes: string;
  prerequisites: string[];
}

/**
 * Deterministic eligibility check. It never upgrades "unknown" to "eligible":
 * missing information produces "unclear" plus the question to answer.
 */
export function assessEligibility(c: Candidate, p: OwnerProfile): EligibilityResult {
  const prerequisites: string[] = [];

  if (c.source === "grants_gov") {
    const types = c.applicantTypes ?? [];
    if (!types.length) return { eligibility: "unclear", notes: "The listing does not state applicant types.", prerequisites };
    if (types.some((t) => SMALL_BIZ_OK.some((re) => re.test(t.trim())))) {
      prerequisites.push("Active SAM.gov registration (UEI) and Grants.gov account");
      if (p.business.samRegistered !== true) prerequisites.push("Register in SAM.gov first — free, typically 7–10 business days");
      return { eligibility: p.business.smallBusiness ? "likely" : "unclear", notes: `Applicant types include: ${types.join("; ")}.`, prerequisites };
    }
    if (types.some((t) => OTHERS.test(t.trim()))) {
      return {
        eligibility: "unclear",
        notes: `Eligibility is "Others" — read the eligibility text: ${(c.eligibilityText ?? "not provided").slice(0, 300)}`,
        prerequisites,
      };
    }
    if (types.some((t) => FOR_PROFIT_NOT_SMALL.test(t)) && !p.business.smallBusiness) {
      return { eligibility: "likely", notes: `Applicant types include: ${types.join("; ")}.`, prerequisites };
    }
    return { eligibility: "ineligible", notes: `Only open to: ${types.join("; ")}.`, prerequisites };
  }

  if (c.source === "sam_gov") {
    prerequisites.push("Active SAM.gov entity registration to submit a bid");
    if (p.business.samRegistered !== true) prerequisites.push("Register in SAM.gov first — free, typically 7–10 business days");
    if (c.location && !new RegExp(`\\b${p.business.state}\\b`).test(c.location)) {
      return { eligibility: "ineligible", notes: `Place of performance (${c.location}) is outside ${p.business.state}.`, prerequisites };
    }
    const code = (c.setAside ?? "").toUpperCase();
    if (!code || code === "NONE") return { eligibility: "likely", notes: "Full and open competition (no set-aside).", prerequisites };
    if (code === "SBA" || code === "SBP") {
      return p.business.smallBusiness
        ? { eligibility: "likely", notes: "Small-business set-aside; size standard for the NAICS code must be met.", prerequisites }
        : { eligibility: "ineligible", notes: "Small-business set-aside.", prerequisites };
    }
    const cert = SET_ASIDE_CERTS[code];
    if (cert) {
      return p.business.certifications.includes(cert)
        ? { eligibility: "likely", notes: `${cert} set-aside and you hold ${cert}.`, prerequisites }
        : { eligibility: "unclear", notes: `${cert} set-aside — requires ${cert} certification, which isn't on your profile.`, prerequisites };
    }
    return { eligibility: "unclear", notes: `Set-aside type ${code}; check the solicitation.`, prerequisites };
  }

  if (c.source === "github") {
    return c.signals?.license
      ? { eligibility: "eligible", notes: `Open source (${c.signals.license}); anyone may use it under its license.`, prerequisites }
      : { eligibility: "unclear", notes: "No license published: reuse rights are unclear.", prerequisites };
  }

  // Web-research findings: rely on stated eligibility text only.
  if (c.eligibilityText && /\b(nonprofit|501\(c\)|university|tribal|state government)s?\s+only\b/i.test(c.eligibilityText)) {
    return { eligibility: "ineligible", notes: c.eligibilityText.slice(0, 300), prerequisites };
  }
  return { eligibility: "unclear", notes: c.eligibilityText?.slice(0, 300) ?? "Eligibility not stated by the source.", prerequisites };
}

export function daysUntil(d: Date | null | undefined, now: Date): number | null {
  return d ? Math.floor((d.getTime() - now.getTime()) / 86_400_000) : null;
}

export interface Rejection {
  reason: string;
}

/** Hard filters applied before scoring. Anything returned here is not shown to the owner. */
export function hardReject(c: Candidate, elig: EligibilityResult, p: OwnerProfile, now: Date, verification: VerificationResult): Rejection | null {
  if (!verification.ok) {
    const failed = verification.checks.filter((x) => !x.passed).map((x) => `${x.name}: ${x.detail}`);
    return { reason: `Verification failed (${failed.join("; ")})` };
  }
  const days = daysUntil(c.deadlineAt, now);
  if (days !== null && days < 0) return { reason: "Deadline has passed." };
  if (days !== null && days < p.constraints.minDaysToDeadline) {
    return { reason: `Only ${days} day(s) to the deadline (minimum ${p.constraints.minDaysToDeadline}).` };
  }
  if (elig.eligibility === "ineligible") return { reason: `Not eligible: ${elig.notes}` };
  if (c.capitalRequiredUsd !== undefined && c.capitalRequiredUsd > p.constraints.maxUpfrontInvestmentUsd) {
    return { reason: `Requires $${c.capitalRequiredUsd.toLocaleString("en-US")} upfront, above your $${p.constraints.maxUpfrontInvestmentUsd.toLocaleString("en-US")} limit.` };
  }
  const status = (c.sourceStatus ?? "").toLowerCase();
  if (["closed", "archived", "inactive", "cancelled"].includes(status)) return { reason: `Source lists it as ${status}.` };
  return null;
}

const SCAM_PATTERNS = [
  /application fee/i,
  /processing fee/i,
  /guaranteed (approval|funding|grant)/i,
  /free (government )?grant money/i,
  /wire (the )?fee/i,
  /gift card/i,
];

export function scamSignals(text: string): string[] {
  return SCAM_PATTERNS.filter((re) => re.test(text)).map((re) => re.source);
}

export interface FeedbackStats {
  accepted: number;
  rejected: number;
}

/**
 * Bounded learning: shifts a score by at most ±10 from the owner's past
 * decisions on the same category/source, and only after 3+ decisions.
 */
export function learnedAdjustment(stats: FeedbackStats | undefined): number {
  if (!stats) return 0;
  const n = stats.accepted + stats.rejected;
  if (n < 3) return 0;
  const rate = (stats.accepted + 1) / (n + 2); // Laplace-smoothed acceptance rate
  return Math.max(-10, Math.min(10, Math.round((rate - 0.5) * 20)));
}

/** Configurable maxima (they sum to 100) and band thresholds. Stored in settings "opportunity.scoring". */
export interface ScoringConfig {
  weights: {
    strategicFit: number;
    financialUpside: number;
    executionProbability: number;
    capitalAffordability: number;
    timeEffort: number;
    timingUrgency: number;
    evidenceQuality: number;
  };
  bands: { high: number; investigate: number; watchlist: number };
}

export const DEFAULT_SCORING: ScoringConfig = {
  weights: { strategicFit: 20, financialUpside: 20, executionProbability: 20, capitalAffordability: 15, timeEffort: 10, timingUrgency: 10, evidenceQuality: 5 },
  bands: { high: 85, investigate: 70, watchlist: 50 },
};

export const SCORING_MODEL_VERSION = "blueprint-v1";

export function bandFor(total: number, cfg: ScoringConfig = DEFAULT_SCORING): ScoreBreakdown["band"] {
  if (total >= cfg.bands.high) return "high";
  if (total >= cfg.bands.investigate) return "investigate";
  if (total >= cfg.bands.watchlist) return "watchlist";
  return "archive";
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Typical owner hours to act on one item, by category (conservative). */
const EFFORT_HOURS: Record<string, number> = {
  contracts: 6,
  grants_financing: 12,
  real_estate: 10,
  business_ideas: 8,
  development: 2,
  personal: 1,
  operations: 2,
  technology: 2,
};

const OFFICIAL_HOST = /\.(gov|mil|edu)$|(^|\.)michigan\.gov$|(^|\.)detroitmi\.gov$/i;

/**
 * Seven-factor score (blueprint v1.0). Each factor is computed as a 0..1
 * fraction and scaled by its configurable maximum. Conservative by design:
 * unknown values score in the middle-low range, never as best case.
 */
export function scoreOpportunity(
  c: Candidate,
  elig: EligibilityResult,
  p: OwnerProfile,
  ctx: { now: Date; openCommitments: number; feedback?: FeedbackStats; verificationMethod?: string; verifiedUrl?: string; config?: ScoringConfig },
): ScoreBreakdown {
  const cfg = ctx.config ?? DEFAULT_SCORING;
  const w = cfg.weights;
  const notes: string[] = [];

  // Strategic fit: category weight, keyword/NAICS/location match, bounded learning (±20% of the factor).
  const text = `${c.title} ${c.summary ?? ""}`.toLowerCase();
  const terms =
    c.category === "contracts"
      ? p.searchTerms.contracts
      : c.category === "grants_financing"
        ? p.searchTerms.grants
        : c.category === "technology" || c.category === "operations"
          ? p.searchTerms.technology
          : [...p.interests, ...p.goals.flatMap((g) => g.toLowerCase().split(/\s+/).filter((x) => x.length > 5))];
  const hits = terms.filter((t) => text.includes(t.toLowerCase())).length;
  let fit = 0.45 * (p.categoryWeights[c.category] ?? 0.5) + Math.min(3, hits) * 0.12;
  if (c.naics && p.business.naics.includes(c.naics)) {
    fit += 0.1;
    notes.push(`NAICS ${c.naics} matches your services`);
  }
  if (c.location && p.business.cities.some((city) => c.location!.toLowerCase().includes(city.toLowerCase()))) {
    fit += 0.1;
    notes.push("Located in Metro Detroit");
  }
  const learnedPts = learnedAdjustment(ctx.feedback); // ±10 on the legacy scale
  const learnedFrac = learnedPts / 50; // → at most ±0.2 of this factor
  if (learnedPts) notes.push(`Adjusted from your past decisions on similar items`);
  const strategicFit = Math.round(w.strategicFit * clamp01(fit + learnedFrac));

  // Financial upside: confirmed amounts only; loans and paid programs count less.
  const amount = c.amountMax ?? c.amountMin;
  let up: number;
  if (amount && amount > 0) {
    up = Math.max(0.15, clamp01(Math.log10(amount) / 6));
    if (c.fundingType === "loan") {
      up *= 0.3;
      notes.push("This is a loan, not a grant: it must be repaid");
    } else if (c.fundingType === "reimbursement") {
      up *= 0.6;
      notes.push("Reimbursement: you pay first and are paid back later");
    } else if (c.fundingType === "paid_program") {
      up *= 0.1;
      notes.push("Paid program: it costs money rather than providing it");
    }
  } else {
    up = { contracts: 0.35, grants_financing: 0.3, real_estate: 0.25, technology: 0.15, operations: 0.15 }[c.category as string] ?? 0.2;
    notes.push("Dollar value not stated by the source");
  }
  const financialUpside = Math.round(w.financialUpside * clamp01(up));

  // Execution probability: eligibility, competition, project maturity, workload.
  let ex = { eligible: 1, likely: 0.75, unclear: 0.4, ineligible: 0 }[elig.eligibility];
  if (c.source === "sam_gov" && !(c.setAside ?? "")) ex *= 0.85; // full and open competition
  if (c.opportunityType === "forecast") {
    ex *= 0.8;
    notes.push("Projected procurement — not yet open for bids");
  }
  if (c.category === "technology" || c.category === "operations") {
    const recent = typeof c.signals?.daysSincePush === "number" ? (c.signals.daysSincePush as number) <= 90 : false;
    const licensed = Boolean(c.signals?.license);
    ex = (licensed ? 0.5 : 0.2) + (recent ? 0.3 : 0);
  }
  if (ctx.openCommitments >= 5) {
    ex *= 0.8;
    notes.push(`You already have ${ctx.openCommitments} opportunities in progress`);
  }
  const executionProbability = Math.round(w.executionProbability * clamp01(ex));

  // Capital affordability (unaffordable amounts are hard-rejected before scoring).
  let cap: number;
  if (c.capitalRequiredUsd !== undefined) {
    const max = p.constraints.maxUpfrontInvestmentUsd;
    cap = c.capitalRequiredUsd === 0 ? 1 : c.capitalRequiredUsd <= max * 0.25 ? 0.8 : 0.5;
  } else if (c.costSharing) {
    cap = 0.4;
    notes.push("Requires cost sharing / matching funds");
  } else if (c.fundingType === "free" || c.category === "technology") {
    cap = 1;
  } else {
    cap = 0.6;
  }
  const capitalAffordability = Math.round(w.capitalAffordability * clamp01(cap));

  // Time and effort relative to the owner's spare hours (a month of spare time).
  const hours = EFFORT_HOURS[c.category] ?? 6;
  const timeEffort = Math.round(w.timeEffort * clamp01(Math.max(0.2, 1 - hours / Math.max(1, p.constraints.weeklyHoursAvailable * 4))));

  // Timing and urgency.
  const days = daysUntil(c.deadlineAt, ctx.now);
  let tu: number;
  if (c.opportunityType === "forecast") tu = 0.3;
  else if (days === null) tu = 0.4;
  else if (days < p.constraints.minDaysToDeadline) tu = 0;
  else if (days <= 30) tu = 1;
  else if (days <= 60) tu = 0.8;
  else if (days <= 120) tu = 0.5;
  else tu = 0.3;
  const timingUrgency = Math.round(w.timingUrgency * tu);

  // Evidence quality.
  let ev = 0.6;
  const method = ctx.verificationMethod ?? "";
  if (method.startsWith("api:")) ev = 1;
  else if (method.startsWith("email:")) ev = 0.4;
  else if (method.startsWith("page:")) {
    try {
      ev = OFFICIAL_HOST.test(new URL(ctx.verifiedUrl ?? c.url).hostname) ? 0.8 : 0.6;
    } catch {
      ev = 0.6;
    }
  }
  if (c.deadlineAt && c.deadlineConfirmed === false) ev -= 0.2;
  const evidenceQuality = Math.round(w.evidenceQuality * clamp01(ev));

  const total = Math.max(0, Math.min(100, strategicFit + financialUpside + executionProbability + capitalAffordability + timeEffort + timingUrgency + evidenceQuality));
  return {
    strategicFit,
    financialUpside,
    executionProbability,
    capitalAffordability,
    timeEffort,
    timingUrgency,
    evidenceQuality,
    learned: learnedPts ? Math.round(w.strategicFit * learnedFrac) : 0,
    total,
    band: bandFor(total, cfg),
    notes,
  };
}

/** One-line human explanation of a score. */
export function explainScore(s: ScoreBreakdown, cfg: ScoringConfig = DEFAULT_SCORING): string {
  const w = cfg.weights;
  return [
    `fit ${s.strategicFit}/${w.strategicFit}`,
    `upside ${s.financialUpside}/${w.financialUpside}`,
    `execution ${s.executionProbability}/${w.executionProbability}`,
    `capital ${s.capitalAffordability}/${w.capitalAffordability}`,
    `effort ${s.timeEffort}/${w.timeEffort}`,
    `timing ${s.timingUrgency}/${w.timingUrgency}`,
    `evidence ${s.evidenceQuality}/${w.evidenceQuality}`,
  ].join(" · ");
}

export function confidenceFor(c: Candidate, v: VerificationResult, elig: EligibilityResult): Confidence {
  const authoritative = v.method.startsWith("api:");
  if (authoritative && c.deadlineConfirmed !== false && elig.eligibility !== "unclear") return "high";
  if (authoritative || (v.ok && c.deadlineConfirmed)) return "medium";
  return "low";
}

/** Items in the "investigate" band or above become qualified (shown in briefings). */
export const QUALIFY_THRESHOLD = DEFAULT_SCORING.bands.investigate;
/** Exceptional alerts: high band only, and only when timing matters. */
export const ALERT_THRESHOLD = DEFAULT_SCORING.bands.high;
export const ALERT_WINDOW_DAYS = 14;

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

export function scoreOpportunity(
  c: Candidate,
  elig: EligibilityResult,
  p: OwnerProfile,
  ctx: { now: Date; openCommitments: number; feedback?: FeedbackStats },
): ScoreBreakdown {
  const notes: string[] = [];

  // Value (0-30): log scale on the confirmed amount. Unknown amount is neutral.
  const amount = c.amountMax ?? c.amountMin;
  let value: number;
  if (amount && amount > 0) {
    value = Math.max(5, Math.min(30, Math.round((Math.log10(amount) / 6) * 30)));
  } else {
    value = 10;
    notes.push("Dollar value not stated by the source");
  }

  // Fit (0-25): category weight, keyword and NAICS matches, location.
  const text = `${c.title} ${c.summary ?? ""}`.toLowerCase();
  const terms = c.category === "contracts" ? p.searchTerms.contracts : c.category === "grants_financing" ? p.searchTerms.grants : p.interests;
  const termHits = terms.filter((t) => text.includes(t.toLowerCase())).length;
  let fit = Math.round(10 * (p.categoryWeights[c.category] ?? 0.5)) + Math.min(10, termHits * 4);
  if (c.naics && p.business.naics.includes(c.naics)) {
    fit += 5;
    notes.push(`NAICS ${c.naics} matches your services`);
  }
  if (c.location && p.business.cities.some((city) => c.location!.toLowerCase().includes(city.toLowerCase()))) {
    fit += 5;
    notes.push("Located in Metro Detroit");
  }
  fit = Math.min(25, fit);

  // Feasibility (0-20): eligibility and current workload.
  let feasibility = { eligible: 20, likely: 15, unclear: 8, ineligible: 0 }[elig.eligibility];
  if (ctx.openCommitments >= 5) {
    feasibility = Math.max(0, feasibility - 5);
    notes.push(`You already have ${ctx.openCommitments} opportunities in progress`);
  }

  // Timing (0-15).
  const days = daysUntil(c.deadlineAt, ctx.now);
  let timing: number;
  if (days === null) timing = 7;
  else if (days < p.constraints.minDaysToDeadline) timing = 0;
  else if (days <= 45) timing = 15;
  else if (days <= 120) timing = 10;
  else timing = 6;

  // Cost/effort (0-10).
  let cost = 7;
  if (c.costSharing) {
    cost = 3;
    notes.push("Requires cost sharing / matching funds");
  }
  if ((c.setAside ?? "").toUpperCase() === "SBA") cost = 9;

  const learned = learnedAdjustment(ctx.feedback);
  if (learned) notes.push(`Adjusted ${learned > 0 ? "+" : ""}${learned} from your past decisions on similar items`);

  const total = Math.max(0, Math.min(100, value + fit + feasibility + timing + cost + learned));
  return { value, fit, feasibility, timing, cost, learned, total, notes };
}

export function confidenceFor(c: Candidate, v: VerificationResult, elig: EligibilityResult): Confidence {
  const authoritative = v.method.startsWith("api:");
  if (authoritative && c.deadlineConfirmed !== false && elig.eligibility !== "unclear") return "high";
  if (authoritative || (v.ok && c.deadlineConfirmed)) return "medium";
  return "low";
}

export const QUALIFY_THRESHOLD = 55;
export const ALERT_THRESHOLD = 80;
export const ALERT_WINDOW_DAYS = 21;

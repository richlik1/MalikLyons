export const OPPORTUNITY_CATEGORIES = [
  "contracts", // commercial cleaning, turnovers, property management, vendor/procurement
  "grants_financing", // grants, assistance programs, loans
  "real_estate",
  "business_ideas", // new markets, software, partnerships
  "development", // mentorship, networking, training, leadership
  "personal", // parenting, community, life improvement
  "operations", // legacy: tools, cost reductions (now part of the technology department)
  "technology", // AI, agent frameworks, property tech, automation
] as const;
export type OpportunityCategory = (typeof OPPORTUNITY_CATEGORIES)[number];

export const OPPORTUNITY_STATUSES = ["discovered", "verified", "qualified", "approved", "in_progress", "closed", "rejected", "archived"] as const;

/** The six research departments and their share of research EFFORT (not spending). */
export const DEPARTMENTS = ["contracts", "grants", "ventures", "real_estate", "personal_growth", "technology"] as const;
export type Department = (typeof DEPARTMENTS)[number];

export const DEFAULT_ALLOCATION: Record<Department, number> = {
  contracts: 0.3,
  grants: 0.2,
  ventures: 0.15,
  real_estate: 0.15,
  personal_growth: 0.1,
  technology: 0.1,
};

export const DEPARTMENT_LABEL: Record<Department, string> = {
  contracts: "Cleaning contracts & clients",
  grants: "Grants & financing",
  ventures: "New businesses & investments",
  real_estate: "Real estate",
  personal_growth: "Personal growth",
  technology: "AI & technology",
};

export function departmentForCategory(c: OpportunityCategory): Department {
  switch (c) {
    case "contracts":
      return "contracts";
    case "grants_financing":
      return "grants";
    case "business_ideas":
      return "ventures";
    case "real_estate":
      return "real_estate";
    case "development":
    case "personal":
      return "personal_growth";
    default:
      return "technology";
  }
}

/** Open solicitations can be acted on now; forecasts are projected and must never be presented as open. */
export type OpportunityType = "open_solicitation" | "forecast" | "program" | "listing" | "idea" | "resource";
/** Grants must be distinguished from loans, reimbursements and paid programs. */
export type FundingType = "grant" | "loan" | "reimbursement" | "paid_program" | "tax_incentive" | "contract" | "free" | "unknown";

export type PriorityBand = "high" | "investigate" | "watchlist" | "archive";
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

export type Eligibility = "eligible" | "likely" | "unclear" | "ineligible";
export type Confidence = "high" | "medium" | "low";

/** A raw finding from a source. Only fields the source itself states go here. */
export interface Candidate {
  source: string;
  sourceId: string;
  category: OpportunityCategory;
  title: string;
  organization?: string;
  /** Primary-source URL the owner can open to check the facts. */
  url: string;
  summary?: string;
  location?: string;
  postedAt?: Date;
  deadlineAt?: Date | null;
  /** Whether the deadline came from an authoritative field (vs. inferred text). */
  deadlineConfirmed?: boolean;
  amountMin?: number;
  amountMax?: number;
  /** Source-specific status (e.g. "posted", "forecasted", "active"). */
  sourceStatus?: string;
  applicantTypes?: string[];
  eligibilityText?: string;
  setAside?: string;
  naics?: string;
  costSharing?: boolean;
  /** Registry entry that produced this candidate. */
  sourceRegistryId?: string;
  opportunityType?: OpportunityType;
  fundingType?: FundingType;
  /** Confirmed upfront capital required, if the source states it. */
  capitalRequiredUsd?: number;
  /** Source-provided evidence of activity/maturity (e.g. GitHub stars, last push). */
  signals?: Record<string, number | string | boolean>;
  raw: unknown;
}

export interface VerificationCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface VerificationResult {
  ok: boolean;
  method: string;
  authoritativeUrl: string;
  checkedAt: Date;
  checks: VerificationCheck[];
  /** Facts refreshed from the authoritative source; they override discovery data. */
  updates?: Partial<Candidate>;
}

export interface SourceAdapter {
  readonly name: string;
  readonly categories: OpportunityCategory[];
  /** Whether credentials/config needed by this source are present. */
  configured(): boolean;
  discover(profile: OwnerProfile, signal: AbortSignal): Promise<Candidate[]>;
  verify(candidate: Candidate, signal: AbortSignal): Promise<VerificationResult>;
}

/**
 * What the agent knows about the owner. Unknowns stay null and are surfaced as
 * eligibility questions instead of being assumed.
 */
export interface OwnerProfile {
  business: {
    legalName: string;
    entityType: string;
    state: string;
    metroArea: string;
    cities: string[];
    naics: string[];
    smallBusiness: boolean;
    samRegistered: boolean | null;
    certifications: string[];
    yearsInBusiness: number | null;
    annualRevenueUsd: number | null;
    employees: number | null;
  };
  searchTerms: {
    grants: string[];
    contracts: string[];
    technology: string[];
  };
  constraints: {
    maxUpfrontInvestmentUsd: number;
    weeklyHoursAvailable: number;
    /** Opportunities closing sooner than this are rejected as not realistically actionable. */
    minDaysToDeadline: number;
  };
  goals: string[];
  interests: string[];
  activeProjects: string[];
  /** Category weights 0..1 (how much the owner cares right now). */
  categoryWeights: Record<OpportunityCategory, number>;
}

/** Blueprint v1.0 scoring: 100 points across seven factors. */
export interface ScoreBreakdown {
  strategicFit: number; // max 20 (includes bounded learning)
  financialUpside: number; // max 20
  executionProbability: number; // max 20
  capitalAffordability: number; // max 15
  timeEffort: number; // max 10
  timingUrgency: number; // max 10
  evidenceQuality: number; // max 5
  learned: number; // already included in strategicFit; shown for transparency
  total: number;
  band: PriorityBand;
  notes: string[];
}

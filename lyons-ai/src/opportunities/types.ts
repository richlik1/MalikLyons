export const OPPORTUNITY_CATEGORIES = [
  "contracts", // commercial cleaning, turnovers, property management, vendor/procurement
  "grants_financing", // grants, assistance programs, loans
  "real_estate",
  "business_ideas", // new markets, software, partnerships
  "development", // mentorship, networking, training, leadership
  "personal", // parenting, community, life improvement
  "operations", // tools, cost reductions, relevant developments
] as const;
export type OpportunityCategory = (typeof OPPORTUNITY_CATEGORIES)[number];

export const OPPORTUNITY_STATUSES = ["discovered", "verified", "qualified", "approved", "in_progress", "closed", "rejected"] as const;
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

export interface ScoreBreakdown {
  value: number;
  fit: number;
  feasibility: number;
  timing: number;
  cost: number;
  learned: number;
  total: number;
  notes: string[];
}

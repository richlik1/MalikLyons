import type { Store } from "../db/store.js";
import type { OwnerProfile } from "./types.js";

export const PROFILE_KEY = "opportunity.profile";

/**
 * Starting profile from what the owner has told LYONS AI. Anything not stated
 * (SAM registration, revenue, certifications, headcount) is null/empty on
 * purpose so eligibility comes back "unclear" with a question, not a guess.
 */
export const DEFAULT_PROFILE: OwnerProfile = {
  business: {
    legalName: "Lyons Cleaning Solutions LLC",
    entityType: "LLC",
    state: "MI",
    metroArea: "Metro Detroit",
    cities: ["Detroit", "Dearborn", "Southfield", "Warren", "Livonia", "Troy", "Farmington Hills", "Sterling Heights", "Ann Arbor", "Pontiac"],
    // 561720 Janitorial Services; 561790 Other Services to Buildings and Dwellings; 561210 Facilities Support Services
    naics: ["561720", "561790", "561210"],
    smallBusiness: true,
    samRegistered: null,
    certifications: [],
    yearsInBusiness: null,
    annualRevenueUsd: null,
    employees: null,
  },
  searchTerms: {
    grants: ["small business", "workforce training", "minority business", "entrepreneur", "Michigan small business"],
    contracts: ["janitorial", "custodial", "cleaning services", "facility maintenance"],
    technology: ["agent", "telegram", "property", "rental", "scheduling", "cleaning", "automation", "workflow", "claude"],
  },
  constraints: {
    maxUpfrontInvestmentUsd: 5000,
    weeklyHoursAvailable: 6,
    minDaysToDeadline: 7,
  },
  goals: ["Grow commercial cleaning revenue", "Win recurring contracts", "Build StayOps into a product", "Improve financial stability"],
  interests: ["leadership", "communication", "AI and software", "real estate", "parenting"],
  activeProjects: ["Lyons Cleaning Solutions operations", "StayOps platform", "Imperial Manor"],
  categoryWeights: {
    contracts: 1,
    grants_financing: 0.9,
    real_estate: 0.6,
    business_ideas: 0.5,
    development: 0.6,
    personal: 0.5,
    operations: 0.6,
    technology: 0.6,
  },
};

export async function loadProfile(store: Store): Promise<OwnerProfile> {
  const saved = await store.getSetting<Partial<OwnerProfile>>(PROFILE_KEY);
  if (!saved) return DEFAULT_PROFILE;
  return {
    ...DEFAULT_PROFILE,
    ...saved,
    business: { ...DEFAULT_PROFILE.business, ...(saved.business ?? {}) },
    searchTerms: { ...DEFAULT_PROFILE.searchTerms, ...(saved.searchTerms ?? {}) },
    constraints: { ...DEFAULT_PROFILE.constraints, ...(saved.constraints ?? {}) },
    categoryWeights: { ...DEFAULT_PROFILE.categoryWeights, ...(saved.categoryWeights ?? {}) },
  };
}

/** Questions whose answers would sharpen eligibility checks. */
export function profileGaps(p: OwnerProfile): string[] {
  const gaps: string[] = [];
  if (p.business.samRegistered === null) gaps.push("Is Lyons Cleaning Solutions registered in SAM.gov (do you have a UEI)?");
  if (p.business.annualRevenueUsd === null) gaps.push("Approximate annual revenue (many programs have size limits)?");
  if (p.business.employees === null) gaps.push("Number of employees?");
  if (p.business.yearsInBusiness === null) gaps.push("Years in business?");
  if (!p.business.certifications.length) gaps.push("Any certifications (MBE, WOSB, 8(a), HUBZone, Michigan Veteran-Owned)?");
  return gaps;
}

import type { Db } from "../db/pool.js";
import { DEFAULT_ALLOCATION, DEPARTMENTS, type Department, type OpportunityCategory, type OpportunityType } from "./types.js";

/**
 * Configurable source registry. Defaults are seeded at startup with
 * ON CONFLICT DO NOTHING, so changes the owner makes in the database persist.
 * Listing a source here is NOT a claim that it currently has opportunities.
 */
export type SourceKind = "grants_gov" | "sam_gov" | "github" | "email_alerts" | "web_research";

export interface SourceEntry {
  id: string;
  name: string;
  department: Department;
  kind: SourceKind;
  url: string;
  domains: string[];
  priority: "high" | "medium" | "low";
  opportunity_type: OpportunityType;
  enabled: boolean;
  config: {
    category?: OpportunityCategory;
    brief?: string;
    queries?: string[];
    gmailQuery?: string;
    senderDomains?: string[];
  };
  access_notes: string | null;
  max_requests_per_run: number;
  max_requests_per_day: number;
  last_success_at: Date | null;
  last_failure_at: Date | null;
  last_error: string | null;
  consecutive_failures: number;
  disabled_reason: string | null;
}

type Seed = Pick<SourceEntry, "id" | "name" | "department" | "kind" | "url" | "domains" | "priority" | "opportunity_type" | "config" | "access_notes"> &
  Partial<Pick<SourceEntry, "max_requests_per_run" | "max_requests_per_day" | "enabled">>;

export const DEFAULT_SOURCES: Seed[] = [
  {
    id: "grants_gov",
    name: "Grants.gov",
    department: "grants",
    kind: "grants_gov",
    url: "https://api.grants.gov/v1/api/search2",
    domains: ["grants.gov"],
    priority: "high",
    opportunity_type: "open_solicitation",
    config: { category: "grants_financing" },
    access_notes: "Public API, no key. Errors are reported in the response body even with HTTP 200.",
    max_requests_per_run: 60,
  },
  {
    id: "sam_gov",
    name: "SAM.gov Contract Opportunities",
    department: "contracts",
    kind: "sam_gov",
    url: "https://api.sam.gov/opportunities/v2/search",
    domains: ["sam.gov"],
    priority: "high",
    opportunity_type: "open_solicitation",
    config: { category: "contracts" },
    access_notes: "Free public API key required (SAM_API_KEY). Bidding requires an active SAM.gov entity registration.",
    max_requests_per_run: 60,
  },
  {
    id: "github",
    name: "GitHub repositories (AI & technology)",
    department: "technology",
    kind: "github",
    url: "https://api.github.com/search/repositories",
    domains: ["github.com"],
    priority: "medium",
    opportunity_type: "resource",
    config: {
      category: "technology",
      queries: ["topic:ai-agents", "topic:property-management", "short-term rental", "cleaning business software", "telegram bot automation", "claude agent"],
    },
    access_notes: "Public REST API (60 requests/hour unauthenticated; set GITHUB_TOKEN for 5,000/hour). Search API: 10 requests/minute.",
    max_requests_per_run: 20,
    max_requests_per_day: 50,
  },
  {
    id: "mi_sigma_vss",
    name: "Michigan SIGMA VSS (email alerts)",
    department: "contracts",
    kind: "email_alerts",
    url: "https://www.michigan.gov/SIGMAVSS",
    domains: ["michigan.gov"],
    priority: "high",
    opportunity_type: "open_solicitation",
    config: { category: "contracts", gmailQuery: "from:michigan.gov (solicitation OR bid OR \"event\") newer_than:3d", senderDomains: ["michigan.gov"] },
    access_notes:
      "State bids are posted in SIGMA VSS (generally over $50,000). Viewing/bidding needs a free vendor account; the official notification channel is email alerts for the commodity codes in your profile. LYONS AI reads those alerts from Gmail and never logs in to the portal.",
  },
  {
    id: "mi_vendor_dashboard",
    name: "Michigan Vendor Opportunity Dashboard",
    department: "contracts",
    kind: "web_research",
    url: "https://www.michigan.gov/dtmb/procurement/contractconnect/vendor-opportunity-dashboard",
    domains: ["michigan.gov"],
    priority: "high",
    opportunity_type: "forecast",
    config: {
      category: "contracts",
      brief:
        "Planned State of Michigan procurement projects for janitorial, custodial, facility cleaning or building maintenance services listed on the DTMB Vendor Opportunity Dashboard. These are FORECASTS with estimated post dates, not open bids.",
    },
    access_notes: "Forecasting tool updated on Mondays; dates are estimates. Items are labelled 'projected', never 'open'. Open bids are in SIGMA VSS.",
  },
  {
    id: "detroit_ocp",
    name: "City of Detroit procurement (OCP / Bonfire)",
    department: "contracts",
    kind: "web_research",
    url: "https://detroitmi.gov/OCP",
    domains: ["detroitmi.gov", "bonfirehub.com"],
    priority: "high",
    opportunity_type: "open_solicitation",
    config: { category: "contracts", brief: "Open City of Detroit bids or RFPs for janitorial, custodial, cleaning or building maintenance services, and supplier registration programs." },
    access_notes:
      "City bids run through the Bonfire (EUNA) e-bidding portal; documents need a free supplier account. Register with your commodity codes to receive invitations by email (ingest them with an email_alerts source).",
  },
  {
    id: "detroit_bonfire_alerts",
    name: "City of Detroit bid invitations (email alerts)",
    department: "contracts",
    kind: "email_alerts",
    url: "https://detroitmi.gov/supplier",
    domains: ["bonfirehub.com", "detroitmi.gov", "euna.com"],
    priority: "high",
    opportunity_type: "open_solicitation",
    config: { category: "contracts", gmailQuery: "from:(bonfirehub.com OR detroitmi.gov OR euna.com) (opportunity OR bid OR RFP) newer_than:3d", senderDomains: ["bonfirehub.com", "detroitmi.gov", "euna.com"] },
    access_notes: "Requires a Bonfire supplier account with commodity codes; alerts arrive by email.",
  },
  {
    id: "sba",
    name: "U.S. Small Business Administration",
    department: "grants",
    kind: "web_research",
    url: "https://www.sba.gov",
    domains: ["sba.gov"],
    priority: "high",
    opportunity_type: "program",
    config: {
      category: "grants_financing",
      brief: "Current SBA funding programs, loan programs, and contracting assistance relevant to a small Michigan cleaning LLC. Label loans as loans and grants as grants.",
    },
    access_notes: "Public pages. Most SBA financing is loans, not grants.",
  },
  {
    id: "medc",
    name: "Michigan Economic Development Corporation programs",
    department: "grants",
    kind: "web_research",
    url: "https://www.michiganbusiness.org",
    domains: ["michiganbusiness.org", "michigan.gov"],
    priority: "high",
    opportunity_type: "program",
    config: { category: "grants_financing", brief: "Open Michigan small-business grant, loan, or technical-assistance programs a small for-profit cleaning LLC may qualify for." },
    access_notes: "Public pages; check each program's own eligibility page.",
  },
  {
    id: "mi_sbdc",
    name: "Michigan SBDC",
    department: "personal_growth",
    kind: "web_research",
    url: "https://michigansbdc.org",
    domains: ["michigansbdc.org"],
    priority: "medium",
    opportunity_type: "program",
    config: { category: "development", brief: "Upcoming Michigan SBDC trainings, consulting programs or events for small business owners in Southeast Michigan (dates required)." },
    access_notes: "Public pages; consulting is typically no-cost.",
  },
  {
    id: "detroit_land_bank",
    name: "Detroit Land Bank Authority",
    department: "real_estate",
    kind: "web_research",
    url: "https://buildingdetroit.org",
    domains: ["buildingdetroit.org"],
    priority: "medium",
    opportunity_type: "listing",
    config: { category: "real_estate", brief: "Current Detroit Land Bank Authority property sale programs or listings suitable for a small operator (commercial or small multifamily), with official terms." },
    access_notes: "Public listings; purchase terms and occupancy requirements apply.",
  },
  {
    id: "detroit_property_portal",
    name: "Detroit Property Portal",
    department: "real_estate",
    kind: "web_research",
    url: "https://buyproperty.detroitmi.gov",
    domains: ["buyproperty.detroitmi.gov", "detroitmi.gov"],
    priority: "medium",
    opportunity_type: "listing",
    config: { category: "real_estate", brief: "City-owned surplus commercial or industrial properties available to buy or lease through the City of Detroit property portal, with official application terms." },
    access_notes: "Applications need an account; City Council approves sales. LYONS AI only reads public information.",
  },
  {
    id: "property_managers",
    name: "Metro Detroit property managers & STR operators",
    department: "contracts",
    kind: "web_research",
    url: "search:open-web",
    domains: [],
    priority: "high",
    opportunity_type: "idea",
    config: {
      category: "contracts",
      brief: "Metro Detroit property management companies, apartment communities and short-term-rental operators that publicly advertise needing cleaning/turnover vendors or are expanding (cite their own website).",
    },
    access_notes: "Lead research only; outreach always needs your approval.",
  },
  {
    id: "ventures",
    name: "New business & investment research",
    department: "ventures",
    kind: "web_research",
    url: "search:open-web",
    domains: [],
    priority: "medium",
    opportunity_type: "idea",
    config: { category: "business_ideas" },
    access_notes: "Evidence-backed ideas only; projected returns are never guarantees.",
  },
  {
    id: "eventbrite",
    name: "Networking & professional events",
    department: "personal_growth",
    kind: "web_research",
    url: "https://www.eventbrite.com",
    domains: ["eventbrite.com", "meetup.com", "detroitchamber.com"],
    priority: "medium",
    opportunity_type: "program",
    config: { category: "development", brief: "Upcoming Detroit-area networking, leadership or small-business events in the next 60 days (free or low cost), with dates and official event pages." },
    access_notes: "Public event listings.",
  },
  {
    id: "personal_resources",
    name: "Family & community resources (Detroit)",
    department: "personal_growth",
    kind: "web_research",
    url: "https://detroitmi.gov",
    domains: ["detroitmi.gov", "michigan.gov", "detroitpubliclibrary.org"],
    priority: "low",
    opportunity_type: "program",
    config: { category: "personal" },
    access_notes: "Public pages.",
  },
  {
    id: "ai_docs",
    name: "Official AI developer documentation",
    department: "technology",
    kind: "web_research",
    url: "https://docs.anthropic.com",
    domains: ["anthropic.com", "claude.com", "github.com"],
    priority: "low",
    opportunity_type: "resource",
    config: { category: "technology" },
    access_notes: "Official documentation and release notes only.",
  },
];

export class SourceRegistry {
  constructor(private readonly db: Db) {}

  async seed(): Promise<number> {
    let inserted = 0;
    for (const s of DEFAULT_SOURCES) {
      const r = await this.db.query(
        `INSERT INTO research_sources (id, name, department, kind, url, domains, priority, opportunity_type, config, access_notes, max_requests_per_run, max_requests_per_day, enabled)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (id) DO NOTHING`,
        [s.id, s.name, s.department, s.kind, s.url, s.domains, s.priority, s.opportunity_type, JSON.stringify(s.config), s.access_notes, s.max_requests_per_run ?? 30, s.max_requests_per_day ?? 200, s.enabled ?? true],
      );
      inserted += r.rowCount ?? 0;
    }
    return inserted;
  }

  async list(): Promise<SourceEntry[]> {
    return (await this.db.query<SourceEntry>("SELECT * FROM research_sources ORDER BY department, priority, id")).rows;
  }

  async get(id: string): Promise<SourceEntry | null> {
    return (await this.db.query<SourceEntry>("SELECT * FROM research_sources WHERE id = $1", [id])).rows[0] ?? null;
  }

  async setEnabled(id: string, enabled: boolean, reason?: string): Promise<boolean> {
    const r = await this.db.query(
      "UPDATE research_sources SET enabled = $2, disabled_reason = $3, consecutive_failures = CASE WHEN $2 THEN 0 ELSE consecutive_failures END, updated_at = now() WHERE id = $1",
      [id, enabled, enabled ? null : reason ?? "disabled by owner"],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async recordSuccess(id: string, at = new Date()): Promise<void> {
    await this.db.query(
      "UPDATE research_sources SET last_run_at = $2, last_success_at = $2, consecutive_failures = 0, last_error = NULL, updated_at = now() WHERE id = $1",
      [id, at],
    );
  }

  /**
   * Circuit breaker: after `disableAfter` consecutive failed runs the source is
   * disabled (with the reason) until the owner re-enables it. Returns true if
   * this failure disabled it.
   */
  async recordFailure(id: string, error: string, disableAfter = 6, at = new Date()): Promise<boolean> {
    const r = await this.db.query<{ consecutive_failures: number }>(
      `UPDATE research_sources SET last_run_at = $2, last_failure_at = $2, last_error = $3, consecutive_failures = consecutive_failures + 1, updated_at = now()
       WHERE id = $1 RETURNING consecutive_failures`,
      [id, at, error.slice(0, 500)],
    );
    const n = r.rows[0]?.consecutive_failures ?? 0;
    if (n >= disableAfter) {
      await this.db.query("UPDATE research_sources SET enabled = false, disabled_reason = $2 WHERE id = $1 AND enabled", [id, `auto-disabled after ${n} consecutive failures: ${error.slice(0, 200)}`]);
      return n === disableAfter;
    }
    return false;
  }

  async apiCallsToday(id: string, timezone: string): Promise<number> {
    const r = await this.db.query<{ n: string | null }>(
      `SELECT sum(api_calls) n FROM research_runs WHERE source_id = $1
         AND started_at >= (date_trunc('day', now() AT TIME ZONE $2) AT TIME ZONE $2)`,
      [id, timezone],
    );
    return Number(r.rows[0]?.n ?? 0);
  }

  /** Web-research runs per department over the last 14 days (for effort allocation). */
  async recentEffort(): Promise<Record<Department, number>> {
    const r = await this.db.query<{ department: string; n: string }>(
      `SELECT s.department, count(*) n FROM research_runs r JOIN research_sources s ON s.id = r.source_id
       WHERE s.kind = 'web_research' AND r.status IN ('succeeded','failed','dead_letter') AND r.started_at > now() - interval '14 days'
       GROUP BY s.department`,
    );
    const out = Object.fromEntries(DEPARTMENTS.map((d) => [d, 0])) as Record<Department, number>;
    for (const row of r.rows) out[row.department as Department] = Number(row.n);
    return out;
  }
}

/**
 * Allocates research "units" to departments so actual effort tracks the target
 * shares over time (largest deficit first). Pure and deterministic.
 */
export function allocateUnits(units: number, done: Record<Department, number>, allocation: Record<Department, number> = DEFAULT_ALLOCATION): Department[] {
  const counts = { ...done };
  const picks: Department[] = [];
  for (let i = 0; i < units; i++) {
    const total = Object.values(counts).reduce((a, b) => a + b, 0) + 1;
    let best: Department = DEPARTMENTS[0];
    let bestDeficit = -Infinity;
    for (const d of DEPARTMENTS) {
      const deficit = allocation[d] * total - counts[d];
      if (deficit > bestDeficit + 1e-9) {
        bestDeficit = deficit;
        best = d;
      }
    }
    picks.push(best);
    counts[best]++;
  }
  return picks;
}

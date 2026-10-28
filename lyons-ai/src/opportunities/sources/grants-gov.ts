import type { Candidate, OwnerProfile, SourceAdapter, VerificationCheck, VerificationResult } from "../types.js";
import { fetchJson, normalizeTitle, parseDate, parseMoney, SourceError, stripHtml, type FetchLike } from "./http.js";

/**
 * Grants.gov public API (no key). Discovery: POST /v1/api/search2.
 * Verification: POST /v1/api/fetchOpportunity re-reads the authoritative record.
 * Grants.gov reports errors in the body (errorcode != 0) even with HTTP 200.
 */
interface SearchHit {
  id: string | number;
  number?: string;
  title?: string;
  agencyCode?: string;
  agencyName?: string;
  agency?: string;
  openDate?: string;
  closeDate?: string;
  oppStatus?: string;
  docType?: string;
}

interface Envelope<T> {
  errorcode?: number;
  msg?: string;
  data?: T;
}

type ApplicantType = string | { id?: string; description?: string };

interface FetchedOpportunity {
  id?: string | number;
  opportunityNumber?: string;
  opportunityTitle?: string;
  owningAgencyCode?: string;
  synopsis?: Record<string, unknown>;
  forecast?: Record<string, unknown>;
}

export const GRANTS_GOV_ELIGIBILITY_CODES = "23|25|99"; // small businesses | others | unrestricted

export function detailUrl(id: string): string {
  return `https://www.grants.gov/search-results-detail/${encodeURIComponent(id)}`;
}

export class GrantsGovSource implements SourceAdapter {
  readonly name = "grants_gov";
  readonly categories = ["grants_financing" as const];

  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    private readonly base = "https://api.grants.gov/v1/api",
    private readonly maxTerms = 5,
  ) {}

  configured(): boolean {
    return true;
  }

  async discover(profile: OwnerProfile, signal: AbortSignal): Promise<Candidate[]> {
    const byId = new Map<string, Candidate>();
    for (const keyword of profile.searchTerms.grants.slice(0, this.maxTerms)) {
      const env = await fetchJson<Envelope<{ hitCount?: number; oppHits?: SearchHit[] }>>(
        this.fetchImpl,
        `${this.base}/search2`,
        {
          method: "POST",
          label: "grants.gov search2",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ keyword, oppStatuses: "forecasted|posted", eligibilities: GRANTS_GOV_ELIGIBILITY_CODES, rows: 25 }),
        },
        signal,
      );
      if (env.errorcode !== 0) throw new SourceError(`grants.gov search2 error ${env.errorcode}: ${env.msg ?? "unknown"}`);
      for (const hit of env.data?.oppHits ?? []) {
        const id = String(hit.id);
        if (!id || !hit.title || byId.has(id)) continue;
        const deadline = parseDate(hit.closeDate);
        byId.set(id, {
          source: this.name,
          sourceId: id,
          category: "grants_financing",
          title: hit.title,
          organization: hit.agencyName ?? hit.agency ?? hit.agencyCode,
          url: detailUrl(id),
          postedAt: parseDate(hit.openDate),
          deadlineAt: deadline ?? null,
          deadlineConfirmed: Boolean(deadline),
          sourceStatus: hit.oppStatus,
          fundingType: "grant",
          // Forecasted grants are announced but not yet accepting applications.
          opportunityType: (hit.oppStatus ?? "").toLowerCase() === "forecasted" ? "forecast" : "open_solicitation",
          sourceRegistryId: "grants_gov",
          raw: { search: hit, matchedKeyword: keyword },
        });
      }
    }
    return [...byId.values()];
  }

  async verify(c: Candidate, signal: AbortSignal): Promise<VerificationResult> {
    const checks: VerificationCheck[] = [];
    const env = await fetchJson<Envelope<FetchedOpportunity>>(
      this.fetchImpl,
      `${this.base}/fetchOpportunity`,
      {
        method: "POST",
        label: "grants.gov fetchOpportunity",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ opportunityId: Number(c.sourceId) }),
      },
      signal,
    );
    const d = env.data;
    const found = env.errorcode === 0 && d !== undefined && String(d.id ?? c.sourceId) === c.sourceId;
    checks.push({ name: "record found", passed: found, detail: found ? `grants.gov id ${c.sourceId}` : `errorcode ${env.errorcode ?? "?"}: ${env.msg ?? ""}` });
    if (!found || !d) return { ok: false, method: "api:grants.gov/fetchOpportunity", authoritativeUrl: c.url, checkedAt: new Date(), checks };

    const title = d.opportunityTitle ?? "";
    const titleOk = title !== "" && normalizeTitle(title) === normalizeTitle(c.title);
    checks.push({ name: "title matches", passed: titleOk, detail: title || "missing" });

    const syn = (d.synopsis ?? d.forecast ?? {}) as Record<string, unknown>;
    const deadline = parseDate(syn.responseDate) ?? parseDate(syn.closeDate) ?? c.deadlineAt ?? undefined;
    const notExpired = !deadline || deadline.getTime() > Date.now();
    checks.push({ name: "still open", passed: notExpired, detail: deadline ? `closes ${deadline.toISOString().slice(0, 10)}` : "no close date published" });

    const applicantTypes = ((syn.applicantTypes as ApplicantType[] | undefined) ?? [])
      .map((t) => (typeof t === "string" ? t : t.description ?? ""))
      .filter(Boolean);
    checks.push({
      name: "eligibility published",
      passed: true, // informational: missing eligibility makes the assessment "unclear", not a verification failure
      detail: applicantTypes.length ? applicantTypes.join("; ") : "not listed",
    });

    const costSharing = syn.costSharing === true || String(syn.costSharing ?? "").toLowerCase() === "yes";
    return {
      ok: found && titleOk && notExpired,
      method: "api:grants.gov/fetchOpportunity",
      authoritativeUrl: detailUrl(c.sourceId),
      checkedAt: new Date(),
      checks,
      updates: {
        title: title || c.title,
        deadlineAt: deadline ?? null,
        deadlineConfirmed: Boolean(deadline),
        amountMin: parseMoney(syn.awardFloor),
        amountMax: parseMoney(syn.awardCeiling),
        applicantTypes,
        eligibilityText: typeof syn.applicantEligibilityDesc === "string" ? stripHtml(syn.applicantEligibilityDesc).slice(0, 1500) : undefined,
        summary: typeof syn.synopsisDesc === "string" ? stripHtml(syn.synopsisDesc).slice(0, 800) : c.summary,
        costSharing,
      },
    };
  }
}

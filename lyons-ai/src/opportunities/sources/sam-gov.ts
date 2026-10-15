import type { Candidate, OwnerProfile, SourceAdapter, VerificationCheck, VerificationResult } from "../types.js";
import { fetchJson, normalizeTitle, parseDate, SourceError, type FetchLike } from "./http.js";

/**
 * SAM.gov Get Opportunities Public API v2 (free API key from SAM.gov → Account
 * Details). Searches federal contract notices for the owner's NAICS codes with
 * place of performance in the owner's state. postedFrom/postedTo are required
 * (MM/dd/yyyy, max 1-year span).
 */
interface Notice {
  noticeId?: string;
  title?: string;
  solicitationNumber?: string;
  fullParentPathName?: string;
  postedDate?: string;
  type?: string;
  responseDeadLine?: string | null;
  naicsCode?: string;
  typeOfSetAside?: string | null;
  typeOfSetAsideDescription?: string | null;
  active?: string;
  uiLink?: string;
  placeOfPerformance?: { city?: { name?: string }; state?: { code?: string; name?: string } } | null;
}

interface SearchResponse {
  totalRecords?: number;
  opportunitiesData?: Notice[];
  error?: unknown;
}

// o = solicitation, k = combined synopsis/solicitation, p = presolicitation, r = sources sought
const NOTICE_TYPES = "o,k,p,r";

function mmddyyyy(d: Date): string {
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

export function noticeUrl(id: string): string {
  return `https://sam.gov/opp/${encodeURIComponent(id)}/view`;
}

export class SamGovSource implements SourceAdapter {
  readonly name = "sam_gov";
  readonly categories = ["contracts" as const];

  constructor(
    private readonly apiKey: string | undefined,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly base = "https://api.sam.gov/opportunities/v2/search",
    private readonly lookbackDays = 30,
  ) {}

  configured(): boolean {
    return Boolean(this.apiKey);
  }

  private async search(params: Record<string, string>, signal: AbortSignal): Promise<Notice[]> {
    if (!this.apiKey) throw new SourceError("SAM.gov API key is not configured (SAM_API_KEY).");
    const url = new URL(this.base);
    url.searchParams.set("api_key", this.apiKey);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const body = await fetchJson<SearchResponse>(this.fetchImpl, url.toString(), { method: "GET", label: "sam.gov search" }, signal);
    if (!Array.isArray(body.opportunitiesData)) throw new SourceError("sam.gov search: unexpected response shape");
    return body.opportunitiesData;
  }

  toCandidate(n: Notice): Candidate | null {
    if (!n.noticeId || !n.title) return null;
    const city = n.placeOfPerformance?.city?.name;
    const state = n.placeOfPerformance?.state?.code;
    const deadline = parseDate(n.responseDeadLine ?? undefined);
    return {
      source: this.name,
      sourceId: n.noticeId,
      category: "contracts",
      title: n.title,
      organization: n.fullParentPathName,
      url: noticeUrl(n.noticeId),
      summary: [n.type, n.solicitationNumber ? `Solicitation ${n.solicitationNumber}` : "", n.typeOfSetAsideDescription ?? ""].filter(Boolean).join(" · "),
      location: [city, state].filter(Boolean).join(", ") || undefined,
      postedAt: parseDate(n.postedDate),
      deadlineAt: deadline ?? null,
      deadlineConfirmed: Boolean(deadline),
      sourceStatus: n.active === "Yes" ? "active" : n.active === "No" ? "inactive" : undefined,
      setAside: n.typeOfSetAside ?? undefined,
      naics: n.naicsCode,
      raw: n,
    };
  }

  async discover(profile: OwnerProfile, signal: AbortSignal): Promise<Candidate[]> {
    const to = new Date();
    const from = new Date(to.getTime() - this.lookbackDays * 86_400_000);
    const out = new Map<string, Candidate>();
    for (const ncode of profile.business.naics) {
      const notices = await this.search(
        { postedFrom: mmddyyyy(from), postedTo: mmddyyyy(to), ncode, state: profile.business.state, ptype: NOTICE_TYPES, limit: "100", offset: "0" },
        signal,
      );
      for (const n of notices) {
        const c = this.toCandidate(n);
        if (c && !out.has(c.sourceId)) out.set(c.sourceId, c);
      }
    }
    return [...out.values()];
  }

  async verify(c: Candidate, signal: AbortSignal): Promise<VerificationResult> {
    const to = new Date();
    const from = new Date(to.getTime() - 364 * 86_400_000);
    const notices = await this.search({ noticeid: c.sourceId, postedFrom: mmddyyyy(from), postedTo: mmddyyyy(to), limit: "1" }, signal);
    const n = notices.find((x) => x.noticeId === c.sourceId);
    const checks: VerificationCheck[] = [{ name: "record found", passed: Boolean(n), detail: n ? `notice ${c.sourceId}` : "not returned by SAM.gov" }];
    if (!n) return { ok: false, method: "api:sam.gov/opportunities", authoritativeUrl: c.url, checkedAt: new Date(), checks };
    const fresh = this.toCandidate(n)!;
    const titleOk = normalizeTitle(fresh.title) === normalizeTitle(c.title);
    checks.push({ name: "title matches", passed: titleOk, detail: fresh.title });
    const active = n.active !== "No";
    checks.push({ name: "notice active", passed: active, detail: `active=${n.active ?? "unknown"}` });
    const open = !fresh.deadlineAt || fresh.deadlineAt.getTime() > Date.now();
    checks.push({ name: "response deadline in future", passed: open, detail: fresh.deadlineAt ? fresh.deadlineAt.toISOString() : "no deadline listed" });
    return {
      ok: titleOk && active && open,
      method: "api:sam.gov/opportunities",
      authoritativeUrl: noticeUrl(c.sourceId),
      checkedAt: new Date(),
      checks,
      updates: { ...fresh, raw: c.raw },
    };
  }
}

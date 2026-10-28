import { describe, expect, it } from "vitest";
import { assessEligibility, bandFor, confidenceFor, DEFAULT_SCORING, explainScore, hardReject, learnedAdjustment, scamSignals, scoreOpportunity } from "../../src/opportunities/assess.js";
import { allocateUnits, DEFAULT_SOURCES } from "../../src/opportunities/registry.js";
import { lockKey } from "../../src/opportunities/scheduler.js";
import { GitHubSource } from "../../src/opportunities/sources/github.js";
import { authPassed, EmailAlertSource, extractLinks } from "../../src/opportunities/sources/email-alerts.js";
import { inferFundingType } from "../../src/opportunities/sources/http.js";
import { typeTags } from "../../src/opportunities/report.js";
import { departmentForCategory } from "../../src/opportunities/types.js";
import { DEFAULT_PROFILE, profileGaps } from "../../src/opportunities/profile.js";
import { formatOpportunity } from "../../src/opportunities/report.js";
import { localClock, webResearchCategories } from "../../src/opportunities/scheduler.js";
import { opportunityButtons, parseOpportunityCallback } from "../../src/opportunities/service.js";
import { GrantsGovSource } from "../../src/opportunities/sources/grants-gov.js";
import { parseDate, parseMoney } from "../../src/opportunities/sources/http.js";
import { SamGovSource } from "../../src/opportunities/sources/sam-gov.js";
import {
  assertPublicHttpsUrl,
  dateVariants,
  isPrivateAddress,
  pageMentionsAmount,
  titleCoverage,
  WebResearchSource,
} from "../../src/opportunities/sources/web-research.js";
import type { OpportunityRow } from "../../src/opportunities/store.js";
import type { Candidate, VerificationResult } from "../../src/opportunities/types.js";

const NOW = new Date("2026-10-15T12:00:00Z");
const inDays = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
const okV: VerificationResult = { ok: true, method: "api:test", authoritativeUrl: "https://x.gov", checkedAt: NOW, checks: [] };
const grant = (over: Partial<Candidate> = {}): Candidate => ({
  source: "grants_gov",
  sourceId: "1",
  category: "grants_financing",
  title: "Small Business Workforce Training Grant",
  url: "https://www.grants.gov/search-results-detail/1",
  applicantTypes: ["Small businesses"],
  deadlineAt: inDays(30),
  deadlineConfirmed: true,
  amountMax: 250_000,
  raw: {},
  ...over,
});

/** Builds a fetch fake that answers by URL substring. */
function fakeFetch(routes: Record<string, (init?: RequestInit) => Response | Promise<Response>>) {
  const calls: { url: string; body?: string }[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    const u = url.toString();
    calls.push({ url: u, body: typeof init?.body === "string" ? init.body : undefined });
    const key = Object.keys(routes).find((k) => u.includes(k));
    if (!key) return new Response("not found", { status: 404 });
    return routes[key]!(init);
  }) as unknown as typeof fetch;
  return { f, calls };
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

describe("eligibility", () => {
  it("small businesses → likely, with SAM registration as a prerequisite when unknown", () => {
    const r = assessEligibility(grant(), DEFAULT_PROFILE);
    expect(r.eligibility).toBe("likely");
    expect(r.prerequisites.join(" ")).toMatch(/Register in SAM\.gov first/);
  });

  it("does not add the SAM prerequisite once the owner is registered", () => {
    const p = { ...DEFAULT_PROFILE, business: { ...DEFAULT_PROFILE.business, samRegistered: true } };
    expect(assessEligibility(grant(), p).prerequisites.join(" ")).not.toMatch(/Register in SAM/);
  });

  it("nonprofit/government-only grants are ineligible; 'Others' is unclear; missing types is unclear", () => {
    expect(assessEligibility(grant({ applicantTypes: ["Nonprofits having a 501(c)(3) status", "State governments"] }), DEFAULT_PROFILE).eligibility).toBe("ineligible");
    expect(assessEligibility(grant({ applicantTypes: ["Others (see text field)"], eligibilityText: "Tribal orgs" }), DEFAULT_PROFILE).eligibility).toBe("unclear");
    expect(assessEligibility(grant({ applicantTypes: [] }), DEFAULT_PROFILE).eligibility).toBe("unclear");
  });

  it("SAM set-asides: small business → likely, certification-only → unclear, out of state → ineligible", () => {
    const c = (over: Partial<Candidate>): Candidate => ({ ...grant(), source: "sam_gov", category: "contracts", applicantTypes: undefined, ...over });
    expect(assessEligibility(c({ setAside: "SBA", location: "Detroit, MI" }), DEFAULT_PROFILE).eligibility).toBe("likely");
    expect(assessEligibility(c({ setAside: "WOSB", location: "Detroit, MI" }), DEFAULT_PROFILE)).toMatchObject({ eligibility: "unclear" });
    expect(assessEligibility(c({ setAside: "SBA", location: "Toledo, OH" }), DEFAULT_PROFILE).eligibility).toBe("ineligible");
    expect(assessEligibility(c({ location: "Warren, MI" }), DEFAULT_PROFILE).notes).toMatch(/Full and open/);
  });
});

describe("hard filters", () => {
  const elig = assessEligibility(grant(), DEFAULT_PROFILE);
  it("rejects failed verification, expired, too-soon, ineligible, and closed items", () => {
    expect(hardReject(grant(), elig, DEFAULT_PROFILE, NOW, { ...okV, ok: false, checks: [{ name: "title matches", passed: false, detail: "x" }] })?.reason).toMatch(/Verification failed/);
    expect(hardReject(grant({ deadlineAt: inDays(-1) }), elig, DEFAULT_PROFILE, NOW, okV)?.reason).toMatch(/passed/);
    expect(hardReject(grant({ deadlineAt: inDays(3) }), elig, DEFAULT_PROFILE, NOW, okV)?.reason).toMatch(/Only 3 day/);
    expect(hardReject(grant(), { ...elig, eligibility: "ineligible" }, DEFAULT_PROFILE, NOW, okV)?.reason).toMatch(/Not eligible/);
    expect(hardReject(grant({ sourceStatus: "closed" }), elig, DEFAULT_PROFILE, NOW, okV)?.reason).toMatch(/closed/);
    expect(hardReject(grant(), elig, DEFAULT_PROFILE, NOW, okV)).toBeNull();
  });

  it("flags scam patterns", () => {
    expect(scamSignals("Guaranteed approval! Pay a small processing fee")).toHaveLength(2);
    expect(scamSignals("Applications are due November 30.")).toEqual([]);
  });
});

describe("scoring (blueprint 7-factor model)", () => {
  const elig = assessEligibility(grant(), DEFAULT_PROFILE);
  const ctx = { now: NOW, openCommitments: 0, verificationMethod: "api:grants.gov/fetchOpportunity" };

  it("is deterministic, bounded by each factor's maximum, and sums to the total", () => {
    const s = scoreOpportunity(grant(), elig, DEFAULT_PROFILE, ctx);
    expect(s.strategicFit).toBeLessThanOrEqual(20);
    expect(s.financialUpside).toBeLessThanOrEqual(20);
    expect(s.executionProbability).toBeLessThanOrEqual(20);
    expect(s.capitalAffordability).toBeLessThanOrEqual(15);
    expect(s.timeEffort).toBeLessThanOrEqual(10);
    expect(s.timingUrgency).toBeLessThanOrEqual(10);
    expect(s.evidenceQuality).toBeLessThanOrEqual(5);
    expect(s.total).toBe(s.strategicFit + s.financialUpside + s.executionProbability + s.capitalAffordability + s.timeEffort + s.timingUrgency + s.evidenceQuality);
    expect(scoreOpportunity(grant(), elig, DEFAULT_PROFILE, ctx)).toEqual(s);
    expect(explainScore(s)).toMatch(/^fit \d+\/20 · upside \d+\/20 · execution \d+\/20 · capital \d+\/15 · effort \d+\/10 · timing \d+\/10 · evidence \d\/5$/);
  });

  it("maps totals to the blueprint priority bands", () => {
    expect(bandFor(85)).toBe("high");
    expect(bandFor(84)).toBe("investigate");
    expect(bandFor(70)).toBe("investigate");
    expect(bandFor(69)).toBe("watchlist");
    expect(bandFor(50)).toBe("watchlist");
    expect(bandFor(49)).toBe("archive");
  });

  it("supports configurable weights and bands", () => {
    const cfg = { weights: { ...DEFAULT_SCORING.weights, evidenceQuality: 0, strategicFit: 25 }, bands: { high: 90, investigate: 60, watchlist: 40 } };
    const s = scoreOpportunity(grant(), elig, DEFAULT_PROFILE, { ...ctx, config: cfg });
    expect(s.evidenceQuality).toBe(0);
    expect(s.strategicFit).toBeLessThanOrEqual(25);
    expect(bandFor(65, cfg)).toBe("investigate");
  });

  it("counts loans and paid programs far below grants, and says so", () => {
    const g = scoreOpportunity(grant({ fundingType: "grant" }), elig, DEFAULT_PROFILE, ctx);
    const loan = scoreOpportunity(grant({ fundingType: "loan" }), elig, DEFAULT_PROFILE, ctx);
    const paid = scoreOpportunity(grant({ fundingType: "paid_program" }), elig, DEFAULT_PROFILE, ctx);
    expect(loan.financialUpside).toBeLessThan(g.financialUpside);
    expect(paid.financialUpside).toBeLessThan(loan.financialUpside);
    expect(loan.notes.join(" ")).toMatch(/loan, not a grant/);
  });

  it("scores projected (forecast) procurements lower and labels them", () => {
    const open = scoreOpportunity(grant(), elig, DEFAULT_PROFILE, ctx);
    const forecast = scoreOpportunity(grant({ opportunityType: "forecast" }), elig, DEFAULT_PROFILE, ctx);
    expect(forecast.total).toBeLessThan(open.total);
    expect(forecast.notes.join(" ")).toMatch(/Projected procurement/);
    expect(typeTags({ opportunity_type: "forecast", funding_type: "loan" })).toEqual(["PROJECTED — not yet open", "LOAN — must be repaid"]);
  });

  it("rewards stronger evidence (API > official page > other page > email)", () => {
    const at = (m: string, url?: string) => scoreOpportunity(grant(), elig, DEFAULT_PROFILE, { ...ctx, verificationMethod: m, verifiedUrl: url }).evidenceQuality;
    expect(at("api:x")).toBe(5);
    expect(at("page:primary-url", "https://www.michigan.gov/x")).toBe(4);
    expect(at("page:primary-url", "https://example.com/x")).toBe(3);
    expect(at("email:official-alert")).toBeLessThan(at("page:primary-url", "https://example.com/x"));
  });

  it("penalises heavy workload and cost sharing; never best-cases unknown capital", () => {
    const base = scoreOpportunity(grant(), elig, DEFAULT_PROFILE, ctx);
    expect(scoreOpportunity(grant(), elig, DEFAULT_PROFILE, { ...ctx, openCommitments: 6 }).total).toBeLessThan(base.total);
    expect(scoreOpportunity(grant({ costSharing: true }), elig, DEFAULT_PROFILE, ctx).capitalAffordability).toBeLessThan(base.capitalAffordability);
    expect(base.capitalAffordability).toBeLessThan(15);
    expect(scoreOpportunity(grant({ capitalRequiredUsd: 0 }), elig, DEFAULT_PROFILE, ctx).capitalAffordability).toBe(15);
  });

  it("hard-excludes unaffordable capital regardless of upside", () => {
    const r = hardReject(grant({ capitalRequiredUsd: 250_000, amountMax: 10_000_000 }), elig, DEFAULT_PROFILE, NOW, okV);
    expect(r?.reason).toMatch(/Requires \$250,000 upfront, above your \$5,000 limit/);
  });

  it("learning is bounded and needs at least 3 decisions", () => {
    expect(learnedAdjustment({ accepted: 2, rejected: 0 })).toBe(0);
    expect(learnedAdjustment({ accepted: 0, rejected: 50 })).toBeGreaterThanOrEqual(-10);
    expect(learnedAdjustment({ accepted: 50, rejected: 0 })).toBeLessThanOrEqual(10);
    const down = scoreOpportunity(grant(), elig, DEFAULT_PROFILE, { ...ctx, feedback: { accepted: 0, rejected: 10 } });
    expect(down.strategicFit).toBeLessThan(scoreOpportunity(grant(), elig, DEFAULT_PROFILE, ctx).strategicFit);
  });

  it("confidence is high only for authoritative, confirmed, clear items", () => {
    expect(confidenceFor(grant(), { ...okV, method: "api:grants.gov" }, elig)).toBe("high");
    expect(confidenceFor(grant(), { ...okV, method: "page:primary-url" }, { ...elig, eligibility: "unclear" })).toBe("medium");
    expect(confidenceFor(grant({ deadlineConfirmed: false }), { ...okV, method: "page:primary-url" }, elig)).toBe("low");
  });
});

describe("departments, allocation and registry helpers", () => {
  it("allocates research effort to match 30/20/15/15/10/10 over time", () => {
    const zero = { contracts: 0, grants: 0, ventures: 0, real_estate: 0, personal_growth: 0, technology: 0 };
    const picks = allocateUnits(100, zero);
    const count = (d: string) => picks.filter((p) => p === d).length;
    expect(count("contracts")).toBe(30);
    expect(count("grants")).toBe(20);
    expect(count("ventures")).toBe(15);
    expect(count("real_estate")).toBe(15);
    expect(count("personal_growth")).toBe(10);
    expect(count("technology")).toBe(10);
    // An under-served department catches up first.
    expect(allocateUnits(1, { ...zero, contracts: 30, grants: 0 })[0]).toBe("grants");
  });

  it("maps categories to departments", () => {
    expect(departmentForCategory("development")).toBe("personal_growth");
    expect(departmentForCategory("operations")).toBe("technology");
    expect(departmentForCategory("grants_financing")).toBe("grants");
  });

  it("seeds the blueprint's official sources with honest access notes", () => {
    const ids = DEFAULT_SOURCES.map((s) => s.id);
    for (const id of ["mi_sigma_vss", "mi_vendor_dashboard", "detroit_ocp", "sam_gov", "grants_gov", "sba", "detroit_land_bank", "detroit_property_portal", "mi_sbdc", "github"]) {
      expect(ids).toContain(id);
    }
    expect(DEFAULT_SOURCES.find((s) => s.id === "mi_vendor_dashboard")!.opportunity_type).toBe("forecast");
    expect(DEFAULT_SOURCES.find((s) => s.id === "mi_sigma_vss")!.kind).toBe("email_alerts"); // never logs in to the portal
  });

  it("classifies funding type conservatively", () => {
    expect(inferFundingType("Small Business Loan Program")).toBe("loan");
    expect(inferFundingType("Matching grant for facade improvements")).toBe("grant");
    expect(inferFundingType("Costs are reimbursed after completion of training")).toBe("reimbursement");
    expect(inferFundingType("Leadership academy, tuition $1,200")).toBe("paid_program");
    expect(inferFundingType("Business support program")).toBe("unknown");
  });

  it("derives stable advisory-lock keys", () => {
    expect(lockKey("discover:grants_gov|2026-10-15#morning")).toBe(lockKey("discover:grants_gov|2026-10-15#morning"));
    expect(lockKey("a")).not.toBe(lockKey("b"));
  });
});

describe("GitHub source (fixtures shaped like the REST API)", () => {
  const repo = {
    full_name: "acme/str-cleaning-scheduler",
    html_url: "https://github.com/acme/str-cleaning-scheduler",
    description: "Turnover scheduling for short-term rental cleaning teams",
    stargazers_count: 420,
    forks_count: 31,
    pushed_at: "2026-10-10T12:00:00Z",
    created_at: "2025-01-01T00:00:00Z",
    archived: false,
    license: { spdx_id: "MIT" },
    topics: ["property-management"],
    owner: { login: "acme" },
  };

  it("searches with recency/stars filters, counts requests, and verifies the repo record", async () => {
    const { f, calls } = fakeFetch({ "/search/repositories": () => json({ items: [repo] }), "/repos/acme/str-cleaning-scheduler": () => json(repo) });
    const src = new GitHubSource({ fetchImpl: f, queries: ["topic:property-management"], now: () => NOW });
    const out = await src.discover(DEFAULT_PROFILE, new AbortController().signal);
    expect(out[0]).toMatchObject({ source: "github", sourceId: "acme/str-cleaning-scheduler", category: "technology", fundingType: "free", capitalRequiredUsd: 0 });
    expect(out[0]!.signals).toMatchObject({ stars: 420, license: "MIT", daysSincePush: 5 });
    expect(decodeURIComponent(calls[0]!.url)).toMatch(/topic:property-management pushed:>2026-09-15 stars:>=50 archived:false/);
    const v = await src.verify(out[0]!, new AbortController().signal);
    expect(v).toMatchObject({ ok: true, method: "api:github/repos" });
    expect(src.requests).toBe(2);
    expect(assessEligibility(out[0]!, DEFAULT_PROFILE).eligibility).toBe("eligible");
  });

  it("fails verification for archived repos and reports 403 reasons honestly", async () => {
    const archived = fakeFetch({ "/repos/": () => json({ ...repo, archived: true }) });
    const c = new GitHubSource({ now: () => NOW }).toCandidate(repo);
    expect((await new GitHubSource({ fetchImpl: archived.f, now: () => NOW }).verify(c, new AbortController().signal)).ok).toBe(false);
    const blocked = fakeFetch({ "/search/": () => json({ message: "API path not available" }, 403) });
    await expect(new GitHubSource({ fetchImpl: blocked.f }).discover(DEFAULT_PROFILE, new AbortController().signal)).rejects.toThrow(/HTTP 403 API path not available/);
    const limited = fakeFetch({ "/search/": () => new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0" } }) });
    await expect(new GitHubSource({ fetchImpl: limited.f }).discover(DEFAULT_PROFILE, new AbortController().signal)).rejects.toThrow(/rate limited/);
  });
});

describe("official email alerts", () => {
  const entry = { id: "mi_sigma_vss", domains: ["michigan.gov"], opportunity_type: "open_solicitation" as const, config: { category: "contracts" as const, senderDomains: ["michigan.gov"] } };

  it("accepts alerts only from official senders with passing DMARC/SPF", async () => {
    const src = new EmailAlertSource(entry, async () => null);
    const base = { source: "email_alerts", sourceId: "m1", category: "contracts" as const, title: "New solicitation: Custodial Services", url: "https://www.michigan.gov/x", raw: {} };
    const ok = await src.verify({ ...base, raw: { from: "SIGMA <noreply@michigan.gov>", authResults: "mx.google.com; dmarc=pass (p=REJECT) header.from=michigan.gov", links: [] } });
    expect(ok.ok).toBe(true);
    const spoofed = await src.verify({ ...base, raw: { from: "SIGMA <noreply@michigan.gov>", authResults: "mx.google.com; dmarc=fail header.from=michigan.gov", links: [] } });
    expect(spoofed.ok).toBe(false);
    const wrongSender = await src.verify({ ...base, raw: { from: "x@michigan-gov-bids.com", authResults: "dmarc=pass header.from=michigan-gov-bids.com", links: [] } });
    expect(wrongSender.ok).toBe(false);
  });

  it("extracts only portal links on the source's domains", () => {
    expect(extractLinks("See https://sigma.michigan.gov/abc and https://evil.example/x.", ["michigan.gov"])).toEqual(["https://sigma.michigan.gov/abc"]);
    expect(authPassed("spf=pass smtp.mailfrom=bounce@mail.michigan.gov", "michigan.gov")).toBe(true);
  });

  it("refuses to run without a connected business Gmail", async () => {
    await expect(new EmailAlertSource(entry, async () => null).discover(DEFAULT_PROFILE, new AbortController().signal)).rejects.toThrow(/not connected/);
  });
});

describe("parsing helpers", () => {
  it("parses source date formats and money", () => {
    expect(parseDate("11/30/2026")!.toISOString()).toBe("2026-12-01T03:59:00.000Z");
    expect(parseDate("2026-11-30")!.toISOString()).toBe("2026-12-01T03:59:00.000Z");
    expect(parseDate("2026-11-01T14:00:00-04:00")!.toISOString()).toBe("2026-11-01T18:00:00.000Z");
    expect(parseDate("")).toBeUndefined();
    expect(parseMoney("$1,250,000")).toBe(1_250_000);
    expect(parseMoney("0")).toBeUndefined();
    expect(parseMoney(null)).toBeUndefined();
  });
});

describe("Grants.gov source (fixtures shaped like the documented API)", () => {
  const searchBody = {
    errorcode: 0,
    msg: "Webservice Succeeds",
    data: {
      hitCount: 2,
      oppHits: [
        { id: "360001", number: "SBA-26-001", title: "Small Business Workforce Training Grant", agencyCode: "SBA", agencyName: "Small Business Administration", openDate: "09/01/2026", closeDate: "11/30/2026", oppStatus: "posted", docType: "synopsis" },
        { id: "360002", number: "X-1", title: "Open-ended program", agencyName: "Agency", openDate: "09/01/2026", closeDate: "", oppStatus: "forecasted", docType: "forecast" },
      ],
    },
  };
  const fetchBody = {
    errorcode: 0,
    data: {
      id: 360001,
      opportunityTitle: "Small Business Workforce Training Grant",
      synopsis: {
        responseDate: "11/30/2026",
        awardCeiling: "250000",
        awardFloor: "50,000",
        costSharing: false,
        applicantTypes: [{ id: "23", description: "Small businesses" }],
        applicantEligibilityDesc: "<p>For-profit small businesses in the US.</p>",
        synopsisDesc: "<p>Funds <b>workforce training</b>.</p>",
      },
    },
  };

  it("discovers with the documented request and maps hits (no deadline → null)", async () => {
    const { f, calls } = fakeFetch({ "/search2": () => json(searchBody) });
    const src = new GrantsGovSource(f, "https://api.grants.gov/v1/api", 1);
    const out = await src.discover(DEFAULT_PROFILE, new AbortController().signal);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ sourceId: "360001", organization: "Small Business Administration", deadlineConfirmed: true, url: "https://www.grants.gov/search-results-detail/360001" });
    expect(out[1]!.deadlineAt).toBeNull();
    expect(JSON.parse(calls[0]!.body!)).toMatchObject({ keyword: "small business", oppStatuses: "forecasted|posted", eligibilities: "23|25|99" });
  });

  it("treats an HTTP-200 body error as a failure", async () => {
    const { f } = fakeFetch({ "/search2": () => json({ errorcode: 1, msg: "bad request" }) });
    await expect(new GrantsGovSource(f).discover(DEFAULT_PROFILE, new AbortController().signal)).rejects.toThrow(/error 1: bad request/);
  });

  it("verifies against fetchOpportunity and pulls authoritative amounts and eligibility", async () => {
    const { f } = fakeFetch({ "/fetchOpportunity": () => json(fetchBody) });
    const src = new GrantsGovSource(f);
    const v = await src.verify(grant({ sourceId: "360001" }), new AbortController().signal);
    expect(v.ok).toBe(true);
    expect(v.method).toBe("api:grants.gov/fetchOpportunity");
    expect(v.updates).toMatchObject({ amountMax: 250000, amountMin: 50000, applicantTypes: ["Small businesses"], costSharing: false });
    expect(v.updates!.summary).toBe("Funds workforce training.");
  });

  it("fails verification when the authoritative title differs or the record is missing", async () => {
    const renamed = fakeFetch({ "/fetchOpportunity": () => json({ ...fetchBody, data: { ...fetchBody.data, opportunityTitle: "Something else" } }) });
    expect((await new GrantsGovSource(renamed.f).verify(grant({ sourceId: "360001" }), new AbortController().signal)).ok).toBe(false);
    const missing = fakeFetch({ "/fetchOpportunity": () => json({ errorcode: 7, msg: "not found" }) });
    expect((await new GrantsGovSource(missing.f).verify(grant({ sourceId: "360001" }), new AbortController().signal)).ok).toBe(false);
  });
});

describe("SAM.gov source", () => {
  const notice = {
    noticeId: "abc123",
    title: "Janitorial Services - Detroit Federal Building",
    solicitationNumber: "GS-05P-26-0001",
    fullParentPathName: "GENERAL SERVICES ADMINISTRATION.PUBLIC BUILDINGS SERVICE",
    postedDate: "2026-10-01",
    type: "Combined Synopsis/Solicitation",
    responseDeadLine: "2026-11-20T14:00:00-05:00",
    naicsCode: "561720",
    typeOfSetAside: "SBA",
    typeOfSetAsideDescription: "Total Small Business Set-Aside (FAR 19.5)",
    active: "Yes",
    placeOfPerformance: { city: { name: "Detroit" }, state: { code: "MI" } },
  };

  it("is disabled without an API key", () => {
    expect(new SamGovSource(undefined).configured()).toBe(false);
  });

  it("searches each NAICS code in the owner's state and never leaks the key in errors", async () => {
    const { f, calls } = fakeFetch({ "api.sam.gov": () => json({ totalRecords: 1, opportunitiesData: [notice] }) });
    const out = await new SamGovSource("SECRET-KEY", f).discover(DEFAULT_PROFILE, new AbortController().signal);
    expect(out).toHaveLength(1); // deduped across the three NAICS searches
    expect(out[0]).toMatchObject({ location: "Detroit, MI", setAside: "SBA", naics: "561720", url: "https://sam.gov/opp/abc123/view" });
    const u = new URL(calls[0]!.url);
    expect(u.searchParams.get("ncode")).toBe("561720");
    expect(u.searchParams.get("state")).toBe("MI");
    expect(u.searchParams.get("postedFrom")).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    const bad = fakeFetch({ "api.sam.gov": () => new Response("", { status: 500 }) });
    await expect(new SamGovSource("SECRET-KEY", bad.f).discover(DEFAULT_PROFILE, new AbortController().signal)).rejects.toThrow(/^sam\.gov search: HTTP 500$/);
  });

  it("verifies by notice id and rejects inactive notices", async () => {
    const src = (n: object) => new SamGovSource("k", fakeFetch({ "api.sam.gov": () => json({ opportunitiesData: [n] }) }).f);
    const cand = new SamGovSource("k").toCandidate(notice)!;
    expect((await src(notice).verify(cand, new AbortController().signal)).ok).toBe(true);
    expect((await src({ ...notice, active: "No" }).verify(cand, new AbortController().signal)).ok).toBe(false);
  });
});

describe("web research verification", () => {
  const publicResolve = async () => ["93.184.216.34"];

  it("blocks private, local and non-https targets (SSRF)", async () => {
    expect(isPrivateAddress("10.0.0.5")).toBe(true);
    expect(isPrivateAddress("169.254.169.254")).toBe(true);
    expect(isPrivateAddress("::1")).toBe(true);
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
    await expect(assertPublicHttpsUrl("http://example.com", publicResolve)).rejects.toThrow(/https/);
    await expect(assertPublicHttpsUrl("https://localhost/x", publicResolve)).rejects.toThrow(/private/);
    await expect(assertPublicHttpsUrl("https://evil.example", async () => ["127.0.0.1"])).rejects.toThrow(/private/);
    await expect(assertPublicHttpsUrl("https://ok.example", publicResolve)).resolves.toBeInstanceOf(URL);
  });

  it("matches dates, amounts and titles as they appear on real pages", () => {
    // Stored end-of-day deadlines are already the next day in UTC; matching must use the Eastern date.
    expect(dateVariants(new Date("2026-12-01T03:59:00Z"))).toContain("november 30, 2026");
    const d = new Date(Date.UTC(2026, 10, 30, 12));
    expect(dateVariants(d)).toContain("november 30, 2026");
    expect(dateVariants(d)).toContain("11/30/2026");
    expect(pageMentionsAmount("Awards of up to $25,000 per business", 25000)).toBe(true);
    expect(pageMentionsAmount("Awards vary", 25000)).toBe(false);
    expect(titleCoverage("Motor City Match Business Grant", "Apply for Motor City Match grants for business owners")).toBeGreaterThanOrEqual(0.6);
  });

  it("confirms facts found on the page and drops claims that aren't", async () => {
    const page = `<html><title>Motor City Match</title><body><h1>Motor City Match Business Grant</h1>
      <p>Applications close November 30, 2026.</p></body></html>`;
    const { f } = fakeFetch({ "program.example": () => new Response(page, { status: 200 }) });
    const src = new WebResearchSource(null, { fetchImpl: f, resolve: publicResolve });
    const c = src.toCandidate({
      title: "Motor City Match Business Grant",
      organization: "DEGC",
      url: "https://program.example/mcm",
      category: "grants_financing",
      summary: "x",
      location: "Detroit",
      deadline: "2026-11-30",
      amount_usd: 50000,
      eligibility: null,
    });
    const v = await src.verify(c, new AbortController().signal);
    expect(v.ok).toBe(true);
    expect(v.updates).toMatchObject({ deadlineConfirmed: true, amountMax: undefined });
    expect(v.checks.find((x) => x.name === "amount on page")!.detail).toMatch(/dropped/);
  });

  it("re-checks every redirect hop and rejects scam pages", async () => {
    const hop = fakeFetch({ "start.example": () => new Response("", { status: 302, headers: { location: "https://internal.example/x" } }) });
    const src = new WebResearchSource(null, { fetchImpl: hop.f, resolve: async (h) => (h === "internal.example" ? ["10.1.2.3"] : ["93.184.216.34"]) });
    const c = { ...grant(), source: "web_research", url: "https://start.example/a" };
    expect((await src.verify(c, new AbortController().signal)).checks.at(-1)).toMatchObject({ name: "safe public URL", passed: false });

    const scam = fakeFetch({ "scam.example": () => new Response("<h1>Small Business Workforce Training Grant</h1> Guaranteed approval, pay the application fee", { status: 200 }) });
    const s2 = new WebResearchSource(null, { fetchImpl: scam.f, resolve: publicResolve });
    const v = await s2.verify({ ...c, url: "https://scam.example/", deadlineAt: undefined, amountMax: undefined }, new AbortController().signal);
    expect(v.ok).toBe(false);
    expect(v.checks.find((x) => x.name === "no scam signals")!.passed).toBe(false);
  });

  it("uses Claude web search then the report tool, resuming paused turns", async () => {
    const finding = {
      title: "Wayne County Janitorial RFP",
      organization: "Wayne County",
      url: "https://wayne.example/rfp",
      category: "contracts",
      summary: "Custodial services",
      location: "Detroit, MI",
      deadline: "2026-11-20",
      amount_usd: null,
      eligibility: null,
    };
    const requests: unknown[] = [];
    const llm = {
      createMessage: async (req: { tools: unknown[]; messages: unknown[] }) => {
        requests.push(structuredClone(req));
        if (requests.length === 1) return { content: [{ type: "server_tool_use", id: "s1", name: "web_search", input: {} }], stop_reason: "pause_turn", usage: { input_tokens: 1, output_tokens: 1 }, model: "claude-opus-5-5" };
        return { content: [{ type: "tool_use", id: "t1", name: "report_opportunities", input: { findings: [finding] } }], stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 }, model: "claude-opus-5-5" };
      },
    };
    let usageCalls = 0;
    const src = new WebResearchSource(llm as never, { onUsage: async () => void usageCalls++ }).withCategories(["contracts"]);
    const out = await src.discover(DEFAULT_PROFILE, new AbortController().signal);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ source: "web_research", category: "contracts", deadlineConfirmed: false });
    expect(usageCalls).toBe(2);
    const first = requests[0] as { tools: { type?: string; name: string }[] };
    expect(first.tools.map((t) => t.type ?? t.name)).toEqual(["web_search_20260209", "report_opportunities"]);
    // After pause_turn the assistant turn is re-sent with no extra user message.
    expect((requests[1] as { messages: { role: string }[] }).messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });
});

describe("scheduler helpers, callbacks, report card", () => {
  it("computes the local clock in the owner's timezone", () => {
    const c = localClock(new Date("2026-10-15T03:30:00Z"), "America/New_York");
    expect(c).toMatchObject({ date: "2026-10-14", hour: 23, minute: 30, weekday: 3, isoWeek: "2026-W42" });
  });

  it("rotates web research categories", () => {
    expect(webResearchCategories(0)).toEqual(["contracts", "grants_financing"]);
    expect(webResearchCategories(6)).toEqual(["operations", "technology"]);
  });

  it("round-trips opportunity button callbacks within 64 bytes", () => {
    const id = "3f2b9c1e-0d4a-4b8e-9a7f-1c2d3e4f5a6b";
    for (const b of opportunityButtons(id).flat()) {
      expect(Buffer.byteLength(b.data)).toBeLessThanOrEqual(64);
      expect(parseOpportunityCallback(b.data)!.id).toBe(id);
    }
    expect(parseOpportunityCallback("op:bad:p")).toBeNull();
  });

  it("report card has every required field and labels unconfirmed values", () => {
    const row = {
      id: "3f2b9c1e-0d4a-4b8e-9a7f-1c2d3e4f5a6b",
      source: "web_research",
      category: "grants_financing",
      title: "Program",
      organization: "Org",
      url: "https://x.example",
      amount_min: null,
      amount_max: null,
      estimated_value: "10000",
      estimate_basis: "typical award reported by recipients",
      deadline_at: inDays(20),
      deadline_confirmed: false,
      eligibility: "unclear",
      eligibility_notes: "Not stated",
      prerequisites: ["SAM"],
      required_documents: ["Narrative"],
      required_investment: "None",
      effort: "5h",
      risks: ["r1"],
      next_action: "Do X",
      why_fit: "Fits",
      score: "61",
      confidence: "low",
      status: "qualified",
      verification: { ok: true, method: "page:primary-url", authoritativeUrl: "https://x.example", checkedAt: NOW.toISOString(), checks: [{ name: "page reachable", passed: true, detail: "" }] },
      last_verified_at: NOW,
    } as unknown as OpportunityRow;
    const text = formatOpportunity(row, "America/New_York", NOW);
    for (const label of ["Why it fits:", "Upside:", "Investment:", "Effort:", "Deadline:", "Eligibility:", "Risks:", "Next action:", "Source:", "Confidence", "Verified 2026-10-15"]) {
      expect(text).toContain(label);
    }
    expect(text).toContain("ESTIMATE: typical award reported by recipients");
    expect(text).toContain("UNCONFIRMED");
  });

  it("lists profile gaps instead of assuming", () => {
    expect(profileGaps(DEFAULT_PROFILE).join(" ")).toMatch(/SAM\.gov/);
  });
});

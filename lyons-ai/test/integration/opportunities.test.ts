import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../../src/db/pool.js";
import { Store } from "../../src/db/store.js";
import { PROFILE_KEY } from "../../src/opportunities/profile.js";
import { SourceRegistry } from "../../src/opportunities/registry.js";
import { lockKey, OpportunityScheduler } from "../../src/opportunities/scheduler.js";
import { OpportunityService, type StayOpsTaskSink } from "../../src/opportunities/service.js";
import { SourceError } from "../../src/opportunities/sources/http.js";
import { OpportunityStore } from "../../src/opportunities/store.js";
import type { Candidate, SourceAdapter, VerificationResult } from "../../src/opportunities/types.js";
import { freshDb, hasDb, RecordingNotifier, silentLog, testConfig } from "../helpers.js";

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000);

function grantCandidate(id: string, over: Partial<Candidate> = {}): Candidate {
  return {
    source: "grants_gov",
    sourceId: id,
    category: "grants_financing",
    title: `Michigan Small Business Workforce Training Grant ${id}`,
    organization: "SBA",
    url: `https://www.grants.gov/search-results-detail/${id}`,
    applicantTypes: ["Small businesses"],
    deadlineAt: inDays(14),
    deadlineConfirmed: true,
    amountMax: 500_000,
    fundingType: "grant",
    raw: { id },
    ...over,
  };
}

/** Controllable source named like the real one so Grants.gov eligibility rules apply. */
class FakeSource implements SourceAdapter {
  readonly name = "grants_gov";
  readonly categories = ["grants_financing" as const];
  candidates: Candidate[] = [];
  verifyCalls = 0;
  failVerify = new Set<string>();
  updates: Partial<Candidate> = {};
  configured() {
    return true;
  }
  async discover() {
    return this.candidates;
  }
  async verify(c: Candidate): Promise<VerificationResult> {
    this.verifyCalls++;
    const ok = !this.failVerify.has(c.sourceId);
    return { ok, method: "api:fake", authoritativeUrl: c.url, checkedAt: new Date(), checks: [{ name: "record found", passed: ok, detail: ok ? "ok" : "missing" }], updates: this.updates };
  }
}

/** Profile that makes a strong grant reach the HIGH band (≥ 85). */
const STRONG_PROFILE = { business: { samRegistered: true }, constraints: { maxUpfrontInvestmentUsd: 5000, weeklyHoursAvailable: 10, minDaysToDeadline: 7 } };

describe.skipIf(!hasDb)("Opportunity Intelligence Department (Postgres)", () => {
  let db: Db;
  let store: Store;
  let opps: OpportunityStore;
  let notifier: RecordingNotifier & { buttons: string[] };
  let source: FakeSource;
  let service: OpportunityService;
  const config = testConfig({ OPP_MAX_ALERTS_PER_DAY: "2" });

  beforeAll(async () => {
    db = await freshDb();
    store = new Store(db);
    opps = new OpportunityStore(db);
  });
  afterAll(async () => db?.end());
  beforeEach(async () => {
    await db.query(
      "TRUNCATE opportunities, opportunity_events, research_runs, notification_history, settings, spend_ledger, research_sources, research_costs, user_feedback RESTART IDENTITY CASCADE",
    );
    const n = new RecordingNotifier() as RecordingNotifier & { buttons: string[]; sendWithButtons: (c: number | null, t: string, b: { data: string }[][]) => Promise<void> };
    n.buttons = [];
    n.sendWithButtons = async (_c, t, b) => {
      n.messages.push(t);
      n.buttons.push(...b.flat().map((x) => x.data));
    };
    notifier = n;
    source = new FakeSource();
    service = new OpportunityService({ store, opps, notifier, config, log: silentLog, sources: [source] });
  });

  const signal = () => new AbortController().signal;

  it("moves a real record through DISCOVERED → VERIFIED → SCORED → SAVED → ACTION PREPARED → REPORTED", async () => {
    await store.setSetting(PROFILE_KEY, STRONG_PROFILE, "owner");
    source.candidates = [grantCandidate("1", { capitalRequiredUsd: 0 })];
    const s = await service.runDiscovery(source, signal());
    expect(s).toMatchObject({ discovered: 1, verified: 1, qualified: 1, actionsPrepared: 1, alerted: 1 });

    const [o] = await opps.search({ limit: 1 });
    expect(o).toMatchObject({ status: "qualified", priority_band: "high", verification_status: "verified", department: "grants", funding_type: "grant", source_registry_id: "grants_gov" });
    expect(Number(o!.score)).toBeGreaterThanOrEqual(85);
    expect((await opps.stages(o!.id)).map((x) => x.stage)).toEqual(["discovered", "verified", "scored", "saved", "action_prepared", "reported"]);

    const evidence = (await db.query("SELECT method, passed, url FROM opportunity_evidence WHERE opportunity_id = $1", [o!.id])).rows;
    expect(evidence).toEqual([{ method: "api:fake", passed: true, url: o!.url }]);
    const score = (await db.query("SELECT model_version, band, explanation FROM opportunity_scores WHERE opportunity_id = $1", [o!.id])).rows[0];
    expect(score).toMatchObject({ model_version: "blueprint-v1", band: "high" });
    expect(score.explanation).toMatch(/^fit \d+\/20/);
    const [action] = await opps.actions(o!.id);
    expect(action).toMatchObject({ kind: "checklist", status: "prepared" });
    expect(action!.body).toMatch(/Nothing will be submitted or sent without your approval/);
    expect(notifier.messages[0]).toMatch(/^⚡ High-priority opportunity, \d+ days left/);
  });

  it("maps bands to statuses: investigate → qualified, watchlist → verified, below 50 → archived (never notified)", async () => {
    source.candidates = [
      grantCandidate("inv"), // ≈ investigate
      grantCandidate("weak", { title: "Research fellowship for universities", amountMax: undefined, deadlineAt: null, applicantTypes: ["Others (see text)"] }),
    ];
    await service.runDiscovery(source, signal());
    const rows = await opps.search({ status: ["qualified", "verified", "archived"], limit: 5 });
    const by = Object.fromEntries(rows.map((r) => [r.source_id, r]));
    expect(by.inv).toMatchObject({ status: "qualified", priority_band: "investigate" });
    expect(["verified", "archived"]).toContain(by.weak!.status);
    expect(Number(by.weak!.score)).toBeLessThan(70);
    expect(notifier.messages).toHaveLength(0);
  });

  it("suppresses duplicates across runs (source id and title+organization fingerprint)", async () => {
    source.candidates = [grantCandidate("1")];
    await service.runDiscovery(source, signal());
    source.candidates = [grantCandidate("1"), { ...grantCandidate("1"), sourceId: "other-id" }];
    const s = await service.runDiscovery(source, signal());
    expect(s).toMatchObject({ duplicates: 2, verified: 0 });
    expect(source.verifyCalls).toBe(1);
    expect((await opps.pipelineCounts()).qualified).toBe(1);
  });

  it("hard-excludes unverifiable, expired, too-tight, ineligible and unaffordable items with reasons", async () => {
    source.failVerify.add("bad");
    source.candidates = [
      grantCandidate("bad"),
      grantCandidate("expired", { deadlineAt: inDays(-2) }),
      grantCandidate("tight", { deadlineAt: inDays(2) }),
      grantCandidate("np", { applicantTypes: ["Nonprofits having a 501(c)(3) status"] }),
      grantCandidate("pricey", { capitalRequiredUsd: 80_000, amountMax: 5_000_000 }),
    ];
    const s = await service.runDiscovery(source, signal());
    expect(s).toMatchObject({ rejected: 5, qualified: 0, alerted: 0 });
    const reasons = (await opps.search({ status: ["rejected"] })).map((o) => o.rejection_reason).join(" | ");
    for (const re of [/Verification failed/, /Deadline has passed/, /Only [12] day/, /Not eligible/, /above your \$5,000 limit/]) expect(reasons).toMatch(re);
    expect(notifier.messages).toHaveLength(0);
  });

  it("does not store items whose verification call errors, and stops on rate limits", async () => {
    source.candidates = [grantCandidate("a"), grantCandidate("b")];
    source.verify = async () => {
      throw new SourceError("grants.gov fetchOpportunity: rate limited (HTTP 429)");
    };
    const s = await service.runDiscovery(source, signal());
    expect(s.errors).toHaveLength(1);
    expect(await opps.pipelineCounts()).toEqual({});
  });

  it("morning brief: top three, one recommended action, changes since the previous briefing; evening review summarises the day", async () => {
    source.candidates = ["1", "2", "3", "4"].map((id) => grantCandidate(id, { deadlineAt: inDays(40) }));
    await service.runDiscovery(source, signal());
    const m1 = await service.sendMorningBriefing();
    expect(m1.count).toBe(3);
    const text = notifier.messages.at(-1)!;
    expect(text).toMatch(/^🌅 Morning Intelligence Brief/);
    expect(text.match(/^\d\. /gm)).toHaveLength(3);
    expect(text).toMatch(/👉 Recommended action: /);
    expect(text).toMatch(/Changes since last briefing: \n- New: /);

    const [first] = await opps.search({ status: ["qualified"], limit: 1 });
    await service.feedback(first!.id, "accepted", "owner");
    await service.sendMorningBriefing();
    expect(notifier.messages.at(-1)).toMatch(/→ approved \(you\)/); // only what changed since the last brief

    await service.sendEveningReview();
    const evening = notifier.messages.at(-1)!;
    expect(evening).toMatch(/^🌙 Evening Intelligence Review/);
    expect(evening).toMatch(/Today: 4 discovered · 4 verified · 0 rejected · 0 archived · 4 qualified/);
    expect(evening).toMatch(/Prepared: Next-step checklist/);
    expect(evening).toMatch(/Tomorrow's highest-value step: /);
  });

  it("records owner feedback, learns within bounds, and pushes approved items to StayOps when enabled", async () => {
    const created: string[] = [];
    const sink: StayOpsTaskSink = { createTask: async (t) => (created.push(t.externalRef), { id: "so-123" }) };
    service = new OpportunityService({ store, opps, notifier, config, log: silentLog, sources: [source], stayops: sink });
    source.candidates = ["1", "2", "3", "4"].map((id) => grantCandidate(id, { deadlineAt: inDays(60) }));
    await service.runDiscovery(source, signal());
    const rows = await opps.search({ limit: 4 });
    await service.feedback(rows[0]!.id, "accepted", "owner");
    expect(created).toEqual([`lyons-opportunity:${rows[0]!.id}`]);
    expect((await opps.actions(rows[0]!.id)).find((a) => a.kind === "stayops_task")).toMatchObject({ status: "done", external_id: "so-123" });

    const baseline = Number(rows[1]!.score);
    for (const o of rows.slice(1)) await service.feedback(o.id, "rejected", "owner", "not my focus");
    expect(Number((await db.query("SELECT count(*) n FROM user_feedback")).rows[0].n)).toBe(4);
    source.candidates = [grantCandidate("5", { title: "Michigan Small Business Workforce Training Grant five", deadlineAt: inDays(60) })];
    await service.runDiscovery(source, signal());
    const after = (await opps.search({ text: "five" }))[0]!;
    expect(Number(after.score)).toBeLessThan(baseline);
  });

  it("evening recheck closes dead items and alerts on material changes once, never repeating the same information", async () => {
    await store.setSetting(PROFILE_KEY, STRONG_PROFILE, "owner");
    source.candidates = [grantCandidate("1", { deadlineAt: inDays(20), capitalRequiredUsd: 0 })];
    await service.runDiscovery(source, signal());
    const [o] = await opps.search({ limit: 1 });
    await service.feedback(o!.id, "accepted", "owner");
    notifier.messages.length = 0;
    source.updates = { deadlineAt: inDays(40) };
    await db.query("UPDATE opportunities SET last_verified_at = now() - interval '2 days' WHERE id = $1", [o!.id]);
    expect((await service.recheck(signal())).alerted).toBe(1);
    expect(notifier.messages.at(-1)).toMatch(/^📅 Deadline changed/);
    await db.query("UPDATE opportunities SET last_verified_at = now() - interval '2 days' WHERE id = $1", [o!.id]);
    expect((await service.recheck(signal())).alerted).toBe(0); // same deadline → no repeat
    source.failVerify.add("1");
    await db.query("UPDATE opportunities SET last_verified_at = now() - interval '2 days' WHERE id = $1", [o!.id]);
    const r = await service.recheck(signal());
    expect(r).toMatchObject({ closed: 1, alerted: 1 });
    expect(notifier.messages.at(-1)).toMatch(/no longer verifies/);
  });

  // ---------------- Scheduler: real Grants.gov adapter against fixture HTTP ----------------
  describe("twice-daily scheduler", () => {
    const searchBody = {
      errorcode: 0,
      data: { oppHits: [{ id: "360001", title: "Michigan Small Business Workforce Training Grant", agencyName: "SBA", openDate: "10/01/2026", closeDate: "12/31/2026", oppStatus: "posted" }] },
    };
    const detailBody = {
      errorcode: 0,
      data: { id: 360001, opportunityTitle: "Michigan Small Business Workforce Training Grant", synopsis: { responseDate: "12/31/2026", awardCeiling: "250000", applicantTypes: [{ description: "Small businesses" }] } },
    };
    let failNetwork = false;
    let requests = 0;
    const fixtureFetch = (async (url: string | URL) => {
      requests++;
      if (failNetwork) throw new TypeError("fetch failed");
      const u = url.toString();
      if (u.endsWith("/search2")) return new Response(JSON.stringify(searchBody), { status: 200 });
      if (u.endsWith("/fetchOpportunity")) return new Response(JSON.stringify(detailBody), { status: 200 });
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    async function setup(iso: string, cfg = config) {
      const registry = new SourceRegistry(db);
      await registry.seed();
      await db.query("UPDATE research_sources SET enabled = (id = 'grants_gov')");
      const at = () => new Date(iso);
      const svc = new OpportunityService({ store, opps, notifier, config: cfg, log: silentLog, sources: [source], now: at });
      return new OpportunityScheduler({ service: svc, opps, store, registry, notifier, config: cfg, log: silentLog, now: at, adapters: { config: cfg, llm: null, alertMailbox: async () => null, fetchImpl: fixtureFetch } });
    }

    beforeEach(() => {
      failNetwork = false;
      requests = 0;
    });

    it("runs the 7 AM cycle (discovery then brief) and the 7 PM cycle (recheck then review), once each", async () => {
      expect(await (await setup("2026-10-15T10:59:00Z")).tick()).toEqual([]); // 06:59 Detroit
      const morning = await setup("2026-10-15T11:05:00Z");
      expect(await morning.tick()).toEqual(["discover:grants_gov", "report:morning"]);
      expect(await morning.tick()).toEqual([]);
      expect(notifier.messages.at(-1)).toMatch(/Morning Intelligence Brief[\s\S]*Michigan Small Business Workforce Training Grant/);
      const evening = await setup("2026-10-15T23:05:00Z");
      expect(await evening.tick()).toEqual(["recheck", "report:evening"]);
      expect(notifier.messages.at(-1)).toMatch(/^🌙 Evening Intelligence Review/);
    });

    it("skips email-alert sources while Google is not connected instead of counting failures", async () => {
      const s = await setup("2026-10-15T11:05:00Z");
      await db.query("UPDATE research_sources SET enabled = true WHERE id = 'mi_sigma_vss'");
      expect(await s.tick()).toEqual(["discover:grants_gov", "report:morning"]);
      expect((await opps.lastRun("discover:mi_sigma_vss", "2026-10-15#morning"))!.status).toBe("skipped");
      expect((await db.query("SELECT consecutive_failures FROM research_sources WHERE id = 'mi_sigma_vss'")).rows[0].consecutive_failures).toBe(0);
    });

    it("tracks API usage and cost per run", async () => {
      await (await setup("2026-10-15T11:05:00Z")).tick();
      const run = (await db.query("SELECT api_calls, checkpoint FROM research_runs WHERE job = 'discover:grants_gov'")).rows[0];
      expect(run.api_calls).toBe(6); // 5 keyword searches + 1 authoritative re-fetch
      expect(run.checkpoint).toMatchObject({ processed: 1, lastSourceId: "360001" });
      const cost = (await db.query("SELECT kind, requests, cost_usd FROM research_costs")).rows;
      expect(cost).toEqual([{ kind: "api_call", requests: 6, cost_usd: "0.000000" }]);
    });

    it("prevents duplicate concurrent runs with an advisory lock", async () => {
      const other = await db.connect();
      await other.query("SELECT pg_advisory_lock($1)", [lockKey("discover:grants_gov|2026-10-15#morning")]);
      try {
        expect(await (await setup("2026-10-15T11:05:00Z")).tick()).not.toContain("discover:grants_gov");
      } finally {
        await other.query("SELECT pg_advisory_unlock_all()");
        other.release();
      }
    });

    it("recovers runs interrupted by a restart and finishes them", async () => {
      const s = await setup("2026-10-15T11:20:00Z");
      const id = await opps.startRun("discover:grants_gov", "2026-10-15#morning", 1, new Date("2026-10-15T11:01:00Z"), { sourceId: "grants_gov", cycle: "morning" });
      expect(await s.recoverInterrupted()).toBe(1);
      expect((await db.query("SELECT status, error FROM research_runs WHERE id = $1", [id])).rows[0]).toMatchObject({ status: "failed", error: "interrupted (process restart)" });
      await db.query("UPDATE research_runs SET finished_at = '2026-10-15T11:02:00Z' WHERE id = $1", [id]);
      expect(await s.tick()).toContain("discover:grants_gov");
      expect((await opps.lastRun("discover:grants_gov", "2026-10-15#morning"))!.status).toBe("succeeded");
    });

    it("handles source failure: retries with backoff, dead-letters, still briefs, and the circuit breaker disables a dead source", async () => {
      failNetwork = true;
      expect(await (await setup("2026-10-15T11:05:00Z")).tick()).toEqual(["discover:grants_gov"]);
      expect(await (await setup("2026-10-15T11:07:00Z")).tick()).toEqual([]); // in backoff
      expect(await (await setup("2026-10-15T11:11:00Z")).tick()).toEqual(["discover:grants_gov"]);
      expect(await (await setup("2026-10-15T11:22:00Z")).tick()).toEqual(["discover:grants_gov", "report:morning"]); // 3rd attempt dead-letters, cycle settles
      expect((await opps.lastRun("discover:grants_gov", "2026-10-15#morning"))!.status).toBe("dead_letter");
      expect(notifier.messages.some((m) => m.startsWith("🧯 Research job discover:grants_gov failed 3 times"))).toBe(true);
      expect(notifier.messages.at(-1)).toMatch(/Source issues:\n- Grants\.gov: 3 failed run\(s\) — grants\.gov search2: network error/);

      for (const t of ["2026-10-16T11:05:00Z", "2026-10-16T11:11:00Z", "2026-10-16T11:22:00Z"]) await (await setup(t)).tick();
      const src = (await db.query("SELECT enabled, disabled_reason FROM research_sources WHERE id = 'grants_gov'")).rows[0];
      expect(src.enabled).toBe(false);
      expect(src.disabled_reason).toMatch(/auto-disabled after 6 consecutive failures/);
      expect(notifier.messages.some((m) => m.includes('"Grants.gov" was disabled'))).toBe(true);
    });

    it("skips a source once its daily API limit is reached", async () => {
      await (await setup("2026-10-15T11:05:00Z")).tick();
      await db.query("UPDATE research_sources SET max_requests_per_day = 6 WHERE id = 'grants_gov'");
      await (await setup("2026-10-15T23:05:00Z")).tick(); // evening has no API discovery for grants_gov; force a new morning-like slot:
      await db.query("DELETE FROM research_runs WHERE job = 'discover:grants_gov'");
      await db.query("INSERT INTO research_runs (job, slot, attempt, status, source_id, api_calls, started_at) VALUES ('discover:grants_gov', 'earlier', 1, 'succeeded', 'grants_gov', 6, '2026-10-15T11:05:00Z')");
      const s = await setup("2026-10-15T11:30:00Z");
      await s.tick();
      expect((await opps.lastRun("discover:grants_gov", "2026-10-15#morning"))).toMatchObject({ status: "skipped" });
    });

    it("does nothing while the module is paused or the kill switch is on", async () => {
      await store.setModulePaused("opportunities", true, "owner");
      expect(await (await setup("2026-10-15T11:05:00Z")).tick()).toEqual([]);
      await store.setModulePaused("opportunities", false, "owner");
      await store.setPaused(true, "owner");
      expect(await (await setup("2026-10-15T11:05:00Z")).tick()).toEqual([]);
      expect(requests).toBe(0);
    });
  });
});

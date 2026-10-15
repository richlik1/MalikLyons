import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../../src/db/pool.js";
import { Store } from "../../src/db/store.js";
import { PROFILE_KEY } from "../../src/opportunities/profile.js";
import { OpportunityScheduler } from "../../src/opportunities/scheduler.js";
import { OpportunityService } from "../../src/opportunities/service.js";
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
    title: `Small Business Workforce Training Grant ${id}`,
    organization: "SBA",
    url: `https://www.grants.gov/search-results-detail/${id}`,
    applicantTypes: ["Small businesses"],
    deadlineAt: inDays(14),
    deadlineConfirmed: true,
    amountMax: 500_000,
    raw: { id },
    ...over,
  };
}

/** Controllable source: returns the given candidates; verify() succeeds unless told otherwise. */
class FakeSource implements SourceAdapter {
  // Named like the real source so the Grants.gov eligibility rules apply.
  readonly name = "grants_gov";
  readonly categories = ["grants_financing" as const];
  candidates: Candidate[] = [];
  verifyCalls = 0;
  failVerify = new Set<string>();
  throwOnDiscover: Error | null = null;
  updates: Partial<Candidate> = {};
  configured() {
    return true;
  }
  async discover() {
    if (this.throwOnDiscover) throw this.throwOnDiscover;
    return this.candidates;
  }
  async verify(c: Candidate): Promise<VerificationResult> {
    this.verifyCalls++;
    const ok = !this.failVerify.has(c.sourceId);
    return {
      ok,
      method: "api:fake",
      authoritativeUrl: c.url,
      checkedAt: new Date(),
      checks: [{ name: "record found", passed: ok, detail: ok ? "ok" : "missing" }],
      updates: this.updates,
    };
  }
}

describe.skipIf(!hasDb)("Opportunity Intelligence pipeline (Postgres)", () => {
  let db: Db;
  let store: Store;
  let opps: OpportunityStore;
  let notifier: RecordingNotifier & { buttons: string[] };
  let source: FakeSource;
  let service: OpportunityService;
  const config = testConfig({ OPP_MAX_ALERTS_PER_DAY: "1", OPP_DAILY_ITEMS: "3" });

  beforeAll(async () => {
    db = await freshDb();
    store = new Store(db);
    opps = new OpportunityStore(db);
  });
  afterAll(async () => db?.end());
  beforeEach(async () => {
    await db.query("TRUNCATE opportunities, opportunity_events, research_runs, notification_log, settings, spend_ledger RESTART IDENTITY CASCADE");
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

  it("discovers, verifies, scores, stores with full records, and alerts once for urgent high-value items", async () => {
    source.candidates = [grantCandidate("1"), grantCandidate("2")];
    const s = await service.runDiscovery(source, signal());
    expect(s).toMatchObject({ discovered: 2, verified: 2, qualified: 2, rejected: 0 });
    expect(s.alerted).toBe(1); // capped at OPP_MAX_ALERTS_PER_DAY=1
    expect(notifier.messages[0]).toMatch(/^⚡ Time-sensitive opportunity/);
    expect(notifier.buttons.some((b) => b.endsWith(":p"))).toBe(true);

    const [top] = await opps.search({ status: ["qualified"], limit: 1 });
    expect(top).toMatchObject({ status: "qualified", eligibility: "likely", confidence: "high", deadline_confirmed: true });
    expect(Number(top!.amount_max)).toBe(500000);
    expect(top!.next_action).toMatch(/SAM\.gov registration/);
    expect(top!.verification!.method).toBe("api:fake");
    expect(top!.last_verified_at).toBeInstanceOf(Date);
    expect((await opps.events(top!.id)).map((e) => e.event)).toEqual(expect.arrayContaining(["discovered", "verified"]));
  });

  it("deduplicates across runs (by source id and by title+organization fingerprint)", async () => {
    source.candidates = [grantCandidate("1")];
    await service.runDiscovery(source, signal());
    source.candidates = [grantCandidate("1"), { ...grantCandidate("1"), sourceId: "other-id" }];
    const s = await service.runDiscovery(source, signal());
    expect(s).toMatchObject({ duplicates: 2, verified: 0 });
    expect(source.verifyCalls).toBe(1);
    expect((await opps.pipelineCounts()).qualified).toBe(1);
  });

  it("filters out unverifiable, expired, too-tight, and ineligible items — with reasons, never notified", async () => {
    source.failVerify.add("bad");
    source.candidates = [
      grantCandidate("bad"),
      grantCandidate("expired", { deadlineAt: inDays(-2) }),
      grantCandidate("tight", { deadlineAt: inDays(2) }),
      grantCandidate("np", { applicantTypes: ["Nonprofits having a 501(c)(3) status"] }),
    ];
    const s = await service.runDiscovery(source, signal());
    expect(s).toMatchObject({ rejected: 4, qualified: 0, alerted: 0 });
    const reasons = (await opps.search({ status: ["rejected"] })).map((o) => o.rejection_reason).join(" | ");
    expect(reasons).toMatch(/Verification failed/);
    expect(reasons).toMatch(/Deadline has passed/);
    expect(reasons).toMatch(/Only [12] day/);
    expect(reasons).toMatch(/Not eligible/);
    expect(notifier.messages).toHaveLength(0);
  });

  it("does not store items whose verification call errors (retried next run), and stops on rate limits", async () => {
    source.candidates = [grantCandidate("a"), grantCandidate("b")];
    source.verify = async () => {
      throw new SourceError("grants.gov fetchOpportunity: rate limited (HTTP 429)");
    };
    const s = await service.runDiscovery(source, signal());
    expect(s.errors).toHaveLength(1);
    expect(await opps.pipelineCounts()).toEqual({});
  });

  it("daily briefing shows only new items, at most N, and never repeats them; sends nothing when nothing is new", async () => {
    source.candidates = ["1", "2", "3", "4"].map((id) => grantCandidate(id, { deadlineAt: inDays(60) })); // not urgent → no alerts
    await service.runDiscovery(source, signal());
    const r1 = await service.sendDailyBriefing();
    expect(r1).toEqual({ sent: true, count: 3 });
    expect(notifier.messages[0]).toMatch(/^🔎 Opportunity briefing/);
    const r2 = await service.sendDailyBriefing();
    expect(r2).toEqual({ sent: true, count: 1 });
    const before = notifier.messages.length;
    expect(await service.sendDailyBriefing()).toEqual({ sent: false, count: 0 });
    expect(notifier.messages.length).toBe(before);
  });

  it("weekly top five does not repeat items already featured unless the owner is pursuing them", async () => {
    source.candidates = ["1", "2"].map((id) => grantCandidate(id, { deadlineAt: inDays(60) }));
    await service.runDiscovery(source, signal());
    expect((await service.sendWeekly()).count).toBe(2);
    const [first] = await opps.search({ status: ["qualified"], limit: 1 });
    await service.feedback(first!.id, "accepted", "owner");
    const again = await service.sendWeekly();
    expect(again.count).toBe(1); // only the approved one, as a tracking item
    expect(notifier.messages.at(-1)).toMatch(/\[approved\]/);
  });

  it("owner feedback changes status and, after 3+ decisions, lowers scores for similar items", async () => {
    source.candidates = ["1", "2", "3"].map((id) => grantCandidate(id, { deadlineAt: inDays(60) }));
    await service.runDiscovery(source, signal());
    const baseline = Number((await opps.search({ limit: 1 }))[0]!.score);
    for (const o of await opps.search({ limit: 3 })) await service.feedback(o.id, "rejected", "owner", "not my focus");
    expect((await opps.pipelineCounts()).closed).toBe(3);
    source.candidates = [grantCandidate("4", { title: "Different grant entirely", deadlineAt: inDays(60) })];
    await service.runDiscovery(source, signal());
    const after = (await opps.search({ text: "Different" }))[0]!;
    expect(Number(after.score)).toBeLessThan(baseline);
    expect(after.score_breakdown!.learned).toBeLessThan(0);
  });

  it("uses the stored owner profile (e.g. SAM registration known → no registration prerequisite)", async () => {
    await store.setSetting(PROFILE_KEY, { business: { samRegistered: true } }, "owner");
    source.candidates = [grantCandidate("1")];
    await service.runDiscovery(source, signal());
    const [o] = await opps.search({ limit: 1 });
    expect(o!.prerequisites.join(" ")).not.toMatch(/Register in SAM/);
    expect(o!.next_action).not.toMatch(/start your SAM\.gov registration/);
  });

  it("recheck closes items that no longer verify and warns only about ones being pursued", async () => {
    source.candidates = ["1", "2"].map((id) => grantCandidate(id, { deadlineAt: inDays(10) }));
    await service.runDiscovery(source, signal());
    const [a, b] = await opps.search({ limit: 2 });
    await service.feedback(a!.id, "accepted", "owner");
    source.failVerify.add(a!.source_id);
    source.failVerify.add(b!.source_id);
    notifier.messages.length = 0;
    const r = await service.recheck(signal());
    expect(r).toMatchObject({ checked: 2, closed: 2 });
    expect(notifier.messages).toHaveLength(1);
    expect(notifier.messages[0]).toMatch(/no longer verifies/);
  });

  it("recheck records deadline changes", async () => {
    source.candidates = [grantCandidate("1", { deadlineAt: inDays(10) })];
    await service.runDiscovery(source, signal());
    source.updates = { deadlineAt: inDays(40) };
    const r = await service.recheck(signal());
    expect(r.changed).toBe(1);
    const [o] = await opps.search({ limit: 1 });
    expect((await opps.events(o!.id)).some((e) => e.event === "changed.deadline")).toBe(true);
  });

  describe("scheduler", () => {
    const at = (iso: string) => () => new Date(iso);
    const sched = (iso: string, cfg = config) =>
      new OpportunityScheduler({ service: new OpportunityService({ store, opps, notifier, config: cfg, log: silentLog, sources: [source], now: at(iso) }), opps, store, config: cfg, log: silentLog, now: at(iso) });

    it("runs discovery, recheck and the daily report once per slot", async () => {
      source.candidates = [grantCandidate("1", { deadlineAt: inDays(60) })];
      const s = sched("2026-10-15T12:00:00Z"); // 08:00 New York, Thursday
      expect(await s.tick()).toEqual(["discover:grants_gov", "recheck", "report:daily"]);
      expect(await s.tick()).toEqual([]);
    });

    it("runs the weekly report on the configured weekday only", async () => {
      expect(await sched("2026-10-19T13:00:00Z").tick()).toContain("report:weekly"); // Monday 09:00 New York
      expect(await sched("2026-10-20T13:00:00Z").tick()).not.toContain("report:weekly");
    });

    it("retries a failed job with backoff, at most 3 attempts per slot", async () => {
      source.throwOnDiscover = new Error("upstream down");
      expect(await sched("2026-10-15T12:00:00Z").tick()).toContain("discover:grants_gov");
      expect(await sched("2026-10-15T12:01:00Z").tick()).not.toContain("discover:grants_gov"); // in backoff (5 min)
      expect(await sched("2026-10-15T12:06:00Z").tick()).toContain("discover:grants_gov"); // attempt 2
      expect(await sched("2026-10-15T12:17:00Z").tick()).toContain("discover:grants_gov"); // attempt 3 (10 min backoff)
      expect(await sched("2026-10-15T13:30:00Z").tick()).not.toContain("discover:grants_gov"); // gave up for this slot
      const runs = (await opps.recentRuns()).filter((r: { job: string }) => r.job === "discover:grants_gov");
      expect(runs).toHaveLength(3);
      expect(runs.every((r: { status: string; error: string }) => r.status === "failed" && r.error === "upstream down")).toBe(true);
    });

    it("does nothing while the module is paused or the kill switch is on", async () => {
      await store.setModulePaused("opportunities", true, "owner");
      expect(await sched("2026-10-15T12:00:00Z").tick()).toEqual([]);
      await store.setModulePaused("opportunities", false, "owner");
      await store.setPaused(true, "owner");
      expect(await sched("2026-10-15T12:00:00Z").tick()).toEqual([]);
    });
  });
});

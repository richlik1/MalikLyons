import type { Logger } from "pino";
import type { Config } from "../config.js";
import type { Button, Notifier } from "../core/notifier.js";
import type { Store } from "../db/store.js";
import {
  ALERT_THRESHOLD,
  ALERT_WINDOW_DAYS,
  assessEligibility,
  confidenceFor,
  daysUntil,
  DEFAULT_SCORING,
  explainScore,
  hardReject,
  scoreOpportunity,
  type ScoringConfig,
} from "./assess.js";
import { loadProfile } from "./profile.js";
import { buildNarrative, deadlineText, formatOpportunity, formatWeekly, typeTags, upsideText } from "./report.js";
import { SourceError } from "./sources/http.js";
import { fingerprint, type OpportunityRow, type OpportunityStore } from "./store.js";
import { DEPARTMENT_LABEL, departmentForCategory, type OpportunityStatus, type SourceAdapter } from "./types.js";

export const MODULE = "opportunities";
export const SCORING_KEY = "opportunity.scoring";

export interface RunStats {
  source: string;
  discovered: number;
  duplicates: number;
  verified: number;
  rejected: number;
  qualified: number;
  archived: number;
  watchlist: number;
  errors: string[];
  alerted: number;
  actionsPrepared: number;
  newIds: string[];
}

export interface RunContext {
  runId?: string;
  onCheckpoint?: (cp: { processed: number; lastSourceId: string }) => Promise<void>;
}

export function opportunityButtons(id: string): Button[][] {
  return [
    [
      { text: "✅ Pursue", data: `op:${id}:p` },
      { text: "📋 Prepare", data: `op:${id}:c` },
      { text: "👎 Not for me", data: `op:${id}:x` },
    ],
  ];
}

export function parseOpportunityCallback(data: string): { id: string; action: "pursue" | "prepare" | "dismiss" } | null {
  const m = /^op:([0-9a-f-]{36}):([pcx])$/.exec(data);
  if (!m) return null;
  return { id: m[1]!, action: m[2] === "p" ? "pursue" : m[2] === "c" ? "prepare" : "dismiss" };
}

/** Pushes approved opportunities into StayOps as tasks (proposed endpoint; off unless enabled). */
export interface StayOpsTaskSink {
  createTask(t: { title: string; description: string; dueAt: Date | null; externalRef: string }): Promise<{ id: string }>;
}

export interface OpportunityServiceDeps {
  store: Store;
  opps: OpportunityStore;
  notifier: Notifier;
  config: Config;
  log: Logger;
  sources: SourceAdapter[];
  stayops?: StayOpsTaskSink | null;
  now?: () => Date;
}

const STATUS_FOR_BAND: Record<string, OpportunityStatus> = { high: "qualified", investigate: "qualified", watchlist: "verified", archive: "archived" };

export class OpportunityService {
  constructor(private readonly d: OpportunityServiceDeps) {}

  private now(): Date {
    return this.d.now ? this.d.now() : new Date();
  }

  source(name: string): SourceAdapter | undefined {
    return this.d.sources.find((s) => s.name === name);
  }

  configuredSources(): SourceAdapter[] {
    return this.d.sources.filter((s) => s.configured());
  }

  async halted(): Promise<boolean> {
    return (await this.d.store.isPaused()) || (await this.d.store.isModulePaused(MODULE));
  }

  async scoringConfig(): Promise<ScoringConfig> {
    const saved = await this.d.store.getSetting<Partial<ScoringConfig>>(SCORING_KEY);
    if (!saved) return DEFAULT_SCORING;
    return { weights: { ...DEFAULT_SCORING.weights, ...(saved.weights ?? {}) }, bands: { ...DEFAULT_SCORING.bands, ...(saved.bands ?? {}) } };
  }

  /**
   * One discovery pass: discover → dedupe → verify (authoritative re-fetch) →
   * eligibility → hard exclusions → 7-factor score → save (with evidence, score
   * history and stage history) → prepare next steps → exceptional alert if warranted.
   * Every write is idempotent, so a crashed run can simply be re-run.
   */
  async runDiscovery(source: SourceAdapter, signal: AbortSignal, rc: RunContext = {}): Promise<RunStats> {
    const { opps, config, log } = this.d;
    const stats: RunStats = {
      source: source.name,
      discovered: 0,
      duplicates: 0,
      verified: 0,
      rejected: 0,
      qualified: 0,
      archived: 0,
      watchlist: 0,
      errors: [],
      alerted: 0,
      actionsPrepared: 0,
      newIds: [],
    };
    const profile = await loadProfile(this.d.store);
    const scoring = await this.scoringConfig();
    const candidates = await source.discover(profile, signal);
    stats.discovered = candidates.length;
    const feedback = await opps.feedbackStats();
    let verifications = 0;
    let processed = 0;

    for (const c of candidates) {
      if (signal.aborted || (await this.halted())) break;
      processed++;
      const existing = await opps.findExisting(c.source, c.sourceId, fingerprint(c));
      if (existing) {
        stats.duplicates++;
        await opps.touch(existing.id);
        continue;
      }
      if (verifications >= config.OPP_MAX_VERIFICATIONS_PER_RUN) break;
      verifications++;

      let v;
      try {
        v = await source.verify(c, signal);
      } catch (err) {
        stats.errors.push((err as Error).message);
        if (err instanceof SourceError && /rate limited|request limit/.test(err.message)) break;
        continue; // not stored: retried on the next run
      }
      const merged = { ...c, ...(v.updates ?? {}) };
      const elig = assessEligibility(merged, profile);
      const now = this.now();
      const rejection = hardReject(merged, elig, profile, now, v);
      const score = scoreOpportunity(merged, elig, profile, {
        now,
        openCommitments: await opps.openCommitments(),
        feedback: feedback.get(`${merged.category}|${merged.source}`),
        verificationMethod: v.method,
        verifiedUrl: v.authoritativeUrl,
        config: scoring,
      });
      const status: OpportunityStatus = rejection ? "rejected" : STATUS_FOR_BAND[score.band]!;
      const n = buildNarrative(merged, elig, score, profile);
      const row = await opps
        .insert({
          candidate: merged,
          status,
          rejectionReason: rejection?.reason,
          eligibility: elig.eligibility,
          eligibilityNotes: elig.notes,
          prerequisites: elig.prerequisites,
          requiredDocuments: n.documents,
          requiredInvestment: n.investment,
          effort: n.effort,
          risks: n.risks,
          nextAction: n.nextAction,
          whyFit: n.whyFit,
          score,
          scoreExplanation: explainScore(score, scoring),
          confidence: confidenceFor(merged, v, elig),
          verification: v,
        })
        .catch((err) => {
          stats.errors.push(`store: ${(err as Error).message}`);
          return null;
        });
      if (row) {
        stats.newIds.push(row.id);
        if (status === "rejected") stats.rejected++;
        else stats.verified++;
        if (status === "archived") stats.archived++;
        if (status === "verified") stats.watchlist++;
        if (status === "qualified") {
          stats.qualified++;
          if (await this.prepareChecklist(row)) stats.actionsPrepared++;
          if (await this.maybeAlertNew(row)) stats.alerted++;
        }
      }
      await rc.onCheckpoint?.({ processed, lastSourceId: c.sourceId });
    }
    log.info({ stats: { ...stats, newIds: stats.newIds.length }, runId: rc.runId }, "opportunity discovery run");
    return stats;
  }

  /** Autonomous preparation (internal only): a concrete next-step checklist for each qualified item. */
  async prepareChecklist(o: OpportunityRow): Promise<boolean> {
    const lines = [
      `Next action: ${o.next_action ?? "review the source"}`,
      ...(o.prerequisites.length ? ["Prerequisites:", ...o.prerequisites.map((p) => `- [ ] ${p}`)] : []),
      ...(o.required_documents.length ? ["Documents:", ...o.required_documents.map((x) => `- [ ] ${x}`)] : []),
      `Deadline: ${deadlineText(o, this.d.config.TIMEZONE, this.now())}`,
      ...(typeTags(o).length ? [`Note: ${typeTags(o).join("; ")}`] : []),
      "Nothing will be submitted or sent without your approval.",
    ];
    return Boolean(await this.d.opps.addAction({ opportunityId: o.id, kind: "checklist", title: "Next-step checklist", body: lines.join("\n") }));
  }

  /**
   * Exceptional alerts outside the two briefings, deduplicated by key so the same
   * information is never sent twice, and capped per day.
   */
  async alert(o: OpportunityRow, reason: string, infoKey: string, text: string): Promise<boolean> {
    const { opps, config } = this.d;
    if ((await opps.notificationsToday(MODULE, "alert", config.TIMEZONE)) >= config.OPP_MAX_ALERTS_PER_DAY) return false;
    const key = `alert:${reason}:${o.id}:${infoKey}`;
    const inserted = await opps.db.query(
      "INSERT INTO notification_history (module, kind, opportunity_ids, text, dedupe_key) VALUES ($1, 'alert', $2, $3, $4) ON CONFLICT DO NOTHING",
      [MODULE, [o.id], text, key],
    );
    if (!inserted.rowCount) return false; // already told the owner this exact thing
    await this.send(text, opportunityButtons(o.id));
    await opps.markNotified([o.id]);
    await opps.history(o.id, "reported", null, null, "system", `alert: ${reason}`);
    return true;
  }

  private async maybeAlertNew(o: OpportunityRow): Promise<boolean> {
    const days = daysUntil(o.deadline_at, this.now());
    if (Number(o.score) < ALERT_THRESHOLD || days === null || days > ALERT_WINDOW_DAYS || o.opportunity_type === "forecast") return false;
    return this.alert(o, "new_high_priority", "v1", `⚡ High-priority opportunity, ${days} days left\n\n${formatOpportunity(o, this.d.config.TIMEZONE, this.now())}`);
  }

  private async send(text: string, buttons?: Button[][]): Promise<void> {
    const n = this.d.notifier;
    if (buttons && n.sendWithButtons) await n.sendWithButtons(null, text, buttons);
    else await n.send(null, text);
  }

  private async lastBriefingAt(): Promise<Date | null> {
    const r = await this.d.opps.db.query<{ at: Date }>(
      "SELECT at FROM notification_history WHERE module = $1 AND kind IN ('morning','evening') ORDER BY at DESC LIMIT 1",
      [MODULE],
    );
    return r.rows[0]?.at ?? null;
  }

  /** Material changes since the previous briefing (deadline changes, closures, owner decisions, new qualified). */
  async changesSince(since: Date | null): Promise<string[]> {
    const r = await this.d.opps.db.query<{ title: string; stage: string; to_status: string | null; reason: string | null; actor: string }>(
      `SELECT o.title, h.stage, h.to_status, h.reason, h.actor FROM opportunity_status_history h JOIN opportunities o ON o.id = h.opportunity_id
       WHERE h.at > $1 AND (h.stage IN ('status', 'deadline_changed') OR (h.stage = 'saved' AND h.to_status = 'qualified'))
       ORDER BY h.at LIMIT 30`,
      [since ?? new Date(0)],
    );
    return r.rows.map((x) =>
      x.stage === "saved"
        ? `New: ${x.title}`
        : x.stage === "deadline_changed"
          ? `Deadline changed: ${x.title} (${x.reason ?? ""})`
          : `${x.title} → ${x.to_status}${x.actor !== "system" ? " (you)" : ""}${x.reason ? ` — ${x.reason}` : ""}`,
    );
  }

  private compactCard(o: OpportunityRow, rank: number): string {
    const tz = this.d.config.TIMEZONE;
    const tags = typeTags(o);
    return [
      `${rank}. ${o.title}${o.notified_at ? "" : " 🆕"}`,
      `   ${DEPARTMENT_LABEL[departmentForCategory(o.category)]} · score ${Math.round(Number(o.score))}/100 (${o.priority_band}) · ${deadlineText(o, tz, this.now())}`,
      ...(tags.length ? [`   ⚠️ ${tags.join(" · ")}`] : []),
      `   Why: ${o.why_fit ?? "—"}`,
      `   Upside: ${upsideText(o)} · Cost: ${o.required_investment ?? "—"}`,
      `   ${o.url}  (id ${o.id.slice(0, 8)})`,
    ].join("\n");
  }

  /** 7:00 AM brief: top three verified opportunities, one recommended action, changes since last briefing. */
  async sendMorningBriefing(): Promise<{ sent: true; count: number }> {
    const { opps, config } = this.d;
    const now = this.now();
    const top = (await opps.search({ status: ["qualified", "approved", "in_progress"], limit: 20 })).filter((o) => !o.deadline_at || o.deadline_at > now).slice(0, 3);
    const changes = await this.changesSince(await this.lastBriefingAt());
    const health = await this.sourceProblems();
    const date = now.toLocaleDateString("en-US", { timeZone: config.TIMEZONE, weekday: "long", month: "short", day: "numeric" });
    const lines = [`🌅 Morning Intelligence Brief — ${date}`, ""];
    if (top.length) {
      lines.push("Top opportunities:", ...top.map((o, i) => this.compactCard(o, i + 1)), "", `👉 Recommended action: ${top[0]!.next_action}`);
    } else {
      lines.push("No verified opportunities meet your bar yet. Research continues tonight at the evening cycle.");
    }
    lines.push("", `Changes since last briefing: ${changes.length ? "" : "none"}`, ...changes.slice(0, 10).map((c) => `- ${c}`));
    if (health.length) lines.push("", "Source issues:", ...health.map((h) => `- ${h}`));
    const text = lines.join("\n");
    if (top.length && this.d.notifier.sendWithButtons) await this.d.notifier.sendWithButtons(null, text, opportunityButtons(top[0]!.id));
    else await this.d.notifier.send(null, text);
    await opps.markNotified(top.map((o) => o.id));
    await opps.logNotification(MODULE, "morning", top.map((o) => o.id), text);
    for (const o of top) await opps.history(o.id, "reported", null, null, "system", "morning brief");
    return { sent: true, count: top.length };
  }

  /** 7:00 PM review: what was discovered/verified/rejected/advanced today, documents prepared, tomorrow's step. */
  async sendEveningReview(): Promise<{ sent: true }> {
    const { opps, config } = this.d;
    const now = this.now();
    const dayStart = `(date_trunc('day', $1::timestamptz AT TIME ZONE $2) AT TIME ZONE $2)`;
    const counts = await opps.db.query<{ stage: string; to_status: string | null; n: string }>(
      `SELECT stage, to_status, count(*) n FROM opportunity_status_history WHERE at >= ${dayStart} GROUP BY 1, 2`,
      [now, config.TIMEZONE],
    );
    const n = (stage: string, to?: string) => counts.rows.filter((r) => r.stage === stage && (to === undefined || r.to_status === to)).reduce((a, r) => a + Number(r.n), 0);
    const prepared = await opps.db.query<{ title: string; otitle: string }>(
      `SELECT a.title, o.title AS otitle FROM opportunity_actions a JOIN opportunities o ON o.id = a.opportunity_id WHERE a.created_at >= ${dayStart} ORDER BY a.created_at LIMIT 10`,
      [now, config.TIMEZONE],
    );
    const next = (await opps.search({ status: ["approved", "in_progress", "qualified"], limit: 5 })).find((o) => !o.deadline_at || o.deadline_at > now);
    const costs = await opps.costSummary(1, config.TIMEZONE);
    const llm = costs.reduce((a, c) => a + c.llmUsd, 0);
    const requests = costs.reduce((a, c) => a + c.requests, 0);
    const health = await this.sourceProblems();
    const text = [
      `🌙 Evening Intelligence Review`,
      "",
      `Today: ${n("discovered")} discovered · ${n("verified")} verified · ${n("saved", "rejected")} rejected · ${n("saved", "archived")} archived · ${n("saved", "qualified")} qualified · ${n("status")} status change(s)`,
      `Prepared: ${prepared.rows.length ? prepared.rows.map((p) => `${p.title} — ${p.otitle}`).join("; ") : "nothing new"}`,
      `Research cost today: $${llm.toFixed(2)} model spend · ${requests} API request(s)`,
      ...(health.length ? ["", "Source issues:", ...health.map((h) => `- ${h}`)] : []),
      "",
      next ? `Tomorrow's highest-value step: ${next.next_action} (${next.title}, score ${Math.round(Number(next.score))})` : "Tomorrow: the morning cycle will look for new opportunities.",
    ].join("\n");
    await this.d.notifier.send(null, text);
    await opps.logNotification(MODULE, "evening", [], text);
    return { sent: true };
  }

  /** Kept for compatibility: the morning brief is the daily briefing. */
  async sendDailyBriefing() {
    return this.sendMorningBriefing();
  }

  /** Optional weekly top five (off by default; see OPP_WEEKLY_ENABLED). */
  async sendWeekly(): Promise<{ sent: boolean; count: number }> {
    const { opps, config } = this.d;
    const items = await opps.weeklyCandidates(5);
    if (!items.length) return { sent: false, count: 0 };
    const text = formatWeekly(items, config.TIMEZONE, await opps.pipelineCounts(), this.now());
    await this.d.notifier.send(null, text);
    await opps.logNotification(MODULE, "weekly", items.map((o) => o.id), text);
    for (const o of items) await opps.event(o.id, "system", "reported.weekly");
    return { sent: true, count: items.length };
  }

  async sourceProblems(): Promise<string[]> {
    const r = await this.d.opps.db.query<{ name: string; enabled: boolean; consecutive_failures: number; last_error: string | null; disabled_reason: string | null }>(
      "SELECT name, enabled, consecutive_failures, last_error, disabled_reason FROM research_sources WHERE consecutive_failures > 0 OR NOT enabled AND disabled_reason LIKE 'auto-disabled%'",
    );
    return r.rows.map((s) => (s.enabled ? `${s.name}: ${s.consecutive_failures} failed run(s) — ${s.last_error ?? "unknown error"}` : `${s.name}: DISABLED — ${s.disabled_reason}`));
  }

  /** Evening verification: re-check open items, close dead ones, alert on material changes. */
  async recheck(signal: AbortSignal): Promise<{ checked: number; closed: number; changed: number; alerted: number }> {
    const { opps, config } = this.d;
    let checked = 0;
    let closed = 0;
    let changed = 0;
    let alerted = 0;
    for (const o of await opps.needsRecheck(12)) {
      if (signal.aborted || (await this.halted())) break;
      const src = this.source(o.source);
      if (!src?.configured() || o.source === "email_alerts") continue;
      const candidate = {
        source: o.source,
        sourceId: o.source_id,
        category: o.category,
        title: o.title,
        organization: o.organization ?? undefined,
        url: o.url,
        deadlineAt: o.deadline_at,
        amountMax: o.amount_max ? Number(o.amount_max) : undefined,
        raw: null,
      };
      let v;
      try {
        v = await src.verify(candidate, signal);
      } catch (err) {
        await opps.event(o.id, "system", "recheck.error", { error: (err as Error).message });
        continue;
      }
      checked++;
      await opps.addEvidence(o.id, v, null);
      const newDeadline = v.updates?.deadlineAt;
      await opps.refreshVerification(o.id, v, newDeadline);
      const important = o.status === "approved" || o.status === "in_progress" || o.priority_band === "high";
      if (!v.ok) {
        closed++;
        await opps.setStatus(o.id, "closed", "system", { reason: `re-verification failed: ${v.checks.filter((c) => !c.passed).map((c) => c.name).join(", ")}` });
        if (important && (await this.alert(o, "no_longer_valid", v.checkedAt.toISOString().slice(0, 10), `⚠️ "${o.title}" no longer verifies (${v.checks.filter((c) => !c.passed).map((c) => c.name).join(", ")}). Check ${o.url}`))) alerted++;
      } else if (newDeadline !== undefined && (newDeadline?.getTime() ?? null) !== (o.deadline_at?.getTime() ?? null)) {
        changed++;
        const when = newDeadline ? newDeadline.toLocaleDateString("en-US", { timeZone: config.TIMEZONE }) : "none";
        await opps.history(o.id, "deadline_changed", null, null, "system", `now ${when}`);
        await opps.event(o.id, "system", "changed.deadline", { from: o.deadline_at, to: newDeadline });
        if (important && (await this.alert(o, "deadline_changed", newDeadline?.toISOString() ?? "none", `📅 Deadline changed for "${o.title}": now ${when}. ${o.url}`))) alerted++;
      } else {
        const days = daysUntil(o.deadline_at, this.now());
        if (important && days !== null && days >= 0 && days <= 3) {
          if (await this.alert(o, "expiring", o.deadline_at!.toISOString(), `⏰ "${o.title}" closes in ${days} day(s). Next: ${o.next_action}`)) alerted++;
        }
      }
    }
    return { checked, closed, changed, alerted };
  }

  /** Owner feedback: drives status, bounded learning, and (when enabled) a StayOps task. */
  async feedback(id: string, decision: "accepted" | "rejected" | "completed", actor: string, note?: string): Promise<OpportunityRow | null> {
    const { opps, log } = this.d;
    const o = await opps.get(id);
    if (!o) return null;
    const status: OpportunityStatus = decision === "accepted" ? "approved" : "closed";
    await opps.setStatus(id, status, actor, { via: "feedback", reason: note ?? decision });
    await opps.event(id, actor, "feedback", { decision, note: note ?? null });
    await opps.recordFeedback(id, actor, decision, note);
    if (decision === "accepted" && this.d.stayops) {
      try {
        const t = await this.d.stayops.createTask({ title: `Pursue: ${o.title}`.slice(0, 200), description: `${o.next_action ?? ""}\n${o.url}`, dueAt: o.deadline_at, externalRef: `lyons-opportunity:${o.id}` });
        await opps.addAction({ opportunityId: id, kind: "stayops_task", title: "StayOps task", body: o.next_action ?? "", status: "done", externalId: t.id });
      } catch (err) {
        log.warn({ err }, "StayOps task creation failed");
        await opps.addAction({ opportunityId: id, kind: "stayops_task", title: "StayOps task", body: `Failed: ${(err as Error).message}`, status: "failed" });
      }
    }
    return opps.get(id);
  }
}

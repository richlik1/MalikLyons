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
  hardReject,
  QUALIFY_THRESHOLD,
  scoreOpportunity,
} from "./assess.js";
import { loadProfile } from "./profile.js";
import { buildNarrative, formatDailyBriefing, formatOpportunity, formatWeekly } from "./report.js";
import { SourceError } from "./sources/http.js";
import { fingerprint, type OpportunityRow, type OpportunityStore } from "./store.js";
import type { OpportunityStatus, SourceAdapter } from "./types.js";

export const MODULE = "opportunities";

export interface RunStats {
  source: string;
  discovered: number;
  duplicates: number;
  verified: number;
  rejected: number;
  qualified: number;
  errors: string[];
  alerted: number;
  newIds: string[];
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

export interface OpportunityServiceDeps {
  store: Store;
  opps: OpportunityStore;
  notifier: Notifier;
  config: Config;
  log: Logger;
  sources: SourceAdapter[];
  now?: () => Date;
}

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

  /**
   * One discovery pass over a source: discover → dedupe → verify against the
   * authoritative source → eligibility → hard filters → score → store → alert.
   */
  async runDiscovery(source: SourceAdapter, signal: AbortSignal): Promise<RunStats> {
    const { opps, config, log } = this.d;
    const stats: RunStats = { source: source.name, discovered: 0, duplicates: 0, verified: 0, rejected: 0, qualified: 0, errors: [], alerted: 0, newIds: [] };
    const profile = await loadProfile(this.d.store);
    const candidates = await source.discover(profile, signal);
    stats.discovered = candidates.length;
    const feedback = await opps.feedbackStats();
    let verifications = 0;

    for (const c of candidates) {
      if (signal.aborted || (await this.halted())) break;
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
        if (err instanceof SourceError && /rate limited/.test(err.message)) break;
        continue; // not stored: it will be retried on the next discovery run
      }
      const merged = { ...c, ...(v.updates ?? {}) };
      const elig = assessEligibility(merged, profile);
      const now = this.now();
      const rejection = hardReject(merged, elig, profile, now, v);
      const score = scoreOpportunity(merged, elig, profile, {
        now,
        openCommitments: await opps.openCommitments(),
        feedback: feedback.get(`${merged.category}|${merged.source}`),
      });
      const status: OpportunityStatus = rejection ? "rejected" : score.total >= QUALIFY_THRESHOLD ? "qualified" : "verified";
      const n = buildNarrative(merged, elig, score, profile);
      const row = await opps.insert({
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
        confidence: confidenceFor(merged, v, elig),
        verification: v,
      }).catch((err) => {
        stats.errors.push(`store: ${(err as Error).message}`);
        return null;
      });
      if (!row) continue;
      stats.newIds.push(row.id);
      if (status === "rejected") stats.rejected++;
      else stats.verified++;
      if (status === "qualified") {
        stats.qualified++;
        if (await this.maybeAlert(row)) stats.alerted++;
      }
    }
    log.info({ stats: { ...stats, newIds: stats.newIds.length } }, "opportunity discovery run");
    return stats;
  }

  /** Immediate alert only for high-score, time-sensitive items, under a daily cap. */
  private async maybeAlert(o: OpportunityRow): Promise<boolean> {
    const { opps, config, notifier } = this.d;
    const days = daysUntil(o.deadline_at, this.now());
    if (Number(o.score) < ALERT_THRESHOLD || days === null || days > ALERT_WINDOW_DAYS || o.notified_at) return false;
    if ((await opps.notificationsToday(MODULE, "alert", config.TIMEZONE)) >= config.OPP_MAX_ALERTS_PER_DAY) return false;
    const text = `⚡ Time-sensitive opportunity\n\n${formatOpportunity(o, config.TIMEZONE, this.now())}`;
    await this.send(text, opportunityButtons(o.id));
    await opps.markNotified([o.id]);
    await opps.logNotification(MODULE, "alert", [o.id], text);
    await opps.event(o.id, "system", "reported.alert");
    return true;
  }

  private async send(text: string, buttons?: Button[][]): Promise<void> {
    const n = this.d.notifier;
    if (buttons && n.sendWithButtons) await n.sendWithButtons(null, text, buttons);
    else await n.send(null, text);
  }

  /** Daily briefing: only items never shown before. Sends nothing when there's nothing new. */
  async sendDailyBriefing(): Promise<{ sent: boolean; count: number }> {
    const { opps, config } = this.d;
    const items = await opps.unnotifiedQualified(config.OPP_DAILY_ITEMS);
    if (!items.length) {
      await opps.logNotification(MODULE, "daily.skipped", [], "nothing new");
      return { sent: false, count: 0 };
    }
    const text = formatDailyBriefing(items, config.TIMEZONE, await opps.pipelineCounts(), this.now());
    // One message per item keeps each one's buttons next to it.
    await this.d.notifier.send(null, text.split("\n\n")[0]!); // header + pipeline line
    for (const o of items) await this.send(formatOpportunity(o, config.TIMEZONE, this.now()), opportunityButtons(o.id));
    await opps.markNotified(items.map((o) => o.id));
    await opps.logNotification(MODULE, "daily", items.map((o) => o.id), text);
    for (const o of items) await opps.event(o.id, "system", "reported.daily");
    return { sent: true, count: items.length };
  }

  /** Weekly top five; items already featured in a weekly report aren't repeated unless being pursued. */
  async sendWeekly(): Promise<{ sent: boolean; count: number }> {
    const { opps, config } = this.d;
    const items = await opps.weeklyCandidates(5);
    if (!items.length) {
      await opps.logNotification(MODULE, "weekly.skipped", [], "nothing to report");
      return { sent: false, count: 0 };
    }
    const text = formatWeekly(items, config.TIMEZONE, await opps.pipelineCounts(), this.now());
    await this.d.notifier.send(null, text);
    await opps.logNotification(MODULE, "weekly", items.map((o) => o.id), text);
    for (const o of items) await opps.event(o.id, "system", "reported.weekly");
    return { sent: true, count: items.length };
  }

  /** Re-verify open items; close expired ones and tell the owner about changes to things they're pursuing. */
  async recheck(signal: AbortSignal): Promise<{ checked: number; closed: number; changed: number }> {
    const { opps, config } = this.d;
    let checked = 0;
    let closed = 0;
    let changed = 0;
    for (const o of await opps.needsRecheck(72)) {
      if (signal.aborted || (await this.halted())) break;
      const src = this.source(o.source);
      if (!src?.configured()) continue;
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
      const newDeadline = v.updates?.deadlineAt;
      await opps.refreshVerification(o.id, v, newDeadline);
      const pursuing = o.status === "approved" || o.status === "in_progress";
      if (!v.ok) {
        closed++;
        await opps.setStatus(o.id, "closed", "system", { reason: "re-verification failed", checks: v.checks });
        if (pursuing) await this.d.notifier.send(null, `⚠️ "${o.title}" no longer verifies (${v.checks.filter((c) => !c.passed).map((c) => c.name).join(", ")}). Check ${o.url}`);
      } else if (newDeadline !== undefined && (newDeadline?.getTime() ?? null) !== (o.deadline_at?.getTime() ?? null)) {
        changed++;
        await opps.event(o.id, "system", "changed.deadline", { from: o.deadline_at, to: newDeadline });
        if (pursuing) {
          await this.d.notifier.send(null, `📅 Deadline changed for "${o.title}": now ${newDeadline ? newDeadline.toLocaleDateString("en-US", { timeZone: config.TIMEZONE }) : "none"}. ${o.url}`);
        }
      }
    }
    return { checked, closed, changed };
  }

  /** Owner feedback feeds the bounded learning adjustment. */
  async feedback(id: string, decision: "accepted" | "rejected" | "completed", actor: string, note?: string): Promise<OpportunityRow | null> {
    const { opps } = this.d;
    const o = await opps.get(id);
    if (!o) return null;
    const status: OpportunityStatus = decision === "accepted" ? "approved" : "closed";
    await opps.setStatus(id, status, actor, { via: "feedback" });
    await opps.event(id, actor, "feedback", { decision, note: note ?? null });
    return opps.get(id);
  }
}

import type { Logger } from "pino";
import type { Config } from "../config.js";
import type { LlmResponse } from "../core/llm.js";
import type { Notifier } from "../core/notifier.js";
import { estimateCostUsd } from "../core/spend.js";
import type { Store } from "../db/store.js";
import { buildAdapter, unavailableReason, type AdapterDeps } from "./adapters.js";
import { allocateUnits, type SourceEntry, type SourceRegistry } from "./registry.js";
import type { OpportunityService } from "./service.js";
import type { OpportunityStore } from "./store.js";
import { DEFAULT_ALLOCATION, OPPORTUNITY_CATEGORIES, type Department, type OpportunityCategory } from "./types.js";

export const MAX_ATTEMPTS = 3;
const STALE_RUNNING_MS = 30 * 60_000;
/** Workflow timeout per job; below STALE_RUNNING_MS so a hung job never looks live to recovery. */
const JOB_TIMEOUT_MS = 25 * 60_000;
const REPORT_WAIT_MS = 60 * 60_000;
export const ALLOCATION_KEY = "opportunity.allocation";

export interface LocalClock {
  date: string; // YYYY-MM-DD
  hour: number;
  minute: number;
  weekday: number; // 0=Sunday
  isoWeek: string;
}

export function localClock(now: Date, timeZone: string): LocalClock {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday!);
  const d = new Date(`${date}T00:00:00Z`);
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return { date, hour: Number(parts.hour), minute: Number(parts.minute), weekday, isoWeek: `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}` };
}

/** Legacy helper kept for compatibility: rotates two categories per slot. */
export function webResearchCategories(slotIndex: number): OpportunityCategory[] {
  const n = OPPORTUNITY_CATEGORIES.length;
  return [OPPORTUNITY_CATEGORIES[slotIndex % n]!, OPPORTUNITY_CATEGORIES[(slotIndex + 1) % n]!];
}

/** Stable 32-bit key for pg advisory locks. */
export function lockKey(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h | 0;
}

export interface SchedulerDeps {
  service: OpportunityService;
  opps: OpportunityStore;
  store: Store;
  registry: SourceRegistry;
  adapters: AdapterDeps;
  notifier: Notifier;
  config: Config;
  log: Logger;
  now?: () => Date;
}

/**
 * Durable twice-daily research scheduler (America/Detroit by default):
 *  - Morning (OPP_MORNING_HOUR): discovery across the registry → Morning brief.
 *  - Evening (OPP_EVENING_HOUR): re-verification + more research → Evening review.
 * Each (job, slot) runs at most once to success; a restart catches up on missed
 * slots. Runs are serialised with Postgres advisory locks, retried with backoff,
 * and dead-lettered after MAX_ATTEMPTS.
 */
export class OpportunityScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private abort = new AbortController();
  lastTickAt: Date | null = null;

  constructor(private readonly d: SchedulerDeps) {}

  private now(): Date {
    return this.d.now ? this.d.now() : new Date();
  }

  /**
   * Runs left "running" by a crashed process are marked failed so they retry.
   * A run is only touched if nobody holds its advisory lock (i.e. no live worker owns it).
   */
  async recoverInterrupted(): Promise<number> {
    const { opps } = this.d;
    const rows = (await opps.db.query<{ id: string; job: string; slot: string }>("SELECT id, job, slot FROM research_runs WHERE status = 'running'")).rows;
    let recovered = 0;
    const client = await opps.db.connect();
    try {
      for (const r of rows) {
        const key = lockKey(`${r.job}|${r.slot}`);
        const free = (await client.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1) AS ok", [key])).rows[0]!.ok;
        if (!free) continue; // a live worker is running it
        await opps.db.query("UPDATE research_runs SET status = 'failed', error = 'interrupted (process restart)', finished_at = now() WHERE id = $1 AND status = 'running'", [r.id]);
        await client.query("SELECT pg_advisory_unlock($1)", [key]);
        recovered++;
      }
    } finally {
      client.release();
    }
    if (recovered) this.d.log.warn({ recovered }, "recovered interrupted research runs");
    return recovered;
  }

  async start(intervalMs = 60_000): Promise<void> {
    await this.d.registry.seed();
    await this.recoverInterrupted();
    const loop = async () => {
      await this.tick().catch((err) => this.d.log.error({ err }, "opportunity scheduler tick failed"));
      this.timer = setTimeout(loop, intervalMs);
    };
    this.timer = setTimeout(loop, 5_000);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.abort.abort();
  }

  async allocation(): Promise<Record<Department, number>> {
    return { ...DEFAULT_ALLOCATION, ...((await this.d.store.getSetting<Partial<Record<Department, number>>>(ALLOCATION_KEY)) ?? {}) };
  }

  /** Picks this cycle's web-research sources: departments by allocation deficit, least-recently-run entry within each. */
  async pickWebSources(units: number, enabled: SourceEntry[]): Promise<SourceEntry[]> {
    const web = enabled.filter((e) => e.kind === "web_research");
    if (!web.length || units <= 0) return [];
    const depts = allocateUnits(units, await this.d.registry.recentEffort(), await this.allocation());
    const picks: SourceEntry[] = [];
    for (const dep of depts) {
      const pool = web
        .filter((e) => e.department === dep && !picks.includes(e))
        .sort((a, b) => (a.last_success_at?.getTime() ?? 0) - (b.last_success_at?.getTime() ?? 0) || a.id.localeCompare(b.id));
      if (pool[0]) picks.push(pool[0]);
    }
    return picks;
  }

  /** One scheduling pass. Returns the jobs that ran. */
  async tick(): Promise<string[]> {
    if (this.running) return [];
    const { service, config } = this.d;
    if (!config.OPP_ENABLED || (await service.halted())) return [];
    this.running = true;
    const ran: string[] = [];
    try {
      const now = this.now();
      this.lastTickAt = now;
      const clock = localClock(now, config.TIMEZONE);
      const sources = (await this.d.registry.list()).filter((s) => s.enabled);

      for (const cycle of ["morning", "evening"] as const) {
        const hour = cycle === "morning" ? config.OPP_MORNING_HOUR : config.OPP_EVENING_HOUR;
        if (clock.hour < hour) continue;
        // If the whole morning window was missed (server down), still run its discovery but
        // don't send a stale morning brief; the evening review covers it.
        const lateMorning = cycle === "morning" && config.OPP_EVENING_HOUR > config.OPP_MORNING_HOUR && clock.hour >= config.OPP_EVENING_HOUR;
        const slot = `${clock.date}#${cycle}`;
        const jobs: string[] = [];

        if (cycle === "morning") {
          for (const s of sources.filter((x) => x.kind !== "web_research")) {
            jobs.push(`discover:${s.id}`);
            if (await this.runSourceJob(s, slot, cycle, now)) ran.push(`discover:${s.id}`);
          }
        } else {
          jobs.push("recheck");
          if (await this.runJob("recheck", slot, cycle, null, now, (signal) => service.recheck(signal))) ran.push("recheck");
        }

        // Research effort allocation (persisted per slot so a restart doesn't re-pick).
        for (const s of await this.plannedWeb(slot, sources)) {
          jobs.push(`discover:${s.id}`);
          if (await this.runSourceJob(s, slot, cycle, now)) ran.push(`discover:${s.id}`);
        }

        // The briefing waits for this cycle's jobs to finish (or for a 60-minute cap).
        const reportJob = `report:${cycle}`;
        if (lateMorning) {
          await this.skip(reportJob, slot, cycle, null, now, "morning window missed; covered by the evening review");
        } else if (await this.cycleSettled(jobs, slot, hour, clock)) {
          if (await this.runJob(reportJob, slot, cycle, null, now, () => (cycle === "morning" ? service.sendMorningBriefing() : service.sendEveningReview()))) {
            ran.push(reportJob);
          }
        }
      }

      if (config.OPP_WEEKLY_ENABLED && clock.weekday === config.OPP_WEEKLY_DAY && clock.hour >= config.OPP_WEEKLY_HOUR) {
        if (await this.runJob("report:weekly", clock.isoWeek, "weekly", null, now, () => service.sendWeekly())) ran.push("report:weekly");
      }
    } finally {
      this.running = false;
    }
    return ran;
  }

  private async plannedWeb(slot: string, sources: SourceEntry[]): Promise<SourceEntry[]> {
    const key = `opportunity.plan.${slot}`;
    const saved = await this.d.store.getSetting<string[]>(key);
    if (saved) return sources.filter((s) => saved.includes(s.id));
    const usable = sources.filter((s) => !unavailableReason(s, this.d.adapters));
    const picks = await this.pickWebSources(this.d.config.OPP_WEB_UNITS_PER_CYCLE, usable);
    await this.d.store.setSetting(key, picks.map((p) => p.id), "scheduler");
    return picks;
  }

  private async cycleSettled(jobs: string[], slot: string, hour: number, clock: LocalClock): Promise<boolean> {
    const minutesIntoCycle = (clock.hour - hour) * 60 + clock.minute;
    if (minutesIntoCycle * 60_000 >= REPORT_WAIT_MS) return true;
    for (const j of jobs) {
      const last = await this.d.opps.lastRun(j, slot);
      if (!last) return false;
      if (last.status === "running") return false;
      if (last.status === "failed" && last.attempt < MAX_ATTEMPTS) return false;
    }
    return true;
  }

  private async runSourceJob(s: SourceEntry, slot: string, cycle: string, now: Date): Promise<boolean> {
    const { config, opps, registry, service } = this.d;
    const job = `discover:${s.id}`;
    const why = unavailableReason(s, this.d.adapters);
    if (why) return this.skip(job, slot, cycle, s.id, now, why);
    // A missing Google connection is a setup gap, not a source failure: skip so it can't trip the circuit breaker.
    if (s.kind === "email_alerts" && !(await this.d.adapters.alertMailbox())) {
      return this.skip(job, slot, cycle, s.id, now, "Google business account not connected (needed to read official alert emails)");
    }
    if ((await registry.apiCallsToday(s.id, config.TIMEZONE)) >= s.max_requests_per_day) return this.skip(job, slot, cycle, s.id, now, "daily API request limit reached");
    return this.runJob(job, slot, cycle, s, now, async (signal, runId) => {
      let requests = 0;
      const adapter = buildAdapter(s, this.d.adapters, {
        countRequest: () => void requests++,
        onUsage: async (r: LlmResponse) => {
          const cost = estimateCostUsd(r.model, r.usage);
          await this.d.store.recordSpend({
            taskId: null,
            model: r.model,
            inputTokens: r.usage.input_tokens,
            outputTokens: r.usage.output_tokens,
            cacheReadTokens: r.usage.cache_read_input_tokens ?? 0,
            cacheWriteTokens: r.usage.cache_creation_input_tokens ?? 0,
            costUsd: cost,
            label: "opportunity_research",
          });
          await opps.recordCost({ runId, sourceId: s.id, department: s.department, kind: "llm", model: r.model, inputTokens: r.usage.input_tokens, outputTokens: r.usage.output_tokens, costUsd: cost });
        },
      });
      if (!adapter) throw new Error("adapter unavailable");
      try {
        const stats = await service.runDiscovery(adapter, signal, {
          runId,
          onCheckpoint: (cp) => opps.db.query("UPDATE research_runs SET checkpoint = $2, api_calls = $3 WHERE id = $1", [runId, JSON.stringify(cp), requests]).then(() => undefined),
        });
        return { ...stats, apiCalls: requests };
      } finally {
        await opps.db.query("UPDATE research_runs SET api_calls = $2 WHERE id = $1", [runId, requests]);
        if (requests) await opps.recordCost({ runId, sourceId: s.id, department: s.department, kind: "api_call", requests });
      }
    });
  }

  private async skip(job: string, slot: string, cycle: string, sourceId: string | null, now: Date, reason: string): Promise<boolean> {
    if (await this.d.opps.lastRun(job, slot)) return false;
    const id = await this.d.opps.startRun(job, slot, 1, now, { sourceId, cycle });
    await this.d.opps.finishRun(id, "skipped", { reason }, undefined, now);
    return false;
  }

  /**
   * Runs `fn` for (job, slot) unless it already finished, is running elsewhere
   * (advisory lock), or is in retry backoff. After MAX_ATTEMPTS failures the run
   * is dead-lettered and the owner is told once.
   */
  private async runJob(
    job: string,
    slot: string,
    cycle: string,
    source: SourceEntry | null,
    now: Date,
    fn: (signal: AbortSignal, runId: string) => Promise<unknown>,
  ): Promise<boolean> {
    const { opps, log, registry, notifier } = this.d;
    const last = await opps.lastRun(job, slot);
    if (last) {
      if (["succeeded", "skipped", "dead_letter"].includes(last.status)) return false;
      if (last.status === "running" && now.getTime() - last.started_at.getTime() < STALE_RUNNING_MS) return false;
      if (last.attempt >= MAX_ATTEMPTS) return false;
      const backoffMs = 5 * 60_000 * 2 ** (last.attempt - 1);
      if (last.status === "failed" && now.getTime() - (last.finished_at ?? last.started_at).getTime() < backoffMs) return false;
    }

    // Cross-process mutual exclusion: only one worker may run this job+slot at a time.
    const client = await opps.db.connect();
    const key = lockKey(`${job}|${slot}`);
    let locked = false;
    try {
      locked = (await client.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1) AS ok", [key])).rows[0]!.ok;
      if (!locked) return false;
      const fresh = await opps.lastRun(job, slot);
      if (fresh && ["succeeded", "skipped", "dead_letter"].includes(fresh.status)) return false;

      const attempt = (fresh?.attempt ?? 0) + 1;
      const runId = await opps.startRun(job, slot, attempt, now, { sourceId: source?.id ?? null, cycle });
      const started = Date.now();
      const finishedAt = () => new Date(now.getTime() + (Date.now() - started));
      try {
        const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(Math.min(this.d.config.TASK_TIMEOUT_MS, JOB_TIMEOUT_MS))]);
        const result = await fn(signal, runId);
        if (signal.aborted) throw new Error(`${job} timed out`);
        const stats = (typeof result === "object" && result ? result : {}) as Record<string, unknown>;
        const errors = Array.isArray(stats.errors) ? (stats.errors as string[]) : [];
        // A discovery run where every verification errored (e.g. source outage) counts as failed.
        if (errors.length > 0 && stats.discovered !== undefined && stats.verified === 0 && stats.rejected === 0 && stats.duplicates === 0) throw new Error(errors[0]);
        await opps.finishRun(runId, "succeeded", { ...stats, newIds: undefined, ms: Date.now() - started }, undefined, finishedAt());
        if (source) await registry.recordSuccess(source.id, finishedAt());
      } catch (err) {
        const message = (err as Error).message;
        const dead = attempt >= MAX_ATTEMPTS;
        log.warn({ err: message, job, slot, attempt, dead }, "opportunity job failed");
        await opps.finishRun(runId, dead ? "dead_letter" : "failed", { ms: Date.now() - started }, message, finishedAt());
        if (source) {
          const disabled = await registry.recordFailure(source.id, message, 6, finishedAt());
          if (disabled) await notifier.send(null, `🔌 Research source "${source.name}" was disabled after repeated failures (${message}). Re-enable with /source_enable ${source.id} once fixed.`);
        }
        if (dead) {
          await notifier.send(
            null,
            `🧯 Research job ${job} failed ${MAX_ATTEMPTS} times this ${cycle} cycle and moved to the dead-letter queue: ${message}. It will run again next cycle; /opp_retry ${job} retries now.`,
          );
        }
      }
      return true;
    } finally {
      if (locked) await client.query("SELECT pg_advisory_unlock($1)", [key]).catch(() => {});
      client.release();
    }
  }

  /** Owner-triggered retry of the most recent dead-lettered run of a job. */
  async retryDeadLetter(job: string): Promise<boolean> {
    const r = await this.d.opps.db.query<{ id: string }>("SELECT id FROM research_runs WHERE job = $1 AND status = 'dead_letter' ORDER BY started_at DESC LIMIT 1", [job]);
    if (!r.rows[0]) return false;
    await this.d.opps.db.query("UPDATE research_runs SET status = 'failed', attempt = 0, finished_at = now() - interval '1 hour' WHERE id = $1", [r.rows[0].id]);
    return true;
  }
}

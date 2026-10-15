import type { Logger } from "pino";
import type { Config } from "../config.js";
import type { Store } from "../db/store.js";
import type { OpportunityService } from "./service.js";
import type { OpportunityStore } from "./store.js";
import { OPPORTUNITY_CATEGORIES, type OpportunityCategory } from "./types.js";
import type { WebResearchSource } from "./sources/web-research.js";

const MAX_ATTEMPTS = 3;
const STALE_RUNNING_MS = 30 * 60_000;

export interface LocalClock {
  date: string; // YYYY-MM-DD
  hour: number;
  weekday: number; // 0=Sunday
  isoWeek: string;
}

export function localClock(now: Date, timeZone: string): LocalClock {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday!);
  // ISO week of the local date.
  const d = new Date(`${date}T00:00:00Z`);
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return { date, hour: Number(parts.hour), weekday, isoWeek: `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}` };
}

/** Rotates web research through categories so each run stays small and cheap. */
export function webResearchCategories(slotIndex: number): OpportunityCategory[] {
  const n = OPPORTUNITY_CATEGORIES.length;
  return [OPPORTUNITY_CATEGORIES[slotIndex % n]!, OPPORTUNITY_CATEGORIES[(slotIndex + 1) % n]!];
}

/**
 * Durable background scheduler. Each job runs at most once per slot (recorded in
 * research_runs), failed runs retry with exponential backoff up to 3 attempts,
 * and nothing runs while the kill switch or the module pause is on.
 */
export class OpportunityScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private abort = new AbortController();

  constructor(
    private readonly d: {
      service: OpportunityService;
      opps: OpportunityStore;
      store: Store;
      config: Config;
      log: Logger;
      web?: WebResearchSource;
      now?: () => Date;
    },
  ) {}

  start(intervalMs = 60_000): void {
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

  /** One scheduling pass. Returns the jobs that ran (for tests and logs). */
  async tick(): Promise<string[]> {
    if (this.running) return [];
    const { service, config } = this.d;
    if (!config.OPP_ENABLED || (await service.halted())) return [];
    this.running = true;
    const ran: string[] = [];
    try {
      const now = this.d.now ? this.d.now() : new Date();
      const clock = localClock(now, config.TIMEZONE);
      const slotIndex = Math.floor(clock.hour / config.OPP_DISCOVERY_EVERY_HOURS);
      const discoverySlot = `${clock.date}#${slotIndex}`;

      for (const src of service.configuredSources()) {
        if (src.name === "web_research") continue;
        if (await this.runJob(`discover:${src.name}`, discoverySlot, now, async (signal) => service.runDiscovery(src, signal))) ran.push(`discover:${src.name}`);
      }

      if (this.d.web?.configured() && config.OPP_WEB_RESEARCH) {
        const spent = await this.d.opps.researchSpendToday(config.TIMEZONE);
        const totalToday = await this.d.store.spendToday(config.TIMEZONE);
        if (spent < config.OPP_DAILY_RESEARCH_BUDGET_USD && totalToday < config.DAILY_SPEND_LIMIT_USD) {
          const dayIndex = Math.floor(now.getTime() / 86_400_000) * 24 + slotIndex;
          const web = this.d.web.withCategories(webResearchCategories(dayIndex));
          if (await this.runJob("discover:web_research", discoverySlot, now, async (signal) => service.runDiscovery(web, signal))) ran.push("discover:web_research");
        }
      }

      if (clock.hour >= 6 && (await this.runJob("recheck", clock.date, now, (signal) => service.recheck(signal)))) ran.push("recheck");
      if (clock.hour >= config.OPP_DAILY_HOUR && (await this.runJob("report:daily", clock.date, now, () => service.sendDailyBriefing()))) ran.push("report:daily");
      if (
        clock.weekday === config.OPP_WEEKLY_DAY &&
        clock.hour >= config.OPP_WEEKLY_HOUR &&
        (await this.runJob("report:weekly", clock.isoWeek, now, () => service.sendWeekly()))
      ) {
        ran.push("report:weekly");
      }
    } finally {
      this.running = false;
    }
    return ran;
  }

  /** Runs `fn` for (job, slot) unless it already succeeded, is in flight, or is in retry backoff. */
  private async runJob(job: string, slot: string, now: Date, fn: (signal: AbortSignal) => Promise<unknown>): Promise<boolean> {
    const { opps, log } = this.d;
    const last = await opps.lastRun(job, slot);
    if (last) {
      if (last.status === "succeeded" || last.status === "skipped") return false;
      if (last.status === "running" && now.getTime() - last.started_at.getTime() < STALE_RUNNING_MS) return false;
      if (last.attempt >= MAX_ATTEMPTS) return false;
      const backoffMs = 5 * 60_000 * 2 ** (last.attempt - 1);
      if (last.status === "failed" && now.getTime() - (last.finished_at ?? last.started_at).getTime() < backoffMs) return false;
    }
    const runId = await opps.startRun(job, slot, (last?.attempt ?? 0) + 1, now);
    const started = Date.now();
    const finishedAt = () => new Date(now.getTime() + (Date.now() - started));
    try {
      const result = await fn(this.abort.signal);
      const stats = (typeof result === "object" && result ? result : {}) as Record<string, unknown>;
      const errors = Array.isArray(stats.errors) ? (stats.errors as string[]) : [];
      // A discovery run where every verification errored (e.g. source outage) counts as failed so it retries.
      const failed = errors.length > 0 && stats.discovered !== undefined && stats.verified === 0 && stats.rejected === 0 && stats.duplicates === 0;
      await opps.finishRun(runId, failed ? "failed" : "succeeded", { ...stats, newIds: undefined, ms: Date.now() - started }, failed ? errors[0] : undefined, finishedAt());
      return true;
    } catch (err) {
      log.warn({ err, job, slot }, "opportunity job failed");
      await opps.finishRun(runId, "failed", { ms: Date.now() - started }, (err as Error).message, finishedAt());
      return true;
    }
  }
}

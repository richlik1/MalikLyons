/**
 * Live end-to-end demonstration of the Opportunity Intelligence Department.
 * Runs ONE scheduler tick with the real source registry and real network:
 *   DISCOVERED → VERIFIED → SCORED → SAVED → ACTION PREPARED → REPORTED
 * then prints the stored records, stage history, research runs, and costs.
 *
 * Usage:
 *   DATABASE_URL=... MASTER_ENCRYPTION_KEY=... npx tsx scripts/opportunity-demo.ts
 *   DEMO_AT=2026-10-15T11:05:00Z ...   # pretend clock (07:05 Detroit = morning cycle)
 *
 * Sends briefs to Telegram if configured, otherwise prints them. Uses only real
 * API responses; an unreachable source is reported as a failure, never faked.
 */
import { Bot } from "grammy";
import pino from "pino";
import { loadConfig } from "../src/config.js";
import { ClaudeClient } from "../src/core/llm.js";
import type { Button, Notifier } from "../src/core/notifier.js";
import { migrate } from "../src/db/migrate.js";
import { createPool } from "../src/db/pool.js";
import { Store } from "../src/db/store.js";
import { SourceRegistry } from "../src/opportunities/registry.js";
import { formatOpportunity } from "../src/opportunities/report.js";
import { OpportunityScheduler } from "../src/opportunities/scheduler.js";
import { OpportunityService } from "../src/opportunities/service.js";
import { GitHubSource } from "../src/opportunities/sources/github.js";
import { GrantsGovSource } from "../src/opportunities/sources/grants-gov.js";
import { SamGovSource } from "../src/opportunities/sources/sam-gov.js";
import { OpportunityStore } from "../src/opportunities/store.js";
import { TelegramNotifier } from "../src/telegram/bot.js";

const cfg = loadConfig();
const log = pino({ level: process.env.DEMO_LOG_LEVEL ?? "info" });
const db = createPool(cfg.DATABASE_URL);
await migrate(db);
const store = new Store(db);
const opps = new OpportunityStore(db);
const registry = new SourceRegistry(db);
await registry.seed();

class ConsoleNotifier implements Notifier {
  async send(_c: number | null, text: string) {
    console.log(`\n=== TELEGRAM (console fallback) ===\n${text}\n`);
  }
  async sendWithButtons(c: number | null, text: string, buttons: Button[][]) {
    await this.send(c, `${text}\n[buttons: ${buttons.flat().map((b) => b.text).join(" | ")}]`);
  }
  async requestApproval() {
    return null;
  }
}
const notifier: Notifier =
  cfg.TELEGRAM_BOT_TOKEN && cfg.TELEGRAM_OWNER_USER_ID ? new TelegramNotifier(new Bot(cfg.TELEGRAM_BOT_TOKEN), cfg.TELEGRAM_OWNER_USER_ID, log) : new ConsoleNotifier();

const at = process.env.DEMO_AT ? new Date(process.env.DEMO_AT) : null;
const now = () => at ?? new Date();
const llm = cfg.ANTHROPIC_API_KEY ? new ClaudeClient(cfg) : null;
const service = new OpportunityService({
  store,
  opps,
  notifier,
  config: cfg,
  log,
  sources: [new GrantsGovSource(), new SamGovSource(cfg.SAM_API_KEY), new GitHubSource({ token: cfg.GITHUB_TOKEN })],
  now,
});
const scheduler = new OpportunityScheduler({ service, opps, store, registry, notifier, config: cfg, log, adapters: { config: cfg, llm, alertMailbox: async () => null }, now });

console.log(`\n--- recovering interrupted runs: ${await scheduler.recoverInterrupted()} ---`);
const ran = await scheduler.tick();
console.log(`\n--- tick at ${now().toISOString()} ran: ${ran.join(", ") || "(nothing due)"} ---`);

const runs = await db.query(
  "SELECT job, slot, attempt, status, api_calls, coalesce(left(error, 140), '') error FROM research_runs ORDER BY started_at DESC LIMIT 20",
);
console.log("\n--- research_runs (latest) ---");
console.table(runs.rows);

const sources = await registry.list();
console.log("\n--- source health ---");
console.table(sources.map((s) => ({ id: s.id, enabled: s.enabled, failures: s.consecutive_failures, lastSuccess: s.last_success_at?.toISOString() ?? "", lastError: (s.last_error ?? "").slice(0, 90) })));

const best = (await opps.search({ status: ["qualified", "verified", "approved"], limit: 1 }))[0];
if (best) {
  console.log("\n--- Best verified opportunity (stored in Postgres) ---\n");
  console.log(formatOpportunity(best, cfg.TIMEZONE));
  console.log("\n--- stage history ---");
  console.table((await opps.stages(best.id)).map((s) => ({ at: s.at.toISOString(), stage: s.stage, to: s.to_status, actor: s.actor })));
  console.log("\n--- prepared actions ---");
  console.table((await opps.actions(best.id)).map((a) => ({ kind: a.kind, title: a.title, status: a.status })));
} else {
  console.log("\nNo opportunity passed verification this run (see source health / runs above). Nothing was fabricated.");
}
console.log("\n--- research_costs (today) ---");
console.table(await opps.costSummary(1, cfg.TIMEZONE));
await db.end();

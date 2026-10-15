/**
 * Live end-to-end demonstration of the Opportunity Intelligence pipeline:
 *   discover (Grants.gov, + SAM.gov if SAM_API_KEY is set)
 *   → verify each item against the authoritative API record
 *   → assess eligibility → score → store in Postgres → report.
 *
 * Usage: DATABASE_URL=... MASTER_ENCRYPTION_KEY=... npx tsx scripts/opportunity-demo.ts
 * Sends the report to Telegram if configured, and always prints it.
 * Uses only real API responses; if a source is unreachable it says so.
 */
import { Bot } from "grammy";
import pino from "pino";
import { loadConfig } from "../src/config.js";
import type { Button, Notifier } from "../src/core/notifier.js";
import { migrate } from "../src/db/migrate.js";
import { createPool } from "../src/db/pool.js";
import { Store } from "../src/db/store.js";
import { formatOpportunity } from "../src/opportunities/report.js";
import { OpportunityService } from "../src/opportunities/service.js";
import { GrantsGovSource } from "../src/opportunities/sources/grants-gov.js";
import { SamGovSource } from "../src/opportunities/sources/sam-gov.js";
import { OpportunityStore } from "../src/opportunities/store.js";
import { TelegramNotifier } from "../src/telegram/bot.js";

const cfg = loadConfig();
const log = pino({ level: "warn" });
const db = createPool(cfg.DATABASE_URL);
await migrate(db);
const store = new Store(db);
const opps = new OpportunityStore(db);

class ConsoleNotifier implements Notifier {
  async send(_c: number | null, text: string) {
    console.log(`\n=== NOTIFICATION ===\n${text}\n`);
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

const sources = [new GrantsGovSource(), new SamGovSource(cfg.SAM_API_KEY)];
const service = new OpportunityService({ store, opps, notifier, config: cfg, log, sources });

for (const src of service.configuredSources()) {
  console.log(`\n--- ${src.name}: discovering and verifying (live) ---`);
  try {
    const s = await service.runDiscovery(src, AbortSignal.timeout(10 * 60_000));
    console.log(
      `${src.name}: ${s.discovered} found · ${s.duplicates} already known · ${s.verified} verified · ${s.rejected} filtered out · ${s.qualified} qualified · ${s.alerted} alerted`,
    );
    if (s.errors.length) console.log(`errors: ${s.errors.slice(0, 5).join(" | ")}`);
  } catch (err) {
    console.log(`${src.name} FAILED: ${(err as Error).message}`);
  }
}

const best = (await opps.search({ status: ["qualified", "verified"], limit: 1 }))[0];
if (best) {
  console.log("\n--- Best verified opportunity (stored in Postgres) ---\n");
  console.log(formatOpportunity(best, cfg.TIMEZONE));
  console.log("\nVerification record:", JSON.stringify(best.verification, null, 2));
  const r = await service.sendDailyBriefing();
  console.log(`\nDaily briefing sent: ${r.sent} (${r.count} items)`);
} else {
  const rejected = await opps.search({ status: ["rejected"], limit: 5 });
  console.log("\nNo opportunity passed verification and filters this run.");
  for (const o of rejected) console.log(`- filtered: ${o.title} — ${o.rejection_reason}`);
}
await db.end();

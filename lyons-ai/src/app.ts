import { hostname } from "node:os";
import { Bot } from "grammy";
import pino, { type Logger } from "pino";
import { defaultAgents } from "./agents/index.js";
import { integrationStatus, type Config } from "./config.js";
import { ClaudeClient, type LlmClient } from "./core/llm.js";
import type { ApprovalRequest, Notifier } from "./core/notifier.js";
import { ToolRegistry } from "./core/registry.js";
import { TaskRunner } from "./core/runner.js";
import { Worker } from "./core/worker.js";
import { migrate } from "./db/migrate.js";
import { createPool } from "./db/pool.js";
import { Store } from "./db/store.js";
import { buildServer } from "./http/server.js";
import { browserTools } from "./integrations/browser/page-snapshot.js";
import { calendarTools } from "./integrations/google/calendar.js";
import { gmailTools } from "./integrations/google/gmail.js";
import { GoogleAuthManager } from "./integrations/google/oauth.js";
import { StayOpsClient, stayOpsTools } from "./integrations/stayops/stayops.js";
import { SecretBox } from "./security/crypto.js";
import { registerHandlers, TelegramNotifier } from "./telegram/bot.js";
import { coreTools } from "./tools/core-tools.js";
import { estimateCostUsd } from "./core/spend.js";
import { OpportunityScheduler } from "./opportunities/scheduler.js";
import { OpportunityService } from "./opportunities/service.js";
import { GrantsGovSource } from "./opportunities/sources/grants-gov.js";
import { SamGovSource } from "./opportunities/sources/sam-gov.js";
import { WebResearchSource } from "./opportunities/sources/web-research.js";
import { OpportunityStore } from "./opportunities/store.js";
import { opportunityTools } from "./opportunities/tools.js";
import { opportunitySections } from "./opportunities/control-section.js";
import { normalizeEmail } from "./clients/identity.js";
import { AutomationPolicies } from "./clients/policies.js";
import { ClientService } from "./clients/service.js";
import { clientTools } from "./clients/tools.js";
import { registerIMessageBridge } from "./comms/imessage-bridge.js";
import type { Scope } from "./core/types.js";
import { registerStorageBridge, storageTools } from "./device/storage.js";
import { GmailMailbox } from "./gmail-cleanup/mailbox.js";
import { GmailCleanupService } from "./gmail-cleanup/service.js";
import { gmailCleanupTools } from "./gmail-cleanup/tools.js";
import type { DraftHook } from "./integrations/google/gmail.js";
import { moduleSections } from "./http/sections.js";
import { registerReceptionist } from "./receptionist/routes.js";
import { receptionistKnowledgeTool } from "./receptionist/tools.js";
import type { LlmRequest, LlmResponse } from "./core/llm.js";

/** Used when Telegram isn't configured: messages go to the log so nothing is silently lost. */
class LogNotifier implements Notifier {
  constructor(private readonly log: Logger) {}
  async send(chatId: number | null, text: string) {
    this.log.info({ chatId, text }, "notify (telegram not configured)");
  }
  async requestApproval(chatId: number | null, req: ApprovalRequest) {
    this.log.warn({ chatId, req }, "approval requested but telegram not configured; use /approvals once connected");
    return null;
  }
}

export function createLogger(cfg: Config): Logger {
  return pino({
    level: cfg.LOG_LEVEL,
    redact: {
      paths: ["*.access_token", "*.refresh_token", "*.id_token", "*.authorization", "*.encrypted_tokens", "headers.authorization"],
      censor: "[redacted]",
    },
  });
}

export function buildTools(cfg: Config, google: GoogleAuthManager, onDraft?: DraftHook): ToolRegistry {
  const tools = new ToolRegistry();
  coreTools.forEach((t) => tools.register(t));
  if (google.configured) {
    gmailTools(google, onDraft).forEach((t) => tools.register(t));
    calendarTools(google).forEach((t) => tools.register(t));
  }
  if (cfg.STAYOPS_API_BASE_URL && cfg.STAYOPS_API_TOKEN) {
    stayOpsTools(new StayOpsClient(cfg.STAYOPS_API_BASE_URL, cfg.STAYOPS_API_TOKEN)).forEach((t) => tools.register(t));
  }
  if (cfg.BROWSER_ALLOWED_DOMAINS.length) browserTools().forEach((t) => tools.register(t));
  return tools;
}

export async function startApp(cfg: Config, opts: { llm?: LlmClient } = {}) {
  const log = createLogger(cfg);
  const db = createPool(cfg.DATABASE_URL);
  const applied = await migrate(db);
  if (applied.length) log.info({ applied }, "migrations applied");

  const store = new Store(db);
  const box = new SecretBox(cfg.MASTER_ENCRYPTION_KEY);
  const google = new GoogleAuthManager(cfg, store, box);
  const clients = new ClientService(db, store);
  const policies = new AutomationPolicies(db, store, cfg.TIMEZONE);
  const cleanup = new GmailCleanupService(db, store);
  const mailboxFor = async (scope: Scope) => new GmailMailbox(await google.clientFor(scope));
  // Every Gmail draft the agent creates is tracked as an outbound message (draft → sent → replied).
  const onDraft: DraftHook = async (d) => {
    const to = d.to[0] ?? "";
    const match = await clients.resolve({ email: normalizeEmail(to) ?? to, source: "outbound" });
    await clients.recordOutbound({ clientId: match.clientId, channel: "email", to, subject: d.subject, body: d.body, status: "draft", externalId: d.draftId, taskId: d.taskId });
  };
  const tools = buildTools(cfg, google, onDraft);
  clientTools({ clients, policies, google, mailboxFor }).forEach((t) => tools.register(t));
  if (google.configured) gmailCleanupTools(cleanup, mailboxFor).forEach((t) => tools.register(t));
  storageTools(store).forEach((t) => tools.register(t));
  tools.register(receptionistKnowledgeTool);
  const agents = defaultAgents();

  if (!cfg.ANTHROPIC_API_KEY && !opts.llm) log.warn("ANTHROPIC_API_KEY is not set: tasks will fail until it is provided");
  const llm = opts.llm ?? new ClaudeClient(cfg);

  let bot: Bot | null = null;
  let notifier: Notifier;
  if (cfg.TELEGRAM_BOT_TOKEN && cfg.TELEGRAM_OWNER_USER_ID) {
    bot = new Bot(cfg.TELEGRAM_BOT_TOKEN);
    notifier = new TelegramNotifier(bot, cfg.TELEGRAM_OWNER_USER_ID, log);
  } else {
    log.warn("Telegram not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_OWNER_USER_ID); notifications go to the log");
    notifier = new LogNotifier(log);
  }

  // ---- Opportunity Intelligence ----
  const opps = new OpportunityStore(db);
  const web = new WebResearchSource(cfg.ANTHROPIC_API_KEY || opts.llm ? llm : null, {
    onUsage: async (r) => {
      await store.recordSpend({
        taskId: null,
        model: r.model,
        inputTokens: r.usage.input_tokens,
        outputTokens: r.usage.output_tokens,
        cacheReadTokens: r.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: r.usage.cache_creation_input_tokens ?? 0,
        costUsd: estimateCostUsd(r.model, r.usage),
        label: "opportunity_research",
      });
    },
  });
  const oppService = new OpportunityService({
    store,
    opps,
    notifier,
    config: cfg,
    log,
    sources: [new GrantsGovSource(), new SamGovSource(cfg.SAM_API_KEY), web],
  });
  opportunityTools(opps, oppService).forEach((t) => tools.register(t));
  const oppScheduler = new OpportunityScheduler({ service: oppService, opps, store, config: cfg, log, web });
  log.info({ integrations: integrationStatus(cfg), tools: tools.names() }, "configuration");

  const workerId = `${hostname()}:${process.pid}`;
  const runner = new TaskRunner({ store, llm, tools, agents, notifier, config: cfg, log, workerId });
  const worker = new Worker({ store, runner, notifier, log, workerId, concurrency: cfg.WORKER_CONCURRENCY, taskTimeoutMs: cfg.TASK_TIMEOUT_MS });

  const server = buildServer({
    config: cfg,
    store,
    google,
    agents,
    notifier,
    runner,
    sections: [...opportunitySections(opps, cfg.TIMEZONE), ...moduleSections({ store, clients, policies, cleanup, timezone: cfg.TIMEZONE })],
  });
  registerIMessageBridge(server, { config: cfg, store, clients, notifier });
  registerStorageBridge(server, { config: cfg, store });
  // The receptionist uses its own (fast, low-effort) model settings and records spend under its own label.
  const receptionistLlm = opts.llm ?? new ClaudeClient({ ...cfg, CLAUDE_MODEL: cfg.RECEPTIONIST_MODEL, CLAUDE_EFFORT: cfg.RECEPTIONIST_EFFORT, CLAUDE_MAX_TOKENS: 1024 });
  registerReceptionist(server, {
    config: cfg,
    store,
    clients,
    notifier,
    log,
    llm: {
      async createMessage(req: LlmRequest, signal: AbortSignal): Promise<LlmResponse> {
        const r = await receptionistLlm.createMessage(req, signal);
        await store.recordSpend({
          taskId: null,
          model: r.model,
          inputTokens: r.usage.input_tokens,
          outputTokens: r.usage.output_tokens,
          cacheReadTokens: r.usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: r.usage.cache_creation_input_tokens ?? 0,
          costUsd: estimateCostUsd(r.model, r.usage),
          label: "receptionist",
        });
        return r;
      },
    },
  });
  await server.listen({ host: cfg.HTTP_HOST, port: cfg.HTTP_PORT });
  log.info({ port: cfg.HTTP_PORT }, "http server listening");

  if (bot) {
    registerHandlers(bot, {
      config: cfg,
      store,
      runner,
      agents,
      google,
      notifier,
      log,
      opportunities: { service: oppService, store: opps },
      comms: { clients, policies },
    });
    await bot.api.setMyCommands([
      { command: "status", description: "Health, spend, integrations" },
      { command: "tasks", description: "Recent tasks" },
      { command: "approvals", description: "Pending approvals" },
      { command: "brief", description: "Run a briefing now: morning|evening" },
      { command: "personal", description: "Run a request in personal accounts" },
      { command: "pause", description: "KILL SWITCH - stop all work" },
      { command: "resume", description: "Resume work" },
      { command: "help", description: "All commands" },
    ]);
    void bot.start({ drop_pending_updates: false, onStart: (me) => log.info({ username: me.username }, "telegram bot started") });
  }

  worker.start();
  if (cfg.OPP_ENABLED) oppScheduler.start();

  const shutdown = async () => {
    log.info("shutting down");
    await bot?.stop();
    oppScheduler.stop();
    runner.abortAll("shutdown");
    await worker.stop();
    await server.close();
    await db.end();
  };
  return { shutdown, store, worker, runner, server, log, opps, oppService, oppScheduler, clients, policies, cleanup };
}

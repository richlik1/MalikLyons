import { Bot, InlineKeyboard, type Context } from "grammy";
import type { Logger } from "pino";
import type { Config } from "../config.js";
import { integrationStatus } from "../config.js";
import type { ApprovalRequest, Button, Notifier } from "../core/notifier.js";
import type { AgentRegistry } from "../core/registry.js";
import type { TaskRunner } from "../core/runner.js";
import { MODULES, type ModuleName, type Scope } from "../core/types.js";
import type { Store, TaskRow } from "../db/store.js";
import type { GoogleAuthManager } from "../integrations/google/oauth.js";
import { triggerBriefing } from "../scheduler/briefings.js";
import { loadProfile, profileGaps } from "../opportunities/profile.js";
import { formatOpportunity } from "../opportunities/report.js";
import { opportunityButtons, parseOpportunityCallback, type OpportunityService } from "../opportunities/service.js";
import type { OpportunityStore } from "../opportunities/store.js";
import type { SourceRegistry } from "../opportunities/registry.js";
import type { OpportunityScheduler } from "../opportunities/scheduler.js";
import type { AutomationPolicies } from "../clients/policies.js";
import type { ClientService } from "../clients/service.js";
import { approvalCallbackData, chunkMessage, isOwner, parseApprovalCallback, parseRemember, parseScope, taskTitle } from "./parse.js";

export class TelegramNotifier implements Notifier {
  constructor(
    private readonly bot: Bot,
    private readonly ownerId: number,
    private readonly log: Logger,
  ) {}

  async send(chatId: number | null, text: string): Promise<void> {
    for (const part of chunkMessage(text)) {
      try {
        await this.bot.api.sendMessage(chatId ?? this.ownerId, part, { link_preview_options: { is_disabled: true } });
      } catch (err) {
        this.log.error({ err }, "telegram send failed");
      }
    }
  }

  async sendWithButtons(chatId: number | null, text: string, buttons: Button[][]): Promise<void> {
    const parts = chunkMessage(text);
    const kb = new InlineKeyboard();
    buttons.forEach((row, i) => {
      row.forEach((b) => kb.text(b.text, b.data));
      if (i < buttons.length - 1) kb.row();
    });
    for (let i = 0; i < parts.length; i++) {
      try {
        await this.bot.api.sendMessage(chatId ?? this.ownerId, parts[i]!, {
          link_preview_options: { is_disabled: true },
          ...(i === parts.length - 1 ? { reply_markup: kb } : {}),
        });
      } catch (err) {
        this.log.error({ err }, "telegram send failed");
      }
    }
  }

  async requestApproval(chatId: number | null, req: ApprovalRequest): Promise<number | null> {
    const kb = new InlineKeyboard()
      .text("✅ Approve", approvalCallbackData(req.approvalId, true))
      .text("❌ Reject", approvalCallbackData(req.approvalId, false));
    const text = `🔐 Approval needed (${req.risk})\n\n${req.summary}\n\nTool: ${req.toolName}\nTask: ${req.taskId.slice(0, 8)}\nExpires: ${req.expiresAt.toISOString()}`;
    const msg = await this.bot.api.sendMessage(chatId ?? this.ownerId, text.slice(0, 4000), { reply_markup: kb });
    return msg.message_id;
  }
}

const HELP = `LYONS AI — send me any request in plain English and I'll turn it into a task.

Tasks
/tasks — recent tasks
/task <id> — task details
/cancel <id> — cancel a task
/personal <request> — run in your PERSONAL accounts (default is business)
/agent <name> <request> — use a specialist agent (/agents to list)

Approvals
/approvals — pending approvals

Briefings
/brief morning|evening [personal]

Memory
/remember <client|project|goal|preference|person|fact> <subject>: <details>

Accounts
/connect_google business|personal
/disconnect_google business|personal

Opportunities
/opps — pipeline and top opportunities
/opp <id> — full recommendation
/opp_done <id> <result> — record the outcome
/profile — what the engine knows about you
/sources — research sources and their health
/source_enable <id>, /source_disable <id>
/opp_runs — recent research runs · /opp_costs — research cost
/opp_retry <job> — retry a dead-lettered job

Clients & communications
/followups — unanswered client requests and what's coming up
/identities — uncertain contact matches to confirm
/identity <id> yes|no — confirm or reject a match
/policies — automation policies
/policy_activate <id>, /policy_revoke <id>
/cleanup — scan your inbox and propose a reversible cleanup

Safety
/status — health, spend, integrations
/pause — KILL SWITCH: stop all work now
/resume — resume work
/modules — module status
/pause_module <name>, /resume_module <name> — pause one module`;

function fmtTask(t: TaskRow): string {
  return `${t.id.slice(0, 8)} [${t.status}] ${t.title} (${t.scope}, $${Number(t.cost_usd).toFixed(3)})`;
}

export function registerHandlers(
  bot: Bot,
  d: {
    config: Config;
    store: Store;
    runner: TaskRunner;
    agents: AgentRegistry;
    google: GoogleAuthManager;
    notifier: Notifier;
    log: Logger;
    opportunities?: { service: OpportunityService; store: OpportunityStore; registry?: SourceRegistry; scheduler?: OpportunityScheduler };
    comms?: { clients: ClientService; policies: AutomationPolicies };
  },
): void {
  const { config, store, runner, agents, google, log } = d;

  // Owner-only, private-chat-only. Everyone else is ignored (and audited).
  bot.use(async (ctx, next) => {
    if (isOwner(ctx.from?.id, ctx.chat?.type ?? (ctx.callbackQuery ? "private" : undefined), config.TELEGRAM_OWNER_USER_ID)) return next();
    log.warn({ from: ctx.from?.id, chat: ctx.chat?.id }, "ignored telegram update from non-owner");
    await store.audit("telegram", "telegram.unauthorized", null, { fromId: ctx.from?.id ?? null, chatId: ctx.chat?.id ?? null });
  });

  const reply = (ctx: Context, text: string) => Promise.all(chunkMessage(text).map((p) => ctx.reply(p)));

  const createTask = async (ctx: Context, input: string, scope: Scope, agent = "chief_of_staff") => {
    if (await store.isPaused()) {
      await reply(ctx, "⛔ Kill switch is ON. Send /resume first.");
      return;
    }
    const task = await store.createTask({ title: taskTitle(input), input, scope, source: "telegram", agent, chatId: ctx.chat!.id });
    await reply(ctx, `📝 Task ${task.id.slice(0, 8)} queued (${scope}${agent !== "chief_of_staff" ? `, ${agent}` : ""}). I'll report back.`);
  };

  bot.command(["start", "help"], (ctx) => reply(ctx, HELP));

  bot.command("status", async (ctx) => {
    const [paused, spend, open, pending, gb, gp] = await Promise.all([
      store.isPaused(),
      store.spendToday(config.TIMEZONE),
      store.openTasks(),
      store.pendingApprovals(),
      google.configured ? google.status("business") : Promise.resolve("not configured"),
      google.configured ? google.status("personal") : Promise.resolve("not configured"),
    ]);
    const integ = Object.entries(integrationStatus(config))
      .map(([k, v]) => `- ${k}: ${v}`)
      .join("\n");
    await reply(
      ctx,
      `Kill switch: ${paused ? "ON ⛔" : "off ✅"}
Spend today: $${spend.toFixed(2)} / $${config.DAILY_SPEND_LIMIT_USD} (per task cap $${config.TASK_SPEND_LIMIT_USD})
Open tasks: ${open.length} (running now: ${runner.activeCount})
Pending approvals: ${pending.length}
Google business: ${gb}
Google personal: ${gp}
Integrations:
${integ}`,
    );
  });

  bot.command("pause", async (ctx) => {
    await store.setPaused(true, "owner");
    runner.abortAll();
    await reply(ctx, "⛔ Kill switch ON. All running tasks halted; nothing new will start. /resume to continue.");
  });

  bot.command("resume", async (ctx) => {
    await store.setPaused(false, "owner");
    await reply(ctx, "✅ Resumed. Halted tasks will continue where they left off.");
  });

  bot.command("modules", async (ctx) => {
    const paused = await store.pausedModules();
    await reply(ctx, MODULES.map((m) => `${paused.includes(m) ? "⏸" : "▶️"} ${m}`).join("\n"));
  });

  for (const [cmd, pause] of [["pause_module", true], ["resume_module", false]] as const) {
    bot.command(cmd, async (ctx) => {
      const m = ctx.match.trim() as ModuleName;
      if (!MODULES.includes(m)) return void (await reply(ctx, `Usage: /${cmd} <${MODULES.join("|")}>`));
      await store.setModulePaused(m, pause, "owner");
      await reply(ctx, `${pause ? "⏸ Paused" : "▶️ Resumed"} ${m}.`);
    });
  }

  bot.command("tasks", async (ctx) => {
    const tasks = await store.recentTasks(15);
    await reply(ctx, tasks.length ? tasks.map(fmtTask).join("\n") : "No tasks yet.");
  });

  bot.command("task", async (ctx) => {
    const t = await store.findTaskByPrefix(ctx.match.trim());
    if (!t) return void (await reply(ctx, "Task not found (use the 8-char id from /tasks)."));
    const calls = await store.toolCallsForTask(t.id);
    const lines = calls.map((c) => `- ${c.tool_name}: ${c.status}`).join("\n") || "- none";
    await reply(ctx, `${fmtTask(t)}\nAgent: ${t.agent}\nTurns: ${t.turns}\n\nRequest:\n${t.input.slice(0, 800)}\n\nTool calls:\n${lines}\n\n${t.result ?? t.error ?? ""}`);
  });

  bot.command("cancel", async (ctx) => {
    const t = await store.findTaskByPrefix(ctx.match.trim());
    if (!t) return void (await reply(ctx, "Task not found."));
    const ok = await store.cancelTask(t.id, "owner");
    runner.abort(t.id);
    await reply(ctx, ok ? `🛑 Cancelled ${t.id.slice(0, 8)}.` : `Task is already ${t.status}.`);
  });

  bot.command("approvals", async (ctx) => {
    const pending = await store.pendingApprovals();
    if (!pending.length) return void (await reply(ctx, "No pending approvals."));
    for (const a of pending) {
      const kb = new InlineKeyboard().text("✅ Approve", approvalCallbackData(a.id, true)).text("❌ Reject", approvalCallbackData(a.id, false));
      await ctx.reply(`🔐 ${a.summary}\nTask ${a.task_id.slice(0, 8)}`, { reply_markup: kb });
    }
  });

  bot.command("personal", async (ctx) => {
    if (!ctx.match.trim()) return void (await reply(ctx, "Usage: /personal <request>"));
    await createTask(ctx, ctx.match.trim(), "personal");
  });

  bot.command("agents", (ctx) => reply(ctx, agents.list().map((a) => `- ${a.name}: ${a.description}`).join("\n")));

  bot.command("agent", async (ctx) => {
    const [name, ...rest] = ctx.match.trim().split(/\s+/);
    if (!name || !agents.get(name) || !rest.length) return void (await reply(ctx, "Usage: /agent <name> <request>. See /agents."));
    await createTask(ctx, rest.join(" "), "business", name);
  });

  bot.command("brief", async (ctx) => {
    const [kindArg, scopeArg] = ctx.match.trim().toLowerCase().split(/\s+/);
    const kind = kindArg === "evening" ? "evening" : "morning";
    const scope = parseScope(scopeArg) ?? "business";
    const r = await triggerBriefing(store, { kind, scope, timeZone: config.TIMEZONE, chatId: ctx.chat.id, force: true });
    await reply(ctx, r.created ? `📋 ${kind} briefing queued (${r.task.id.slice(0, 8)}).` : r.reason);
  });

  bot.command("remember", async (ctx) => {
    const m = parseRemember(ctx.match);
    if (!m) return void (await reply(ctx, "Usage: /remember client Acme Rentals: prefers invoices on the 1st"));
    const saved = await store.saveMemory({ ...m, scope: "business", source: "owner" });
    await reply(ctx, `🧠 Remembered [${saved.kind}] ${saved.subject}.`);
  });

  bot.command("connect_google", async (ctx) => {
    const scope = parseScope(ctx.match);
    if (!scope) return void (await reply(ctx, "Usage: /connect_google business|personal"));
    if (!google.configured) return void (await reply(ctx, "Google OAuth isn't configured on the server (GOOGLE_CLIENT_ID/SECRET)."));
    const url = await google.createAuthUrl(scope);
    await reply(ctx, `Open this link and sign in with your ${scope.toUpperCase()} Google account (valid 10 minutes, single use):\n${url}`);
  });

  bot.command("disconnect_google", async (ctx) => {
    const scope = parseScope(ctx.match);
    if (!scope) return void (await reply(ctx, "Usage: /disconnect_google business|personal"));
    await google.disconnect(scope);
    await reply(ctx, `Disconnected Google ${scope} and revoked its token.`);
  });

  if (d.opportunities) {
    const { service, store: opps } = d.opportunities;

    bot.command("opps", async (ctx) => {
      const counts = await opps.pipelineCounts();
      const top = await opps.search({ status: ["qualified", "approved", "in_progress"], limit: 8 });
      const lines = top.map((o) => `- ${o.id.slice(0, 8)} [${o.status}] ${o.title} — ${Math.round(Number(o.score))}/100`);
      await reply(
        ctx,
        `Pipeline: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(" · ") || "empty"}\n\n${lines.join("\n") || "Nothing qualified yet."}\n\nUse /opp <id> for details.`,
      );
    });

    bot.command("opp", async (ctx) => {
      const o = await opps.findByPrefix(ctx.match.trim());
      if (!o) return void (await reply(ctx, "Opportunity not found (use the 8-char id from /opps)."));
      const text = formatOpportunity(o, config.TIMEZONE);
      if (d.notifier.sendWithButtons) await d.notifier.sendWithButtons(ctx.chat.id, text, opportunityButtons(o.id));
      else await reply(ctx, text);
    });

    bot.command("opp_done", async (ctx) => {
      const [prefix, ...rest] = ctx.match.trim().split(/\s+/);
      const o = prefix ? await opps.findByPrefix(prefix) : null;
      if (!o) return void (await reply(ctx, "Usage: /opp_done <id> <what happened>"));
      await service.feedback(o.id, "completed", "owner", rest.join(" ") || undefined);
      await reply(ctx, `Recorded the outcome for "${o.title}". Thanks — this tunes future recommendations.`);
    });

    bot.command("sources", async (ctx) => {
      if (!d.opportunities?.registry) return void (await reply(ctx, "Source registry not available."));
      const list = await d.opportunities.registry.list();
      await reply(
        ctx,
        list
          .map(
            (s) =>
              `${s.enabled ? (s.consecutive_failures ? "⚠️" : "✅") : "⏸"} ${s.id} — ${s.name} [${s.department}, ${s.kind}]${s.consecutive_failures ? ` · ${s.consecutive_failures} failure(s): ${s.last_error ?? ""}` : ""}${s.disabled_reason ? ` · ${s.disabled_reason}` : ""}`,
          )
          .join("\n"),
      );
    });

    for (const [cmd, enable] of [["source_enable", true], ["source_disable", false]] as const) {
      bot.command(cmd, async (ctx) => {
        const id = ctx.match.trim();
        const ok = id && d.opportunities?.registry ? await d.opportunities.registry.setEnabled(id, enable, "disabled by owner") : false;
        await reply(ctx, ok ? `${enable ? "Enabled" : "Disabled"} source ${id}.` : `Usage: /${cmd} <id> (see /sources)`);
      });
    }

    bot.command("opp_runs", async (ctx) => {
      const runs = (await opps.recentRuns(15)) as { job: string; slot: string; status: string; attempt: number; api_calls: number; error: string | null }[];
      await reply(ctx, runs.map((r) => `${r.status === "succeeded" ? "✅" : r.status === "skipped" ? "⏭" : r.status === "running" ? "⏳" : "❌"} ${r.job} ${r.slot} · attempt ${r.attempt} · ${r.api_calls} req${r.error ? ` · ${r.error.slice(0, 80)}` : ""}`).join("\n") || "No runs yet.");
    });

    bot.command("opp_costs", async (ctx) => {
      const rows = await opps.costSummary(7, config.TIMEZONE);
      const total = rows.reduce((a, r) => a + r.llmUsd, 0);
      await reply(ctx, `Research cost, last 7 days: $${total.toFixed(2)}\n${rows.map((r) => `- ${r.sourceId ?? "other"}: $${r.llmUsd.toFixed(2)} · ${r.requests} API request(s)`).join("\n") || "- nothing yet"}`);
    });

    bot.command("opp_retry", async (ctx) => {
      const ok = d.opportunities?.scheduler ? await d.opportunities.scheduler.retryDeadLetter(ctx.match.trim()) : false;
      await reply(ctx, ok ? "Queued for retry on the next scheduler tick." : "No dead-lettered run with that job name (see /opp_runs).");
    });

    bot.command("profile", async (ctx) => {
      const p = await loadProfile(store);
      const gaps = profileGaps(p);
      await reply(
        ctx,
        `${p.business.legalName} · ${p.business.entityType} · ${p.business.state} (${p.business.metroArea})\nNAICS: ${p.business.naics.join(", ")}\nSAM.gov registered: ${p.business.samRegistered ?? "unknown"}\nCertifications: ${p.business.certifications.join(", ") || "none listed"}\nMax upfront investment: $${p.constraints.maxUpfrontInvestmentUsd} · ~${p.constraints.weeklyHoursAvailable} h/week spare\n${gaps.length ? `\nTo sharpen eligibility checks, tell me:\n- ${gaps.join("\n- ")}` : ""}`,
      );
    });
  }

  if (d.comms) {
    const { clients, policies } = d.comms;

    bot.command("followups", async (ctx) => {
      const [open, upcoming] = await Promise.all([clients.unanswered(24), clients.upcoming(7)]);
      const fmt = (x: Date) => x.toLocaleString("en-US", { timeZone: config.TIMEZONE, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      await reply(
        ctx,
        [
          `Unanswered client requests (>24h): ${open.length}`,
          ...open.slice(0, 15).map((o) => `- ${o.name}, ${fmt(o.at)}: ${o.summary.slice(0, 140)}`),
          "",
          `Next 7 days: ${upcoming.length}`,
          ...upcoming.slice(0, 15).map((u) => `- ${fmt(u.due_at)} ${u.kind} — ${u.name}: ${u.summary.slice(0, 100)}`),
          "",
          "Ask me to draft replies for any of these.",
        ].join("\n"),
      );
    });

    bot.command("identities", async (ctx) => {
      const rows = await clients.pendingSuggestions();
      await reply(ctx, rows.length ? rows.map((r) => `${r.id.slice(0, 8)}: ${r.value}${r.display_name ? ` (${r.display_name})` : ""} → ${r.client_name}? ${r.reason}`).join("\n") + "\n\nReply /identity <id> yes|no" : "Nothing to confirm.");
    });

    bot.command("identity", async (ctx) => {
      const [prefix, answer] = ctx.match.trim().split(/\s+/);
      const all = await clients.pendingSuggestions();
      const match = all.filter((r) => prefix && r.id.startsWith(prefix.toLowerCase()));
      if (match.length !== 1 || !["yes", "no"].includes(answer ?? "")) return void (await reply(ctx, "Usage: /identity <id> yes|no (ids from /identities)"));
      await reply(ctx, await clients.decideSuggestion(match[0]!.id, answer === "yes", "owner"));
    });

    bot.command("policies", async (ctx) => {
      const list = await policies.list();
      await reply(
        ctx,
        list.length
          ? list.map((p) => `${p.id.slice(0, 8)} [${p.status}] ${p.name}\n  ${p.channel} → ${p.rules.recipients.join(", ")}; max ${p.rules.maxPerDay}/day${p.rules.subjectPrefix ? `; subject starts "${p.rules.subjectPrefix}"` : ""}\n  ${p.description}`).join("\n\n")
          : "No automation policies: every outgoing message needs your approval.",
      );
    });

    for (const [cmd, status] of [["policy_activate", "active"], ["policy_revoke", "revoked"]] as const) {
      bot.command(cmd, async (ctx) => {
        const p = await policies.findByPrefix(ctx.match.trim());
        if (!p) return void (await reply(ctx, `Usage: /${cmd} <id> (from /policies)`));
        const ok = await policies.setStatus(p.id, status, "owner");
        await reply(ctx, ok ? `Policy "${p.name}" is now ${status}.` : `Policy "${p.name}" can't be changed (it may be revoked).`);
      });
    }

    bot.command("cleanup", async (ctx) => {
      if (await store.isPaused()) return void (await reply(ctx, "⛔ Kill switch is ON."));
      const scope = parseScope(ctx.match) ?? "business";
      await store.createTask({
        title: `Gmail cleanup scan (${scope})`,
        input: "Scan my inbox with gmail_cleanup_scan (archive only, older than 30 days) and send me the cleanup report. Do not apply anything yet.",
        scope,
        source: "telegram",
        chatId: ctx.chat.id,
      });
      await reply(ctx, `🧹 Scanning your ${scope} inbox. I'll send the report; nothing changes until you approve.`);
    });
  }

  bot.on("callback_query:data", async (ctx) => {
    const opp = parseOpportunityCallback(ctx.callbackQuery.data);
    if (opp && d.opportunities) {
      const o = await d.opportunities.store.get(opp.id);
      if (!o) return void (await ctx.answerCallbackQuery({ text: "Not found" }));
      if (opp.action === "dismiss") {
        await d.opportunities.service.feedback(o.id, "rejected", "owner");
        await ctx.answerCallbackQuery({ text: "Dismissed — I'll show fewer like this" });
        return;
      }
      await d.opportunities.service.feedback(o.id, "accepted", "owner");
      if (opp.action === "prepare") {
        await store.createTask({
          title: `Prepare: ${o.title}`.slice(0, 60),
          input: `Prepare to pursue this opportunity. Read the official page, then produce: (1) an application/bid checklist with every required document and form, (2) key dates, (3) open questions about eligibility, (4) a draft of any narrative or outreach as a Gmail DRAFT if relevant. Do not submit or contact anyone.\n\n${formatOpportunity(o, config.TIMEZONE)}`,
          scope: "business",
          source: "telegram",
          chatId: ctx.chat?.id ?? null,
        });
        await ctx.answerCallbackQuery({ text: "Pursuing — preparing a checklist" });
      } else {
        await ctx.answerCallbackQuery({ text: "Marked as pursuing" });
      }
      return;
    }
    const parsed = parseApprovalCallback(ctx.callbackQuery.data);
    if (!parsed) return void (await ctx.answerCallbackQuery({ text: "Unknown action" }));
    const r = await store.decideApproval(parsed.approvalId, parsed.approve, "owner");
    if (!r.ok) {
      await ctx.answerCallbackQuery({ text: r.reason });
      return;
    }
    await ctx.answerCallbackQuery({ text: parsed.approve ? "Approved" : "Rejected" });
    const base = ctx.callbackQuery.message && "text" in ctx.callbackQuery.message ? ctx.callbackQuery.message.text ?? "" : r.approval.summary;
    await ctx.editMessageText(`${base}\n\n${parsed.approve ? "✅ APPROVED — executing" : "❌ REJECTED"}`).catch(() => {});
  });

  bot.on("message:text", async (ctx) => {
    if (ctx.message.text.startsWith("/")) return void (await reply(ctx, "Unknown command. /help"));
    await createTask(ctx, ctx.message.text, "business");
  });

  bot.catch((err) => log.error({ err: err.error }, "telegram handler error"));
}

import { Bot, InlineKeyboard, type Context } from "grammy";
import type { Logger } from "pino";
import type { Config } from "../config.js";
import { integrationStatus } from "../config.js";
import type { ApprovalRequest, Notifier } from "../core/notifier.js";
import type { AgentRegistry } from "../core/registry.js";
import type { TaskRunner } from "../core/runner.js";
import type { Scope } from "../core/types.js";
import type { Store, TaskRow } from "../db/store.js";
import type { GoogleAuthManager } from "../integrations/google/oauth.js";
import { triggerBriefing } from "../scheduler/briefings.js";
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

Safety
/status — health, spend, integrations
/pause — KILL SWITCH: stop all work now
/resume — resume work`;

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

  bot.on("callback_query:data", async (ctx) => {
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

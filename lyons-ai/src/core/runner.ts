import type { Logger } from "pino";
import type { Config } from "../config.js";
import type { Store, TaskRow, ToolCallRow } from "../db/store.js";
import { wrapUntrusted } from "../security/untrusted.js";
import { TaskFailure } from "./errors.js";
import type { LlmClient, LlmMessage } from "./llm.js";
import type { Notifier } from "./notifier.js";
import { decide, forbiddenDataClasses } from "./policy.js";
import { buildSystemPrompt } from "./prompts.js";
import type { AgentRegistry, ToolRegistry } from "./registry.js";
import { estimateCostUsd } from "./spend.js";
import type { AgentDefinition, ToolContext, ToolDefinition } from "./types.js";

type ToolUse = { type: "tool_use"; id: string; name: string; input: unknown };
type ToolResultBlock = { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export { TaskFailure };

/** Thrown to stop a task without marking it failed (kill switch / cancellation). */
export class HaltError extends Error {
  constructor(readonly kind: "paused" | "shutdown" | "cancelled" | "timeout") {
    super(kind);
  }
}

export interface RunnerDeps {
  store: Store;
  llm: LlmClient;
  tools: ToolRegistry;
  agents: AgentRegistry;
  notifier: Notifier;
  config: Config;
  log: Logger;
  workerId: string;
  leaseMs?: number;
}

export class TaskRunner {
  private readonly controllers = new Map<string, AbortController>();
  private readonly leaseMs: number;

  constructor(private readonly d: RunnerDeps) {
    this.leaseMs = d.leaseMs ?? 60_000;
  }

  /** Kill switch / shutdown: abort every in-flight task at its next await point. Tasks stay resumable. */
  abortAll(kind: "paused" | "shutdown" = "paused"): void {
    for (const c of this.controllers.values()) c.abort(new HaltError(kind));
  }

  abort(taskId: string): void {
    this.controllers.get(taskId)?.abort(new HaltError("cancelled"));
  }

  get activeCount(): number {
    return this.controllers.size;
  }

  async run(task: TaskRow): Promise<void> {
    const { store, notifier, log } = this.d;
    const chatId = task.chat_id ? Number(task.chat_id) : null;
    const ac = new AbortController();
    this.controllers.set(task.id, ac);
    const msLeft = task.deadline_at ? task.deadline_at.getTime() - Date.now() : this.d.config.TASK_TIMEOUT_MS;
    const timeout = setTimeout(() => ac.abort(new HaltError("timeout")), Math.max(0, msLeft));
    const lease = setInterval(() => {
      store.renewLease(task.id, this.d.workerId, this.leaseMs).catch((err) => log.warn({ err }, "lease renewal failed"));
    }, Math.floor(this.leaseMs / 3));

    if (task.attempts > 1) await store.audit("system", "task.resumed", task.id, { attempt: task.attempts });

    try {
      await this.loop(task, chatId, ac.signal);
    } catch (err) {
      const halt = err instanceof HaltError ? err : ac.signal.reason instanceof HaltError ? ac.signal.reason : null;
      if (halt?.kind === "paused" || halt?.kind === "shutdown") {
        // Leave the task resumable; it continues after /resume or restart.
        await store.setTaskStatus(task.id, "queued");
        await store.audit("system", "task.halted", task.id, { reason: halt.kind === "paused" ? "kill switch" : "shutdown" });
      } else if (halt?.kind === "cancelled") {
        await store.audit("system", "task.halted", task.id, { reason: "cancelled" });
      } else if (halt?.kind === "timeout") {
        await this.fail(task, chatId, `Timed out after ${Math.round(this.d.config.TASK_TIMEOUT_MS / 60000)} min.`);
      } else {
        log.error({ err, taskId: task.id }, "task failed");
        await this.fail(task, chatId, err instanceof TaskFailure ? err.message : `Internal error: ${(err as Error).message}`);
      }
    } finally {
      clearTimeout(timeout);
      clearInterval(lease);
      this.controllers.delete(task.id);
    }
  }

  private async fail(task: TaskRow, chatId: number | null, message: string) {
    await this.d.store.setTaskStatus(task.id, "failed", { error: message });
    await this.d.store.audit("system", "task.failed", task.id, { error: message });
    await this.d.notifier.send(chatId, `❌ Task failed: ${task.title}\n${message}\n(id ${task.id.slice(0, 8)})`);
  }

  private async checkpoint(taskId: string, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw signal.reason instanceof HaltError ? signal.reason : new HaltError("cancelled");
    if (await this.d.store.isPaused()) throw new HaltError("paused");
    const current = await this.d.store.getTask(taskId);
    if (!current || current.status === "cancelled") throw new HaltError("cancelled");
  }

  private async loop(task: TaskRow, chatId: number | null, signal: AbortSignal): Promise<void> {
    const { store, llm, tools, config, notifier } = this.d;
    const agent = this.d.agents.get(task.agent);
    if (!agent) throw new TaskFailure(`Unknown agent "${task.agent}".`);
    const system = buildSystemPrompt(agent, config);
    // Hide tools whose data classes this agent may not see (e.g. client data from coding agents).
    const llmTools = tools.toLlmTools(agent.tools.filter((n) => {
      const t = tools.get(n);
      return t !== undefined && forbiddenDataClasses(t, agent).length === 0;
    }));

    let messages = (await store.getMessages(task.id)) as LlmMessage[];
    if (messages.length === 0) {
      const initial = await this.initialUserMessage(task);
      await store.appendMessage(task.id, "user", initial);
      messages = [{ role: "user", content: initial }];
    }

    for (;;) {
      await this.checkpoint(task.id, signal);
      const last = messages[messages.length - 1]!;

      if (last.role === "assistant") {
        const blocks = Array.isArray(last.content) ? last.content : [];
        const toolUses = blocks.filter((b): b is ToolUse => (b as { type: string }).type === "tool_use");
        if (toolUses.length === 0) {
          const text = blocks
            .filter((b) => (b as { type: string }).type === "text")
            .map((b) => (b as { text: string }).text)
            .join("\n")
            .trim();
          const result = text || "(The agent finished without a written report.)";
          await store.setTaskStatus(task.id, "completed", { result });
          await store.audit("agent", "task.completed", task.id, {});
          await notifier.send(chatId, `✅ ${task.title}\n\n${result}`);
          return;
        }
        const outcome = await this.resolveToolCalls(task, agent, chatId, toolUses, signal);
        if (outcome === "awaiting_approval") {
          await store.setTaskStatus(task.id, "awaiting_approval");
          return;
        }
        await store.appendMessage(task.id, "user", outcome);
        messages.push({ role: "user", content: outcome });
        continue;
      }

      // Last message is from the user side: ask the model for the next step.
      const turns = await store.incrementTurns(task.id);
      if (turns > config.MAX_AGENT_TURNS) throw new TaskFailure(`Stopped after ${config.MAX_AGENT_TURNS} model turns (MAX_AGENT_TURNS).`);
      await this.enforceBudget(task.id);

      const response = await llm.createMessage({ system, tools: llmTools, messages }, signal);
      const cost = estimateCostUsd(response.model, response.usage);
      await store.recordSpend({
        taskId: task.id,
        model: response.model,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
        costUsd: cost,
      });

      if (response.stop_reason === "refusal") {
        throw new TaskFailure("The model declined this request. Rephrase it or handle it manually.");
      }
      if (response.stop_reason === "max_tokens") {
        throw new TaskFailure("The model's response was cut off (max_tokens). Try a narrower request.");
      }
      // Persist the full content verbatim (including thinking blocks): history is append-only.
      await store.appendMessage(task.id, "assistant", response.content);
      messages.push({ role: "assistant", content: response.content as LlmMessage["content"] });
    }
  }

  private async enforceBudget(taskId: string): Promise<void> {
    const { store, config } = this.d;
    const today = await store.spendToday(config.TIMEZONE);
    if (today >= config.DAILY_SPEND_LIMIT_USD) {
      throw new TaskFailure(`Daily spending limit reached ($${today.toFixed(2)} of $${config.DAILY_SPEND_LIMIT_USD}).`);
    }
    const task = await store.getTask(taskId);
    const taskCost = Number(task?.cost_usd ?? 0);
    if (taskCost >= config.TASK_SPEND_LIMIT_USD) {
      throw new TaskFailure(`Per-task spending limit reached ($${taskCost.toFixed(2)} of $${config.TASK_SPEND_LIMIT_USD}).`);
    }
  }

  private async initialUserMessage(task: TaskRow): Promise<string> {
    const { store, config } = this.d;
    const now = new Date().toLocaleString("en-US", { timeZone: config.TIMEZONE, dateStyle: "full", timeStyle: "short" });
    const [core, related] = await Promise.all([
      store.coreMemories(task.scope),
      store.searchMemories(task.input.slice(0, 200), task.scope, 8),
    ]);
    const seen = new Set<string>();
    const memories = [...core, ...related].filter((m) => !seen.has(m.id) && seen.add(m.id));
    const memoryText = memories.length
      ? memories
          .map((m) => {
            const line = `- [${m.kind}] ${m.subject}: ${m.content}`;
            // Memories the agent saved from third-party content stay marked untrusted.
            return m.source === "owner" ? line : wrapUntrusted(`memory:${m.source}`, line);
          })
          .join("\n")
      : "(none)";
    return `Current time: ${now} (${config.TIMEZONE})
Task scope: ${task.scope} — use only ${task.scope} accounts and data.
Task source: ${task.source}

Things you remember:
${memoryText}

Owner's request:
${task.input}`;
  }

  /**
   * Resolve every tool_use in the assistant turn. Each call is recorded once by
   * its tool_use_id, so re-running this after a crash reuses stored results and
   * never re-executes a completed action.
   */
  private async resolveToolCalls(
    task: TaskRow,
    agent: AgentDefinition,
    chatId: number | null,
    toolUses: ToolUse[],
    signal: AbortSignal,
  ): Promise<ToolResultBlock[] | "awaiting_approval"> {
    const { store, tools, notifier, config } = this.d;
    const results: ToolResultBlock[] = [];
    let waiting = false;

    for (const tu of toolUses) {
      const tool = agent.tools.includes(tu.name) ? tools.get(tu.name) : undefined;
      if (!tool) {
        await store.upsertToolCall({ taskId: task.id, toolUseId: tu.id, toolName: tu.name, input: tu.input, risk: "unknown", decision: "deny", status: "denied" });
        results.push(errorResult(tu.id, `Tool "${tu.name}" is not available to this agent.`));
        continue;
      }
      const parsed = tool.input.safeParse(tu.input);
      if (!parsed.success) {
        await store.upsertToolCall({ taskId: task.id, toolUseId: tu.id, toolName: tu.name, input: tu.input, risk: tool.risk, decision: "deny", status: "denied" });
        results.push(errorResult(tu.id, `Invalid input: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`));
        continue;
      }

      const policy = decide({
        tool,
        taskScope: task.scope,
        paused: await store.isPaused(),
        modulePaused: await store.isModulePaused(tool.module ?? "core_agent"),
        agent,
      });
      if (policy.decision === "require_approval" && tool.autoApprove) {
        const existing = await store.getToolCallByUseId(tu.id);
        const policyId = existing ? null : await tool.autoApprove(parsed.data, { store, config, scope: task.scope, taskId: task.id });
        if (policyId) {
          policy.decision = "allow";
          policy.reason = `Covered by owner-approved automation policy ${policyId}`;
          await store.audit("policy", "approval.by_policy", task.id, { tool: tool.name, policyId, action: tool.describeAction(parsed.data) });
        }
      }
      let row = await store.upsertToolCall({
        taskId: task.id,
        toolUseId: tu.id,
        toolName: tu.name,
        input: parsed.data,
        risk: tool.risk,
        decision: policy.decision,
        status: policy.decision === "allow" ? "pending" : policy.decision === "require_approval" ? "awaiting_approval" : "denied",
      });

      if (row.status === "running") row = await this.recoverInterrupted(task, chatId, tool, row);

      switch (row.status) {
        case "succeeded":
        case "failed":
          results.push(toResultBlock(tu.id, row.output ?? { content: row.error ?? "No output recorded.", isError: true }));
          break;
        case "denied":
          await store.audit("policy", "tool.denied", task.id, { tool: tu.name, reason: policy.reason });
          results.push(errorResult(tu.id, `Denied by policy: ${policy.reason}`));
          break;
        case "rejected":
          results.push(errorResult(tu.id, "The owner rejected this action (or the approval expired). Do not retry it."));
          break;
        case "outcome_unknown":
          results.push(errorResult(tu.id, "This action was interrupted mid-execution; its outcome is unknown. It was NOT retried to avoid duplicates. Tell the owner to verify it manually."));
          break;
        case "awaiting_approval": {
          waiting = true;
          const summary = tool.describeAction(parsed.data);
          const approval = await store.createApproval({
            taskId: task.id,
            toolCallId: row.id,
            summary,
            expiresAt: new Date(Date.now() + config.APPROVAL_TTL_HOURS * 3_600_000),
          });
          if (!approval.telegram_message_id) {
            const messageId = await notifier.requestApproval(chatId, {
              approvalId: approval.id,
              taskId: task.id,
              toolName: tool.name,
              summary,
              risk: tool.risk,
              expiresAt: approval.expires_at,
            });
            await store.setApprovalMessage(approval.id, chatId, messageId);
            await store.audit("agent", "approval.requested", task.id, { approvalId: approval.id, tool: tool.name, summary });
          }
          break;
        }
        case "pending":
        case "approved":
          await this.checkpoint(task.id, signal);
          results.push(await this.execute(task, chatId, tool, row, parsed.data, signal));
          break;
        default:
          results.push(errorResult(tu.id, `Unexpected tool call state: ${row.status}`));
      }
    }
    return waiting ? "awaiting_approval" : results;
  }

  /** A call left 'running' means a previous worker died mid-execution. */
  private async recoverInterrupted(task: TaskRow, chatId: number | null, tool: ToolDefinition, row: ToolCallRow): Promise<ToolCallRow> {
    const { store, notifier } = this.d;
    if (tool.idempotent) {
      await store.setToolCallStatus(row.id, "pending");
      await store.audit("system", "tool.retry_idempotent", task.id, { tool: tool.name, toolCallId: row.id });
      return { ...row, status: "pending" };
    }
    await store.finishToolCall(row.id, "outcome_unknown", null, "Interrupted during execution");
    await store.audit("system", "tool.outcome_unknown", task.id, { tool: tool.name, toolCallId: row.id });
    await notifier.send(chatId, `⚠️ "${tool.describeAction(row.input as never)}" was interrupted and may or may not have happened. I did not retry it. Please verify.`);
    return { ...row, status: "outcome_unknown" };
  }

  private async execute(task: TaskRow, chatId: number | null, tool: ToolDefinition, row: ToolCallRow, input: unknown, signal: AbortSignal): Promise<ToolResultBlock> {
    const { store, notifier, config } = this.d;
    if (!(await store.markToolCallRunning(row.id))) {
      return errorResult(row.tool_use_id, "This tool call is already being handled elsewhere.");
    }
    await store.audit("agent", "tool.started", task.id, { tool: tool.name, toolCallId: row.id, input });
    const ctx: ToolContext = { taskId: task.id, scope: task.scope, chatId, store, notifier, config, signal, idempotencyKey: row.id };
    try {
      const out = await tool.run(input, ctx);
      await store.finishToolCall(row.id, out.isError ? "failed" : "succeeded", out);
      await store.audit("agent", out.isError ? "tool.failed" : "tool.succeeded", task.id, { tool: tool.name, toolCallId: row.id });
      return toResultBlock(row.tool_use_id, out);
    } catch (err) {
      if (signal.aborted) throw err; // leave 'running'; recoverInterrupted decides on resume
      const message = (err as Error).message ?? String(err);
      await store.finishToolCall(row.id, "failed", { content: `Tool error: ${message}`, isError: true }, message);
      await store.audit("agent", "tool.failed", task.id, { tool: tool.name, toolCallId: row.id, error: message });
      return errorResult(row.tool_use_id, `Tool error: ${message}`);
    }
  }
}

function errorResult(toolUseId: string, message: string): ToolResultBlock {
  return { type: "tool_result", tool_use_id: toolUseId, content: message, is_error: true };
}

function toResultBlock(toolUseId: string, out: { content: string; isError?: boolean }): ToolResultBlock {
  return out.isError
    ? { type: "tool_result", tool_use_id: toolUseId, content: out.content, is_error: true }
    : { type: "tool_result", tool_use_id: toolUseId, content: out.content };
}

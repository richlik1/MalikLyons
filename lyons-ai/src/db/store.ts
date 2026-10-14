import type { Db, Queryable } from "./pool.js";
import type { Scope } from "../core/types.js";

export type TaskStatus = "queued" | "running" | "awaiting_approval" | "completed" | "failed" | "cancelled";
export type TaskSource = "telegram" | "schedule" | "webhook" | "system";

export interface TaskRow {
  id: string;
  parent_task_id: string | null;
  title: string;
  input: string;
  agent: string;
  scope: Scope;
  source: TaskSource;
  status: TaskStatus;
  chat_id: string | null; // bigint comes back as string
  result: string | null;
  error: string | null;
  turns: number;
  cost_usd: string;
  attempts: number;
  deadline_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export type ToolCallStatus =
  | "pending"
  | "awaiting_approval"
  | "approved"
  | "rejected"
  | "denied"
  | "running"
  | "succeeded"
  | "failed"
  | "outcome_unknown";

export interface ToolCallRow {
  id: string;
  task_id: string;
  tool_use_id: string;
  tool_name: string;
  input: unknown;
  risk: string;
  decision: "allow" | "require_approval" | "deny";
  status: ToolCallStatus;
  output: { content: string; isError?: boolean } | null;
  error: string | null;
}

export interface ApprovalRow {
  id: string;
  task_id: string;
  tool_call_id: string;
  summary: string;
  status: "pending" | "approved" | "rejected" | "expired";
  telegram_chat_id: string | null;
  telegram_message_id: string | null;
  expires_at: Date;
}

export interface MemoryRow {
  id: string;
  kind: string;
  subject: string;
  content: string;
  scope: Scope;
  source: string;
  updated_at: Date;
}

const PAUSED_KEY = "agent.paused";

/** Thin, explicit data-access layer. All SQL lives here. */
export class Store {
  constructor(readonly db: Db) {}

  // ---------- settings / kill switch ----------
  async isPaused(q: Queryable = this.db): Promise<boolean> {
    const r = await q.query<{ value: { paused: boolean } }>("SELECT value FROM settings WHERE key = $1", [PAUSED_KEY]);
    return r.rows[0]?.value.paused ?? false;
  }

  async setPaused(paused: boolean, actor: string): Promise<void> {
    await this.db.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [PAUSED_KEY, { paused }],
    );
    await this.audit(actor, paused ? "kill_switch.on" : "kill_switch.off", null, {});
  }

  // ---------- audit ----------
  async audit(actor: string, event: string, taskId: string | null, details: Record<string, unknown>, q: Queryable = this.db) {
    await q.query("INSERT INTO audit_log (actor, event, task_id, details) VALUES ($1, $2, $3, $4)", [
      actor,
      event,
      taskId,
      details,
    ]);
  }

  async auditForTask(taskId: string) {
    const r = await this.db.query<{ actor: string; event: string; details: any; at: Date }>(
      "SELECT actor, event, details, at FROM audit_log WHERE task_id = $1 ORDER BY id",
      [taskId],
    );
    return r.rows;
  }

  // ---------- tasks ----------
  async createTask(t: {
    title: string;
    input: string;
    scope: Scope;
    source: TaskSource;
    agent?: string;
    chatId?: number | null;
    parentTaskId?: string | null;
  }): Promise<TaskRow> {
    const r = await this.db.query<TaskRow>(
      `INSERT INTO tasks (title, input, scope, source, agent, chat_id, parent_task_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [t.title, t.input, t.scope, t.source, t.agent ?? "chief_of_staff", t.chatId ?? null, t.parentTaskId ?? null],
    );
    const task = r.rows[0]!;
    await this.audit(t.source, "task.created", task.id, { title: t.title, scope: t.scope, agent: task.agent });
    return task;
  }

  async getTask(id: string): Promise<TaskRow | null> {
    const r = await this.db.query<TaskRow>("SELECT * FROM tasks WHERE id = $1", [id]);
    return r.rows[0] ?? null;
  }

  async findTaskByPrefix(prefix: string): Promise<TaskRow | null> {
    if (!/^[0-9a-f-]{4,36}$/i.test(prefix)) return null;
    const r = await this.db.query<TaskRow>("SELECT * FROM tasks WHERE id::text LIKE $1 ORDER BY created_at DESC LIMIT 2", [
      `${prefix.toLowerCase()}%`,
    ]);
    return r.rows.length === 1 ? r.rows[0]! : null;
  }

  async recentTasks(limit = 10): Promise<TaskRow[]> {
    const r = await this.db.query<TaskRow>("SELECT * FROM tasks ORDER BY created_at DESC LIMIT $1", [limit]);
    return r.rows;
  }

  async openTasks(): Promise<TaskRow[]> {
    const r = await this.db.query<TaskRow>(
      "SELECT * FROM tasks WHERE status IN ('queued','running','awaiting_approval') ORDER BY created_at",
    );
    return r.rows;
  }

  /**
   * Atomically claim the next runnable task. A task is runnable if queued, or if
   * it was 'running' but its lease expired (the worker died mid-task) — that is
   * how interrupted workflows resume.
   */
  async claimNextTask(workerId: string, leaseMs: number, defaultTimeoutMs: number): Promise<TaskRow | null> {
    const r = await this.db.query<TaskRow>(
      `UPDATE tasks SET status = 'running', lease_owner = $1,
              lease_expires_at = now() + ($2 || ' milliseconds')::interval,
              attempts = attempts + 1,
              started_at = coalesce(started_at, now()),
              deadline_at = coalesce(deadline_at, now() + ($3 || ' milliseconds')::interval),
              updated_at = now()
       WHERE id = (
         SELECT id FROM tasks
         WHERE status = 'queued' OR (status = 'running' AND lease_expires_at < now())
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       RETURNING *`,
      [workerId, String(leaseMs), String(defaultTimeoutMs)],
    );
    return r.rows[0] ?? null;
  }

  async renewLease(taskId: string, workerId: string, leaseMs: number): Promise<boolean> {
    const r = await this.db.query(
      `UPDATE tasks SET lease_expires_at = now() + ($3 || ' milliseconds')::interval
       WHERE id = $1 AND lease_owner = $2 AND status = 'running'`,
      [taskId, workerId, String(leaseMs)],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async setTaskStatus(
    taskId: string,
    status: TaskStatus,
    fields: { result?: string; error?: string } = {},
    q: Queryable = this.db,
  ): Promise<void> {
    const terminal = status === "completed" || status === "failed" || status === "cancelled";
    await q.query(
      `UPDATE tasks SET status = $2, result = coalesce($3, result), error = coalesce($4, error),
              lease_owner = CASE WHEN $2 = 'running' THEN lease_owner ELSE NULL END,
              lease_expires_at = CASE WHEN $2 = 'running' THEN lease_expires_at ELSE NULL END,
              completed_at = CASE WHEN $5 THEN now() ELSE completed_at END,
              updated_at = now()
       WHERE id = $1`,
      [taskId, status, fields.result ?? null, fields.error ?? null, terminal],
    );
  }

  /** Cancel unless already terminal. Returns whether the task was cancelled. */
  async cancelTask(taskId: string, actor: string): Promise<boolean> {
    const r = await this.db.query(
      `UPDATE tasks SET status = 'cancelled', completed_at = now(), updated_at = now(), lease_owner = NULL, lease_expires_at = NULL
       WHERE id = $1 AND status IN ('queued','running','awaiting_approval')`,
      [taskId],
    );
    if ((r.rowCount ?? 0) > 0) {
      await this.db.query("UPDATE approvals SET status = 'expired' WHERE task_id = $1 AND status = 'pending'", [taskId]);
      await this.audit(actor, "task.cancelled", taskId, {});
      return true;
    }
    return false;
  }

  async incrementTurns(taskId: string): Promise<number> {
    const r = await this.db.query<{ turns: number }>("UPDATE tasks SET turns = turns + 1 WHERE id = $1 RETURNING turns", [taskId]);
    return r.rows[0]!.turns;
  }

  // ---------- conversation transcript (append-only) ----------
  async appendMessage(taskId: string, role: "user" | "assistant", content: unknown, q: Queryable = this.db): Promise<number> {
    const r = await q.query<{ seq: number }>(
      `INSERT INTO task_messages (task_id, seq, role, content)
       VALUES ($1, coalesce((SELECT max(seq) + 1 FROM task_messages WHERE task_id = $1), 0), $2, $3)
       RETURNING seq`,
      [taskId, role, JSON.stringify(content)],
    );
    return r.rows[0]!.seq;
  }

  async getMessages(taskId: string): Promise<{ role: "user" | "assistant"; content: any }[]> {
    const r = await this.db.query<{ role: "user" | "assistant"; content: any }>(
      "SELECT role, content FROM task_messages WHERE task_id = $1 ORDER BY seq",
      [taskId],
    );
    return r.rows;
  }

  // ---------- tool calls ----------
  /** Insert-once by tool_use_id. Returns the existing row if it was already recorded. */
  async upsertToolCall(t: {
    taskId: string;
    toolUseId: string;
    toolName: string;
    input: unknown;
    risk: string;
    decision: "allow" | "require_approval" | "deny";
    status: ToolCallStatus;
  }): Promise<ToolCallRow> {
    await this.db.query(
      `INSERT INTO tool_calls (task_id, tool_use_id, tool_name, input, risk, decision, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (tool_use_id) DO NOTHING`,
      [t.taskId, t.toolUseId, t.toolName, JSON.stringify(t.input ?? null), t.risk, t.decision, t.status],
    );
    return (await this.getToolCallByUseId(t.toolUseId))!;
  }

  async getToolCallByUseId(toolUseId: string): Promise<ToolCallRow | null> {
    const r = await this.db.query<ToolCallRow>("SELECT * FROM tool_calls WHERE tool_use_id = $1", [toolUseId]);
    return r.rows[0] ?? null;
  }

  async toolCallsForTask(taskId: string): Promise<ToolCallRow[]> {
    const r = await this.db.query<ToolCallRow>("SELECT * FROM tool_calls WHERE task_id = $1 ORDER BY created_at", [taskId]);
    return r.rows;
  }

  /**
   * Transition to 'running' only from an executable state. The conditional
   * update is the guard against two workers (or a resume) executing the same call.
   */
  async markToolCallRunning(id: string): Promise<boolean> {
    const r = await this.db.query(
      `UPDATE tool_calls SET status = 'running', started_at = now()
       WHERE id = $1 AND status IN ('pending', 'approved')`,
      [id],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async finishToolCall(id: string, status: ToolCallStatus, output: { content: string; isError?: boolean } | null, error?: string) {
    await this.db.query("UPDATE tool_calls SET status = $2, output = $3, error = $4, completed_at = now() WHERE id = $1", [
      id,
      status,
      output ? JSON.stringify(output) : null,
      error ?? null,
    ]);
  }

  async setToolCallStatus(id: string, status: ToolCallStatus) {
    await this.db.query("UPDATE tool_calls SET status = $2 WHERE id = $1", [id, status]);
  }

  // ---------- approvals ----------
  async createApproval(a: { taskId: string; toolCallId: string; summary: string; expiresAt: Date }): Promise<ApprovalRow> {
    await this.db.query(
      `INSERT INTO approvals (task_id, tool_call_id, summary, expires_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (tool_call_id) DO NOTHING`,
      [a.taskId, a.toolCallId, a.summary, a.expiresAt],
    );
    const r = await this.db.query<ApprovalRow>("SELECT * FROM approvals WHERE tool_call_id = $1", [a.toolCallId]);
    return r.rows[0]!;
  }

  async setApprovalMessage(id: string, chatId: number | null, messageId: number | null) {
    await this.db.query("UPDATE approvals SET telegram_chat_id = $2, telegram_message_id = $3 WHERE id = $1", [id, chatId, messageId]);
  }

  async getApproval(id: string): Promise<ApprovalRow | null> {
    const r = await this.db.query<ApprovalRow>("SELECT * FROM approvals WHERE id = $1", [id]);
    return r.rows[0] ?? null;
  }

  async pendingApprovals(): Promise<ApprovalRow[]> {
    const r = await this.db.query<ApprovalRow>("SELECT * FROM approvals WHERE status = 'pending' ORDER BY created_at");
    return r.rows;
  }

  /**
   * Record the owner's decision. Only a pending, unexpired approval can be
   * decided, and only once. On decision the task is re-queued so the runner
   * resumes it.
   */
  async decideApproval(
    id: string,
    approve: boolean,
    actor: string,
  ): Promise<{ ok: true; approval: ApprovalRow } | { ok: false; reason: string }> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const r = await client.query<ApprovalRow>("SELECT * FROM approvals WHERE id = $1 FOR UPDATE", [id]);
      const approval = r.rows[0];
      if (!approval) {
        await client.query("ROLLBACK");
        return { ok: false, reason: "Approval not found." };
      }
      if (approval.status !== "pending") {
        await client.query("ROLLBACK");
        return { ok: false, reason: `Already ${approval.status}.` };
      }
      if (approval.expires_at.getTime() < Date.now()) {
        await client.query("UPDATE approvals SET status = 'expired' WHERE id = $1", [id]);
        await client.query("COMMIT");
        return { ok: false, reason: "Approval expired." };
      }
      const status = approve ? "approved" : "rejected";
      await client.query("UPDATE approvals SET status = $2, decided_by = $3, decided_at = now() WHERE id = $1", [id, status, actor]);
      await client.query("UPDATE tool_calls SET status = $2 WHERE id = $1 AND status = 'awaiting_approval'", [
        approval.tool_call_id,
        status,
      ]);
      // Re-queue the task only if every approval for it has now been decided.
      await client.query(
        `UPDATE tasks SET status = 'queued', updated_at = now()
         WHERE id = $1 AND status = 'awaiting_approval'
           AND NOT EXISTS (SELECT 1 FROM approvals WHERE task_id = $1 AND status = 'pending')`,
        [approval.task_id],
      );
      await this.audit(actor, `approval.${status}`, approval.task_id, { approvalId: id, summary: approval.summary }, client);
      await client.query("COMMIT");
      return { ok: true, approval: { ...approval, status } };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  /** Expire stale approvals and fail their tasks. Returns expired approvals. */
  async expireApprovals(): Promise<ApprovalRow[]> {
    const r = await this.db.query<ApprovalRow>(
      "UPDATE approvals SET status = 'expired' WHERE status = 'pending' AND expires_at < now() RETURNING *",
    );
    for (const a of r.rows) {
      await this.db.query("UPDATE tool_calls SET status = 'rejected' WHERE id = $1 AND status = 'awaiting_approval'", [a.tool_call_id]);
      await this.db.query(
        `UPDATE tasks SET status = 'queued', updated_at = now()
         WHERE id = $1 AND status = 'awaiting_approval'
           AND NOT EXISTS (SELECT 1 FROM approvals WHERE task_id = $1 AND status = 'pending')`,
        [a.task_id],
      );
      await this.audit("system", "approval.expired", a.task_id, { approvalId: a.id });
    }
    return r.rows;
  }

  // ---------- spend ----------
  async recordSpend(s: {
    taskId: string | null;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    costUsd: number;
  }) {
    await this.db.query(
      `INSERT INTO spend_ledger (task_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [s.taskId, s.model, s.inputTokens, s.outputTokens, s.cacheReadTokens, s.cacheWriteTokens, s.costUsd],
    );
    if (s.taskId) await this.db.query("UPDATE tasks SET cost_usd = cost_usd + $2 WHERE id = $1", [s.taskId, s.costUsd]);
  }

  /** Spend since local midnight in the configured timezone. */
  async spendToday(timezone: string): Promise<number> {
    const r = await this.db.query<{ total: string | null }>(
      `SELECT sum(cost_usd) AS total FROM spend_ledger
       WHERE at >= (date_trunc('day', now() AT TIME ZONE $1) AT TIME ZONE $1)`,
      [timezone],
    );
    return Number(r.rows[0]?.total ?? 0);
  }

  // ---------- memory ----------
  async saveMemory(m: { kind: string; subject: string; content: string; scope: Scope; source: string }): Promise<MemoryRow> {
    const r = await this.db.query<MemoryRow>(
      `INSERT INTO memories (kind, subject, content, scope, source) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (scope, kind, subject) DO UPDATE SET content = EXCLUDED.content, source = EXCLUDED.source, updated_at = now()
       RETURNING id, kind, subject, content, scope, source, updated_at`,
      [m.kind, m.subject.trim(), m.content.trim(), m.scope, m.source],
    );
    return r.rows[0]!;
  }

  async searchMemories(query: string, scope: Scope, limit = 10): Promise<MemoryRow[]> {
    const r = await this.db.query<MemoryRow>(
      `SELECT id, kind, subject, content, scope, source, updated_at FROM memories
       WHERE scope = $2 AND (search @@ plainto_tsquery('english', $1) OR subject ILIKE '%' || $1 || '%')
       ORDER BY ts_rank(search, plainto_tsquery('english', $1)) DESC, updated_at DESC
       LIMIT $3`,
      [query, scope, limit],
    );
    return r.rows;
  }

  /** Durable preferences/goals are always injected into a task's context. */
  async coreMemories(scope: Scope, limit = 30): Promise<MemoryRow[]> {
    const r = await this.db.query<MemoryRow>(
      `SELECT id, kind, subject, content, scope, source, updated_at FROM memories
       WHERE scope = $1 AND kind IN ('preference', 'goal') ORDER BY updated_at DESC LIMIT $2`,
      [scope, limit],
    );
    return r.rows;
  }

  async deleteMemory(id: string, scope: Scope): Promise<boolean> {
    const r = await this.db.query("DELETE FROM memories WHERE id = $1 AND scope = $2", [id, scope]);
    return (r.rowCount ?? 0) > 0;
  }

  // ---------- oauth ----------
  async saveOAuthCredential(c: { provider: string; accountLabel: Scope; accountEmail: string | null; scopes: string[]; encryptedTokens: string }) {
    await this.db.query(
      `INSERT INTO oauth_credentials (provider, account_label, account_email, scopes, encrypted_tokens)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (provider, account_label) DO UPDATE SET account_email = coalesce(EXCLUDED.account_email, oauth_credentials.account_email),
         scopes = EXCLUDED.scopes, encrypted_tokens = EXCLUDED.encrypted_tokens, updated_at = now()`,
      [c.provider, c.accountLabel, c.accountEmail, c.scopes, c.encryptedTokens],
    );
  }

  async getOAuthCredential(provider: string, accountLabel: Scope) {
    const r = await this.db.query<{ account_email: string | null; scopes: string[]; encrypted_tokens: string }>(
      "SELECT account_email, scopes, encrypted_tokens FROM oauth_credentials WHERE provider = $1 AND account_label = $2",
      [provider, accountLabel],
    );
    return r.rows[0] ?? null;
  }

  async deleteOAuthCredential(provider: string, accountLabel: Scope) {
    await this.db.query("DELETE FROM oauth_credentials WHERE provider = $1 AND account_label = $2", [provider, accountLabel]);
  }

  async createOAuthState(state: string, provider: string, accountLabel: Scope, ttlMs: number) {
    await this.db.query("INSERT INTO oauth_states (state, provider, account_label, expires_at) VALUES ($1, $2, $3, now() + ($4 || ' milliseconds')::interval)", [
      state,
      provider,
      accountLabel,
      String(ttlMs),
    ]);
  }

  /** Single-use: the state row is deleted when consumed. */
  async consumeOAuthState(state: string): Promise<{ provider: string; account_label: Scope } | null> {
    const r = await this.db.query<{ provider: string; account_label: Scope }>(
      "DELETE FROM oauth_states WHERE state = $1 AND expires_at > now() RETURNING provider, account_label",
      [state],
    );
    return r.rows[0] ?? null;
  }

  // ---------- browser runs ----------
  async createBrowserRun(taskId: string | null, workflow: string, url: string): Promise<string> {
    const r = await this.db.query<{ id: string }>(
      "INSERT INTO browser_runs (task_id, workflow, url, status) VALUES ($1, $2, $3, 'running') RETURNING id",
      [taskId, workflow, url],
    );
    return r.rows[0]!.id;
  }

  async finishBrowserRun(id: string, status: "succeeded" | "stopped" | "failed", screenshots: string[], steps: unknown[], error?: string) {
    await this.db.query(
      "UPDATE browser_runs SET status = $2, screenshots = $3, steps = $4, error = $5, finished_at = now() WHERE id = $1",
      [id, status, screenshots, JSON.stringify(steps), error ?? null],
    );
  }

  // ---------- scheduled run idempotency ----------
  /** Returns true if this (kind, key) had not run before and is now claimed. */
  async claimScheduledRun(kind: string, runKey: string): Promise<boolean> {
    const r = await this.db.query("INSERT INTO scheduled_runs (kind, run_key) VALUES ($1, $2) ON CONFLICT DO NOTHING", [kind, runKey]);
    return (r.rowCount ?? 0) > 0;
  }

  async attachScheduledRunTask(kind: string, runKey: string, taskId: string) {
    await this.db.query("UPDATE scheduled_runs SET task_id = $3 WHERE kind = $1 AND run_key = $2", [kind, runKey, taskId]);
  }
}

import pino from "pino";
import { loadConfig, type Config } from "../src/config.js";
import type { LlmClient, LlmRequest, LlmResponse } from "../src/core/llm.js";
import type { ApprovalRequest, Notifier } from "../src/core/notifier.js";
import { migrate } from "../src/db/migrate.js";
import { createPool, type Db } from "../src/db/pool.js";

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
export const hasDb = Boolean(TEST_DATABASE_URL);

export const silentLog = pino({ level: "silent" });

export function testConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: TEST_DATABASE_URL ?? "postgres://unused",
    MASTER_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    TIMEZONE: "America/New_York",
    ...overrides,
  });
}

/** Fresh schema per test file. Requires TEST_DATABASE_URL pointing at a disposable database. */
export async function freshDb(): Promise<Db> {
  const db = createPool(TEST_DATABASE_URL!);
  await db.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate(db);
  return db;
}

export async function resetData(db: Db) {
  await db.query(`TRUNCATE tasks, task_messages, tool_calls, approvals, memories, oauth_credentials, oauth_states,
    spend_ledger, browser_runs, scheduled_runs, settings RESTART IDENTITY CASCADE`);
}

type Step = (req: LlmRequest, signal: AbortSignal) => LlmResponse | Promise<LlmResponse>;

/** Scripted LLM: each call consumes the next step. Records every request. */
export class FakeLlm implements LlmClient {
  readonly calls: LlmRequest[] = [];
  constructor(private readonly steps: Step[]) {}
  async createMessage(req: LlmRequest, signal: AbortSignal): Promise<LlmResponse> {
    // Snapshot messages: the runner keeps appending to the same array.
    this.calls.push({ ...req, messages: [...req.messages] });
    const step = this.steps.shift();
    if (!step) throw new Error("FakeLlm: no more scripted responses");
    return step(req, signal);
  }
}

const usage = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

export function textResponse(text: string): Step {
  return () => ({ content: [{ type: "text", text, citations: null }], stop_reason: "end_turn", usage, model: "claude-opus-5-5" }) as unknown as LlmResponse;
}

export function toolUseResponse(id: string, name: string, input: unknown): Step {
  return () =>
    ({
      content: [
        { type: "thinking", thinking: "", signature: "sig" },
        { type: "tool_use", id, name, input },
      ],
      stop_reason: "tool_use",
      usage,
      model: "claude-opus-5-5",
    }) as unknown as LlmResponse;
}

/** Never resolves until aborted — for timeout / kill-switch tests. */
export function hangingResponse(): Step {
  return (_req, signal) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
}

export class RecordingNotifier implements Notifier {
  readonly messages: string[] = [];
  readonly approvals: ApprovalRequest[] = [];
  async send(_chatId: number | null, text: string) {
    this.messages.push(text);
  }
  async requestApproval(_chatId: number | null, req: ApprovalRequest) {
    this.approvals.push(req);
    return this.approvals.length;
  }
}

/** Find the tool_result the runner sent back for a tool_use id in the last LLM request. */
export function lastToolResult(llm: FakeLlm, toolUseId: string): { content: string; is_error?: boolean } | undefined {
  const req = llm.calls[llm.calls.length - 1]!;
  for (const m of req.messages) {
    if (m.role !== "user" || !Array.isArray(m.content)) continue;
    for (const b of m.content as { type: string; tool_use_id?: string; content: string; is_error?: boolean }[]) {
      if (b.type === "tool_result" && b.tool_use_id === toolUseId) return b;
    }
  }
  return undefined;
}

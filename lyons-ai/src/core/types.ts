import type { z } from "zod";
import type { Config } from "../config.js";
import type { Store } from "../db/store.js";
import type { Notifier } from "./notifier.js";

export type Scope = "business" | "personal";

/**
 * Risk classes drive the policy engine. Anything that leaves the system, moves
 * money, deletes data, changes permissions, or is legally binding requires the
 * owner's explicit approval before it runs.
 */
export type Risk =
  | "read" // no side effects
  | "write_internal" // side effects only inside LYONS AI or as unsent drafts
  | "external_communication" // email/SMS/invites that someone else receives
  | "financial" // payments, invoices sent, purchases
  | "destructive" // deletes or overwrites records
  | "permissions" // sharing / access changes
  | "legal"; // legally binding submissions

export const APPROVAL_REQUIRED_RISKS: ReadonlySet<Risk> = new Set([
  "external_communication",
  "financial",
  "destructive",
  "permissions",
  "legal",
]);

/**
 * Independently pausable modules (Control Center). Pausing a module denies its
 * tools and stops its background jobs; the global kill switch stops everything.
 */
export const MODULES = [
  "core_agent",
  "opportunities",
  "gmail_cleanup",
  "client_relationships",
  "communications",
  "receptionist",
  "browser",
  "device_storage",
] as const;
export type ModuleName = (typeof MODULES)[number];

/**
 * Data classes a tool can expose to the model. Agents declare which classes they
 * may see; a coding agent, for example, never receives client or personal data
 * unless the owner explicitly grants it.
 */
export const DATA_CLASSES = ["public", "business_internal", "client_pii", "personal_messages", "personal", "financial"] as const;
export type DataClass = (typeof DATA_CLASSES)[number];

export interface ToolContext {
  taskId: string;
  scope: Scope;
  chatId: number | null;
  store: Store;
  notifier: Notifier;
  config: Config;
  signal: AbortSignal;
  /** Stable per tool call (survives retries). Pass to providers that support idempotency keys. */
  idempotencyKey: string;
}

export interface ToolResult {
  /** Text returned to the model. Wrap third-party content with wrapUntrusted(). */
  content: string;
  isError?: boolean;
}

export interface ToolDefinition<I = any> {
  name: string;
  description: string;
  input: z.ZodType<I>;
  risk: Risk;
  /** Scopes this tool may operate in. Omit for both. */
  scopes?: Scope[];
  /** Module this tool belongs to; pausing the module denies the tool. Defaults to core_agent. */
  module?: ModuleName;
  /** Data classes this tool reads or returns. Defaults to ["business_internal"]. */
  dataClasses?: DataClass[];
  /**
   * Whether it is safe to execute again if a crash left the outcome unknown.
   * Non-idempotent tools are never re-run automatically; the owner is told to verify.
   */
  idempotent: boolean;
  /** One-line, human-readable description of exactly what will happen. Shown in approval prompts. */
  describeAction(input: I): string;
  /**
   * For approval-gated tools: return the id of an owner-activated automation
   * policy that covers this exact action, letting it run without a per-call
   * approval. Return null to require approval as usual.
   */
  autoApprove?(input: I, ctx: Pick<ToolContext, "store" | "config" | "scope" | "taskId">): Promise<string | null>;
  run(input: I, ctx: ToolContext): Promise<ToolResult>;
}

export interface AgentDefinition {
  name: string;
  description: string;
  /** Agent-specific instructions appended to the shared base prompt. */
  instructions: string;
  /** Tool names this agent may use. Unknown/unregistered names are ignored. */
  tools: string[];
  /**
   * Data classes this agent may see. Omit for full access (chief of staff).
   * Tools exposing any other class are hidden from the agent and denied by policy.
   */
  dataAccess?: DataClass[];
}

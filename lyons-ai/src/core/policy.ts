import { APPROVAL_REQUIRED_RISKS, type Scope, type ToolDefinition } from "./types.js";

export type Decision = "allow" | "require_approval" | "deny";

export interface PolicyInput {
  tool: ToolDefinition;
  taskScope: Scope;
  paused: boolean;
}

/**
 * Central, deterministic permission check. The model never decides whether an
 * action needs approval; this function does, based on the tool's declared risk.
 */
export function decide({ tool, taskScope, paused }: PolicyInput): { decision: Decision; reason: string } {
  if (paused) return { decision: "deny", reason: "Kill switch is active; all tool execution is halted." };
  if (tool.scopes && !tool.scopes.includes(taskScope)) {
    return { decision: "deny", reason: `Tool ${tool.name} is not permitted in ${taskScope} tasks.` };
  }
  if (APPROVAL_REQUIRED_RISKS.has(tool.risk)) {
    return { decision: "require_approval", reason: `${tool.risk} actions require explicit owner approval.` };
  }
  return { decision: "allow", reason: `${tool.risk} action permitted.` };
}

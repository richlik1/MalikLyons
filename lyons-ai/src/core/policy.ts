import { APPROVAL_REQUIRED_RISKS, type AgentDefinition, type DataClass, type Scope, type ToolDefinition } from "./types.js";

export type Decision = "allow" | "require_approval" | "deny";

export interface PolicyInput {
  tool: ToolDefinition;
  taskScope: Scope;
  paused: boolean;
  /** Whether the tool's module is paused in the Control Center. */
  modulePaused?: boolean;
  agent?: AgentDefinition;
}

export function toolDataClasses(tool: ToolDefinition): DataClass[] {
  return tool.dataClasses ?? ["business_internal"];
}

/** Data classes the tool exposes that the agent is not authorised to see. */
export function forbiddenDataClasses(tool: ToolDefinition, agent: AgentDefinition | undefined): DataClass[] {
  if (!agent?.dataAccess) return [];
  return toolDataClasses(tool).filter((c) => !agent.dataAccess!.includes(c));
}

/**
 * Central, deterministic permission check. The model never decides whether an
 * action needs approval; this function does, based on the tool's declared risk.
 */
export function decide({ tool, taskScope, paused, modulePaused, agent }: PolicyInput): { decision: Decision; reason: string } {
  if (paused) return { decision: "deny", reason: "Kill switch is active; all tool execution is halted." };
  if (modulePaused) return { decision: "deny", reason: `The ${tool.module ?? "core_agent"} module is paused in the Control Center.` };
  const forbidden = forbiddenDataClasses(tool, agent);
  if (forbidden.length) {
    return { decision: "deny", reason: `Agent ${agent!.name} is not authorised to access ${forbidden.join(", ")} data.` };
  }
  if (tool.scopes && !tool.scopes.includes(taskScope)) {
    return { decision: "deny", reason: `Tool ${tool.name} is not permitted in ${taskScope} tasks.` };
  }
  if (APPROVAL_REQUIRED_RISKS.has(tool.risk)) {
    return { decision: "require_approval", reason: `${tool.risk} actions require explicit owner approval.` };
  }
  return { decision: "allow", reason: `${tool.risk} action permitted.` };
}

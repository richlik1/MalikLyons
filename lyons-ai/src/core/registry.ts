import { z } from "zod";
import type { LlmTool } from "./llm.js";
import type { AgentDefinition, ToolDefinition } from "./types.js";

/**
 * Tools and agents are registered at startup. Adding a specialist agent means
 * registering an AgentDefinition (name, instructions, tool allowlist); adding a
 * capability means registering a ToolDefinition. The runner, policy engine,
 * approvals, and audit trail apply to everything automatically.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): this {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(tool.name)) throw new Error(`Invalid tool name: ${tool.name}`);
    if (this.tools.has(tool.name)) throw new Error(`Duplicate tool: ${tool.name}`);
    this.tools.set(tool.name, tool);
    return this;
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  names(): string[] {
    return [...this.tools.keys()];
  }

  /** Deterministic order (sorted) keeps the prompt-cache prefix stable. */
  toLlmTools(allowed: string[]): LlmTool[] {
    return allowed
      .filter((n) => this.tools.has(n))
      .sort()
      .map((n) => {
        const t = this.tools.get(n)!;
        const schema = z.toJSONSchema(t.input, { target: "draft-2020-12", io: "input" }) as Record<string, unknown>;
        delete schema.$schema;
        return {
          name: t.name,
          description: `${t.description}\n[risk: ${t.risk}${t.risk === "read" || t.risk === "write_internal" ? "" : " — requires owner approval"}]`,
          input_schema: schema as LlmTool["input_schema"],
        };
      });
  }
}

export class AgentRegistry {
  private readonly agents = new Map<string, AgentDefinition>();

  register(agent: AgentDefinition): this {
    if (this.agents.has(agent.name)) throw new Error(`Duplicate agent: ${agent.name}`);
    this.agents.set(agent.name, agent);
    return this;
  }

  get(name: string): AgentDefinition | undefined {
    return this.agents.get(name);
  }

  list(): AgentDefinition[] {
    return [...this.agents.values()];
  }
}

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defaultAgents } from "../../src/agents/index.js";
import { decide } from "../../src/core/policy.js";
import { ToolRegistry } from "../../src/core/registry.js";
import { estimateCostUsd } from "../../src/core/spend.js";
import type { Risk, ToolDefinition } from "../../src/core/types.js";
import { coreTools } from "../../src/tools/core-tools.js";

function tool(risk: Risk, scopes?: ("business" | "personal")[]): ToolDefinition {
  return {
    name: `t_${risk}`,
    description: "test",
    input: z.object({}),
    risk,
    scopes,
    idempotent: true,
    describeAction: () => "x",
    run: async () => ({ content: "ok" }),
  };
}

describe("policy engine", () => {
  it("allows read and internal writes without approval", () => {
    expect(decide({ tool: tool("read"), taskScope: "business", paused: false }).decision).toBe("allow");
    expect(decide({ tool: tool("write_internal"), taskScope: "business", paused: false }).decision).toBe("allow");
  });

  it.each(["external_communication", "financial", "destructive", "permissions", "legal"] as Risk[])("requires approval for %s", (risk) => {
    expect(decide({ tool: tool(risk), taskScope: "business", paused: false }).decision).toBe("require_approval");
  });

  it("denies everything while the kill switch is on", () => {
    expect(decide({ tool: tool("read"), taskScope: "business", paused: true }).decision).toBe("deny");
  });

  it("enforces business/personal separation", () => {
    expect(decide({ tool: tool("read", ["business"]), taskScope: "personal", paused: false }).decision).toBe("deny");
    expect(decide({ tool: tool("read", ["business"]), taskScope: "business", paused: false }).decision).toBe("allow");
  });
});

describe("ToolRegistry", () => {
  it("exposes tools in sorted order with input-mode JSON schema and approval hints", () => {
    const reg = new ToolRegistry();
    coreTools.forEach((t) => reg.register(t));
    const llmTools = reg.toLlmTools(["send_progress_update", "memory_forget", "memory_save", "not_registered"]);
    expect(llmTools.map((t) => t.name)).toEqual(["memory_forget", "memory_save", "send_progress_update"]);
    expect(llmTools[0]!.description).toContain("requires owner approval");
    expect(llmTools[1]!.input_schema).toMatchObject({ type: "object", required: ["kind", "subject", "content"] });
    expect(llmTools[1]!.input_schema).not.toHaveProperty("$schema");
  });

  it("rejects duplicate and malformed tool names", () => {
    const reg = new ToolRegistry().register(tool("read"));
    expect(() => reg.register(tool("read"))).toThrow(/Duplicate/);
    expect(() => reg.register({ ...tool("read"), name: "Bad Name" })).toThrow(/Invalid/);
  });

  it("ships the default agents with distinct tool allowlists", () => {
    const agents = defaultAgents();
    expect(agents.get("chief_of_staff")!.tools).toContain("browser_page_snapshot");
    expect(agents.get("operations")!.tools).not.toContain("browser_page_snapshot");
  });
});

describe("spend estimation", () => {
  it("prices Opus 5.5 tokens", () => {
    // 1M in * $4 + 1M out * $20
    expect(estimateCostUsd("claude-opus-5-5", { input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBeCloseTo(24);
  });

  it("includes cache reads and writes", () => {
    const c = estimateCostUsd("claude-opus-5-5", { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000 });
    expect(c).toBeCloseTo(0.2 + 5);
  });

  it("prices unknown models conservatively", () => {
    expect(estimateCostUsd("some-future-model", { input_tokens: 1_000_000, output_tokens: 0 })).toBeCloseTo(10);
  });
});

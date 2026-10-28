import { z } from "zod";
import type { ToolDefinition } from "../core/types.js";

const kind = z.enum(["client", "project", "goal", "preference", "person", "fact"]);

const saveInput = z.object({
  kind,
  subject: z.string().min(1).max(200).describe("Short key, e.g. client name or project name"),
  content: z.string().min(1).max(4000),
});

export const memorySave: ToolDefinition<z.infer<typeof saveInput>> = {
  name: "memory_save",
  description: "Save or update a long-term memory (clients, projects, goals, preferences, people, facts). Same kind+subject overwrites.",
  input: saveInput,
  risk: "write_internal",
  dataClasses: ["client_pii", "personal", "business_internal"],
  idempotent: true,
  describeAction: (i) => `Remember [${i.kind}] ${i.subject}`,
  async run(i, ctx) {
    // Agent-saved memories are tagged "agent" and re-wrapped as untrusted on recall,
    // so content lifted from an email cannot later masquerade as an owner instruction.
    const m = await ctx.store.saveMemory({ ...i, scope: ctx.scope, source: "agent" });
    return { content: `Saved memory ${m.id} [${m.kind}] ${m.subject}.` };
  },
};

const searchInput = z.object({ query: z.string().min(1).max(200) });

export const memorySearch: ToolDefinition<z.infer<typeof searchInput>> = {
  name: "memory_search",
  description: "Search long-term memory for the task's scope.",
  input: searchInput,
  risk: "read",
  dataClasses: ["client_pii", "personal", "business_internal"],
  idempotent: true,
  describeAction: (i) => `Search memory: ${i.query}`,
  async run(i, ctx) {
    const rows = await ctx.store.searchMemories(i.query, ctx.scope, 15);
    if (!rows.length) return { content: "No matching memories." };
    return { content: rows.map((m) => `- (${m.id}) [${m.kind}] ${m.subject}: ${m.content} (source: ${m.source})`).join("\n") };
  },
};

const forgetInput = z.object({ memory_id: z.string().uuid() });

export const memoryForget: ToolDefinition<z.infer<typeof forgetInput>> = {
  name: "memory_forget",
  description: "Delete a memory by id. Requires owner approval.",
  input: forgetInput,
  risk: "destructive",
  dataClasses: ["client_pii", "personal", "business_internal"],
  idempotent: true,
  describeAction: (i) => `Delete memory ${i.memory_id}`,
  async run(i, ctx) {
    const ok = await ctx.store.deleteMemory(i.memory_id, ctx.scope);
    return ok ? { content: "Memory deleted." } : { content: "No such memory in this scope.", isError: true };
  },
};

const progressInput = z.object({ message: z.string().min(1).max(1000) });

export const sendProgressUpdate: ToolDefinition<z.infer<typeof progressInput>> = {
  name: "send_progress_update",
  description: "Send a short progress update to the owner on Telegram during long tasks. Use sparingly (major milestones only).",
  input: progressInput,
  risk: "write_internal", // goes only to the owner
  idempotent: false,
  describeAction: (i) => `Progress update: ${i.message}`,
  async run(i, ctx) {
    await ctx.notifier.send(ctx.chatId, `⏳ ${i.message}`);
    return { content: "Update sent to owner." };
  },
};

export const coreTools: ToolDefinition[] = [memorySave, memorySearch, memoryForget, sendProgressUpdate];

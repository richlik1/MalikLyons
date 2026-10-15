import { z } from "zod";
import type { ToolDefinition } from "../core/types.js";
import { loadProfile, PROFILE_KEY, profileGaps } from "./profile.js";
import { formatOpportunity } from "./report.js";
import type { OpportunityService } from "./service.js";
import type { OpportunityStore } from "./store.js";
import { OPPORTUNITY_CATEGORIES, OPPORTUNITY_STATUSES } from "./types.js";

export function opportunityTools(opps: OpportunityStore, service: OpportunityService): ToolDefinition[] {
  const searchInput = z.object({
    status: z.array(z.enum(OPPORTUNITY_STATUSES)).optional(),
    category: z.enum(OPPORTUNITY_CATEGORIES).optional(),
    text: z.string().max(100).optional(),
    limit: z.number().int().min(1).max(20).default(10),
  });
  const search: ToolDefinition<z.infer<typeof searchInput>> = {
    name: "opportunity_search",
    description: "Search the opportunity pipeline (verified grants, contracts, programs). Returns full recommendation cards.",
    input: searchInput,
    risk: "read",
    module: "opportunities",
    dataClasses: ["public", "business_internal"],
    idempotent: true,
    describeAction: () => "Search opportunity pipeline",
    async run(i, ctx) {
      const rows = await opps.search(i);
      if (!rows.length) return { content: "No matching opportunities in the pipeline." };
      return { content: rows.map((o) => `[${o.status}] ${formatOpportunity(o, ctx.config.TIMEZONE)}`).join("\n\n---\n\n") };
    },
  };

  const updateInput = z.object({
    opportunity_id: z.string().uuid(),
    decision: z.enum(["accepted", "rejected", "completed", "in_progress"]),
    note: z.string().max(1000).optional().describe("Owner's reason or the result (e.g. 'won $12k contract')"),
  });
  const update: ToolDefinition<z.infer<typeof updateInput>> = {
    name: "opportunity_update",
    description: "Record the owner's decision or result for an opportunity (feeds future recommendations).",
    input: updateInput,
    risk: "write_internal",
    module: "opportunities",
    dataClasses: ["business_internal"],
    idempotent: true,
    describeAction: (i) => `Mark opportunity ${i.opportunity_id.slice(0, 8)} as ${i.decision}`,
    async run(i) {
      if (i.decision === "in_progress") {
        await opps.setStatus(i.opportunity_id, "in_progress", "owner", { note: i.note ?? null });
        return { content: "Marked in progress." };
      }
      const o = await service.feedback(i.opportunity_id, i.decision, "owner", i.note);
      return o ? { content: `Recorded: ${i.decision}. Status is now ${o.status}.` } : { content: "Opportunity not found.", isError: true };
    },
  };

  const profileInput = z.object({
    patch: z
      .record(z.string(), z.unknown())
      .describe("Partial profile to merge, e.g. {\"business\":{\"samRegistered\":true,\"employees\":6}} or {\"constraints\":{\"weeklyHoursAvailable\":4}}"),
  });
  const profile: ToolDefinition<z.infer<typeof profileInput>> = {
    name: "opportunity_profile_update",
    description: "Update what the opportunity engine knows about the owner/business (eligibility facts, goals, constraints, search terms). Only record facts the owner stated.",
    input: profileInput,
    risk: "write_internal",
    module: "opportunities",
    dataClasses: ["business_internal", "financial"],
    idempotent: true,
    describeAction: () => "Update opportunity profile",
    async run(i, ctx) {
      const current = await loadProfile(ctx.store);
      const merged: Record<string, unknown> = { ...current };
      for (const [k, v] of Object.entries(i.patch)) {
        const cur = (current as unknown as Record<string, unknown>)[k];
        merged[k] = v && typeof v === "object" && !Array.isArray(v) && cur && typeof cur === "object" && !Array.isArray(cur) ? { ...cur, ...v } : v;
      }
      await ctx.store.setSetting(PROFILE_KEY, merged, "owner");
      const gaps = profileGaps(await loadProfile(ctx.store));
      return { content: `Profile updated.${gaps.length ? ` Still unknown: ${gaps.join(" ")}` : ""}` };
    },
  };

  const runInput = z.object({ source: z.enum(["grants_gov", "sam_gov", "github", "web_research"]) });
  const runNow: ToolDefinition<z.infer<typeof runInput>> = {
    name: "opportunity_research_now",
    description: "Run one discovery pass on a source now (normally automatic). Returns counts of new, verified, rejected and qualified items.",
    input: runInput,
    risk: "write_internal",
    module: "opportunities",
    dataClasses: ["public", "business_internal"],
    idempotent: true,
    describeAction: (i) => `Run opportunity discovery on ${i.source}`,
    async run(i, ctx) {
      const src = service.source(i.source);
      if (!src?.configured()) return { content: `${i.source} is not configured on the server.`, isError: true };
      const s = await service.runDiscovery(src, ctx.signal);
      return {
        content: `${i.source}: ${s.discovered} found, ${s.duplicates} already known, ${s.verified} verified, ${s.rejected} filtered out, ${s.qualified} qualified, ${s.alerted} alerted.${s.errors.length ? ` Errors: ${s.errors.slice(0, 3).join("; ")}` : ""}`,
      };
    },
  };

  return [search, update, profile, runNow];
}

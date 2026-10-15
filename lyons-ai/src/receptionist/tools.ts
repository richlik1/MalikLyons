import type { ToolDefinition } from "../core/types.js";
import { guardReply, KNOWLEDGE_KEY, KnowledgeSchema, type ReceptionistKnowledge } from "./brain.js";
import type { z } from "zod";

/** Changes what the receptionist tells the public, so it needs the owner's approval. */
export const receptionistKnowledgeTool: ToolDefinition<z.infer<typeof KnowledgeSchema>> = {
  name: "receptionist_knowledge_update",
  description:
    "Replace what the phone receptionist may tell callers (business name, services, service area, hours, FAQs). Requires owner approval. Do not include prices, availability or contract terms; the receptionist's safety filter removes them anyway.",
  input: KnowledgeSchema,
  risk: "external_communication",
  module: "receptionist",
  dataClasses: ["business_internal"],
  idempotent: true,
  describeAction: (i) =>
    `Update receptionist script: ${i.businessName}; services: ${i.services.join(", ")}; area: ${i.serviceArea}; hours: ${i.hours}; ${i.faqs.length} FAQ(s): ${i.faqs.map((f) => `"${f.q}" → "${f.a}"`).join(" | ")}`.slice(0, 1500),
  async run(i, ctx) {
    const flagged = i.faqs.filter((f) => guardReply(f.a).violations.length > 0).map((f) => f.q);
    await ctx.store.setSetting(KNOWLEDGE_KEY, i satisfies ReceptionistKnowledge, "owner");
    return {
      content: `Receptionist knowledge updated.${flagged.length ? ` Note: these FAQ answers mention prices/availability/terms and will be replaced by the safety filter when spoken: ${flagged.join("; ")}` : ""}`,
    };
  },
};

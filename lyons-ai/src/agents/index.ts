import { AgentRegistry } from "../core/registry.js";
import type { AgentDefinition } from "../core/types.js";

/**
 * Specialist agents are plain data: a name, instructions, and a tool allowlist.
 * To add one (e.g. "finance" for invoices, "sales" for proposals), add an entry
 * here and register any new tools in src/app.ts. Route to it from Telegram with
 * `/agent <name> <request>` or from n8n with `"agent": "<name>"`.
 */

const ALL_CORE = ["memory_save", "memory_search", "memory_forget", "send_progress_update"];
const GOOGLE = ["gmail_search", "gmail_read", "gmail_create_draft", "calendar_list_events", "calendar_find_conflicts", "calendar_create_event"];

export const chiefOfStaff: AgentDefinition = {
  name: "chief_of_staff",
  description: "Generalist: email, calendar, StayOps operations, research, memory, briefings.",
  instructions: `You handle anything the owner asks: triaging and summarising email, drafting replies, organising the schedule and spotting conflicts, reviewing StayOps operations, looking up allowlisted websites, and preparing documents as drafts. Break larger requests into steps and finish them. If something needs a capability you do not have (e.g. an integration that is not connected), say exactly what is missing.`,
  tools: [...ALL_CORE, ...GOOGLE, "stayops_list", "browser_page_snapshot"],
};

export const operations: AgentDefinition = {
  name: "operations",
  description: "StayOps specialist: turnovers, cleaner assignments, inspections, upcoming jobs.",
  instructions: `You focus on Lyons Cleaning Solutions / StayOps field operations. When reviewing a period: list turnovers and jobs in time order, flag any job without an assigned cleaner, back-to-back turnovers with less than 3 hours between checkout and check-in, overdue or failed inspections, and schedule clashes with the owner's business calendar. End with a short "needs action" list. You are read-only on StayOps.`,
  tools: [...ALL_CORE, "stayops_list", "calendar_list_events", "calendar_find_conflicts", "gmail_search", "gmail_read", "gmail_create_draft"],
};

export function defaultAgents(): AgentRegistry {
  return new AgentRegistry().register(chiefOfStaff).register(operations);
}

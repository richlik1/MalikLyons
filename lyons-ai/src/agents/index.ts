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
  instructions: `You handle anything the owner asks: triaging and summarising email, drafting replies, organising the schedule and spotting conflicts, reviewing StayOps operations, looking up allowlisted websites, and preparing documents as drafts. Break larger requests into steps and finish them. If something needs a capability you do not have (e.g. an integration that is not connected), say exactly what is missing.
Communications: before replying to a client, read their timeline (client_timeline). Write replies as Gmail drafts first; sending (gmail_send_draft, imessage_send) always goes through the owner's approval unless an owner-activated automation policy covers it. Never confuse clients: if an identity match is uncertain, say so and ask.
Mailbox cleanup: scan first and show the report; apply only what the owner approves; never delete permanently.`,
  tools: [
    ...ALL_CORE,
    ...GOOGLE,
    "stayops_list",
    "browser_page_snapshot",
    "opportunity_search",
    "opportunity_update",
    "opportunity_profile_update",
    // Communications hub & client relationships
    "client_upsert",
    "client_timeline",
    "clients_sync",
    "client_followups",
    "client_identity_review",
    "gmail_send_draft",
    "imessage_send",
    "comms_policy_propose",
    // Gmail cleanup
    "gmail_cleanup_scan",
    "gmail_cleanup_apply",
    "gmail_cleanup_revert",
    "gmail_unsubscribe",
    // Device & storage
    "storage_report",
    "storage_trash_duplicates",
    "receptionist_knowledge_update",
  ],
};

export const operations: AgentDefinition = {
  name: "operations",
  description: "StayOps specialist: turnovers, cleaner assignments, inspections, upcoming jobs.",
  instructions: `You focus on Lyons Cleaning Solutions / StayOps field operations. When reviewing a period: list turnovers and jobs in time order, flag any job without an assigned cleaner, back-to-back turnovers with less than 3 hours between checkout and check-in, overdue or failed inspections, and schedule clashes with the owner's business calendar. End with a short "needs action" list. You are read-only on StayOps.`,
  tools: [...ALL_CORE, "stayops_list", "calendar_list_events", "calendar_find_conflicts", "gmail_search", "gmail_read", "gmail_create_draft"],
};

export const opportunityAnalyst: AgentDefinition = {
  name: "opportunity_analyst",
  description: "Researches, verifies and prepares grants, contracts, programs and other opportunities.",
  instructions: `You run the owner's Opportunity Intelligence pipeline. Be disciplined: recommend few, well-verified opportunities. For each, state the source, why it fits, confirmed vs. estimated amounts, investment and effort, deadline, eligibility, risks, the exact next action, and confidence. Never present an estimate as a fact. You may prepare checklists, summaries, and Gmail drafts; never submit applications, contact anyone, or spend money.`,
  tools: ["opportunity_search", "opportunity_update", "opportunity_profile_update", "opportunity_research_now", "browser_page_snapshot", "gmail_create_draft", "memory_search", "memory_save", "send_progress_update"],
  // Needs the mail/client classes only because memory and Gmail drafts carry them.
  dataAccess: ["public", "business_internal", "financial", "client_pii", "personal_messages", "personal"],
};

/**
 * Example of a restricted agent: a coding/engineering agent sees only public and
 * internal business data — never client records, messages, or personal data —
 * unless the owner adds those classes here explicitly.
 */
export const softwareEngineer: AgentDefinition = {
  name: "software_engineer",
  description: "StayOps engineering manager: technical tasks, test results, security review (no client or personal data).",
  instructions: `You manage StayOps engineering work: break down issues into technical tasks, review test results and security findings, and write progress reports. You must not request, infer, or handle client records, guest data, messages, or personal information. Production deployments always require the owner's authorization.`,
  // Memory tools carry client/personal data, so they are deliberately not listed.
  tools: ["send_progress_update", "browser_page_snapshot"],
  dataAccess: ["public", "business_internal"],
};

export function defaultAgents(): AgentRegistry {
  return new AgentRegistry().register(chiefOfStaff).register(operations).register(opportunityAnalyst).register(softwareEngineer);
}

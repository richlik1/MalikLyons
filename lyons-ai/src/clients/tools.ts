import { calendar } from "@googleapis/calendar";
import { gmail } from "@googleapis/gmail";
import { z } from "zod";
import type { Scope, ToolDefinition } from "../core/types.js";
import type { Mailbox } from "../gmail-cleanup/mailbox.js";
import { toSimpleEvent } from "../integrations/google/calendar.js";
import type { GoogleAuthManager } from "../integrations/google/oauth.js";
import { wrapUntrusted } from "../security/untrusted.js";
import { header } from "../integrations/google/gmail.js";
import { normalizeEmail, normalizePhone } from "./identity.js";
import type { AutomationPolicies } from "./policies.js";
import type { ClientService } from "./service.js";
import { ClientSync, GoogleContactsSource } from "./sync.js";

const CLIENT = { module: "client_relationships" as const, dataClasses: ["client_pii" as const] };
const COMMS = { module: "communications" as const, dataClasses: ["client_pii" as const, "personal_messages" as const] };

function hoursAgo(d: Date, now = new Date()): number {
  return Math.round((now.getTime() - d.getTime()) / 3_600_000);
}

export function clientTools(deps: {
  clients: ClientService;
  policies: AutomationPolicies;
  google: GoogleAuthManager;
  mailboxFor: (scope: Scope) => Promise<Mailbox>;
}): ToolDefinition[] {
  const { clients, policies, google, mailboxFor } = deps;

  const upsertInput = z.object({
    name: z.string().min(1).max(200),
    company: z.string().max(200).optional(),
    status: z.enum(["prospect", "active", "inactive"]).optional(),
    notes: z.string().max(2000).optional(),
    emails: z.array(z.string().max(320)).max(10).optional(),
    phones: z.array(z.string().max(40)).max(10).optional(),
    domains: z.array(z.string().max(253)).max(5).optional().describe("Company email domains (not gmail.com etc.)"),
  });
  const upsert: ToolDefinition<z.infer<typeof upsertInput>> = {
    ...CLIENT,
    name: "client_upsert",
    description: "Create or update a client record and its known emails/phones/domains (only details the owner gave or that are certain).",
    input: upsertInput,
    risk: "write_internal",
    idempotent: true,
    describeAction: (i) => `Save client ${i.name}`,
    async run(i) {
      const r = await clients.upsertClient(i, "agent");
      return { content: `Saved client ${r.client.name} (${r.client.id.slice(0, 8)}).${r.conflicts.length ? ` Conflicts: ${r.conflicts.join("; ")}` : ""}` };
    },
  };

  const findInput = z.object({ query: z.string().min(1).max(200) });
  const timeline: ToolDefinition<z.infer<typeof findInput>> = {
    ...CLIENT,
    dataClasses: ["client_pii", "personal_messages"],
    name: "client_timeline",
    description: "Find a client by name, company, email or phone and show their communication timeline (emails, meetings, messages, calls) and what we've sent them.",
    input: findInput,
    risk: "read",
    idempotent: true,
    describeAction: (i) => `Show client timeline for ${i.query}`,
    async run(i, ctx) {
      const found = await clients.find(i.query);
      if (!found.length) return { content: "No matching client." };
      if (found.length > 1) return { content: `Several clients match: ${found.map((c) => `${c.name}${c.company ? ` (${c.company})` : ""}`).join(", ")}. Be more specific.` };
      const c = found[0]!;
      const events = await clients.timeline(c.id, 30);
      const sent = await clients.outboundHistory(c.id, 10);
      const fmt = (d: Date) => d.toLocaleString("en-US", { timeZone: ctx.config.TIMEZONE, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      const lines = events.map(
        (e) =>
          `- ${fmt(e.at)} ${e.kind}${e.direction ? ` ${e.direction === "in" ? "←" : "→"}` : ""}${e.channel ? ` [${e.channel}]` : ""}: ${e.summary}${e.requires_response && !e.responded_at ? " ⚠️ awaiting reply" : ""}`,
      );
      const out = sent.map((s) => `- ${s.channel} to ${s.to_address}: "${s.subject ?? ""}" — ${s.status}${s.sent_at ? ` ${fmt(s.sent_at)}` : ""}${s.policy_id ? " (auto, policy)" : ""}`);
      return {
        content: `${c.name}${c.company ? ` — ${c.company}` : ""} [${c.status}]\n${c.notes ?? ""}\n\nTimeline:\n${wrapUntrusted("client_timeline", lines.join("\n") || "(empty)")}\n\nSent by LYONS AI:\n${out.join("\n") || "(nothing)"}`,
      };
    },
  };

  const syncInput = z.object({ days: z.number().int().min(1).max(90).default(14), include_contacts: z.boolean().default(true) });
  const syncTool: ToolDefinition<z.infer<typeof syncInput>> = {
    ...CLIENT,
    dataClasses: ["client_pii", "personal_messages"],
    name: "clients_sync",
    description: "Refresh client timelines from Gmail (inbound and sent), Google Calendar, and Google Contacts for the task's account. Only mail/events involving known clients are stored.",
    input: syncInput,
    risk: "write_internal",
    idempotent: true,
    describeAction: (i) => `Sync client communications from the last ${i.days} days`,
    async run(i, ctx) {
      const s = new ClientSync(clients, ctx.store);
      const mail = await s.syncMail(await mailboxFor(ctx.scope), ctx.scope, i.days);
      const auth = await google.clientFor(ctx.scope);
      const api = calendar({ version: "v3", auth });
      const res = await api.events.list({
        calendarId: "primary",
        timeMin: new Date(Date.now() - i.days * 86_400_000).toISOString(),
        timeMax: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        singleEvents: true,
        maxResults: 250,
      });
      const cal = await s.syncCalendar((res.data.items ?? []).map(toSimpleEvent), ctx.scope);
      const contacts = i.include_contacts ? await s.syncContacts(new GoogleContactsSource(auth)) : { enriched: 0, suggestions: 0 };
      const pending = (await clients.pendingSuggestions()).length;
      return {
        content: `Mail: ${mail.scanned} scanned, ${mail.linked} linked to clients, ${mail.newEvents} new timeline entries, ${mail.outboundMarkedSent} drafts confirmed sent.\nCalendar: ${cal.newEvents} new meetings.\nContacts: ${contacts.enriched} phone numbers added to known clients.\nIdentity matches waiting for your confirmation: ${pending}.`,
      };
    },
  };

  const followInput = z.object({ unanswered_after_hours: z.number().int().min(1).max(336).default(24), upcoming_days: z.number().int().min(1).max(60).default(7) });
  const followups: ToolDefinition<z.infer<typeof followInput>> = {
    ...CLIENT,
    dataClasses: ["client_pii", "personal_messages"],
    name: "client_followups",
    description: "List unanswered client requests, upcoming client obligations (meetings, due dates), and sent messages with no reply — the basis for follow-up suggestions.",
    input: followInput,
    risk: "read",
    idempotent: true,
    describeAction: () => "List client follow-ups",
    async run(i, ctx) {
      const [open, upcoming, sent] = await Promise.all([clients.unanswered(i.unanswered_after_hours), clients.upcoming(i.upcoming_days), clients.outboundHistory(null, 50)]);
      const noReply = sent.filter((s) => s.status === "sent" && s.sent_at && hoursAgo(s.sent_at) > 72);
      const fmt = (d: Date) => d.toLocaleString("en-US", { timeZone: ctx.config.TIMEZONE, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      const text = [
        `Unanswered client requests (> ${i.unanswered_after_hours}h): ${open.length}`,
        ...open.map((o) => `- ${o.name} (${hoursAgo(o.at)}h ago${o.channel ? `, ${o.channel}` : ""}): ${o.summary}`),
        "",
        `Upcoming in ${i.upcoming_days} days: ${upcoming.length}`,
        ...upcoming.map((u) => `- ${fmt(u.due_at)} ${u.kind} with ${u.name}: ${u.summary}`),
        "",
        `Sent with no reply after 3 days: ${noReply.length}`,
        ...noReply.map((s) => `- ${s.to_address}: "${s.subject ?? ""}" sent ${fmt(s.sent_at!)}`),
      ].join("\n");
      return { content: wrapUntrusted("client_followups", text) };
    },
  };

  const reviewInput = z.object({});
  const review: ToolDefinition<z.infer<typeof reviewInput>> = {
    ...CLIENT,
    name: "client_identity_review",
    description: "List uncertain identity matches (e.g. same name, same company domain, conflicting email/phone) waiting for the owner to confirm.",
    input: reviewInput,
    risk: "read",
    idempotent: true,
    describeAction: () => "List identity matches to confirm",
    async run() {
      const rows = await clients.pendingSuggestions();
      if (!rows.length) return { content: "Nothing to confirm." };
      return { content: rows.map((r) => `- ${r.id.slice(0, 8)}: ${r.value}${r.display_name ? ` (${r.display_name})` : ""} → ${r.client_name}? confidence ${r.confidence} — ${r.reason} [${r.source}]`).join("\n") };
    },
  };

  // ---------- communications: sending (approval-gated unless an active policy covers it) ----------
  const sendInput = z.object({
    draft_id: z.string().min(1).max(200),
    to: z.string().max(320).describe("Recipient exactly as in the draft"),
    subject: z.string().max(300).describe("Subject exactly as in the draft"),
  });
  const sendDraft: ToolDefinition<z.infer<typeof sendInput>> = {
    ...COMMS,
    name: "gmail_send_draft",
    description: "Send an existing Gmail draft. Requires owner approval unless an owner-activated automation policy covers this exact recipient. The draft's real recipient and subject are checked before sending.",
    input: sendInput,
    risk: "external_communication",
    idempotent: false,
    describeAction: (i) => `SEND email "${i.subject}" to ${i.to} (draft ${i.draft_id})`,
    autoApprove: (i) => policies.covers("email", i.to, i.subject),
    async run(i, ctx) {
      const api = gmail({ version: "v1", auth: await google.clientFor(ctx.scope) });
      const d = await api.users.drafts.get({ userId: "me", id: i.draft_id, format: "metadata" });
      const realTo = (header(d.data.message?.payload, "To") ?? "").split(",").map((x) => normalizeEmail(x)).filter(Boolean);
      const realSubject = header(d.data.message?.payload, "Subject");
      if (realTo.length !== 1 || realTo[0] !== normalizeEmail(i.to) || realSubject !== i.subject) {
        return { content: `Not sent: the draft's actual recipient/subject (${realTo.join(", ")} / "${realSubject}") don't match what was approved.`, isError: true };
      }
      const policyId = await policies.covers("email", i.to, i.subject);
      const resolved = await clients.resolve({ email: i.to, source: "outbound" });
      const outId = await clients.recordOutbound({ clientId: resolved.clientId, channel: "email", to: i.to, subject: i.subject, body: d.data.message?.snippet ?? "", status: "queued", policyId: policyId ?? undefined, taskId: ctx.taskId });
      const sent = await api.users.drafts.send({ userId: "me", requestBody: { id: i.draft_id } });
      await clients.markOutbound(outId, "sent", "sent via Gmail", sent.data.id ?? undefined);
      if (resolved.clientId) {
        await clients.recordEvent(resolved.clientId, { at: new Date(), kind: "email", direction: "out", channel: "gmail", source: "lyons_outbound", externalId: outId, summary: `Sent: ${i.subject}` });
      }
      return { content: `Sent "${i.subject}" to ${i.to} (Gmail id ${sent.data.id}).` };
    },
  };

  const imsgInput = z.object({ handle: z.string().max(320).describe("Phone number or Apple ID email"), text: z.string().min(1).max(2000) });
  const imessageSend: ToolDefinition<z.infer<typeof imsgInput>> = {
    ...COMMS,
    name: "imessage_send",
    description: "Queue an iMessage for the owner's Mac bridge to send. Requires owner approval unless an active policy covers this recipient. Delivery is confirmed by the bridge.",
    input: imsgInput,
    risk: "external_communication",
    idempotent: false,
    describeAction: (i) => `SEND iMessage to ${i.handle}: "${i.text.slice(0, 160)}${i.text.length > 160 ? "…" : ""}"`,
    autoApprove: (i) => policies.covers("imessage", i.handle, undefined),
    async run(i, ctx) {
      const handle = normalizePhone(i.handle) ?? normalizeEmail(i.handle);
      if (!handle) return { content: "Invalid phone number or Apple ID.", isError: true };
      const resolved = await clients.resolve({ phone: normalizePhone(i.handle) ?? undefined, email: normalizeEmail(i.handle) ?? undefined, source: "outbound" });
      const policyId = await policies.covers("imessage", i.handle, undefined);
      const id = await clients.recordOutbound({ clientId: resolved.clientId, channel: "imessage", to: handle, body: i.text, status: "queued", policyId: policyId ?? undefined, taskId: ctx.taskId });
      return { content: `Queued iMessage ${id.slice(0, 8)} for the Mac bridge. It is NOT sent until the bridge confirms delivery; you'll be told if it fails.` };
    },
  };

  const policyInput = z.object({
    name: z.string().min(3).max(100),
    channel: z.enum(["email", "imessage"]),
    description: z.string().min(10).max(500),
    recipients: z.array(z.string().max(320)).min(1).max(25),
    max_per_day: z.number().int().min(1).max(20),
    subject_prefix: z.string().max(100).optional(),
    allowed_hours: z.tuple([z.number().int().min(0).max(23), z.number().int().min(1).max(24)]).optional(),
  });
  const proposePolicy: ToolDefinition<z.infer<typeof policyInput>> = {
    ...COMMS,
    dataClasses: ["client_pii"],
    name: "comms_policy_propose",
    description:
      "Propose a narrowly scoped automation policy (specific recipients, channel, daily cap, optional subject prefix/hours) that would let matching messages send without per-message approval. It stays inactive until the owner activates it.",
    input: policyInput,
    risk: "write_internal",
    idempotent: false,
    describeAction: (i) => `Propose automation policy "${i.name}"`,
    async run(i) {
      const r = await policies.propose(
        { name: i.name, channel: i.channel, description: i.description, rules: { recipients: i.recipients, maxPerDay: i.max_per_day, subjectPrefix: i.subject_prefix, allowedHours: i.allowed_hours } },
        "agent",
      );
      if ("error" in r) return { content: r.error, isError: true };
      return { content: `Proposed policy ${r.id.slice(0, 8)}. It is NOT active. The owner can activate it with /policy_activate ${r.id.slice(0, 8)} or in the Control Center.` };
    },
  };

  return [upsert, timeline, syncTool, followups, review, sendDraft, imessageSend, proposePolicy];
}

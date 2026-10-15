import { gmail, type gmail_v1 } from "@googleapis/gmail";
import { z } from "zod";
import type { ToolDefinition } from "../../core/types.js";
import { wrapUntrusted } from "../../security/untrusted.js";
import type { GoogleAuthManager } from "./oauth.js";

type Part = gmail_v1.Schema$MessagePart;

export function header(part: Part | undefined, name: string): string {
  return part?.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function decode(data: string | null | undefined): string {
  return data ? Buffer.from(data, "base64url").toString("utf8") : "";
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Prefer text/plain anywhere in the MIME tree; fall back to text/html converted to text. */
export function extractBody(payload: Part | undefined): string {
  if (!payload) return "";
  const plain: string[] = [];
  const html: string[] = [];
  const walk = (p: Part) => {
    if (p.mimeType === "text/plain" && p.body?.data) plain.push(decode(p.body.data));
    else if (p.mimeType === "text/html" && p.body?.data) html.push(decode(p.body.data));
    p.parts?.forEach(walk);
  };
  walk(payload);
  if (plain.length) return plain.join("\n").trim();
  if (html.length) return htmlToText(html.join("\n"));
  return "";
}

const NO_NEWLINES = /^[^\r\n]*$/;

/** Build an RFC 2822 message. Header values are validated to prevent header injection. */
export function buildMime(m: { to: string[]; cc?: string[]; subject: string; body: string; inReplyTo?: string; references?: string }): string {
  // Validate raw values: encoding could otherwise hide a CR/LF from the check below.
  for (const v of [...m.to, ...(m.cc ?? []), m.subject, m.inReplyTo ?? "", m.references ?? ""]) {
    if (!NO_NEWLINES.test(v)) throw new Error("Header contains a newline");
  }
  const headers = [
    `To: ${m.to.join(", ")}`,
    m.cc?.length ? `Cc: ${m.cc.join(", ")}` : "",
    `Subject: ${encodeHeader(m.subject)}`,
    m.inReplyTo ? `In-Reply-To: ${m.inReplyTo}` : "",
    m.references ? `References: ${m.references}` : "",
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
  ].filter(Boolean);
  return `${headers.join("\r\n")}\r\n\r\n${m.body.replace(/\r?\n/g, "\r\n")}`;
}

function encodeHeader(v: string): string {
  // RFC 2047 encode non-ASCII subjects.
  return /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, "utf8").toString("base64")}?=`;
}

export interface DraftHook {
  (d: { scope: "business" | "personal"; to: string[]; subject: string; body: string; draftId: string; taskId: string }): Promise<void>;
}

export function gmailTools(auth: GoogleAuthManager, onDraft?: DraftHook): ToolDefinition[] {
  const searchInput = z.object({
    query: z.string().max(500).describe('Gmail search syntax, e.g. "is:unread newer_than:1d" or "from:client@example.com"'),
    max_results: z.number().int().min(1).max(25).default(10),
  });

  const search: ToolDefinition<z.infer<typeof searchInput>> = {
    name: "gmail_search",
    description: "Search the task scope's Gmail. Returns id, sender, subject, date and snippet for each message.",
    input: searchInput,
    risk: "read",
    dataClasses: ["client_pii", "personal_messages"],
    idempotent: true,
    describeAction: (i) => `Search Gmail: ${i.query}`,
    async run(i, ctx) {
      const api = gmail({ version: "v1", auth: await auth.clientFor(ctx.scope) });
      const list = await api.users.messages.list({ userId: "me", q: i.query, maxResults: i.max_results });
      const ids = list.data.messages ?? [];
      if (!ids.length) return { content: "No messages matched." };
      const rows = await Promise.all(
        ids.map(async ({ id }) => {
          const m = await api.users.messages.get({ userId: "me", id: id!, format: "metadata", metadataHeaders: ["From", "Subject", "Date"] });
          const unread = m.data.labelIds?.includes("UNREAD") ? " [unread]" : "";
          return `- id ${m.data.id} | ${header(m.data.payload, "Date")} | from ${header(m.data.payload, "From")} | ${header(m.data.payload, "Subject")}${unread}\n  ${m.data.snippet ?? ""}`;
        }),
      );
      return { content: wrapUntrusted(`gmail:${ctx.scope}`, rows.join("\n")) };
    },
  };

  const readInput = z.object({ message_id: z.string().min(1).max(100) });
  const read: ToolDefinition<z.infer<typeof readInput>> = {
    name: "gmail_read",
    description: "Read one email (headers and plain-text body) from the task scope's Gmail.",
    input: readInput,
    risk: "read",
    dataClasses: ["client_pii", "personal_messages"],
    idempotent: true,
    describeAction: (i) => `Read email ${i.message_id}`,
    async run(i, ctx) {
      const api = gmail({ version: "v1", auth: await auth.clientFor(ctx.scope) });
      const m = await api.users.messages.get({ userId: "me", id: i.message_id, format: "full" });
      const p = m.data.payload;
      const text = [
        `From: ${header(p, "From")}`,
        `To: ${header(p, "To")}`,
        `Cc: ${header(p, "Cc")}`,
        `Date: ${header(p, "Date")}`,
        `Subject: ${header(p, "Subject")}`,
        `Thread: ${m.data.threadId}`,
        "",
        extractBody(p) || "(no text body)",
      ].join("\n");
      return { content: wrapUntrusted(`gmail:${ctx.scope}:${i.message_id}`, text) };
    },
  };

  const email = z.string().email();
  const draftInput = z.object({
    to: z.array(email).min(1).max(20),
    cc: z.array(email).max(20).optional(),
    subject: z.string().min(1).max(300).regex(NO_NEWLINES, "no newlines"),
    body: z.string().min(1).max(20_000),
    reply_to_message_id: z.string().max(100).optional().describe("Gmail message id this draft replies to (keeps it in the thread)."),
  });

  const draft: ToolDefinition<z.infer<typeof draftInput>> = {
    name: "gmail_create_draft",
    description: "Save an email as a DRAFT in the task scope's Gmail. Nothing is sent; the owner reviews and sends it from Gmail.",
    input: draftInput,
    risk: "write_internal",
    dataClasses: ["client_pii", "personal_messages"],
    idempotent: false,
    describeAction: (i) => `Create Gmail draft to ${i.to.join(", ")}: "${i.subject}"`,
    async run(i, ctx) {
      const api = gmail({ version: "v1", auth: await auth.clientFor(ctx.scope) });
      let threadId: string | undefined;
      let inReplyTo: string | undefined;
      let references: string | undefined;
      if (i.reply_to_message_id) {
        const orig = await api.users.messages.get({
          userId: "me",
          id: i.reply_to_message_id,
          format: "metadata",
          metadataHeaders: ["Message-ID", "References"],
        });
        threadId = orig.data.threadId ?? undefined;
        inReplyTo = header(orig.data.payload, "Message-ID") || undefined;
        references = [header(orig.data.payload, "References"), inReplyTo].filter(Boolean).join(" ") || undefined;
      }
      const raw = Buffer.from(buildMime({ to: i.to, cc: i.cc, subject: i.subject, body: i.body, inReplyTo, references })).toString("base64url");
      const res = await api.users.drafts.create({ userId: "me", requestBody: { message: { raw, threadId } } });
      await onDraft?.({ scope: ctx.scope, to: i.to, subject: i.subject, body: i.body, draftId: res.data.id ?? "", taskId: ctx.taskId });
      return { content: `Draft saved (draft id ${res.data.id}). It has NOT been sent; the owner can review it in Gmail Drafts.` };
    },
  };

  return [search, read, draft];
}

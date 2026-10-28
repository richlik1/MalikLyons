import { z } from "zod";
import type { Scope, ToolDefinition } from "../core/types.js";
import type { Mailbox } from "./mailbox.js";
import type { GmailCleanupService } from "./service.js";

export function gmailCleanupTools(svc: GmailCleanupService, mailboxFor: (scope: Scope) => Promise<Mailbox>): ToolDefinition[] {
  const common = { module: "gmail_cleanup" as const, dataClasses: ["personal_messages" as const, "client_pii" as const] };

  const scanInput = z.object({
    query: z.string().max(300).default("in:inbox").describe("Gmail search for the messages to review"),
    max_messages: z.number().int().min(1).max(5000).default(500),
    archive_older_than_days: z.number().int().min(0).max(3650).default(30),
    trash_older_than_days: z.number().int().min(30).max(3650).nullable().default(null).describe("Only if the owner asked for trashing; null = archive only"),
  });
  const scan: ToolDefinition<z.infer<typeof scanInput>> = {
    ...common,
    name: "gmail_cleanup_scan",
    description:
      "Classify mail (spam, promotions, newsletters, receipts, invoices, financial, legal, client) and propose a reversible cleanup plan. Changes nothing in Gmail. Financial, legal, receipt, invoice, client, starred and user-labelled mail is always protected.",
    input: scanInput,
    risk: "write_internal",
    idempotent: true,
    describeAction: (i) => `Scan Gmail (${i.query}) and propose a cleanup plan`,
    async run(i, ctx) {
      const r = await svc.scan(await mailboxFor(ctx.scope), {
        scope: ctx.scope,
        query: i.query,
        maxMessages: i.max_messages,
        archiveOlderThanDays: i.archive_older_than_days,
        trashOlderThanDays: i.trash_older_than_days,
      });
      return { content: `${r.report}\n\nplan_id: ${r.planId}\nTo apply, call gmail_cleanup_apply with expected_archive=${r.summary.byAction.archive} and expected_trash=${r.summary.byAction.trash} (only if trashing was requested).` };
    },
  };

  const applyInput = z.object({
    plan_id: z.string().uuid(),
    include_trash: z.boolean().default(false),
    expected_archive: z.number().int().min(0),
    expected_trash: z.number().int().min(0).default(0),
  });
  const apply: ToolDefinition<z.infer<typeof applyInput>> = {
    ...common,
    name: "gmail_cleanup_apply",
    description: "Apply a cleanup plan: archive (and optionally move to Trash) exactly the messages in the plan. Reversible. Requires owner approval.",
    input: applyInput,
    // Bulk mailbox changes are treated as destructive so they always need approval, even though they're reversible.
    risk: "destructive",
    idempotent: true,
    describeAction: (i) =>
      `Gmail cleanup plan ${i.plan_id.slice(0, 8)}: archive ${i.expected_archive} message(s)${i.include_trash ? ` and move ${i.expected_trash} to Trash (recoverable 30 days)` : ""}. Reversible; protected mail untouched.`,
    async run(i, ctx) {
      const r = await svc.apply(await mailboxFor(ctx.scope), i.plan_id, i.include_trash, { archive: i.expected_archive, trash: i.include_trash ? i.expected_trash : 0 });
      return { content: `Archived ${r.archived}, trashed ${r.trashed}.\n\n${r.report}` };
    },
  };

  const revertInput = z.object({ plan_id: z.string().uuid() });
  const revert: ToolDefinition<z.infer<typeof revertInput>> = {
    ...common,
    name: "gmail_cleanup_revert",
    description: "Undo an applied cleanup plan: move its messages back to the Inbox and restore any trashed ones.",
    input: revertInput,
    risk: "write_internal",
    idempotent: true,
    describeAction: (i) => `Revert Gmail cleanup plan ${i.plan_id.slice(0, 8)}`,
    async run(i, ctx) {
      const r = await svc.revert(await mailboxFor(ctx.scope), i.plan_id);
      return { content: `Restored ${r.restored} message(s) to the Inbox.` };
    },
  };

  const unsubInput = z.object({ candidate_id: z.string().uuid(), sender: z.string().max(320) });
  const unsub: ToolDefinition<z.infer<typeof unsubInput>> = {
    ...common,
    name: "gmail_unsubscribe",
    description: "Unsubscribe from a bulk sender using its standard one-click unsubscribe (RFC 8058). Never used for spam. Requires owner approval.",
    input: unsubInput,
    risk: "external_communication",
    idempotent: true,
    describeAction: (i) => `Send a one-click unsubscribe request to ${i.sender}`,
    async run(i) {
      return { content: await svc.unsubscribe(i.candidate_id, fetch, undefined, i.sender) };
    },
  };

  return [scan, apply, revert, unsub];
}

import type { Db } from "../db/pool.js";
import type { Store } from "../db/store.js";
import type { Scope } from "../core/types.js";
import {
  classifyMessage,
  decideAction,
  parseUnsubscribe,
  senderEmail,
  type ClassifierContext,
  type CleanupAction,
  type MailCategory,
  type MessageMeta,
} from "./classify.js";
import type { Mailbox } from "./mailbox.js";
import { assertPublicHttpsUrl } from "../opportunities/sources/web-research.js";

export const CLEANUP_MODULE = "gmail_cleanup";

export interface ScanOptions {
  scope: Scope;
  query: string;
  maxMessages: number;
  archiveOlderThanDays: number;
  trashOlderThanDays: number | null;
  now?: Date;
}

export interface PlanSummary {
  scanned: number;
  byCategory: Record<string, number>;
  byAction: Record<CleanupAction, number>;
  protectedByReason: Record<string, number>;
  topSenders: { sender: string; count: number; action: CleanupAction }[];
  unsubscribeSuggestions: number;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]!);
      }
    }),
  );
  return out;
}

export class GmailCleanupService {
  constructor(
    private readonly db: Db,
    private readonly store: Store,
  ) {}

  /** Known client senders protect their mail (from client records and client memories). */
  async classifierContext(): Promise<ClassifierContext> {
    const emails = new Set<string>();
    const domains = new Set<string>();
    const r = await this.db.query<{ value: string }>(
      `SELECT lower(value) AS value FROM client_identities WHERE kind = 'email'
       UNION SELECT lower(substring(content from '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+')) FROM memories WHERE kind = 'client'`,
    );
    for (const row of r.rows) {
      if (!row.value) continue;
      emails.add(row.value);
      const d = row.value.split("@")[1];
      if (d) domains.add(d);
    }
    return { clientEmails: emails, clientDomains: domains };
  }

  /** Read-only: classify the mailbox and store a proposed plan. Changes nothing in Gmail. */
  async scan(mailbox: Mailbox, o: ScanOptions): Promise<{ planId: string; summary: PlanSummary; report: string }> {
    const now = o.now ?? new Date();
    const ctx = await this.classifierContext();
    const ids = await mailbox.listIds(o.query, o.maxMessages);
    const metas = await mapLimit(ids, 8, (id) => mailbox.getMeta(id));

    const summary: PlanSummary = {
      scanned: metas.length,
      byCategory: {},
      byAction: { archive: 0, trash: 0, keep: 0 },
      protectedByReason: {},
      topSenders: [],
      unsubscribeSuggestions: 0,
    };
    const senders = new Map<string, { count: number; unread: number; action: CleanupAction; meta: MessageMeta; category: MailCategory }>();
    const items: { m: MessageMeta; category: MailCategory; action: CleanupAction; protected: string | null }[] = [];

    for (const m of metas) {
      const c = classifyMessage(m, ctx);
      const action = decideAction(m, c, { archiveOlderThanDays: o.archiveOlderThanDays, trashOlderThanDays: o.trashOlderThanDays, now });
      items.push({ m, category: c.category, action, protected: c.protected });
      summary.byCategory[c.category] = (summary.byCategory[c.category] ?? 0) + 1;
      summary.byAction[action]++;
      if (c.protected) summary.protectedByReason[c.protected] = (summary.protectedByReason[c.protected] ?? 0) + 1;
      const s = senderEmail(m.from);
      const entry = senders.get(s) ?? { count: 0, unread: 0, action, meta: m, category: c.category };
      entry.count++;
      if (m.labelIds.includes("UNREAD")) entry.unread++;
      if (action !== "keep") entry.action = action;
      senders.set(s, entry);
    }
    summary.topSenders = [...senders.entries()]
      .filter(([, v]) => v.action !== "keep")
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10)
      .map(([sender, v]) => ({ sender, count: v.count, action: v.action }));

    const date = now.toISOString().slice(0, 10);
    const label = `LYONS/Cleanup-${date}`;
    const client = await this.db.connect();
    let planId: string;
    try {
      await client.query("BEGIN");
      const p = await client.query<{ id: string }>(
        "INSERT INTO cleanup_plans (scope, query, label_name, summary, report) VALUES ($1, $2, $3, $4, '') RETURNING id",
        [o.scope, o.query, label, JSON.stringify(summary)],
      );
      planId = p.rows[0]!.id;
      for (const it of items) {
        await client.query(
          `INSERT INTO cleanup_items (plan_id, message_id, thread_id, sender, subject, category, action, protected_reason)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING`,
          [planId, it.m.id, it.m.threadId ?? null, senderEmail(it.m.from), it.m.subject.slice(0, 300), it.category, it.action, it.protected],
        );
      }
      // Unsubscribe suggestions: recurring bulk senders, never spam (unsubscribing from spam confirms your address).
      for (const [sender, v] of senders) {
        if (v.category === "spam" || !["promotions", "newsletter", "social"].includes(v.category) || v.count < 3) continue;
        const u = parseUnsubscribe(v.meta.listUnsubscribe, v.meta.listUnsubscribePost);
        if (u.method === "none") continue;
        await client.query(
          `INSERT INTO unsubscribe_candidates (plan_id, sender, message_count, unread_count, method, url, mailto)
           VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
          [planId, sender, v.count, v.unread, u.method, u.url ?? null, u.mailto ?? null],
        );
        summary.unsubscribeSuggestions++;
      }
      await client.query("UPDATE cleanup_plans SET summary = $2 WHERE id = $1", [planId, JSON.stringify(summary)]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    const report = await this.report(planId);
    await this.db.query("UPDATE cleanup_plans SET report = $2 WHERE id = $1", [planId, report]);
    await this.store.audit("agent", "gmail_cleanup.scanned", null, { planId, scope: o.scope, scanned: summary.scanned, byAction: summary.byAction });
    return { planId, summary, report };
  }

  async getPlan(planId: string) {
    const r = await this.db.query<{ id: string; scope: Scope; status: string; label_name: string; summary: PlanSummary; created_at: Date; applied_at: Date | null; query: string }>(
      "SELECT id, scope, status, label_name, summary, created_at, applied_at, query FROM cleanup_plans WHERE id = $1",
      [planId],
    );
    return r.rows[0] ?? null;
  }

  async recentPlans(limit = 5) {
    const r = await this.db.query<{ id: string; scope: string; status: string; summary: PlanSummary; created_at: Date }>(
      "SELECT id, scope, status, summary, created_at FROM cleanup_plans ORDER BY created_at DESC LIMIT $1",
      [limit],
    );
    return r.rows;
  }

  async report(planId: string): Promise<string> {
    const plan = await this.getPlan(planId);
    if (!plan) return "Plan not found.";
    const s = plan.summary;
    const counts = await this.db.query<{ action: string; applied: string; reverted: string; n: string }>(
      `SELECT action, count(applied_at) applied, count(reverted_at) reverted, count(*) n FROM cleanup_items WHERE plan_id = $1 GROUP BY action`,
      [planId],
    );
    const unsub = await this.db.query<{ id: string; sender: string; message_count: number; unread_count: number; method: string; status: string }>(
      "SELECT id, sender, message_count, unread_count, method, status FROM unsubscribe_candidates WHERE plan_id = $1 ORDER BY message_count DESC LIMIT 10",
      [planId],
    );
    const lines = [
      `📬 Gmail cleanup report (${plan.scope}) — plan ${planId.slice(0, 8)} [${plan.status}]`,
      `Scanned ${s.scanned} messages matching: ${plan.query}`,
      "",
      `By type: ${Object.entries(s.byCategory).map(([k, v]) => `${k} ${v}`).join(" · ") || "none"}`,
      `Proposed: archive ${s.byAction.archive} · trash ${s.byAction.trash} · keep ${s.byAction.keep}`,
      `Protected (never touched): ${Object.entries(s.protectedByReason).map(([k, v]) => `${k} ${v}`).join(" · ") || "none"}`,
    ];
    if (s.topSenders.length) {
      lines.push("", "Biggest senders to clean up:");
      for (const t of s.topSenders.slice(0, 8)) lines.push(`- ${t.sender}: ${t.count} → ${t.action}`);
    }
    if (unsub.rows.length) {
      lines.push("", "Unsubscribe suggestions:");
      for (const u of unsub.rows) {
        const how = u.method === "one_click" ? "one-click (I can do it with your approval)" : u.method === "link" ? "web link (you click)" : "email request (draft only)";
        lines.push(`- ${u.sender}: ${u.message_count} msgs, ${u.unread_count} unread — ${how} [${u.status}] (id ${u.id.slice(0, 8)})`);
      }
    }
    const applied = counts.rows.filter((r) => Number(r.applied) > 0);
    if (applied.length) {
      lines.push("", `Applied: ${applied.map((r) => `${r.action} ${r.applied}${Number(r.reverted) ? ` (reverted ${r.reverted})` : ""}`).join(" · ")}`);
    }
    lines.push(
      "",
      "Recovery options:",
      `- Archived mail stays in All Mail with the label "${plan.label_name}"; revert the whole plan with one command, or move any message back to Inbox in Gmail.`,
      "- Trashed mail is recoverable from Gmail Trash for 30 days (revert restores it).",
      "- Nothing is ever permanently deleted by LYONS AI.",
    );
    return lines.join("\n");
  }

  /**
   * Apply a proposed plan. Idempotent: only items not yet applied are changed.
   * Trash is applied only when includeTrash is true.
   */
  async apply(
    mailbox: Mailbox,
    planId: string,
    includeTrash: boolean,
    expected?: { archive: number; trash: number },
  ): Promise<{ archived: number; trashed: number; report: string }> {
    const plan = await this.getPlan(planId);
    if (!plan) throw new Error("Plan not found.");
    // The approval prompt showed these counts; refuse if the plan doesn't match them.
    if (expected && (expected.archive !== plan.summary.byAction.archive || expected.trash !== (includeTrash ? plan.summary.byAction.trash : 0))) {
      throw new Error(
        `Counts don't match the plan (plan: archive ${plan.summary.byAction.archive}, trash ${includeTrash ? plan.summary.byAction.trash : 0}). Nothing was changed.`,
      );
    }
    if (plan.status === "reverted") throw new Error("This plan was reverted; run a new scan.");
    if (Date.now() - plan.created_at.getTime() > 7 * 86_400_000) {
      await this.db.query("UPDATE cleanup_plans SET status = 'expired' WHERE id = $1", [planId]);
      throw new Error("Plan is older than 7 days; run a new scan so it reflects the mailbox as it is now.");
    }
    const labelId = await mailbox.ensureLabel(plan.label_name);

    const archive = await this.db.query<{ message_id: string }>(
      "SELECT message_id FROM cleanup_items WHERE plan_id = $1 AND action = 'archive' AND applied_at IS NULL",
      [planId],
    );
    const ids = archive.rows.map((r) => r.message_id);
    for (let i = 0; i < ids.length; i += 1000) {
      const batch = ids.slice(i, i + 1000);
      await mailbox.batchModify(batch, [labelId], ["INBOX"]);
      await this.db.query("UPDATE cleanup_items SET applied_action = 'archive', applied_at = now() WHERE plan_id = $1 AND message_id = ANY($2)", [planId, batch]);
    }

    let trashed = 0;
    if (includeTrash) {
      const t = await this.db.query<{ message_id: string }>(
        "SELECT message_id FROM cleanup_items WHERE plan_id = $1 AND action = 'trash' AND applied_at IS NULL",
        [planId],
      );
      for (const r of t.rows) {
        // Label first so trashed mail is still traceable to this plan.
        await mailbox.batchModify([r.message_id], [labelId], []);
        await mailbox.trash(r.message_id);
        await this.db.query("UPDATE cleanup_items SET applied_action = 'trash', applied_at = now() WHERE plan_id = $1 AND message_id = $2", [planId, r.message_id]);
        trashed++;
      }
    }
    await this.db.query("UPDATE cleanup_plans SET status = 'applied', applied_at = coalesce(applied_at, now()) WHERE id = $1", [planId]);
    await this.store.audit("agent", "gmail_cleanup.applied", null, { planId, archived: ids.length, trashed, label: plan.label_name });
    const report = await this.report(planId);
    return { archived: ids.length, trashed, report };
  }

  /** Undo everything a plan applied: back to Inbox, out of Trash, label removed. */
  async revert(mailbox: Mailbox, planId: string): Promise<{ restored: number }> {
    const plan = await this.getPlan(planId);
    if (!plan) throw new Error("Plan not found.");
    const labelId = await mailbox.ensureLabel(plan.label_name);
    const rows = await this.db.query<{ message_id: string; applied_action: string }>(
      "SELECT message_id, applied_action FROM cleanup_items WHERE plan_id = $1 AND applied_at IS NOT NULL AND reverted_at IS NULL",
      [planId],
    );
    for (const r of rows.rows.filter((x) => x.applied_action === "trash")) await mailbox.untrash(r.message_id);
    const ids = rows.rows.map((r) => r.message_id);
    for (let i = 0; i < ids.length; i += 1000) await mailbox.batchModify(ids.slice(i, i + 1000), ["INBOX"], [labelId]);
    await this.db.query("UPDATE cleanup_items SET reverted_at = now() WHERE plan_id = $1 AND applied_at IS NOT NULL AND reverted_at IS NULL", [planId]);
    await this.db.query("UPDATE cleanup_plans SET status = 'reverted', reverted_at = now() WHERE id = $1", [planId]);
    await this.store.audit("owner", "gmail_cleanup.reverted", null, { planId, restored: ids.length });
    return { restored: ids.length };
  }

  /**
   * RFC 8058 one-click unsubscribe: a single POST with body
   * "List-Unsubscribe=One-Click" to the sender's https endpoint. Other methods
   * are returned to the owner as instructions, never actioned automatically.
   */
  async unsubscribe(
    candidateId: string,
    fetchImpl: typeof fetch = fetch,
    resolve?: (host: string) => Promise<string[]>,
    expectedSender?: string,
  ): Promise<string> {
    const r = await this.db.query<{ id: string; sender: string; method: string; url: string | null; mailto: string | null; status: string }>(
      "SELECT id, sender, method, url, mailto, status FROM unsubscribe_candidates WHERE id = $1",
      [candidateId],
    );
    const c = r.rows[0];
    if (!c) throw new Error("Unsubscribe candidate not found.");
    if (expectedSender !== undefined && expectedSender.toLowerCase() !== c.sender.toLowerCase()) {
      throw new Error(`Sender mismatch: approval was for ${expectedSender}, candidate is ${c.sender}. Nothing was sent.`);
    }
    if (c.status === "unsubscribed") return `Already unsubscribed from ${c.sender}.`;
    if (c.method !== "one_click" || !c.url) {
      await this.db.query("UPDATE unsubscribe_candidates SET status = 'manual' WHERE id = $1", [c.id]);
      return c.method === "link"
        ? `${c.sender} doesn't support one-click unsubscribe. Open this link yourself to unsubscribe: ${c.url}`
        : `${c.sender} only accepts unsubscribe requests by email (${c.mailto}). I can draft that email for you to send.`;
    }
    try {
      // The URL comes from an email header (sender-controlled): only public https hosts.
      await assertPublicHttpsUrl(c.url, resolve);
    } catch (err) {
      await this.db.query("UPDATE unsubscribe_candidates SET status = 'failed', result = $2 WHERE id = $1", [c.id, (err as Error).message]);
      return `Refused to call ${c.sender}'s unsubscribe URL: ${(err as Error).message}.`;
    }
    try {
      const res = await fetchImpl(c.url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "List-Unsubscribe=One-Click",
        redirect: "manual",
        signal: AbortSignal.timeout(20_000),
      });
      const ok = res.status >= 200 && res.status < 400;
      await this.db.query("UPDATE unsubscribe_candidates SET status = $2, result = $3 WHERE id = $1", [c.id, ok ? "unsubscribed" : "failed", `HTTP ${res.status}`]);
      await this.store.audit("agent", ok ? "gmail_cleanup.unsubscribed" : "gmail_cleanup.unsubscribe_failed", null, { sender: c.sender, status: res.status });
      return ok ? `Unsubscribed from ${c.sender} (HTTP ${res.status}). It can take a few days for mail to stop.` : `Unsubscribe request to ${c.sender} failed (HTTP ${res.status}).`;
    } catch (err) {
      await this.db.query("UPDATE unsubscribe_candidates SET status = 'failed', result = $2 WHERE id = $1", [c.id, (err as Error).name]);
      return `Unsubscribe request to ${c.sender} failed (${(err as Error).name}).`;
    }
  }
}

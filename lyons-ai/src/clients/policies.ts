import type { Db } from "../db/pool.js";
import type { Store } from "../db/store.js";
import { normalizeEmail, normalizePhone } from "./identity.js";

/**
 * Narrowly scoped automation policies. A policy lets one channel send to an
 * explicit list of recipients, optionally only with a subject prefix, under a
 * daily cap, without per-message approval. Policies are created "proposed" and
 * only the owner can activate them (Telegram /policy_activate or the Control
 * Center); there is intentionally no tool that lets the model activate one.
 */
export interface PolicyRules {
  recipients: string[];
  maxPerDay: number;
  subjectPrefix?: string;
  /** Local hours [start, end) when automatic sends are allowed. */
  allowedHours?: [number, number];
}

export function normalizeRecipient(v: string): string {
  return normalizeEmail(v) ?? normalizePhone(v) ?? v.trim().toLowerCase();
}

export function validateRules(r: PolicyRules): string | null {
  if (!r.recipients.length) return "A policy must list specific recipients.";
  if (r.recipients.length > 25) return "At most 25 recipients per policy.";
  if (r.recipients.some((x) => x.includes("*"))) return "Wildcards are not allowed.";
  if (!(r.maxPerDay >= 1 && r.maxPerDay <= 20)) return "maxPerDay must be 1–20.";
  return null;
}

export class AutomationPolicies {
  constructor(
    private readonly db: Db,
    private readonly store: Store,
    private readonly timezone: string,
  ) {}

  async propose(p: { name: string; channel: string; description: string; rules: PolicyRules }, actor: string): Promise<{ id: string } | { error: string }> {
    const err = validateRules(p.rules);
    if (err) return { error: err };
    const rules = { ...p.rules, recipients: p.rules.recipients.map(normalizeRecipient) };
    const r = await this.db.query<{ id: string }>(
      "INSERT INTO automation_policies (name, channel, description, rules) VALUES ($1, $2, $3, $4) RETURNING id",
      [p.name, p.channel, p.description, JSON.stringify(rules)],
    );
    await this.store.audit(actor, "policy.proposed", null, { policyId: r.rows[0]!.id, name: p.name, channel: p.channel, rules });
    return { id: r.rows[0]!.id };
  }

  async setStatus(id: string, status: "active" | "revoked", actor: string): Promise<boolean> {
    const r = await this.db.query(
      `UPDATE automation_policies SET status = $2, approved_by = CASE WHEN $2 = 'active' THEN $3 ELSE approved_by END,
         approved_at = CASE WHEN $2 = 'active' THEN now() ELSE approved_at END
       WHERE id = $1 AND status <> 'revoked'`,
      [id, status, actor],
    );
    if ((r.rowCount ?? 0) > 0) await this.store.audit(actor, `policy.${status}`, null, { policyId: id });
    return (r.rowCount ?? 0) > 0;
  }

  async list() {
    const r = await this.db.query<{ id: string; name: string; channel: string; description: string; rules: PolicyRules; status: string; approved_at: Date | null }>(
      "SELECT id, name, channel, description, rules, status, approved_at FROM automation_policies WHERE status <> 'revoked' ORDER BY created_at DESC",
    );
    return r.rows;
  }

  async findByPrefix(prefix: string) {
    if (!/^[0-9a-f-]{4,36}$/i.test(prefix)) return null;
    const r = await this.db.query<{ id: string; name: string; status: string }>("SELECT id, name, status FROM automation_policies WHERE id::text LIKE $1 LIMIT 2", [
      `${prefix.toLowerCase()}%`,
    ]);
    return r.rows.length === 1 ? r.rows[0]! : null;
  }

  /** Returns the id of an ACTIVE policy that covers this exact send, or null (→ needs approval). */
  async covers(channel: string, to: string, subject: string | undefined, now = new Date()): Promise<string | null> {
    const recipient = normalizeRecipient(to);
    const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: this.timezone, hour: "2-digit", hourCycle: "h23" }).format(now));
    const r = await this.db.query<{ id: string; rules: PolicyRules }>("SELECT id, rules FROM automation_policies WHERE status = 'active' AND channel = $1", [channel]);
    for (const p of r.rows) {
      if (!p.rules.recipients.includes(recipient)) continue;
      if (p.rules.subjectPrefix && !(subject ?? "").startsWith(p.rules.subjectPrefix)) continue;
      if (p.rules.allowedHours && !(hour >= p.rules.allowedHours[0] && hour < p.rules.allowedHours[1])) continue;
      const sent = await this.db.query<{ n: string }>(
        `SELECT count(*) n FROM outbound_messages WHERE policy_id = $1 AND status IN ('queued','sent','replied')
           AND created_at >= (date_trunc('day', now() AT TIME ZONE $2) AT TIME ZONE $2)`,
        [p.id, this.timezone],
      );
      if (Number(sent.rows[0]!.n) >= p.rules.maxPerDay) continue;
      return p.id;
    }
    return null;
  }
}

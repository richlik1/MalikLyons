import type { Db } from "../db/pool.js";
import type { Store } from "../db/store.js";
import type { Scope } from "../core/types.js";
import {
  AUTO_LINK_THRESHOLD,
  isFreeMailDomain,
  looksLikeRequest,
  matchObservation,
  normalizeEmail,
  normalizePhone,
  type KnownClient,
  type KnownIdentity,
  type Observation,
} from "./identity.js";

export interface ClientRow {
  id: string;
  name: string;
  company: string | null;
  scope: Scope;
  status: string;
  notes: string | null;
}

export interface TimelineEvent {
  at: Date;
  kind: string;
  direction: "in" | "out" | null;
  channel: string | null;
  summary: string;
  requires_response: boolean;
  responded_at: Date | null;
  due_at: Date | null;
}

export interface NewEvent {
  at: Date;
  kind: "email" | "meeting" | "proposal" | "invoice" | "stayops_job" | "note" | "message" | "call";
  direction?: "in" | "out";
  channel?: string;
  source: string;
  externalId?: string;
  summary: string;
  requiresResponse?: boolean;
  dueAt?: Date;
  details?: Record<string, unknown>;
}

export class ClientService {
  constructor(
    private readonly db: Db,
    private readonly store: Store,
  ) {}

  async upsertClient(c: { name: string; company?: string; scope?: Scope; status?: string; notes?: string; emails?: string[]; phones?: string[]; domains?: string[] }, actor = "owner") {
    const existing = await this.db.query<ClientRow>("SELECT * FROM clients WHERE lower(name) = lower($1) LIMIT 1", [c.name.trim()]);
    let client: ClientRow;
    if (existing.rows[0]) {
      const r = await this.db.query<ClientRow>(
        `UPDATE clients SET company = coalesce($2, company), status = coalesce($3, status), notes = coalesce($4, notes), updated_at = now() WHERE id = $1 RETURNING *`,
        [existing.rows[0].id, c.company ?? null, c.status ?? null, c.notes ?? null],
      );
      client = r.rows[0]!;
    } else {
      const r = await this.db.query<ClientRow>("INSERT INTO clients (name, company, scope, status, notes) VALUES ($1, $2, $3, $4, $5) RETURNING *", [
        c.name.trim(),
        c.company ?? null,
        c.scope ?? "business",
        c.status ?? "active",
        c.notes ?? null,
      ]);
      client = r.rows[0]!;
    }
    const conflicts: string[] = [];
    const add = async (kind: string, value: string | null) => {
      if (!value) return;
      const r = await this.db.query<{ client_id: string }>(
        `INSERT INTO client_identities (client_id, kind, value, source, confidence, verified_by_owner)
         VALUES ($1, $2, $3, $4, 1, $5) ON CONFLICT (kind, value) DO UPDATE SET kind = EXCLUDED.kind RETURNING client_id`,
        [client.id, kind, value, actor, actor === "owner"],
      );
      if (r.rows[0]!.client_id !== client.id) conflicts.push(`${value} already belongs to another client`);
    };
    for (const e of c.emails ?? []) await add("email", normalizeEmail(e));
    for (const p of c.phones ?? []) await add("phone", normalizePhone(p));
    for (const d of c.domains ?? []) if (!isFreeMailDomain(d)) await add("domain", d.toLowerCase());
    await this.store.audit(actor, "client.upserted", null, { clientId: client.id, name: client.name, conflicts });
    return { client, conflicts };
  }

  async find(query: string): Promise<ClientRow[]> {
    const email = normalizeEmail(query);
    const phone = normalizePhone(query);
    const r = await this.db.query<ClientRow>(
      `SELECT DISTINCT c.* FROM clients c LEFT JOIN client_identities i ON i.client_id = c.id
       WHERE c.name ILIKE '%' || $1 || '%' OR c.company ILIKE '%' || $1 || '%' OR i.value = $2 OR i.value = $3
       ORDER BY c.name LIMIT 10`,
      [query, email, phone],
    );
    return r.rows;
  }

  private async knowledge(): Promise<{ identities: KnownIdentity[]; clients: KnownClient[] }> {
    const [i, c] = await Promise.all([
      this.db.query<{ client_id: string; kind: string; value: string }>("SELECT client_id, kind, value FROM client_identities"),
      this.db.query<KnownClient>("SELECT id, name, company FROM clients"),
    ]);
    return { identities: i.rows.map((r) => ({ clientId: r.client_id, kind: r.kind, value: r.value })), clients: c.rows };
  }

  /**
   * Resolve an observed sender to a client. High-confidence matches link; anything
   * else is recorded as a suggestion and returns null (so nothing is misfiled).
   */
  async resolve(o: Observation): Promise<{ clientId: string | null; confidence: number; reason: string }> {
    const k = await this.knowledge();
    const m = matchObservation(o, k.identities, k.clients);
    if (m.clientId && m.confidence >= AUTO_LINK_THRESHOLD && !m.conflict) return m;
    for (const s of m.suggestions) {
      const kind = o.email ? "email" : "phone";
      const value = o.email ? normalizeEmail(o.email) : o.phone ? normalizePhone(o.phone) : null;
      if (!value) continue;
      await this.db.query(
        `INSERT INTO identity_suggestions (kind, value, display_name, source, candidate_client_id, confidence, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
        [kind, value, o.name ?? null, o.source, s.clientId, s.confidence, m.conflict ? `CONFLICT: ${s.reason}` : s.reason],
      );
    }
    return { clientId: null, confidence: m.confidence, reason: m.reason };
  }

  async pendingSuggestions() {
    const r = await this.db.query<{ id: string; kind: string; value: string; display_name: string | null; client_name: string; confidence: string; reason: string; source: string }>(
      `SELECT s.id, s.kind, s.value, s.display_name, c.name AS client_name, s.confidence, s.reason, s.source
       FROM identity_suggestions s JOIN clients c ON c.id = s.candidate_client_id WHERE s.status = 'pending' ORDER BY s.confidence DESC, s.created_at LIMIT 50`,
    );
    return r.rows;
  }

  async decideSuggestion(id: string, accept: boolean, actor = "owner"): Promise<string> {
    const r = await this.db.query<{ kind: string; value: string; candidate_client_id: string; status: string }>(
      "SELECT kind, value, candidate_client_id, status FROM identity_suggestions WHERE id = $1",
      [id],
    );
    const s = r.rows[0];
    if (!s) return "Suggestion not found.";
    if (s.status !== "pending") return `Already ${s.status}.`;
    if (accept) {
      const ins = await this.db.query<{ client_id: string }>(
        `INSERT INTO client_identities (client_id, kind, value, source, confidence, verified_by_owner)
         VALUES ($1, $2, $3, 'owner_confirmed', 1, true) ON CONFLICT (kind, value) DO NOTHING RETURNING client_id`,
        [s.candidate_client_id, s.kind, s.value],
      );
      if (!ins.rows.length) return `${s.value} is already linked to a client; not changed.`;
      // Other pending suggestions for the same identifier are now moot.
      await this.db.query("UPDATE identity_suggestions SET status = 'rejected' WHERE kind = $1 AND value = $2 AND status = 'pending' AND id <> $3", [s.kind, s.value, id]);
    }
    await this.db.query("UPDATE identity_suggestions SET status = $2 WHERE id = $1", [id, accept ? "accepted" : "rejected"]);
    await this.store.audit(actor, accept ? "client.identity_confirmed" : "client.identity_rejected", null, { suggestionId: id, value: s.value });
    return accept ? `Linked ${s.value}.` : `Rejected; ${s.value} won't be linked.`;
  }

  /** Record an event; outbound events mark earlier unanswered inbound requests as responded. */
  async recordEvent(clientId: string, e: NewEvent): Promise<boolean> {
    const r = await this.db.query(
      `INSERT INTO client_events (client_id, at, kind, direction, channel, source, external_id, summary, requires_response, due_at, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT (source, external_id) DO NOTHING`,
      [clientId, e.at, e.kind, e.direction ?? null, e.channel ?? null, e.source, e.externalId ?? null, e.summary.slice(0, 1000), Boolean(e.requiresResponse), e.dueAt ?? null, JSON.stringify(e.details ?? {})],
    );
    const inserted = (r.rowCount ?? 0) > 0;
    if (inserted && e.direction === "out") {
      await this.db.query(
        `UPDATE client_events SET responded_at = $2 WHERE client_id = $1 AND direction = 'in' AND requires_response AND responded_at IS NULL AND at <= $2`,
        [clientId, e.at],
      );
    }
    if (inserted && e.direction === "in") {
      // An inbound message after something we sent means the client replied.
      await this.db.query(
        "UPDATE outbound_messages SET status = 'replied', replied_at = $2 WHERE client_id = $1 AND status = 'sent' AND sent_at <= $2",
        [clientId, e.at],
      );
    }
    return inserted;
  }

  async timeline(clientId: string, limit = 30): Promise<TimelineEvent[]> {
    const r = await this.db.query<TimelineEvent>(
      `SELECT at, kind, direction, channel, summary, requires_response, responded_at, due_at FROM client_events
       WHERE client_id = $1 ORDER BY at DESC LIMIT $2`,
      [clientId, limit],
    );
    return r.rows;
  }

  /** Inbound requests with no reply after `afterHours`, oldest first. */
  async unanswered(afterHours: number, now = new Date()) {
    const r = await this.db.query<{ client_id: string; name: string; at: Date; summary: string; channel: string | null }>(
      `SELECT e.client_id, c.name, e.at, e.summary, e.channel FROM client_events e JOIN clients c ON c.id = e.client_id
       WHERE e.direction = 'in' AND e.requires_response AND e.responded_at IS NULL AND e.at < $1
       ORDER BY e.at ASC LIMIT 50`,
      [new Date(now.getTime() - afterHours * 3_600_000)],
    );
    return r.rows;
  }

  async upcoming(days: number, now = new Date()) {
    const r = await this.db.query<{ client_id: string; name: string; kind: string; summary: string; due_at: Date }>(
      `SELECT e.client_id, c.name, e.kind, e.summary, e.due_at FROM client_events e JOIN clients c ON c.id = e.client_id
       WHERE e.due_at BETWEEN $1 AND $2 ORDER BY e.due_at ASC LIMIT 50`,
      [now, new Date(now.getTime() + days * 86_400_000)],
    );
    return r.rows;
  }

  async recordOutbound(o: { clientId: string | null; channel: string; to: string; subject?: string; body: string; status: "draft" | "queued" | "sent"; externalId?: string; policyId?: string; taskId?: string }) {
    const r = await this.db.query<{ id: string }>(
      `INSERT INTO outbound_messages (client_id, channel, to_address, subject, body, status, external_id, policy_id, task_id, sent_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CASE WHEN $6 = 'sent' THEN now() END) RETURNING id`,
      [o.clientId, o.channel, o.to, o.subject ?? null, o.body.slice(0, 20_000), o.status, o.externalId ?? null, o.policyId ?? null, o.taskId ?? null],
    );
    return r.rows[0]!.id;
  }

  async markOutbound(id: string, status: "sent" | "failed" | "cancelled", result?: string, externalId?: string) {
    await this.db.query(
      `UPDATE outbound_messages SET status = $2, result = $3, external_id = coalesce($4, external_id), sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE sent_at END WHERE id = $1`,
      [id, status, result ?? null, externalId ?? null],
    );
  }

  async outboundHistory(clientId: string | null, limit = 20) {
    const r = await this.db.query<{ id: string; channel: string; to_address: string; subject: string | null; status: string; created_at: Date; sent_at: Date | null; replied_at: Date | null; policy_id: string | null }>(
      `SELECT id, channel, to_address, subject, status, created_at, sent_at, replied_at, policy_id FROM outbound_messages
       WHERE ($1::uuid IS NULL OR client_id = $1) ORDER BY created_at DESC LIMIT $2`,
      [clientId, limit],
    );
    return r.rows;
  }
}

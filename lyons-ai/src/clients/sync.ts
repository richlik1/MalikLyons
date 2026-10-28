import { people } from "@googleapis/people";
import type { OAuth2Client } from "google-auth-library";
import type { Store } from "../db/store.js";
import type { Scope } from "../core/types.js";
import { senderEmail, type MessageMeta } from "../gmail-cleanup/classify.js";
import type { Mailbox } from "../gmail-cleanup/mailbox.js";
import type { SimpleEvent } from "../integrations/google/calendar.js";
import { looksLikeRequest, normalizeEmail, normalizePhone } from "./identity.js";
import type { ClientService } from "./service.js";

export interface Contact {
  name?: string;
  emails: string[];
  phones: string[];
  resourceName: string;
}

export interface ContactsSource {
  list(max: number): Promise<Contact[]>;
}

export class GoogleContactsSource implements ContactsSource {
  constructor(private readonly auth: OAuth2Client) {}
  async list(max: number): Promise<Contact[]> {
    const api = people({ version: "v1", auth: this.auth });
    const out: Contact[] = [];
    let pageToken: string | undefined;
    while (out.length < max) {
      const r = await api.people.connections.list({
        resourceName: "people/me",
        personFields: "names,emailAddresses,phoneNumbers",
        pageSize: Math.min(1000, max - out.length),
        pageToken,
      });
      for (const p of r.data.connections ?? []) {
        out.push({
          resourceName: p.resourceName ?? "",
          name: p.names?.[0]?.displayName ?? undefined,
          emails: (p.emailAddresses ?? []).map((e) => e.value ?? "").filter(Boolean),
          phones: (p.phoneNumbers ?? []).map((e) => e.value ?? "").filter(Boolean),
        });
      }
      pageToken = r.data.nextPageToken ?? undefined;
      if (!pageToken) break;
    }
    return out;
  }
}

export interface SyncStats {
  scanned: number;
  linked: number;
  unmatched: number;
  newEvents: number;
  outboundMarkedSent: number;
}

function addresses(header: string | undefined): string[] {
  return (header ?? "").split(",").map((x) => senderEmail(x)).filter((x) => x.includes("@"));
}

/**
 * Pulls client communications into the timeline. Only mail involving a
 * recognised client is stored; everything else is left alone (not copied).
 */
export class ClientSync {
  constructor(
    private readonly clients: ClientService,
    private readonly store: Store,
  ) {}

  async syncMail(mailbox: Mailbox, scope: Scope, days = 14, max = 300): Promise<SyncStats> {
    const stats: SyncStats = { scanned: 0, linked: 0, unmatched: 0, newEvents: 0, outboundMarkedSent: 0 };
    const ids = await mailbox.listIds(`newer_than:${days}d -in:spam -in:trash -category:promotions -category:social`, max);
    for (const id of ids) {
      const m: MessageMeta = await mailbox.getMeta(id);
      stats.scanned++;
      const outbound = m.labelIds.includes("SENT");
      const at = new Date(m.internalDate ?? Date.now());
      const bulk = Boolean(m.listUnsubscribe || m.listId);
      const parties = outbound ? addresses(m.to) : [senderEmail(m.from)];
      let matched = false;
      for (const email of parties) {
        const res = await this.clients.resolve({ email, name: outbound ? undefined : m.from.replace(/<.*>/, "").trim(), source: `gmail:${scope}` });
        if (!res.clientId) continue;
        matched = true;
        const inserted = await this.clients.recordEvent(res.clientId, {
          at,
          kind: "email",
          direction: outbound ? "out" : "in",
          channel: "gmail",
          source: `gmail:${scope}`,
          externalId: `${id}:${email}`,
          summary: `${m.subject}${m.snippet ? ` — ${m.snippet}` : ""}`,
          requiresResponse: !outbound && looksLikeRequest(`${m.subject} ${m.snippet ?? ""}`, bulk),
          details: { messageId: id, threadId: m.threadId },
        });
        if (inserted) stats.newEvents++;
        if (outbound) {
          const r = await this.store.db.query(
            `UPDATE outbound_messages SET status = 'sent', sent_at = $3, external_id = coalesce(external_id, $4)
             WHERE channel = 'email' AND status IN ('draft','queued') AND lower(to_address) = lower($1) AND coalesce(subject, '') = $2`,
            [email, m.subject, at, id],
          );
          stats.outboundMarkedSent += r.rowCount ?? 0;
        }
      }
      if (matched) stats.linked++;
      else stats.unmatched++;
    }
    return stats;
  }

  async syncCalendar(events: SimpleEvent[], scope: Scope): Promise<{ linked: number; newEvents: number }> {
    let linked = 0;
    let newEvents = 0;
    for (const e of events) {
      for (const email of e.attendees ?? []) {
        const res = await this.clients.resolve({ email, source: `gcal:${scope}` });
        if (!res.clientId) continue;
        linked++;
        const start = new Date(e.start);
        if (
          await this.clients.recordEvent(res.clientId, {
            at: start,
            kind: "meeting",
            channel: "calendar",
            source: `gcal:${scope}`,
            externalId: `${e.id}:${normalizeEmail(email)}`,
            summary: e.summary,
            dueAt: start.getTime() > Date.now() ? start : undefined,
            details: { eventId: e.id, location: e.location ?? null },
          })
        ) {
          newEvents++;
        }
      }
    }
    return { linked, newEvents };
  }

  /**
   * Contacts only ENRICH known clients: a contact whose email exactly matches a
   * client adds that contact's phone numbers. Contacts are never turned into
   * clients automatically; a same-name-only match becomes a suggestion.
   */
  async syncContacts(source: ContactsSource, max = 2000): Promise<{ enriched: number; suggestions: number }> {
    let enriched = 0;
    let suggestions = 0;
    for (const c of await source.list(max)) {
      let clientId: string | null = null;
      for (const e of c.emails) {
        const r = await this.clients.resolve({ email: e, name: c.name, source: "google_contacts" });
        if (r.clientId) {
          clientId = r.clientId;
          break;
        }
        if (r.reason === "needs owner confirmation") suggestions++;
      }
      if (!clientId) continue;
      for (const p of c.phones) {
        const phone = normalizePhone(p);
        if (!phone) continue;
        const r = await this.store.db.query(
          `INSERT INTO client_identities (client_id, kind, value, source, confidence) VALUES ($1, 'phone', $2, 'google_contacts', 0.9)
           ON CONFLICT (kind, value) DO NOTHING`,
          [clientId, phone],
        );
        enriched += r.rowCount ?? 0;
      }
    }
    return { enriched, suggestions };
  }
}

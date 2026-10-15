import type { AutomationPolicies } from "../clients/policies.js";
import type { ClientService } from "../clients/service.js";
import { formatBytes } from "../device/storage.js";
import type { Store } from "../db/store.js";
import type { GmailCleanupService } from "../gmail-cleanup/service.js";
import { esc, type ControlSection } from "./control-center.js";

/** Control Center panels for communications, automations, cleanup, storage and calls. */
export function moduleSections(d: { store: Store; clients: ClientService; policies: AutomationPolicies; cleanup: GmailCleanupService; timezone: string }): ControlSection[] {
  const { store, clients, policies, cleanup, timezone } = d;
  const when = (x: Date) => esc(x.toLocaleString("en-US", { timeZone: timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }));
  return [
    {
      id: "communications",
      title: "Client communications",
      async render() {
        const [open, upcoming, sent, suggestions] = await Promise.all([clients.unanswered(24), clients.upcoming(7), clients.outboundHistory(null, 8), clients.pendingSuggestions()]);
        const openRows = open.slice(0, 8).map((o) => `<tr><td>${esc(o.name)}</td><td>${when(o.at)}</td><td>${esc(o.summary.slice(0, 120))}</td></tr>`).join("");
        const upRows = upcoming.slice(0, 6).map((u) => `<tr><td>${when(u.due_at)}</td><td>${esc(u.name)}</td><td>${esc(u.summary.slice(0, 100))}</td></tr>`).join("");
        const sentRows = sent.map((s) => `<tr><td>${esc(s.channel)}</td><td>${esc(s.to_address)}</td><td>${esc(s.subject ?? "")}</td><td>${esc(s.status)}${s.policy_id ? ' <span class="pill">policy</span>' : ""}</td></tr>`).join("");
        return `<p><b>${open.length}</b> unanswered client request(s) older than 24h · <b>${suggestions.length}</b> identity match(es) to confirm (/identities)</p>
          ${openRows ? `<table><tr><th>Client</th><th>Received</th><th>Request</th></tr>${openRows}</table>` : ""}
          ${upRows ? `<h2 style="margin-top:12px">Next 7 days</h2><table>${upRows}</table>` : ""}
          ${sentRows ? `<h2 style="margin-top:12px">Recently drafted / sent</h2><table><tr><th>Channel</th><th>To</th><th>Subject</th><th>Status</th></tr>${sentRows}</table>` : ""}`;
      },
    },
    {
      id: "policies",
      title: "Automation policies",
      async render() {
        const list = await policies.list();
        if (!list.length) return `<p class="muted">None. Every outgoing message needs your approval.</p>`;
        return `<table><tr><th>Policy</th><th>Scope</th><th>Status</th></tr>${list
          .map(
            (p) =>
              `<tr><td>${esc(p.name)}<br><span class="muted">${esc(p.description)}</span></td><td>${esc(p.channel)} → ${esc(p.rules.recipients.join(", "))}; max ${esc(p.rules.maxPerDay)}/day</td>
               <td class="${p.status === "active" ? "ok" : "warn"}">${esc(p.status)}<br><span class="muted">/policy_${p.status === "active" ? "revoke" : "activate"} ${esc(p.id.slice(0, 8))}</span></td></tr>`,
          )
          .join("")}</table>`;
      },
    },
    {
      id: "gmail-cleanup",
      title: "Gmail cleanup",
      async render() {
        const plans = await cleanup.recentPlans(5);
        if (!plans.length) return `<p class="muted">No scans yet. Ask: "scan my inbox for cleanup".</p>`;
        return `<table><tr><th>Plan</th><th>Account</th><th>Proposed</th><th>Status</th></tr>${plans
          .map(
            (p) =>
              `<tr><td>${esc(p.id.slice(0, 8))}<br><span class="muted">${when(p.created_at)}</span></td><td>${esc(p.scope)}</td>
               <td>archive ${esc(p.summary.byAction.archive)} · trash ${esc(p.summary.byAction.trash)} · keep ${esc(p.summary.byAction.keep)}<br><span class="muted">${esc(p.summary.unsubscribeSuggestions)} unsubscribe suggestion(s)</span></td><td>${esc(p.status)}</td></tr>`,
          )
          .join("")}</table>`;
      },
    },
    {
      id: "storage",
      title: "Storage recommendations",
      async render() {
        const r = await store.db.query<{ id: string; device: string; created_at: Date; summary: any; groups: { hash: string; size: number; paths: string[] }[] }>(
          "SELECT * FROM storage_reports ORDER BY created_at DESC LIMIT 1",
        );
        const rep = r.rows[0];
        if (!rep) return `<p class="muted">No scan from your Mac yet.</p>`;
        const top = rep.groups.slice(0, 5).map((g) => `<tr><td>${esc(g.paths[0])}</td><td>${esc(g.paths.length)} copies</td><td>${esc(formatBytes(g.size * (g.paths.length - 1)))}</td></tr>`).join("");
        return `<p>${esc(rep.device)} · ${when(rep.created_at)} · <b>${esc(formatBytes(rep.summary.reclaimable_bytes))}</b> reclaimable in ${esc(rep.summary.duplicate_groups)} duplicate group(s)</p>
          ${top ? `<table><tr><th>Kept copy</th><th>Copies</th><th>Wasted</th></tr>${top}</table>` : ""}<p class="muted">Moving duplicates to Trash needs your approval per group.</p>`;
      },
    },
    {
      id: "calls",
      title: "Receptionist calls",
      async render() {
        const r = await store.db.query<{ call_sid: string; from_number: string | null; started_at: Date; status: string; intent: string | null; escalated: boolean; guard_events: string[] }>(
          "SELECT call_sid, from_number, started_at, status, intent, escalated, guard_events FROM calls ORDER BY started_at DESC LIMIT 8",
        );
        if (!r.rows.length) return `<p class="muted">No calls yet.</p>`;
        return `<table><tr><th>When</th><th>From</th><th>Outcome</th></tr>${r.rows
          .map(
            (c) =>
              `<tr><td>${when(c.started_at)}</td><td>${esc(c.from_number ?? "unknown")}</td><td>${esc(c.status)}${c.escalated ? ' <span class="pill bad">escalated</span>' : ""} ${esc(c.intent ?? "")}${c.guard_events.length ? ` <span class="pill warn">${esc(c.guard_events.length)} filtered</span>` : ""}</td></tr>`,
          )
          .join("")}</table>`;
      },
    },
  ];
}

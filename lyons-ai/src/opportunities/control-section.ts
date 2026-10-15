import type { ControlSection } from "../http/control-center.js";
import { esc } from "../http/control-center.js";
import type { SourceRegistry } from "./registry.js";
import type { OpportunityStore } from "./store.js";

export function opportunitySections(opps: OpportunityStore, timezone: string, registry?: SourceRegistry): ControlSection[] {
  return [
    {
      id: "opportunities",
      title: "Opportunity pipeline",
      async render() {
        const counts = await opps.pipelineCounts();
        const top = await opps.search({ status: ["qualified", "approved", "in_progress"], limit: 8 });
        const rows = top
          .map(
            (o) =>
              `<tr><td>${o.url.startsWith("https://") ? `<a href="${esc(o.url)}" rel="noopener noreferrer" target="_blank">${esc(o.title)}</a>` : esc(o.title)}<br><span class="muted">${esc(o.organization ?? "")}</span></td>
               <td>${esc(Math.round(Number(o.score ?? 0)))}<br><span class="muted">${esc(o.priority_band ?? "")}</span></td><td>${esc(o.status)}${o.opportunity_type === "forecast" ? ' <span class="pill warn">projected</span>' : ""}${o.funding_type === "loan" ? ' <span class="pill warn">loan</span>' : ""}</td>
               <td>${o.deadline_at ? esc(o.deadline_at.toLocaleDateString("en-US", { timeZone: timezone })) : "—"}${o.deadline_confirmed ? "" : ' <span class="warn">?</span>'}</td></tr>`,
          )
          .join("");
        return `<p class="muted">${Object.entries(counts).map(([k, v]) => `${esc(k)} ${esc(v)}`).join(" · ") || "Empty — first discovery run pending."}</p>
          ${rows ? `<table><tr><th>Opportunity</th><th>Score</th><th>Status</th><th>Deadline</th></tr>${rows}</table>` : ""}`;
      },
    },
    {
      id: "sources",
      title: "Research sources & cost",
      async render() {
        if (!registry) return `<p class="muted">Registry unavailable.</p>`;
        const [list, costs] = await Promise.all([registry.list(), opps.costSummary(7, timezone)]);
        const total = costs.reduce((a, c) => a + c.llmUsd, 0);
        const reqs = costs.reduce((a, c) => a + c.requests, 0);
        return `<p>Last 7 days: <b>$${esc(total.toFixed(2))}</b> model spend · <b>${esc(reqs)}</b> API requests</p><table><tr><th>Source</th><th>Dept</th><th>Health</th></tr>${list
          .map(
            (s) =>
              `<tr><td>${esc(s.name)}</td><td>${esc(s.department)}</td><td class="${!s.enabled ? "warn" : s.consecutive_failures ? "bad" : "ok"}">${!s.enabled ? "disabled" : s.consecutive_failures ? `${esc(s.consecutive_failures)} failure(s)` : s.last_success_at ? "ok" : "not run yet"}${s.last_error ? `<br><span class="muted">${esc(s.last_error.slice(0, 90))}</span>` : ""}</td></tr>`,
          )
          .join("")}</table>`;
      },
    },
    {
      id: "automations",
      title: "Background automations",
      async render() {
        const runs = (await opps.recentRuns(10)) as { job: string; slot: string; status: string; attempt: number; error: string | null; started_at: Date }[];
        if (!runs.length) return `<p class="muted">No background runs yet.</p>`;
        return `<table><tr><th>Job</th><th>When (UTC)</th><th>Result</th></tr>${runs
          .map(
            (r) =>
              `<tr><td>${esc(r.job)}</td><td>${esc(r.started_at.toISOString().slice(5, 16).replace("T", " "))}</td>
               <td class="${r.status === "failed" || r.status === "dead_letter" ? "bad" : r.status === "succeeded" ? "ok" : ""}">${esc(r.status)}${r.attempt > 1 ? ` (attempt ${esc(r.attempt)})` : ""}${r.error ? ` — ${esc(r.error.slice(0, 80))}` : ""}</td></tr>`,
          )
          .join("")}</table>`;
      },
    },
  ];
}

import type { ControlSection } from "../http/control-center.js";
import { esc } from "../http/control-center.js";
import type { OpportunityStore } from "./store.js";

export function opportunitySections(opps: OpportunityStore, timezone: string): ControlSection[] {
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
               <td>${esc(Math.round(Number(o.score ?? 0)))}</td><td>${esc(o.status)}</td>
               <td>${o.deadline_at ? esc(o.deadline_at.toLocaleDateString("en-US", { timeZone: timezone })) : "—"}${o.deadline_confirmed ? "" : ' <span class="warn">?</span>'}</td></tr>`,
          )
          .join("");
        return `<p class="muted">${Object.entries(counts).map(([k, v]) => `${esc(k)} ${esc(v)}`).join(" · ") || "Empty — first discovery run pending."}</p>
          ${rows ? `<table><tr><th>Opportunity</th><th>Score</th><th>Status</th><th>Deadline</th></tr>${rows}</table>` : ""}`;
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
               <td class="${r.status === "failed" ? "bad" : r.status === "succeeded" ? "ok" : ""}">${esc(r.status)}${r.attempt > 1 ? ` (attempt ${esc(r.attempt)})` : ""}${r.error ? ` — ${esc(r.error.slice(0, 80))}` : ""}</td></tr>`,
          )
          .join("")}</table>`;
      },
    },
  ];
}

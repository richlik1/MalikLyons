import { daysUntil, type EligibilityResult } from "./assess.js";
import type { OpportunityRow } from "./store.js";
import type { Candidate, OwnerProfile, ScoreBreakdown } from "./types.js";

const CATEGORY_LABEL: Record<string, string> = {
  contracts: "Contract",
  grants_financing: "Grant/financing",
  real_estate: "Real estate",
  business_ideas: "Business idea",
  development: "Development",
  personal: "Personal",
  operations: "Operations",
  technology: "AI & technology",
};

const SOURCE_LABEL: Record<string, string> = {
  grants_gov: "Grants.gov",
  sam_gov: "SAM.gov",
  web_research: "Web (page verified)",
  github: "GitHub API",
  email_alerts: "Official email alert",
};

const BAND_LABEL: Record<string, string> = { high: "HIGH PRIORITY", investigate: "Investigate", watchlist: "Watchlist", archive: "Archived" };

/** Plain-language tags that must never be omitted (projected vs open; loans vs grants). */
export function typeTags(o: { opportunity_type?: string; funding_type?: string }): string[] {
  const tags: string[] = [];
  if (o.opportunity_type === "forecast") tags.push("PROJECTED — not yet open");
  if (o.funding_type === "loan") tags.push("LOAN — must be repaid");
  if (o.funding_type === "reimbursement") tags.push("REIMBURSEMENT — you pay first");
  if (o.funding_type === "paid_program") tags.push("PAID PROGRAM — costs money");
  if (o.funding_type === "tax_incentive") tags.push("TAX INCENTIVE");
  return tags;
}

/** Deterministic narrative built only from verified facts and our scoring. */
export function buildNarrative(c: Candidate, elig: EligibilityResult, score: ScoreBreakdown, p: OwnerProfile) {
  const risks: string[] = [];
  const docs: string[] = [];
  let effort: string;
  let investment: string;
  let nextAction: string;

  if (c.category === "contracts") {
    effort = "Bid preparation ≈ 4–10 hours; a site visit may be required.";
    investment = "Bid preparation time only; insurance/bonding if required by the solicitation.";
    docs.push("SAM.gov registration (UEI)", "Capability statement", "Price proposal / bid sheet", "Past-performance references", "Certificate of general liability insurance");
    risks.push("Federal bids are competitive; price and past performance usually decide");
    nextAction = `Open the notice (${c.url}), download the solicitation/statement of work, and confirm the site-visit date and how to submit.`;
  } else if (c.category === "grants_financing") {
    effort = "Application ≈ 6–20 hours depending on the narrative and budget requirements.";
    investment = c.costSharing ? "Cost sharing / matching funds required — check the amount in the notice." : "No cost sharing stated by the source.";
    docs.push("SAM.gov UEI and Grants.gov account", "SF-424 application forms", "Project narrative", "Budget and budget justification");
    risks.push("Award amounts are a ceiling, not a guarantee");
    nextAction = `Read the eligibility section of the notice (${c.url}). If it fits, tap Pursue and I'll prepare an application checklist and draft.`;
  } else if (c.category === "technology" || c.category === "operations") {
    effort = "Evaluation ≈ 1–2 hours (read docs, try in a sandbox).";
    investment = c.signals?.license ? `Free and open source (${c.signals.license}).` : "Free to view; license unclear — don't reuse code until confirmed.";
    nextAction = `Review the README and license at ${c.url}; if useful, ask me to draft an evaluation of how it could help LYONS AI or StayOps (no code is installed without your approval).`;
  } else {
    effort = "Unknown — depends on the program; check the page.";
    investment = "Not stated by the source.";
    nextAction = `Review the official page (${c.url}) and decide whether to pursue.`;
  }

  if (elig.prerequisites.some((x) => x.startsWith("Register in SAM.gov"))) {
    nextAction = `First: start your SAM.gov registration (free, sam.gov) — it's required to apply and can take 7–10 business days. Then: ${nextAction}`;
  }
  if (c.costSharing) risks.push("Requires matching funds");
  if (!c.deadlineConfirmed && c.deadlineAt) risks.push("Deadline not confirmed on an authoritative source");
  if (!c.deadlineAt) risks.push("No deadline published; may close without notice");
  if (elig.eligibility === "unclear") risks.push("Eligibility unclear — needs your confirmation");
  if (c.amountMax === undefined && c.amountMin === undefined) risks.push("Dollar value not stated");

  const fitBits = [`${CATEGORY_LABEL[c.category]} matching your goals (${p.goals[0]})`, ...score.notes.filter((n) => !n.startsWith("Dollar value"))];
  return {
    whyFit: fitBits.join("; "),
    effort,
    investment,
    nextAction,
    risks,
    documents: docs.length ? docs.map((d) => `${d} (typical — confirm in the notice)`) : [],
  };
}

function money(n: string | number | null | undefined): string | null {
  if (n === null || n === undefined) return null;
  const v = Number(n);
  return Number.isFinite(v) ? `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : null;
}

export function upsideText(o: OpportunityRow): string {
  const lo = money(o.amount_min);
  const hi = money(o.amount_max);
  if (lo && hi && lo !== hi) return `${lo}–${hi} (confirmed by source)`;
  if (hi) return `Up to ${hi} (confirmed by source)`;
  if (lo) return `From ${lo} (confirmed by source)`;
  if (o.estimated_value) return `≈ ${money(o.estimated_value)} (ESTIMATE: ${o.estimate_basis ?? "basis not recorded"})`;
  return "Not stated by the source";
}

export function deadlineText(o: OpportunityRow, timezone: string, now = new Date()): string {
  if (!o.deadline_at) return "No deadline published";
  const d = o.deadline_at.toLocaleDateString("en-US", { timeZone: timezone, weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const days = daysUntil(o.deadline_at, now);
  return `${d} (${days} days)${o.deadline_confirmed ? "" : " — UNCONFIRMED"}`;
}

/** Full recommendation card: every field the owner asked for. */
export function formatOpportunity(o: OpportunityRow, timezone: string, now = new Date()): string {
  const v = o.verification;
  const lines = [
    `${o.title}`,
    `${CATEGORY_LABEL[o.category] ?? o.category} · ${SOURCE_LABEL[o.source] ?? o.source}${o.organization ? ` · ${o.organization}` : ""}`,
    `Score ${Math.round(Number(o.score ?? 0))}/100${o.priority_band ? ` (${BAND_LABEL[o.priority_band]})` : ""} · Confidence ${o.confidence ?? "?"} · Verified ${o.last_verified_at ? o.last_verified_at.toISOString().slice(0, 10) : "never"}`,
    ...(typeTags(o).length ? [`⚠️ ${typeTags(o).join(" · ")}`] : []),
    "",
    `Why it fits: ${o.why_fit ?? "—"}`,
    `Upside: ${upsideText(o)}`,
    `Investment: ${o.required_investment ?? "—"}`,
    `Effort: ${o.effort ?? "—"}`,
    `Deadline: ${deadlineText(o, timezone, now)}`,
    `Eligibility: ${(o.eligibility ?? "unclear").toUpperCase()} — ${o.eligibility_notes ?? ""}`.slice(0, 600),
  ];
  if (o.prerequisites.length) lines.push(`Prerequisites: ${o.prerequisites.join("; ")}`);
  if (o.risks.length) lines.push(`Risks: ${o.risks.join("; ")}`);
  if (o.required_documents.length) lines.push(`Documents: ${o.required_documents.join("; ")}`);
  lines.push(`Next action: ${o.next_action ?? "—"}`);
  lines.push(`Source: ${o.url}`);
  if (v) lines.push(`Verification: ${v.method} — ${v.checks.map((c) => `${c.passed ? "✓" : "✗"} ${c.name}`).join(", ")}`);
  lines.push(`(id ${o.id.slice(0, 8)})`);
  return lines.join("\n");
}

export function formatDailyBriefing(items: OpportunityRow[], timezone: string, counts: Record<string, number>, now = new Date()): string {
  const header = `🔎 Opportunity briefing — ${now.toLocaleDateString("en-US", { timeZone: timezone, weekday: "long", month: "short", day: "numeric" })}`;
  const pipeline = `Pipeline: ${counts.qualified ?? 0} qualified · ${counts.approved ?? 0} approved · ${counts.in_progress ?? 0} in progress · ${counts.rejected ?? 0} filtered out`;
  const body = items.map((o, i) => `${i + 1}. ${formatOpportunity(o, timezone, now)}`).join("\n\n");
  return `${header}\n${pipeline}\n\n${body}`;
}

export function formatWeekly(items: OpportunityRow[], timezone: string, counts: Record<string, number>, now = new Date()): string {
  const lines = [
    `📈 Weekly top ${items.length} opportunities`,
    `Pipeline: ${Object.entries(counts)
      .map(([k, v]) => `${k} ${v}`)
      .join(" · ")}`,
    "",
  ];
  items.forEach((o, i) => {
    lines.push(`${i + 1}. ${o.title} [${o.status}] — score ${Math.round(Number(o.score ?? 0))}, ${deadlineText(o, timezone, now)}`);
    lines.push(`   Next: ${o.next_action ?? "—"}`);
    lines.push(`   ${o.url} (id ${o.id.slice(0, 8)})`);
  });
  return lines.join("\n");
}

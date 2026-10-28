import { createHash } from "node:crypto";
import type { Db } from "../db/pool.js";
import { normalizeTitle } from "./sources/http.js";
import { departmentForCategory, type Candidate, type Confidence, type Eligibility, type OpportunityCategory, type OpportunityStatus, type ScoreBreakdown, type VerificationResult } from "./types.js";

export interface OpportunityRow {
  id: string;
  source: string;
  source_id: string;
  category: OpportunityCategory;
  title: string;
  organization: string | null;
  url: string;
  summary: string | null;
  location: string | null;
  amount_min: string | null;
  amount_max: string | null;
  estimated_value: string | null;
  estimate_basis: string | null;
  deadline_at: Date | null;
  deadline_confirmed: boolean;
  eligibility: Eligibility | null;
  eligibility_notes: string | null;
  prerequisites: string[];
  required_documents: string[];
  required_investment: string | null;
  effort: string | null;
  risks: string[];
  next_action: string | null;
  why_fit: string | null;
  score: string | null;
  score_breakdown: ScoreBreakdown | null;
  confidence: Confidence | null;
  status: OpportunityStatus;
  rejection_reason: string | null;
  department: string | null;
  source_registry_id: string | null;
  opportunity_type: string;
  funding_type: string;
  priority_band: "high" | "investigate" | "watchlist" | "archive" | null;
  capital_required_usd: string | null;
  estimated_cost: string | null;
  assigned_owner: string;
  retrieved_at: Date | null;
  verification_status: "verified" | "unverified" | "failed";
  verification: (Omit<VerificationResult, "updates" | "checkedAt"> & { checkedAt: string }) | null;
  first_seen_at: Date;
  last_seen_at: Date;
  last_verified_at: Date | null;
  notified_at: Date | null;
}

export function fingerprint(c: Pick<Candidate, "title" | "organization">): string {
  return createHash("sha256")
    .update(`${normalizeTitle(c.title)}|${normalizeTitle(c.organization ?? "")}`)
    .digest("hex");
}

export interface NewOpportunity {
  candidate: Candidate;
  status: OpportunityStatus;
  rejectionReason?: string | null;
  eligibility: Eligibility;
  eligibilityNotes: string;
  prerequisites: string[];
  requiredDocuments: string[];
  requiredInvestment: string;
  effort: string;
  risks: string[];
  nextAction: string;
  whyFit: string;
  score: ScoreBreakdown;
  scoreExplanation?: string;
  confidence: Confidence;
  verification: VerificationResult;
}

export class OpportunityStore {
  constructor(readonly db: Db) {}

  async findExisting(source: string, sourceId: string, fp: string): Promise<OpportunityRow | null> {
    const r = await this.db.query<OpportunityRow>(
      "SELECT * FROM opportunities WHERE (source = $1 AND source_id = $2) OR fingerprint = $3 LIMIT 1",
      [source, sourceId, fp],
    );
    return r.rows[0] ?? null;
  }

  async touch(id: string): Promise<void> {
    await this.db.query("UPDATE opportunities SET last_seen_at = now() WHERE id = $1", [id]);
  }

  async insert(o: NewOpportunity): Promise<OpportunityRow> {
    const c = o.candidate;
    const { updates: _u, ...verification } = o.verification;
    const r = await this.db.query<OpportunityRow>(
      `INSERT INTO opportunities (source, source_id, fingerprint, category, title, organization, url, summary, location,
         amount_min, amount_max, posted_at, deadline_at, deadline_confirmed, eligibility, eligibility_notes, prerequisites,
         required_documents, required_investment, effort, risks, next_action, why_fit, score, score_breakdown, confidence,
         status, rejection_reason, verification, raw, last_verified_at,
         department, source_registry_id, opportunity_type, funding_type, priority_band, capital_required_usd, estimated_cost, retrieved_at, verification_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,
               $32,$33,$34,$35,$36,$37,$38,$39,$40)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [
        c.source,
        c.sourceId,
        fingerprint(c),
        c.category,
        c.title,
        c.organization ?? null,
        o.verification.authoritativeUrl || c.url,
        c.summary ?? null,
        c.location ?? null,
        c.amountMin ?? null,
        c.amountMax ?? null,
        c.postedAt ?? null,
        c.deadlineAt ?? null,
        Boolean(c.deadlineConfirmed),
        o.eligibility,
        o.eligibilityNotes,
        o.prerequisites,
        o.requiredDocuments,
        o.requiredInvestment,
        o.effort,
        o.risks,
        o.nextAction,
        o.whyFit,
        o.score.total,
        JSON.stringify(o.score),
        o.confidence,
        o.status,
        o.rejectionReason ?? null,
        JSON.stringify(verification),
        JSON.stringify(c.raw ?? null),
        o.verification.checkedAt,
        departmentForCategory(c.category),
        c.sourceRegistryId ?? c.source,
        c.opportunityType ?? "open_solicitation",
        c.fundingType ?? "unknown",
        o.rejectionReason ? null : o.score.band,
        c.capitalRequiredUsd ?? null,
        o.requiredInvestment,
        o.verification.checkedAt,
        o.verification.ok ? "verified" : "failed",
      ],
    );
    const row = r.rows[0];
    if (!row) throw new Error("duplicate opportunity");
    await this.event(row.id, "system", "discovered", { source: c.source, sourceId: c.sourceId });
    await this.history(row.id, "discovered", null, "discovered", "system", `${c.source}${c.sourceRegistryId ? ` (${c.sourceRegistryId})` : ""}`);
    await this.addEvidence(row.id, o.verification, c.postedAt ?? null);
    await this.history(row.id, o.verification.ok ? "verified" : "verification_failed", "discovered", null, "system", o.verification.method);
    if (!o.rejectionReason) {
      await this.addScore(row.id, o.score, o.scoreExplanation ?? "");
      await this.history(row.id, "scored", null, null, "system", `${o.score.total}/100 (${o.score.band})`);
    }
    await this.history(row.id, "saved", "discovered", o.status, "system", o.rejectionReason ?? null);
    await this.event(row.id, "system", o.status === "rejected" ? "rejected" : "verified", {
      method: o.verification.method,
      checks: o.verification.checks,
      reason: o.rejectionReason ?? undefined,
      score: o.score.total,
    });
    return row;
  }

  async event(id: string, actor: string, event: string, details: Record<string, unknown> = {}): Promise<void> {
    await this.db.query("INSERT INTO opportunity_events (opportunity_id, actor, event, details) VALUES ($1, $2, $3, $4)", [id, actor, event, details]);
  }

  async events(id: string) {
    const r = await this.db.query<{ at: Date; actor: string; event: string; details: any }>(
      "SELECT at, actor, event, details FROM opportunity_events WHERE opportunity_id = $1 ORDER BY id",
      [id],
    );
    return r.rows;
  }

  async get(id: string): Promise<OpportunityRow | null> {
    const r = await this.db.query<OpportunityRow>("SELECT * FROM opportunities WHERE id = $1", [id]);
    return r.rows[0] ?? null;
  }

  async findByPrefix(prefix: string): Promise<OpportunityRow | null> {
    if (!/^[0-9a-f-]{4,36}$/i.test(prefix)) return null;
    const r = await this.db.query<OpportunityRow>("SELECT * FROM opportunities WHERE id::text LIKE $1 LIMIT 2", [`${prefix.toLowerCase()}%`]);
    return r.rows.length === 1 ? r.rows[0]! : null;
  }

  async setStatus(id: string, status: OpportunityStatus, actor: string, details: Record<string, unknown> = {}): Promise<void> {
    const prev = await this.db.query<{ status: string }>("SELECT status FROM opportunities WHERE id = $1", [id]);
    await this.db.query("UPDATE opportunities SET status = $2, updated_at = now() WHERE id = $1", [id, status]);
    await this.event(id, actor, `status.${status}`, details);
    await this.history(id, "status", prev.rows[0]?.status ?? null, status, actor, typeof details.reason === "string" ? details.reason : null);
  }

  // ---- blueprint tables: evidence, scores, stage history, actions, feedback, costs ----
  async history(id: string, stage: string, from: string | null, to: string | null, actor: string, reason: string | null): Promise<void> {
    await this.db.query(
      "INSERT INTO opportunity_status_history (opportunity_id, stage, from_status, to_status, actor, reason) VALUES ($1, $2, $3, $4, $5, $6)",
      [id, stage, from, to, actor, reason],
    );
  }

  async stages(id: string) {
    const r = await this.db.query<{ at: Date; stage: string; from_status: string | null; to_status: string | null; actor: string; reason: string | null }>(
      "SELECT at, stage, from_status, to_status, actor, reason FROM opportunity_status_history WHERE opportunity_id = $1 ORDER BY id",
      [id],
    );
    return r.rows;
  }

  async addEvidence(id: string, v: VerificationResult, publishedAt: Date | null): Promise<void> {
    await this.db.query(
      "INSERT INTO opportunity_evidence (opportunity_id, url, method, published_at, retrieved_at, passed, checks) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [id, v.authoritativeUrl, v.method, publishedAt, v.checkedAt, v.ok, JSON.stringify(v.checks)],
    );
  }

  async addScore(id: string, s: ScoreBreakdown, explanation: string, modelVersion = "blueprint-v1"): Promise<void> {
    await this.db.query(
      "INSERT INTO opportunity_scores (opportunity_id, model_version, components, total, band, explanation) VALUES ($1, $2, $3, $4, $5, $6)",
      [id, modelVersion, JSON.stringify(s), s.total, s.band, explanation],
    );
  }

  async addAction(a: { opportunityId: string; kind: "checklist" | "outreach_draft" | "internal_task" | "stayops_task" | "reminder"; title: string; body: string; taskId?: string | null; status?: string; externalId?: string | null }): Promise<string | null> {
    const r = await this.db.query<{ id: string }>(
      `INSERT INTO opportunity_actions (opportunity_id, kind, title, body, task_id, status, external_id) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (opportunity_id, kind, title) DO NOTHING RETURNING id`,
      [a.opportunityId, a.kind, a.title, a.body, a.taskId ?? null, a.status ?? "prepared", a.externalId ?? null],
    );
    if (r.rows[0]) await this.history(a.opportunityId, "action_prepared", null, null, "system", `${a.kind}: ${a.title}`);
    return r.rows[0]?.id ?? null;
  }

  async setActionStatus(id: string, status: string, externalId?: string | null): Promise<void> {
    await this.db.query("UPDATE opportunity_actions SET status = $2, external_id = coalesce($3, external_id), updated_at = now() WHERE id = $1", [id, status, externalId ?? null]);
  }

  async actions(id: string) {
    const r = await this.db.query<{ id: string; kind: string; status: string; title: string; body: string; created_at: Date; task_id: string | null; external_id: string | null }>(
      "SELECT id, kind, status, title, body, created_at, task_id, external_id FROM opportunity_actions WHERE opportunity_id = $1 ORDER BY created_at",
      [id],
    );
    return r.rows;
  }

  async recordFeedback(id: string, actor: string, decision: "accepted" | "rejected" | "completed", note?: string): Promise<void> {
    await this.db.query("INSERT INTO user_feedback (opportunity_id, actor, decision, note) VALUES ($1, $2, $3, $4)", [id, actor, decision, note ?? null]);
  }

  async recordCost(c: { runId: string | null; sourceId: string | null; department: string | null; kind: "llm" | "api_call"; model?: string; inputTokens?: number; outputTokens?: number; requests?: number; costUsd?: number }): Promise<void> {
    await this.db.query(
      `INSERT INTO research_costs (run_id, source_id, department, kind, model, input_tokens, output_tokens, requests, cost_usd)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [c.runId, c.sourceId, c.department, c.kind, c.model ?? null, c.inputTokens ?? 0, c.outputTokens ?? 0, c.requests ?? 0, c.costUsd ?? 0],
    );
  }

  async costSummary(days: number, timezone: string) {
    const r = await this.db.query<{ source_id: string | null; llm_usd: string; requests: string }>(
      `SELECT source_id, coalesce(sum(cost_usd), 0) llm_usd, coalesce(sum(requests), 0) requests FROM research_costs
       WHERE at >= (date_trunc('day', now() AT TIME ZONE $2) AT TIME ZONE $2) - (($1::int - 1) || ' days')::interval
       GROUP BY source_id ORDER BY 2 DESC`,
      [days, timezone],
    );
    return r.rows.map((x) => ({ sourceId: x.source_id, llmUsd: Number(x.llm_usd), requests: Number(x.requests) }));
  }

  async markNotified(ids: string[]): Promise<void> {
    if (ids.length) await this.db.query("UPDATE opportunities SET notified_at = now() WHERE id = ANY($1)", [ids]);
  }

  async refreshVerification(id: string, v: VerificationResult, deadlineAt: Date | null | undefined): Promise<void> {
    const { updates: _u, ...verification } = v;
    await this.db.query(
      `UPDATE opportunities SET verification = $2, last_verified_at = $3,
         deadline_at = CASE WHEN $4::boolean THEN $5 ELSE deadline_at END, updated_at = now() WHERE id = $1`,
      [id, JSON.stringify(verification), v.checkedAt, deadlineAt !== undefined, deadlineAt ?? null],
    );
  }

  async search(f: { status?: OpportunityStatus[]; category?: OpportunityCategory; text?: string; limit?: number }): Promise<OpportunityRow[]> {
    const where: string[] = [];
    const args: unknown[] = [];
    if (f.status?.length) {
      args.push(f.status);
      where.push(`status = ANY($${args.length})`);
    }
    if (f.category) {
      args.push(f.category);
      where.push(`category = $${args.length}`);
    }
    if (f.text) {
      args.push(`%${f.text}%`);
      where.push(`(title ILIKE $${args.length} OR organization ILIKE $${args.length} OR summary ILIKE $${args.length})`);
    }
    args.push(f.limit ?? 20);
    const r = await this.db.query<OpportunityRow>(
      `SELECT * FROM opportunities ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY score DESC NULLS LAST, deadline_at ASC NULLS LAST LIMIT $${args.length}`,
      args,
    );
    return r.rows;
  }

  async pipelineCounts(): Promise<Record<string, number>> {
    const r = await this.db.query<{ status: string; n: string }>("SELECT status, count(*) n FROM opportunities GROUP BY status");
    return Object.fromEntries(r.rows.map((x) => [x.status, Number(x.n)]));
  }

  async openCommitments(): Promise<number> {
    const r = await this.db.query<{ n: string }>("SELECT count(*) n FROM opportunities WHERE status IN ('approved','in_progress')");
    return Number(r.rows[0]!.n);
  }

  /** Owner decisions per category+source, for bounded learning. */
  async feedbackStats(): Promise<Map<string, { accepted: number; rejected: number }>> {
    const r = await this.db.query<{ category: string; source: string; decision: string; n: string }>(
      `SELECT o.category, o.source, f.decision, count(*) n
       FROM user_feedback f JOIN opportunities o ON o.id = f.opportunity_id
       GROUP BY 1, 2, 3`,
    );
    const m = new Map<string, { accepted: number; rejected: number }>();
    for (const row of r.rows) {
      const key = `${row.category}|${row.source}`;
      const s = m.get(key) ?? { accepted: 0, rejected: 0 };
      if (row.decision === "accepted" || row.decision === "completed") s.accepted += Number(row.n);
      if (row.decision === "rejected") s.rejected += Number(row.n);
      m.set(key, s);
    }
    return m;
  }

  /** Qualified items not yet shown to the owner, best first. */
  async unnotifiedQualified(limit: number): Promise<OpportunityRow[]> {
    const r = await this.db.query<OpportunityRow>(
      `SELECT * FROM opportunities WHERE status = 'qualified' AND notified_at IS NULL
         AND (deadline_at IS NULL OR deadline_at > now())
       ORDER BY score DESC, deadline_at ASC NULLS LAST LIMIT $1`,
      [limit],
    );
    return r.rows;
  }

  async needsRecheck(maxAgeHours: number): Promise<OpportunityRow[]> {
    const r = await this.db.query<OpportunityRow>(
      `SELECT * FROM opportunities WHERE status IN ('qualified','approved','in_progress')
         AND (last_verified_at IS NULL OR last_verified_at < now() - ($1 || ' hours')::interval
              OR (deadline_at IS NOT NULL AND deadline_at < now() + interval '14 days'))
       ORDER BY deadline_at ASC NULLS LAST LIMIT 50`,
      [String(maxAgeHours)],
    );
    return r.rows;
  }

  async weeklyCandidates(limit: number): Promise<OpportunityRow[]> {
    // Exclude items already featured in a weekly report unless the owner is actively pursuing them.
    const r = await this.db.query<OpportunityRow>(
      `SELECT o.* FROM opportunities o
       WHERE o.status IN ('qualified','approved','in_progress')
         AND (o.deadline_at IS NULL OR o.deadline_at > now())
         AND (o.status IN ('approved','in_progress')
              OR NOT EXISTS (SELECT 1 FROM opportunity_events e WHERE e.opportunity_id = o.id AND e.event = 'reported.weekly'))
       ORDER BY (o.status IN ('approved','in_progress')) DESC, o.score DESC LIMIT $1`,
      [limit],
    );
    return r.rows;
  }

  async logNotification(module: string, kind: string, ids: string[], text: string): Promise<void> {
    await this.db.query("INSERT INTO notification_history (module, kind, opportunity_ids, text) VALUES ($1, $2, $3, $4)", [module, kind, ids, text]);
  }

  async notificationsToday(module: string, kind: string, timezone: string): Promise<number> {
    const r = await this.db.query<{ n: string }>(
      `SELECT count(*) n FROM notification_history WHERE module = $1 AND kind = $2
         AND at >= (date_trunc('day', now() AT TIME ZONE $3) AT TIME ZONE $3)`,
      [module, kind, timezone],
    );
    return Number(r.rows[0]!.n);
  }

  // ---- background job bookkeeping ----
  async lastRun(job: string, slot: string) {
    const r = await this.db.query<{ id: string; status: string; attempt: number; started_at: Date; finished_at: Date | null }>(
      "SELECT id, status, attempt, started_at, finished_at FROM research_runs WHERE job = $1 AND slot = $2 ORDER BY started_at DESC LIMIT 1",
      [job, slot],
    );
    return r.rows[0] ?? null;
  }

  /** Timestamps come from the scheduler's clock so backoff math uses one time source. */
  async startRun(job: string, slot: string, attempt: number, at: Date = new Date(), extra: { sourceId?: string | null; cycle?: string } = {}): Promise<string> {
    const r = await this.db.query<{ id: string }>(
      "INSERT INTO research_runs (job, slot, attempt, status, started_at, source_id, cycle) VALUES ($1, $2, $3, 'running', $4, $5, $6) RETURNING id",
      [job, slot, attempt, at, extra.sourceId ?? null, extra.cycle ?? null],
    );
    return r.rows[0]!.id;
  }

  async finishRun(id: string, status: "succeeded" | "failed" | "skipped" | "dead_letter", stats: Record<string, unknown>, error?: string, at: Date = new Date()): Promise<void> {
    await this.db.query("UPDATE research_runs SET status = $2, stats = $3, error = $4, finished_at = $5 WHERE id = $1", [
      id,
      status,
      JSON.stringify(stats),
      error ?? null,
      at,
    ]);
  }

  async recentRuns(limit = 20) {
    const r = await this.db.query("SELECT id, job, slot, cycle, source_id, attempt, status, stats, error, api_calls, checkpoint, started_at, finished_at FROM research_runs ORDER BY started_at DESC, id DESC LIMIT $1", [limit]);
    return r.rows;
  }

  async researchSpendToday(timezone: string): Promise<number> {
    const r = await this.db.query<{ total: string | null }>(
      `SELECT sum(cost_usd) total FROM spend_ledger WHERE label = 'opportunity_research'
         AND at >= (date_trunc('day', now() AT TIME ZONE $1) AT TIME ZONE $1)`,
      [timezone],
    );
    return Number(r.rows[0]?.total ?? 0);
  }
}

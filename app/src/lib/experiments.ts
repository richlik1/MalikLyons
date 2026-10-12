import { createHash } from "node:crypto";

// Randomized merchant experiments: deterministic visitor-level assignment and an honest
// intent-to-treat readout. Every visitor ASSIGNED counts, whether or not they used try-on,
// so the comparison is not biased by self-selection.

export type Arm = "treatment" | "control";

/** Deterministic assignment: same salt + visitor always gets the same arm. */
export function assignArm(salt: string, visitorId: string, treatmentPct: number): Arm {
  const digest = createHash("sha256").update(`${salt}:${visitorId}`).digest();
  const bucket = digest.readUInt32BE(0) % 10_000; // 0..9999
  return bucket < Math.round(treatmentPct * 100) ? "treatment" : "control";
}

export interface ArmSummary {
  arm: Arm;
  visitors: number;
  tryon_open: number;
  tryon_success: number;
  add_to_cart: number;
  checkout_started: number;
  purchasers: number;
  revenue_cents: number;
}

export type Metric = "add_to_cart" | "checkout_started" | "purchasers";

export interface MetricReadout {
  metric: Metric;
  controlRate: number;
  treatmentRate: number;
  absoluteDiff: number;
  relativeLift: number | null;
  ci90: [number, number];
  verdict: "insufficient_data" | "positive" | "inconclusive" | "negative";
}

export interface ExperimentReadout {
  visitors: { control: number; treatment: number };
  srm: { pValue: number; flagged: boolean };
  progress: number | null; // share of planned visitors per arm reached
  metrics: MetricReadout[];
  notes: string[];
}

const Z90 = 1.6448536;
const MIN_VISITORS_PER_ARM = 1000;
const MIN_CONVERSIONS_PER_ARM = 30;

export function analyze(rows: ArmSummary[], opts: { treatmentPct: number; plannedVisitorsPerArm?: number | null }): ExperimentReadout {
  const t = rows.find((r) => r.arm === "treatment") ?? empty("treatment");
  const c = rows.find((r) => r.arm === "control") ?? empty("control");
  const notes: string[] = [];

  const srm = sampleRatioMismatch(t.visitors, c.visitors, opts.treatmentPct / 100);
  if (srm.flagged) notes.push("Sample ratio mismatch: assignment or logging is broken. Do not interpret results until fixed.");

  const metrics = (["add_to_cart", "checkout_started", "purchasers"] as Metric[]).map((m) => readout(m, c, t, srm.flagged));
  const planned = opts.plannedVisitorsPerArm ?? null;
  const progress = planned ? Math.min(t.visitors, c.visitors) / planned : null;
  if (progress !== null && progress < 1) notes.push("Planned sample size not reached. Fixed-horizon test: do not stop early on a promising result.");
  notes.push("90% confidence intervals use a normal approximation; treat borderline results as inconclusive.");

  return { visitors: { control: c.visitors, treatment: t.visitors }, srm, progress, metrics, notes };
}

function readout(metric: Metric, c: ArmSummary, t: ArmSummary, srmFlagged: boolean): MetricReadout {
  const pc = c.visitors ? c[metric] / c.visitors : 0;
  const pt = t.visitors ? t[metric] / t.visitors : 0;
  const diff = pt - pc;
  const se = Math.sqrt((c.visitors ? (pc * (1 - pc)) / c.visitors : 0) + (t.visitors ? (pt * (1 - pt)) / t.visitors : 0));
  const ci90: [number, number] = [diff - Z90 * se, diff + Z90 * se];
  const enough = c.visitors >= MIN_VISITORS_PER_ARM && t.visitors >= MIN_VISITORS_PER_ARM && c[metric] >= MIN_CONVERSIONS_PER_ARM && t[metric] >= MIN_CONVERSIONS_PER_ARM;
  let verdict: MetricReadout["verdict"] = "insufficient_data";
  if (enough && !srmFlagged) verdict = ci90[0] > 0 ? "positive" : diff <= 0 ? "negative" : "inconclusive";
  return { metric, controlRate: pc, treatmentRate: pt, absoluteDiff: diff, relativeLift: pc > 0 ? diff / pc : null, ci90, verdict };
}

/** Chi-square goodness-of-fit (1 df) on the visitor split. Flag at p < 0.001. */
export function sampleRatioMismatch(treatment: number, control: number, expectedTreatmentShare: number) {
  const n = treatment + control;
  if (n < 100) return { pValue: 1, flagged: false };
  const et = n * expectedTreatmentShare;
  const ec = n - et;
  const chi = (treatment - et) ** 2 / et + (control - ec) ** 2 / ec;
  const pValue = erfc(Math.sqrt(chi / 2));
  return { pValue, flagged: pValue < 0.001 };
}

/** Visitors needed per arm for a two-sided two-proportion z-test. */
export function requiredVisitorsPerArm(baseline: number, relativeLift: number, alpha = 0.05, power = 0.8): number {
  const p1 = baseline;
  const p2 = baseline * (1 + relativeLift);
  const za = alpha === 0.05 ? 1.959964 : alpha === 0.1 ? 1.6448536 : 1.959964;
  const zb = power === 0.8 ? 0.841621 : power === 0.9 ? 1.281552 : 0.841621;
  const pbar = (p1 + p2) / 2;
  const n = (za * Math.sqrt(2 * pbar * (1 - pbar)) + zb * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))) ** 2 / (p2 - p1) ** 2;
  return Math.ceil(n);
}

function empty(arm: Arm): ArmSummary {
  return { arm, visitors: 0, tryon_open: 0, tryon_success: 0, add_to_cart: 0, checkout_started: 0, purchasers: 0, revenue_cents: 0 };
}

// Complementary error function (Abramowitz–Stegun 7.1.26, |error| < 1.5e-7).
function erfc(x: number): number {
  const t = 1 / (1 + 0.3275911 * x);
  const y = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return y * Math.exp(-x * x);
}

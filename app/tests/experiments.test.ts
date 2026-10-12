import { describe, expect, it } from "vitest";
import { analyze, assignArm, requiredVisitorsPerArm, sampleRatioMismatch, type ArmSummary } from "@/lib/experiments";

const row = (arm: "treatment" | "control", visitors: number, atc: number, purchasers = 0): ArmSummary => ({
  arm, visitors, tryon_open: 0, tryon_success: 0, add_to_cart: atc, checkout_started: 0, purchasers, revenue_cents: 0,
});

describe("assignArm", () => {
  it("is deterministic per visitor and salt", () => {
    expect(assignArm("s1", "visitor-123", 50)).toBe(assignArm("s1", "visitor-123", 50));
  });
  it("splits close to the configured share across many visitors", () => {
    let t = 0;
    for (let i = 0; i < 20_000; i++) if (assignArm("salt", `v-${i}`, 50) === "treatment") t++;
    expect(t / 20_000).toBeGreaterThan(0.48);
    expect(t / 20_000).toBeLessThan(0.52);
    let t20 = 0;
    for (let i = 0; i < 20_000; i++) if (assignArm("salt", `v-${i}`, 20) === "treatment") t20++;
    expect(t20 / 20_000).toBeGreaterThan(0.18);
    expect(t20 / 20_000).toBeLessThan(0.22);
  });
  it("re-randomizes when the salt changes", () => {
    let same = 0;
    for (let i = 0; i < 2000; i++) if (assignArm("a", `v-${i}`, 50) === assignArm("b", `v-${i}`, 50)) same++;
    expect(same / 2000).toBeGreaterThan(0.4);
    expect(same / 2000).toBeLessThan(0.6);
  });
});

describe("sampleRatioMismatch", () => {
  it("does not flag a fair split", () => expect(sampleRatioMismatch(5030, 4970, 0.5).flagged).toBe(false));
  it("flags a broken split", () => expect(sampleRatioMismatch(5600, 4400, 0.5).flagged).toBe(true));
});

describe("analyze", () => {
  it("reports insufficient data on small samples instead of a verdict", () => {
    const r = analyze([row("treatment", 120, 12), row("control", 118, 7)], { treatmentPct: 50 });
    expect(r.metrics.find((m) => m.metric === "add_to_cart")?.verdict).toBe("insufficient_data");
  });
  it("finds a clear positive effect with a CI excluding zero", () => {
    const r = analyze([row("treatment", 30_000, 2_100), row("control", 30_000, 1_800)], { treatmentPct: 50 });
    const atc = r.metrics.find((m) => m.metric === "add_to_cart")!;
    expect(atc.verdict).toBe("positive");
    expect(atc.ci90[0]).toBeGreaterThan(0);
    expect(atc.relativeLift).toBeCloseTo(1 / 6, 3);
  });
  it("calls a small positive difference inconclusive when the CI spans zero", () => {
    const r = analyze([row("treatment", 5_000, 310), row("control", 5_000, 300)], { treatmentPct: 50 });
    expect(r.metrics.find((m) => m.metric === "add_to_cart")?.verdict).toBe("inconclusive");
  });
  it("refuses a verdict when the sample ratio is broken", () => {
    const r = analyze([row("treatment", 36_000, 2_600), row("control", 30_000, 1_800)], { treatmentPct: 50 });
    expect(r.srm.flagged).toBe(true);
    expect(r.metrics.every((m) => m.verdict === "insufficient_data")).toBe(true);
  });
  it("reports progress against the planned sample", () => {
    const r = analyze([row("treatment", 2_000, 130), row("control", 2_100, 120)], { treatmentPct: 50, plannedVisitorsPerArm: 25_739 });
    expect(r.progress).toBeCloseTo(2000 / 25_739, 4);
  });
});

describe("requiredVisitorsPerArm", () => {
  it("matches the pilot plan figure (6% baseline, +10% relative, α=.05, 80% power)", () => {
    expect(requiredVisitorsPerArm(0.06, 0.1)).toBe(25_740); // 25,739.4 rounded up
  });
});

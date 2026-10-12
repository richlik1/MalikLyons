import { describe, expect, it } from "vitest";
import { billingMode, billingPeriod, estimateInvoice, grossMargin, type Plan } from "@/lib/billing";

const starter: Plan = { key: "starter", monthlyPriceCents: 4900, includedGenerations: 250, overageCentsPerGeneration: 15, hardCap: false };
const pilot: Plan = { key: "pilot", monthlyPriceCents: 0, includedGenerations: 500, overageCentsPerGeneration: null, hardCap: true };
const oldGrowth: Plan = { key: "growth-old", monthlyPriceCents: 14900, includedGenerations: 2000, overageCentsPerGeneration: null, hardCap: true };

describe("estimateInvoice", () => {
  it("charges base only within the allowance", () => {
    expect(estimateInvoice(starter, 200)).toMatchObject({ overageUnits: 0, totalCents: 4900 });
  });
  it("adds overage beyond the allowance", () => {
    expect(estimateInvoice(starter, 300)).toMatchObject({ overageUnits: 50, overageCents: 750, totalCents: 5650 });
  });
  it("never bills overage on hard-capped plans", () => {
    expect(estimateInvoice(pilot, 600)).toMatchObject({ overageUnits: 100, overageCents: 0, totalCents: 0 });
  });
  it("respects merchant quota overrides", () => {
    expect(estimateInvoice(starter, 300, 400).overageUnits).toBe(0);
  });
});

describe("grossMargin (corrected unit economics)", () => {
  it("shows the brief's original Growth tier is negative-margin at full use and on-demand cost", () => {
    const m = grossMargin(oldGrowth, 2000, { unitCostUsd: 0.075, billingPlatformPct: 0 });
    expect(m.marginPct!).toBeLessThan(0);
  });
  it("shows recommended Starter stays positive at full use and on-demand cost", () => {
    const m = grossMargin(starter, 250, { unitCostUsd: 0.075 });
    expect(m.marginPct!).toBeGreaterThan(0.5);
  });
  it("accounts for overage revenue and its cost", () => {
    const m = grossMargin(starter, 1000, { unitCostUsd: 0.075 });
    expect(m.revenueCents).toBe(4900 + 750 * 15);
    expect(m.marginPct!).toBeGreaterThan(0.4);
  });
  it("reports pilot (free) usage as pure cost", () => {
    expect(grossMargin(pilot, 400, { unitCostUsd: 0.075 })).toMatchObject({ revenueCents: 0, cogsCents: 3000, marginPct: null });
  });
});

describe("billingMode", () => {
  it("defaults to disabled", () => expect(billingMode({})).toBe("disabled"));
  it("supports shadow", () => expect(billingMode({ BILLING_MODE: "shadow" })).toBe("shadow"));
  it("refuses live billing in this build", () => expect(() => billingMode({ BILLING_MODE: "live" })).toThrow());
  it("computes UTC billing periods", () => expect(billingPeriod(new Date("2026-10-31T23:59:00Z"))).toBe("2026-10-01"));
});

// Usage-based billing math. This build NEVER charges money: BILLING_MODE may only be
// "disabled" (default) or "shadow" (compute estimated invoices for review).

export interface Plan {
  key: string;
  monthlyPriceCents: number;
  includedGenerations: number;
  overageCentsPerGeneration: number | null;
  hardCap: boolean;
}

export interface InvoiceEstimate {
  included: number;
  used: number;
  overageUnits: number;
  baseCents: number;
  overageCents: number;
  totalCents: number;
}

export function estimateInvoice(plan: Plan, used: number, quotaOverride?: number | null): InvoiceEstimate {
  const included = quotaOverride ?? plan.includedGenerations;
  const overageUnits = Math.max(0, used - included);
  const overageCents = plan.hardCap ? 0 : overageUnits * (plan.overageCentsPerGeneration ?? 0);
  return { included, used, overageUnits, baseCents: plan.monthlyPriceCents, overageCents, totalCents: plan.monthlyPriceCents + overageCents };
}

export interface MarginInputs {
  unitCostUsd: number;          // provider cost per billable generation
  paymentFeePct?: number;       // card processing, default 2.9%
  paymentFixedCents?: number;   // default 30¢
  billingPlatformPct?: number;  // e.g. Stripe Billing ~0.7% (verify), default 0.7%
  appStoreRevSharePct?: number; // Shopify: 0% on first $1M lifetime, 15% above (verify)
  infraCentsPerMerchant?: number;
}

/** Gross margin for one merchant-month. Returns null when there is no revenue. */
export function grossMargin(plan: Plan, used: number, m: MarginInputs, quotaOverride?: number | null) {
  const inv = estimateInvoice(plan, used, quotaOverride);
  const revenue = inv.totalCents;
  if (revenue <= 0) return { revenueCents: 0, cogsCents: Math.round(used * m.unitCostUsd * 100), marginPct: null as number | null };
  const billable = plan.hardCap ? Math.min(used, inv.included) : used;
  const ai = billable * m.unitCostUsd * 100;
  const fees = revenue * ((m.paymentFeePct ?? 0.029) + (m.billingPlatformPct ?? 0.007) + (m.appStoreRevSharePct ?? 0)) + (m.paymentFixedCents ?? 30);
  const cogs = ai + fees + (m.infraCentsPerMerchant ?? 200);
  return { revenueCents: revenue, cogsCents: Math.round(cogs), marginPct: (revenue - cogs) / revenue };
}

export type BillingMode = "disabled" | "shadow";

export function billingMode(env: Record<string, string | undefined> = process.env): BillingMode {
  const v = env.BILLING_MODE ?? "disabled";
  if (v === "live") throw new Error("BILLING_MODE=live is not supported by this build");
  return v === "shadow" ? "shadow" : "disabled";
}

export function billingPeriod(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

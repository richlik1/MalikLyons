import { NextResponse } from "next/server";
import { authenticateSecretKey } from "@/lib/api-auth";
import { billingPeriod, estimateInvoice } from "@/lib/billing";
import { createAdminClient } from "@/lib/supabase/server";

/** GET /api/v1/usage — this billing period's metered usage and estimated charges. */
export async function GET(req: Request) {
  const caller = await authenticateSecretKey(req);
  if (caller instanceof NextResponse) return caller;
  const svc = createAdminClient();
  const period = billingPeriod(new Date());
  const [{ data: m }, { data: rows }] = await Promise.all([
    svc.from("merchants").select("plan, monthly_generation_quota, billing_status, plans(monthly_price_cents, included_generations, overage_cents_per_generation, hard_cap)").eq("id", caller.merchantId).single(),
    svc.from("usage_events").select("quantity").eq("merchant_id", caller.merchantId).eq("billing_period", period),
  ]);
  const plan = m?.plans as unknown as { monthly_price_cents: number; included_generations: number; overage_cents_per_generation: number | null; hard_cap: boolean };
  const used = (rows ?? []).reduce((s, r) => s + r.quantity, 0);
  const inv = estimateInvoice(
    { key: m!.plan, monthlyPriceCents: plan.monthly_price_cents, includedGenerations: plan.included_generations, overageCentsPerGeneration: plan.overage_cents_per_generation, hardCap: plan.hard_cap },
    used, m!.monthly_generation_quota,
  );
  return NextResponse.json({
    object: "usage", billing_period: period, plan: m!.plan, billing_status: m!.billing_status,
    used: inv.used, included: inv.included, overage_units: inv.overageUnits, hard_cap: plan.hard_cap,
    estimated_total_cents: inv.totalCents, note: "Estimates only. Billing is not active in this version.",
  });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, parseJson, sameOrigin } from "@/lib/http";
import { createUserClient, getSessionUser } from "@/lib/supabase/server";

const schema = z.object({
  key: z.string().regex(/^[a-z0-9-]{3,40}$/, "lowercase letters, numbers and dashes"),
  hypothesis: z.string().trim().min(10).max(500),
  primaryMetric: z.enum(["add_to_cart", "purchase", "checkout_started"]).default("add_to_cart"),
  treatmentPct: z.number().int().min(1).max(99).default(50),
  plannedVisitorsPerArm: z.number().int().positive().optional(),
});

// Experiments are created in draft; RLS ensures merchants only create them for their own store.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return jsonError(403, "bad_origin", "Cross-site request rejected.");
  const user = await getSessionUser();
  if (!user) return jsonError(401, "unauthenticated", "Please sign in.");
  const parsed = await parseJson(req, schema);
  if (!parsed.ok) return parsed.res;
  const supabase = await createUserClient();
  const { data: merchant } = await supabase.from("merchants").select("id").eq("owner_id", user.id).maybeSingle();
  if (!merchant) return jsonError(403, "not_merchant", "Create your store first.");
  const { data, error } = await supabase
    .from("experiments")
    .insert({
      merchant_id: merchant.id, key: parsed.data.key, hypothesis: parsed.data.hypothesis, primary_metric: parsed.data.primaryMetric,
      treatment_pct: parsed.data.treatmentPct, planned_visitors_per_arm: parsed.data.plannedVisitorsPerArm ?? null,
    })
    .select("id")
    .single();
  if (error) return jsonError(400, "experiment_failed", error.code === "23505" ? "An experiment with this key already exists." : "Couldn't create the experiment.");
  return NextResponse.json({ id: data.id });
}

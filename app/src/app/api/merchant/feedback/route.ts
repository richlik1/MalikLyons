import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, parseJson, sameOrigin } from "@/lib/http";
import { createUserClient, getSessionUser } from "@/lib/supabase/server";

const schema = z.object({
  pilotWeek: z.number().int().min(0).max(12),
  likelihoodToRecommend: z.number().int().min(0).max(10),
  valueRating: z.number().int().min(1).max(5),
  qualityRating: z.number().int().min(1).max(5),
  wouldPay: z.enum(["yes", "maybe", "no"]),
  priceNamed: z.number().min(0).max(100000).optional(),
  topIssue: z.string().trim().max(1000).optional(),
  comment: z.string().trim().max(2000).optional(),
});

// Weekly structured merchant feedback (feeds go/no-go gates G9 and the pilot scorecard).
export async function POST(req: Request) {
  if (!sameOrigin(req)) return jsonError(403, "bad_origin", "Cross-site request rejected.");
  const user = await getSessionUser();
  if (!user) return jsonError(401, "unauthenticated", "Please sign in.");
  const parsed = await parseJson(req, schema);
  if (!parsed.ok) return parsed.res;
  const supabase = await createUserClient();
  const { data: merchant } = await supabase.from("merchants").select("id").eq("owner_id", user.id).maybeSingle();
  if (!merchant) return jsonError(403, "not_merchant", "Create your store first.");
  const d = parsed.data;
  const { error } = await supabase.from("merchant_feedback").insert({
    merchant_id: merchant.id, submitted_by: user.id, pilot_week: d.pilotWeek, likelihood_to_recommend: d.likelihoodToRecommend,
    value_rating: d.valueRating, quality_rating: d.qualityRating, would_pay: d.wouldPay,
    price_named_cents: d.priceNamed != null ? Math.round(d.priceNamed * 100) : null, top_issue: d.topIssue || null, comment: d.comment || null,
  });
  if (error) return jsonError(400, "feedback_failed", error.code === "23505" ? "Feedback for this week was already submitted." : "Couldn't save feedback.");
  return NextResponse.json({ ok: true });
}

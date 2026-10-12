import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, parseJson, sameOrigin } from "@/lib/http";
import { createAdminClient, createUserClient, getSessionUser } from "@/lib/supabase/server";

const schema = z.object({
  merchantId: z.string().uuid(),
  status: z.enum(["invited", "onboarding", "live", "completed", "withdrawn"]),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  productsLimit: z.number().int().min(1).max(200).optional(),
  offeredPrice: z.number().min(0).max(100000).optional(),
  agreementSigned: z.boolean().optional(),
  dpaSigned: z.boolean().optional(),
  convertedToPaid: z.boolean().optional(),
  adminNotes: z.string().max(4000).optional(),
});

// Admin-only: enroll a merchant in the pilot or update its status.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return jsonError(403, "bad_origin", "Cross-site request rejected.");
  const user = await getSessionUser();
  if (!user) return jsonError(401, "unauthenticated", "Please sign in.");
  const { data: profile } = await (await createUserClient()).from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") return jsonError(403, "forbidden", "Admins only.");
  const parsed = await parseJson(req, schema);
  if (!parsed.ok) return parsed.res;
  const d = parsed.data;
  const now = new Date().toISOString();
  const row: Record<string, unknown> = { merchant_id: d.merchantId, status: d.status };
  if (d.startDate) row.start_date = d.startDate;
  if (d.endDate) row.end_date = d.endDate;
  if (d.productsLimit) row.products_limit = d.productsLimit;
  if (d.offeredPrice != null) row.offered_price_cents = Math.round(d.offeredPrice * 100);
  if (d.agreementSigned) row.agreement_signed_at = now;
  if (d.dpaSigned) row.dpa_signed_at = now;
  if (d.convertedToPaid != null) row.converted_to_paid = d.convertedToPaid;
  if (d.adminNotes != null) row.admin_notes = d.adminNotes;
  const { error } = await createAdminClient().from("pilot_enrollments").upsert(row, { onConflict: "merchant_id" });
  if (error) return jsonError(400, "pilot_failed", error.message);
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { jsonError, parseJson, sameOrigin } from "@/lib/http";
import { waitlistSchema } from "@/lib/schemas";
import { createAdminClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return jsonError(403, "bad_origin", "Cross-site request rejected.");
  const parsed = await parseJson(req, waitlistSchema);
  if (!parsed.ok) return parsed.res;
  const d = parsed.data;

  const admin = createAdminClient();
  const { error } = await admin.from("waitlist_signups").insert({
    visitor_id: d.visitorId,
    email: d.email,
    brand_name: d.brandName,
    store_url: d.storeUrl ?? null,
    platform: d.platform ?? null,
    monthly_orders: d.monthlyOrders ?? null,
    biggest_problem: d.biggestProblem || null,
    utm_source: d.utmSource ?? null,
    utm_campaign: d.utmCampaign ?? null,
  });
  // Duplicate email: respond the same way so the endpoint can't be used to probe the list.
  if (error && error.code !== "23505") {
    console.error("[waitlist] insert failed", error.message);
    return jsonError(500, "waitlist_failed", "Couldn't join the waitlist. Please try again.");
  }
  if (!error) {
    await admin.from("landing_events").insert({ visitor_id: d.visitorId, event: "waitlist_submit", utm_source: d.utmSource ?? null });
  }
  return NextResponse.json({ ok: true });
}

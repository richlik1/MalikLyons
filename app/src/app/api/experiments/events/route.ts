import { NextResponse } from "next/server";
import { z } from "zod";
import { allowedOriginsForMerchant, corsHeaders, PREFLIGHT_HEADERS } from "@/lib/cors";
import { createAdminClient } from "@/lib/supabase/server";

// Browser-reported funnel events. Purchases are deliberately NOT accepted here: they come
// from verified server sources (Shopify orders webhook) so revenue can't be spoofed.
const schema = z.object({
  experimentId: z.string().uuid(),
  visitorId: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/),
  event: z.enum(["tryon_open", "tryon_success", "add_to_cart", "checkout_started"]),
  productId: z.string().uuid().optional(),
});

export async function POST(req: Request) {
  const body = schema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const svc = createAdminClient();
  const { data: exp } = await svc.from("experiments").select("id, merchant_id, status").eq("id", body.data.experimentId).maybeSingle();
  if (!exp) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const cors = corsHeaders(req.headers.get("origin"), await allowedOriginsForMerchant(svc, exp.merchant_id));
  if (!cors) return NextResponse.json({ error: "origin_not_allowed" }, { status: 403 });
  if (exp.status !== "running") return new NextResponse(null, { status: 204, headers: cors });

  // The arm comes from the stored assignment, never from the client.
  const { data: a } = await svc.from("experiment_assignments").select("arm").eq("experiment_id", exp.id).eq("visitor_id", body.data.visitorId).maybeSingle();
  if (!a) return NextResponse.json({ error: "not_assigned" }, { status: 409, headers: cors });
  const { error } = await svc.from("experiment_events").insert({
    experiment_id: exp.id, visitor_id: body.data.visitorId, arm: a.arm, event: body.data.event, product_id: body.data.productId ?? null, source: "browser",
  });
  if (error) console.error("[experiments] event failed", error.message);
  return new NextResponse(null, { status: 204, headers: cors });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: PREFLIGHT_HEADERS });
}

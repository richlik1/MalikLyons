import { NextResponse } from "next/server";
import { z } from "zod";
import { allowedOriginsForMerchant, corsHeaders, PREFLIGHT_HEADERS } from "@/lib/cors";
import { assignArm } from "@/lib/experiments";
import { createAdminClient } from "@/lib/supabase/server";

const schema = z.object({ experimentId: z.string().uuid(), visitorId: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/) });

// Called by the storefront widget before rendering the try-on button. Records first exposure
// once per visitor (intent-to-treat). Returns { arm }; a stopped/draft experiment returns
// arm "treatment" with experiment: "inactive" so the button simply shows.
export async function POST(req: Request) {
  const body = schema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const svc = createAdminClient();
  const { data: exp } = await svc.from("experiments").select("id, merchant_id, salt, status, treatment_pct").eq("id", body.data.experimentId).maybeSingle();
  if (!exp) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const cors = corsHeaders(req.headers.get("origin"), await allowedOriginsForMerchant(svc, exp.merchant_id));
  if (!cors) return NextResponse.json({ error: "origin_not_allowed" }, { status: 403 });
  if (exp.status !== "running") return NextResponse.json({ arm: "treatment", experiment: "inactive" }, { headers: cors });

  const arm = assignArm(exp.salt, body.data.visitorId, exp.treatment_pct);
  const { error } = await svc
    .from("experiment_assignments")
    .upsert({ experiment_id: exp.id, visitor_id: body.data.visitorId, arm }, { onConflict: "experiment_id,visitor_id", ignoreDuplicates: true });
  if (error) console.error("[experiments] assignment failed", error.message);
  return NextResponse.json({ arm, experiment: "running" }, { headers: cors });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: PREFLIGHT_HEADERS });
}

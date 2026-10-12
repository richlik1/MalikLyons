import { NextResponse } from "next/server";
import { jsonError, parseJson, sameOrigin } from "@/lib/http";
import { landingEventSchema } from "@/lib/schemas";
import { createAdminClient, supabaseConfigured } from "@/lib/supabase/server";

// First-party landing analytics. Stores a random visitor id only — no IP, no user agent.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return jsonError(403, "bad_origin", "Cross-site request rejected.");
  if (!supabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) return new NextResponse(null, { status: 204 });
  const parsed = await parseJson(req, landingEventSchema);
  if (!parsed.ok) return parsed.res;
  const d = parsed.data;
  const { error } = await createAdminClient()
    .from("landing_events")
    .insert({ visitor_id: d.visitorId, event: d.event, variant: d.variant ?? null, path: d.path ?? null, utm_source: d.utmSource ?? null });
  if (error) console.error("[events] insert failed", error.message);
  return new NextResponse(null, { status: 204 });
}

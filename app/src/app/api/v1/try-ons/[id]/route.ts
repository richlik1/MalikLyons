import { NextResponse } from "next/server";
import { apiError, authenticateSecretKey } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { API_RESULT_URL_TTL } from "@/lib/tryon/api-service";

/** GET /api/v1/try-ons/:id — status and a fresh result URL for your account's try-on. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const caller = await authenticateSecretKey(req);
  if (caller instanceof NextResponse) return caller;
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return apiError(404, "not_found", "No such try-on.");
  const svc = createAdminClient();
  const { data: g } = await svc
    .from("generations")
    .select("id, status, result_path, created_at, completed_at, latency_ms, error_code, product_id, external_ref, merchant_id, source")
    .eq("id", id)
    .eq("merchant_id", caller.merchantId) // tenant isolation (service role bypasses RLS)
    .maybeSingle();
  if (!g || g.source === "app") return apiError(404, "not_found", "No such try-on.");
  let resultUrl: string | null = null;
  if (g.result_path) resultUrl = (await svc.storage.from("tryon-results").createSignedUrl(g.result_path, API_RESULT_URL_TTL)).data?.signedUrl ?? null;
  return NextResponse.json({
    id: g.id, object: "try_on", status: g.status, result_url: resultUrl,
    result_url_expires_at: resultUrl ? new Date(Date.now() + API_RESULT_URL_TTL * 1000).toISOString() : null,
    error_code: g.error_code, latency_ms: g.latency_ms, product_id: g.product_id, external_ref: g.external_ref,
    created_at: g.created_at, completed_at: g.completed_at,
  });
}

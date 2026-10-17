import { NextResponse } from "next/server";
import { lookupKey } from "@/lib/api-auth";
import { jsonError, parseJson, sameOrigin } from "@/lib/http";
import { limitConfigFromEnv } from "@/lib/limits";
import { createProvider } from "@/lib/providers";
import { tryOnSchema } from "@/lib/schemas";
import { createAdminClient, getSessionUser } from "@/lib/supabase/server";
import { runTryOn } from "@/lib/tryon/service";
import { SupabaseBlobStore, SupabaseTryOnRepo } from "@/lib/tryon/supabase-adapters";

export const runtime = "nodejs";
export const maxDuration = 120;

// All AI calls happen here, server-side. Provider keys never reach the browser.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return jsonError(403, "bad_origin", "Cross-site request rejected.");
  const user = await getSessionUser();
  if (!user) return jsonError(401, "unauthenticated", "Please sign in.");

  const parsed = await parseJson(req, tryOnSchema);
  if (!parsed.ok) return parsed.res;

  const admin = createAdminClient();
  // Widget sessions: attribute usage to the publishable key, and only for that merchant's products.
  let embed: { source: "embed"; apiKeyId: string } | null = null;
  if (parsed.data.embedKey) {
    const caller = await lookupKey(parsed.data.embedKey, "publishable");
    const { data: p } = await admin.from("products").select("merchant_id").eq("id", parsed.data.productId).maybeSingle();
    if (!caller || !p || p.merchant_id !== caller.merchantId) return jsonError(403, "embed_not_allowed", "Try-on isn't available for this product here.");
    embed = { source: "embed", apiKeyId: caller.keyId };
  }
  try {
    const result = await runTryOn(
      { userId: user.id, photoId: parsed.data.photoId, productId: parsed.data.productId, ...(embed ?? {}) },
      {
        repo: new SupabaseTryOnRepo(admin),
        blobs: new SupabaseBlobStore(admin),
        provider: createProvider(),
        limits: limitConfigFromEnv(),
        log: (event, data) => console.log(JSON.stringify({ event, ...data })),
      },
    );
    if (!result.ok) {
      const headers = result.retryAfterSeconds ? { "Retry-After": String(result.retryAfterSeconds) } : undefined;
      return NextResponse.json({ error: { code: result.code, message: result.message }, generationId: result.generationId }, { status: result.status, headers });
    }
    return NextResponse.json(result);
  } catch (err) {
    console.error("[try-on] unexpected", err);
    return jsonError(500, "internal", "Something went wrong. Please try again.");
  }
}

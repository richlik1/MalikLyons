import { NextResponse } from "next/server";
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
  try {
    const result = await runTryOn(
      { userId: user.id, ...parsed.data },
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

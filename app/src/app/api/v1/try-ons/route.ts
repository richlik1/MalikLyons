import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, authenticateSecretKey } from "@/lib/api-auth";
import { MIN_PERSON_DIMENSION } from "@/lib/image";
import { limitConfigFromEnv } from "@/lib/limits";
import { createProvider } from "@/lib/providers";
import { decodeBase64Image, fetchRemoteImage, RemoteImageError } from "@/lib/remote-image";
import { createAdminClient } from "@/lib/supabase/server";
import { runApiTryOn } from "@/lib/tryon/api-service";
import { SupabaseBlobStore, SupabaseTryOnRepo } from "@/lib/tryon/supabase-adapters";

export const runtime = "nodejs";
export const maxDuration = 120;

const schema = z
  .object({
    person_image_url: z.string().url().optional(),
    person_image_base64: z.string().min(16).optional(),
    product_id: z.string().uuid().optional(),
    garment_image_url: z.string().url().optional(),
    garment_image_base64: z.string().min(16).optional(),
    category: z.enum(["tops", "bottoms", "one-pieces"]).optional(),
    external_ref: z.string().max(200).optional(),
  })
  .refine((v) => Boolean(v.person_image_url) !== Boolean(v.person_image_base64), "Provide exactly one of person_image_url or person_image_base64")
  .refine((v) => [v.product_id, v.garment_image_url, v.garment_image_base64].filter(Boolean).length === 1, "Provide exactly one of product_id, garment_image_url or garment_image_base64")
  .refine((v) => Boolean(v.product_id) || Boolean(v.category), "category is required when not using product_id");

/**
 * POST /api/v1/try-ons — generate a virtual try-on (synchronous; typically completes within the
 * request). Your server must have the shopper's consent to process their photo.
 */
export async function POST(req: Request) {
  const caller = await authenticateSecretKey(req);
  if (caller instanceof NextResponse) return caller;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid request body.");
  const b = parsed.data;
  const svc = createAdminClient();
  const repo = new SupabaseTryOnRepo(svc);
  const blobs = new SupabaseBlobStore(svc);

  let category = b.category;
  let productId: string | null = null;
  try {
    const person = b.person_image_url
      ? await fetchRemoteImage(b.person_image_url, { minDimension: MIN_PERSON_DIMENSION })
      : decodeBase64Image(b.person_image_base64!, MIN_PERSON_DIMENSION);
    let garment;
    if (b.product_id) {
      const { data: p } = await svc.from("products").select("id, merchant_id, category, image_path, is_active").eq("id", b.product_id).maybeSingle();
      if (!p || p.merchant_id !== caller.merchantId) return apiError(404, "product_not_found", "No such product for this account.");
      productId = p.id;
      category ??= p.category;
      garment = await blobs.download("garments", p.image_path);
    } else {
      garment = b.garment_image_url ? await fetchRemoteImage(b.garment_image_url, { minDimension: 256 }) : decodeBase64Image(b.garment_image_base64!, 256);
    }
    const result = await runApiTryOn(
      { merchantId: caller.merchantId, apiKeyId: caller.keyId, person, garment, category: category!, productId, externalRef: b.external_ref ?? null },
      { repo, blobs, provider: createProvider(), limits: limitConfigFromEnv(), perKeyPerMinute: Number(process.env.API_RATE_LIMIT_PER_KEY_PER_MINUTE) || 30 },
    );
    if (!result.ok) {
      return apiError(result.status, result.code, result.message, result.retryAfterSeconds ? { "Retry-After": String(result.retryAfterSeconds) } : undefined);
    }
    return NextResponse.json(
      { id: result.id, object: "try_on", status: "succeeded", result_url: result.resultUrl, result_url_expires_at: result.resultExpiresAt, latency_ms: result.latencyMs, product_id: productId, external_ref: b.external_ref ?? null, disclaimer: "AI-generated preview for visual reference only. Not a size or fit prediction." },
      { status: 201, headers: { "Request-Id": result.id } },
    );
  } catch (e) {
    if (e instanceof RemoteImageError) return apiError(422, "invalid_image", e.message);
    console.error("[api/v1/try-ons]", e);
    return apiError(500, "internal_error", "Something went wrong.");
  }
}

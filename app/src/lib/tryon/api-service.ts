import { billingPeriod } from "../billing";
import { evaluateLimits, type LimitConfig, type MerchantQuota } from "../limits";
import { ProviderError, type GarmentCategory, type ImageInput, type TryOnProvider } from "../providers/types";
import { BUCKETS, type BlobStore, type GenerationPatch, type NewGeneration } from "./service";

// Try-on for the public REST API (secret keys, server-to-server). The merchant is the data
// controller for their shopper's photo: TrendSet does not store the input photo, only the
// result (private bucket, api/<merchant>/…, purged after the retention period).

export interface ApiRepo {
  getApiUsage(merchantId: string, apiKeyId: string, now: Date): Promise<{ globalSpendTodayUsd: number; merchant?: MerchantQuota; keyLastMinute: number }>;
  createGeneration(row: NewGeneration): Promise<string>;
  completeGeneration(id: string, patch: GenerationPatch): Promise<void>;
  recordUsage(row: { merchantId: string; generationId: string; unitCostUsd: number; billingPeriod: string }): Promise<void>;
}

export interface ApiTryOnInput {
  merchantId: string;
  apiKeyId: string;
  person: ImageInput;
  garment: ImageInput;
  category: GarmentCategory;
  productId?: string | null;
  externalRef?: string | null;
}

export type ApiTryOnResult =
  | { ok: true; id: string; resultUrl: string; resultExpiresAt: string; latencyMs: number }
  | { ok: false; status: number; code: string; message: string; retryAfterSeconds?: number; id?: string };

export const API_RESULT_URL_TTL = 60 * 60;

export async function runApiTryOn(
  input: ApiTryOnInput,
  deps: { repo: ApiRepo; blobs: BlobStore; provider: TryOnProvider | null; limits: LimitConfig; perKeyPerMinute: number; now?: () => Date },
): Promise<ApiTryOnResult> {
  const now = deps.now?.() ?? new Date();
  const { provider, repo, blobs } = deps;
  if (!provider) return { ok: false, status: 503, code: "provider_unavailable", message: "Try-on generation is temporarily unavailable." };
  if (!provider.supportedCategories.includes(input.category)) {
    return { ok: false, status: 422, code: "unsupported_category", message: `Category "${input.category}" is not supported.` };
  }

  const usage = await repo.getApiUsage(input.merchantId, input.apiKeyId, now);
  if (usage.keyLastMinute >= deps.perKeyPerMinute) {
    return { ok: false, status: 429, code: "rate_limited", message: `Rate limit: ${deps.perKeyPerMinute} requests per minute per key.`, retryAfterSeconds: 60 };
  }
  const decision = evaluateLimits(
    { userLastMinute: 0, userLastDay: 0, globalSpendTodayUsd: usage.globalSpendTodayUsd, merchant: usage.merchant },
    { ...deps.limits, perUserPerMinute: Number.MAX_SAFE_INTEGER, perUserPerDay: Number.MAX_SAFE_INTEGER },
    provider.costPerImageUsd,
  );
  if (!decision.allowed) {
    const code = decision.reason === "merchant_quota" ? "quota_exceeded" : decision.reason === "merchant_suspended" ? "account_suspended" : "capacity_paused";
    return { ok: false, status: decision.reason === "merchant_suspended" ? 403 : 429, code, message: decision.message, retryAfterSeconds: decision.retryAfterSeconds };
  }

  const id = await repo.createGeneration({
    userId: null, merchantId: input.merchantId, productId: input.productId ?? null, personPhotoId: null,
    provider: provider.id, model: provider.model, reservedCostUsd: provider.costPerImageUsd,
    source: "api", apiKeyId: input.apiKeyId, externalRef: input.externalRef ?? null,
  });
  const started = Date.now();
  try {
    const out = await provider.generate({ person: input.person, garment: input.garment, category: input.category });
    const ext = out.mimeType === "image/jpeg" ? "jpg" : out.mimeType === "image/webp" ? "webp" : "png";
    const path = `api/${input.merchantId}/${id}.${ext}`;
    await blobs.upload(BUCKETS.results, path, out.bytes, out.mimeType);
    const resultUrl = await blobs.signedUrl(BUCKETS.results, path, API_RESULT_URL_TTL);
    const latencyMs = Date.now() - started;
    await repo.completeGeneration(id, { status: "succeeded", resultPath: path, latencyMs, costUsd: provider.costPerImageUsd, providerJobId: out.providerJobId });
    await repo.recordUsage({ merchantId: input.merchantId, generationId: id, unitCostUsd: provider.costPerImageUsd, billingPeriod: billingPeriod(now) }).catch(() => {});
    return { ok: true, id, resultUrl, resultExpiresAt: new Date(now.getTime() + API_RESULT_URL_TTL * 1000).toISOString(), latencyMs };
  } catch (err) {
    const code = err instanceof ProviderError ? err.code : "provider_error";
    const latencyMs = Date.now() - started;
    await repo
      .completeGeneration(id, {
        status: code === "content_rejected" || code === "invalid_input" ? "rejected" : "failed",
        latencyMs, costUsd: 0, errorCode: code, errorMessage: (err instanceof Error ? err.message : String(err)).slice(0, 500),
      })
      .catch(() => {});
    const map: Record<string, [number, string]> = {
      invalid_input: [422, "The images could not be used. Use a clear, front-facing photo and a clean garment image."],
      content_rejected: [422, "The images were declined by the safety filter."],
      rate_limited: [503, "The AI provider is busy. Retry shortly."],
      timeout: [504, "Generation timed out. Retry."],
    };
    const [status, message] = map[code] ?? [502, "Generation failed. You are not charged for failed generations."];
    return { ok: false, status, code: code === "provider_error" ? "generation_failed" : code, message, id };
  }
}

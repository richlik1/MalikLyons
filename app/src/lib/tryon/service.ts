import { billingPeriod } from "../billing";
import { evaluateLimits, type LimitConfig, type UsageSnapshot } from "../limits";
import { ProviderError, type GarmentCategory, type TryOnProvider } from "../providers/types";

// Orchestrates one try-on. All I/O is injected so the flow is unit-testable and the
// provider can be swapped without touching this file.

export interface PhotoRecord {
  id: string;
  storagePath: string;
  mimeType: string;
  expiresAt: Date;
  deletedAt: Date | null;
}

export interface ProductRecord {
  id: string;
  merchantId: string;
  name: string;
  category: GarmentCategory;
  imagePath: string;
  purchaseUrl: string;
  isActive: boolean;
}

export interface NewGeneration {
  userId: string;
  merchantId: string;
  productId: string;
  personPhotoId: string;
  provider: string;
  model: string;
  reservedCostUsd: number;
}

export interface GenerationPatch {
  status: "succeeded" | "failed" | "rejected";
  resultPath?: string;
  latencyMs: number;
  costUsd: number;
  errorCode?: string;
  errorMessage?: string;
  providerJobId?: string;
}

export interface TryOnRepo {
  getPhoto(userId: string, photoId: string): Promise<PhotoRecord | null>;
  getProduct(productId: string): Promise<ProductRecord | null>;
  getUsage(userId: string, merchantId: string, now: Date): Promise<UsageSnapshot>;
  createGeneration(row: NewGeneration): Promise<string>;
  completeGeneration(id: string, patch: GenerationPatch): Promise<void>;
  /** Append one billable unit to the usage ledger (idempotent per generation). */
  recordUsage(row: { merchantId: string; generationId: string; unitCostUsd: number; billingPeriod: string }): Promise<void>;
}

export interface BlobStore {
  download(bucket: string, path: string): Promise<{ bytes: Uint8Array; mimeType: string }>;
  upload(bucket: string, path: string, bytes: Uint8Array, mimeType: string): Promise<void>;
  signedUrl(bucket: string, path: string, expiresInSeconds: number): Promise<string>;
}

export interface TryOnDeps {
  repo: TryOnRepo;
  blobs: BlobStore;
  provider: TryOnProvider | null;
  limits: LimitConfig;
  now?: () => Date;
  log?: (event: string, data: Record<string, unknown>) => void;
}

export type TryOnResult =
  | {
      ok: true;
      generationId: string;
      resultUrl: string;
      personUrl: string;
      product: { id: string; name: string; purchaseUrl: string };
    }
  | { ok: false; status: number; code: string; message: string; retryAfterSeconds?: number; generationId?: string };

export const BUCKETS = { photos: "person-photos", results: "tryon-results", garments: "garments" } as const;
const SIGNED_URL_TTL = 60 * 10;

const USER_MESSAGES: Record<string, string> = {
  invalid_input: "We couldn't generate a preview from this photo. A well-lit, front-facing, full-body or upper-body photo works best.",
  content_rejected: "This image was declined by the safety filter. Please try a different photo.",
  rate_limited: "Our AI provider is busy. Please try again in a moment.",
  timeout: "The preview took too long. Please try again.",
  provider_error: "Something went wrong generating your preview. This attempt does not count toward your daily limit.",
  not_configured: "Virtual try-on is temporarily unavailable.",
};

export async function runTryOn(
  req: { userId: string; photoId: string; productId: string },
  deps: TryOnDeps,
): Promise<TryOnResult> {
  const now = deps.now?.() ?? new Date();
  const log = deps.log ?? (() => {});
  const { provider, repo, blobs } = deps;

  if (!provider) {
    return { ok: false, status: 503, code: "not_configured", message: USER_MESSAGES.not_configured };
  }

  const [photo, product] = await Promise.all([repo.getPhoto(req.userId, req.photoId), repo.getProduct(req.productId)]);
  if (!photo || photo.deletedAt) {
    return { ok: false, status: 404, code: "photo_not_found", message: "Please upload a photo first." };
  }
  if (photo.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, status: 410, code: "photo_expired", message: "This photo has expired under our retention policy. Please upload it again." };
  }
  if (!product || !product.isActive) {
    return { ok: false, status: 404, code: "product_not_found", message: "This item is no longer available." };
  }
  if (!provider.supportedCategories.includes(product.category)) {
    return { ok: false, status: 422, code: "unsupported_category", message: "Try-on isn't available for this item yet." };
  }

  const usage = await repo.getUsage(req.userId, product.merchantId, now);
  const decision = evaluateLimits(usage, deps.limits, provider.costPerImageUsd);
  if (!decision.allowed) {
    log("tryon.limited", { userId: req.userId, reason: decision.reason });
    return { ok: false, status: 429, code: decision.reason, message: decision.message, retryAfterSeconds: decision.retryAfterSeconds };
  }

  // Insert the pending row first: it reserves budget and counts toward rate limits
  // while the provider call is in flight.
  const generationId = await repo.createGeneration({
    userId: req.userId,
    merchantId: product.merchantId,
    productId: product.id,
    personPhotoId: photo.id,
    provider: provider.id,
    model: provider.model,
    reservedCostUsd: provider.costPerImageUsd,
  });

  const started = Date.now();
  try {
    const [person, garment, personUrl] = await Promise.all([
      blobs.download(BUCKETS.photos, photo.storagePath),
      blobs.download(BUCKETS.garments, product.imagePath),
      blobs.signedUrl(BUCKETS.photos, photo.storagePath, SIGNED_URL_TTL),
    ]);

    const output = await provider.generate({ person, garment, category: product.category });

    const ext = output.mimeType === "image/jpeg" ? "jpg" : output.mimeType === "image/webp" ? "webp" : "png";
    const resultPath = `${req.userId}/${generationId}.${ext}`;
    await blobs.upload(BUCKETS.results, resultPath, output.bytes, output.mimeType);
    const resultUrl = await blobs.signedUrl(BUCKETS.results, resultPath, SIGNED_URL_TTL);

    const latencyMs = Date.now() - started;
    await repo.completeGeneration(generationId, {
      status: "succeeded",
      resultPath,
      latencyMs,
      costUsd: provider.costPerImageUsd,
      providerJobId: output.providerJobId,
    });
    // Metering failure must not fail the shopper's request, but it must be visible.
    await repo
      .recordUsage({ merchantId: product.merchantId, generationId, unitCostUsd: provider.costPerImageUsd, billingPeriod: billingPeriod(now) })
      .catch((e) => log("usage.record_failed", { generationId, error: String(e) }));
    log("tryon.succeeded", { generationId, provider: provider.id, latencyMs });

    return {
      ok: true,
      generationId,
      resultUrl,
      personUrl,
      product: { id: product.id, name: product.name, purchaseUrl: product.purchaseUrl },
    };
  } catch (err) {
    const latencyMs = Date.now() - started;
    const code = err instanceof ProviderError ? err.code : "provider_error";
    const rawMessage = err instanceof Error ? err.message : String(err);
    await repo
      .completeGeneration(generationId, {
        status: code === "content_rejected" || code === "invalid_input" ? "rejected" : "failed",
        latencyMs,
        // Assumes failed predictions are not billed (FASHN documents this); revisit per provider.
        costUsd: 0,
        errorCode: code,
        errorMessage: rawMessage.slice(0, 500),
      })
      .catch((e) => log("tryon.log_failed", { generationId, error: String(e) }));
    log("tryon.failed", { generationId, provider: provider.id, code, error: rawMessage });

    const status = code === "invalid_input" || code === "content_rejected" ? 422 : code === "rate_limited" ? 429 : 502;
    return { ok: false, status, code, message: USER_MESSAGES[code] ?? USER_MESSAGES.provider_error, generationId };
  }
}

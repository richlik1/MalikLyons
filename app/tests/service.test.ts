import { beforeEach, describe, expect, it } from "vitest";
import { ProviderError, type TryOnProvider } from "@/lib/providers/types";
import { runTryOn, type BlobStore, type GenerationPatch, type NewGeneration, type TryOnRepo } from "@/lib/tryon/service";

const USER = "11111111-1111-1111-1111-111111111111";
const NOW = new Date("2026-10-12T12:00:00Z");
const limits = { perUserPerMinute: 2, perUserPerDay: 15, globalDailyBudgetUsd: 20 };

class FakeRepo implements TryOnRepo {
  created: NewGeneration[] = [];
  completed: { id: string; patch: GenerationPatch }[] = [];
  photo = { id: "p1", storagePath: `${USER}/p1.jpg`, mimeType: "image/jpeg", expiresAt: new Date("2026-11-01"), deletedAt: null as Date | null };
  product = { id: "g1", merchantId: "m1", name: "Box Hoodie", category: "tops" as const, imagePath: "m/g1.png", purchaseUrl: "https://shop.example/hoodie", isActive: true };
  usage = { userLastMinute: 0, userLastDay: 0, globalSpendTodayUsd: 0 };
  async getPhoto(userId: string) { return userId === USER ? this.photo : null; }
  async getProduct(id: string) { return id === this.product.id ? this.product : null; }
  async getUsage() { return this.usage; }
  async createGeneration(row: NewGeneration) { this.created.push(row); return "gen-1"; }
  async completeGeneration(id: string, patch: GenerationPatch) { this.completed.push({ id, patch }); }
}

class FakeBlobs implements BlobStore {
  uploads: string[] = [];
  async download() { return { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg" }; }
  async upload(bucket: string, path: string) { this.uploads.push(`${bucket}/${path}`); }
  async signedUrl(bucket: string, path: string) { return `https://signed.example/${bucket}/${path}`; }
}

// Test double for the provider interface. Lives only in tests; the app has no fake provider.
function provider(impl: TryOnProvider["generate"]): TryOnProvider {
  return { id: "test", model: "test-model", supportedCategories: ["tops"], costPerImageUsd: 0.075, generate: impl };
}

let repo: FakeRepo;
let blobs: FakeBlobs;
beforeEach(() => { repo = new FakeRepo(); blobs = new FakeBlobs(); });

const req = { userId: USER, photoId: "p1", productId: "g1" };

describe("runTryOn", () => {
  it("generates, stores the result privately, logs cost and latency", async () => {
    const res = await runTryOn(req, { repo, blobs, limits, now: () => NOW, provider: provider(async () => ({ bytes: new Uint8Array([9]), mimeType: "image/png", providerJobId: "job-7" })) });
    expect(res).toMatchObject({ ok: true, generationId: "gen-1", product: { purchaseUrl: "https://shop.example/hoodie" } });
    expect(blobs.uploads).toEqual([`tryon-results/${USER}/gen-1.png`]);
    expect(repo.created[0]).toMatchObject({ provider: "test", reservedCostUsd: 0.075 });
    expect(repo.completed[0].patch).toMatchObject({ status: "succeeded", costUsd: 0.075, providerJobId: "job-7" });
  });

  it("returns 503 honestly when no provider is configured", async () => {
    const res = await runTryOn(req, { repo, blobs, limits, provider: null });
    expect(res).toMatchObject({ ok: false, status: 503, code: "not_configured" });
    expect(repo.created).toHaveLength(0);
  });

  it("refuses photos owned by someone else", async () => {
    const res = await runTryOn({ ...req, userId: "someone-else" }, { repo, blobs, limits, provider: provider(async () => { throw new Error("must not be called"); }) });
    expect(res).toMatchObject({ ok: false, status: 404, code: "photo_not_found" });
  });

  it("refuses expired photos (retention policy)", async () => {
    repo.photo.expiresAt = new Date("2026-10-01");
    const res = await runTryOn(req, { repo, blobs, limits, now: () => NOW, provider: provider(async () => { throw new Error("no"); }) });
    expect(res).toMatchObject({ ok: false, status: 410 });
  });

  it("refuses unsupported categories before spending money", async () => {
    repo.product = { ...repo.product, category: "bottoms" as never };
    const res = await runTryOn(req, { repo, blobs, limits, now: () => NOW, provider: provider(async () => { throw new Error("no"); }) });
    expect(res).toMatchObject({ ok: false, code: "unsupported_category" });
    expect(repo.created).toHaveLength(0);
  });

  it("rate-limits before calling the provider", async () => {
    repo.usage.userLastDay = 15;
    let called = false;
    const res = await runTryOn(req, { repo, blobs, limits, now: () => NOW, provider: provider(async () => { called = true; return { bytes: new Uint8Array(), mimeType: "image/png" }; }) });
    expect(res).toMatchObject({ ok: false, status: 429, code: "user_day" });
    expect(called).toBe(false);
  });

  it("logs provider failures with zero cost and a user-safe message", async () => {
    const res = await runTryOn(req, { repo, blobs, limits, now: () => NOW, provider: provider(async () => { throw new ProviderError("content_rejected", "nsfw filter"); }) });
    expect(res).toMatchObject({ ok: false, status: 422, code: "content_rejected", generationId: "gen-1" });
    expect(repo.completed[0].patch).toMatchObject({ status: "rejected", costUsd: 0, errorCode: "content_rejected", errorMessage: "nsfw filter" });
    if (!res.ok) expect(res.message).not.toContain("nsfw filter");
  });

  it("treats unexpected errors as provider_error (502)", async () => {
    const res = await runTryOn(req, { repo, blobs, limits, now: () => NOW, provider: provider(async () => { throw new TypeError("boom"); }) });
    expect(res).toMatchObject({ ok: false, status: 502, code: "provider_error" });
    expect(repo.completed[0].patch.status).toBe("failed");
  });
});

import { describe, expect, it, vi } from "vitest";
import { bearerToken, generateApiKey, hashApiKey, keyKindOf, normalizeOrigin } from "@/lib/api-keys";
import { decodeBase64Image, fetchRemoteImage, isPrivateAddress } from "@/lib/remote-image";
import { ProviderError, type TryOnProvider } from "@/lib/providers/types";
import { runApiTryOn, type ApiRepo } from "@/lib/tryon/api-service";
import type { BlobStore, GenerationPatch, NewGeneration } from "@/lib/tryon/service";
import { png } from "./fixtures";

describe("API keys", () => {
  it("generates distinct, typed keys and stores only a hash", () => {
    const a = generateApiKey("secret"), b = generateApiKey("secret"), p = generateApiKey("publishable");
    expect(a.plaintext).toMatch(/^ts_sk_[0-9A-Za-z]{32}$/);
    expect(p.plaintext).toMatch(/^ts_pk_[0-9A-Za-z]{32}$/);
    expect(a.plaintext).not.toBe(b.plaintext);
    expect(a.hash).toBe(hashApiKey(a.plaintext));
    expect(a.hash).not.toContain(a.plaintext.slice(6));
    expect(a.prefix).toBe(a.plaintext.slice(0, 10));
    expect(keyKindOf(a.plaintext)).toBe("secret");
    expect(keyKindOf(p.plaintext)).toBe("publishable");
    expect(keyKindOf("ts_sk_short")).toBeNull();
  });
  it("parses bearer tokens and normalizes origins", () => {
    expect(bearerToken("Bearer abc")).toBe("abc");
    expect(bearerToken("Basic abc")).toBeNull();
    expect(normalizeOrigin("https://shop.example/products/x")).toBe("https://shop.example");
    expect(normalizeOrigin("javascript:alert(1)")).toBeNull();
    expect(normalizeOrigin("http://shop.example")).toBeNull();
  });
});

describe("SSRF protection for image URLs", () => {
  it("classifies private and public addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "151.101.1.69", "2606:4700::6810:84e5"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });
  const ok = () => new Response(png(800, 1000), { status: 200, headers: { "content-type": "image/png" } });
  it("refuses non-https, odd ports, credentials, and hosts resolving to private IPs", async () => {
    const f = vi.fn(async () => ok());
    await expect(fetchRemoteImage("http://cdn.example/a.png", { fetchImpl: f })).rejects.toThrow(/https/);
    await expect(fetchRemoteImage("https://cdn.example:8443/a.png", { fetchImpl: f })).rejects.toThrow(/port/);
    await expect(fetchRemoteImage("https://u:p@cdn.example/a.png", { fetchImpl: f })).rejects.toThrow(/credentials/);
    await expect(fetchRemoteImage("https://169.254.169.254/latest/meta-data", { fetchImpl: f })).rejects.toThrow(/publicly/);
    await expect(fetchRemoteImage("https://internal.example/a.png", { fetchImpl: f, lookupImpl: async () => [{ address: "8.8.8.8" }, { address: "10.0.0.5" }] })).rejects.toThrow(/publicly/);
    expect(f).not.toHaveBeenCalled();
  });
  it("refuses redirects, oversized and non-image responses", async () => {
    const lookupImpl = async () => [{ address: "93.184.216.34" }];
    await expect(fetchRemoteImage("https://cdn.example/a", { lookupImpl, fetchImpl: async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1" } }) })).rejects.toThrow(/redirect/);
    await expect(fetchRemoteImage("https://cdn.example/a", { lookupImpl, fetchImpl: async () => new Response("x", { headers: { "content-length": String(20e6) } }) })).rejects.toThrow(/8 MB/);
    await expect(fetchRemoteImage("https://cdn.example/a", { lookupImpl, fetchImpl: async () => new Response("<html>") })).rejects.toThrow(/JPEG, PNG or WebP/);
  });
  it("downloads and validates a public image", async () => {
    const r = await fetchRemoteImage("https://cdn.example/a.png", { lookupImpl: async () => [{ address: "93.184.216.34" }], fetchImpl: async () => ok(), minDimension: 512 });
    expect(r.mimeType).toBe("image/png");
  });
  it("decodes base64 / data URLs with validation", () => {
    const b64 = Buffer.from(png(800, 1000)).toString("base64");
    expect(decodeBase64Image(b64).mimeType).toBe("image/png");
    expect(decodeBase64Image(`data:image/png;base64,${b64}`).mimeType).toBe("image/png");
    expect(() => decodeBase64Image(Buffer.from("not an image").toString("base64"))).toThrow();
  });
});

describe("runApiTryOn", () => {
  const limits = { perUserPerMinute: 2, perUserPerDay: 15, globalDailyBudgetUsd: 20 };
  const img = { bytes: png(800, 1000), mimeType: "image/png" };
  function setup(usage: Partial<{ globalSpendTodayUsd: number; keyLastMinute: number; merchant: { used: number; included: number; hardCap: boolean; status: "active" | "suspended" } }> = {}) {
    const created: NewGeneration[] = [], completed: GenerationPatch[] = [], usageRows: unknown[] = [], uploads: string[] = [];
    const repo: ApiRepo = {
      getApiUsage: async () => ({ globalSpendTodayUsd: 0, keyLastMinute: 0, merchant: { used: 0, included: 500, hardCap: true, status: "active" }, ...usage }),
      createGeneration: async (r) => { created.push(r); return "gen-api-1"; },
      completeGeneration: async (_id, p) => { completed.push(p); },
      recordUsage: async (r) => { usageRows.push(r); },
    };
    const blobs: BlobStore = { download: async () => img, upload: async (b, p) => { uploads.push(`${b}/${p}`); }, signedUrl: async (b, p) => `https://signed/${b}/${p}` };
    return { repo, blobs, created, completed, usageRows, uploads };
  }
  const provider = (gen: TryOnProvider["generate"]): TryOnProvider => ({ id: "t", model: "m", supportedCategories: ["tops"], costPerImageUsd: 0.075, generate: gen });
  const input = { merchantId: "m1", apiKeyId: "k1", person: img, garment: img, category: "tops" as const, externalRef: "ord_1" };

  it("generates, stores under the merchant's API folder, meters usage and attributes to the key", async () => {
    const s = setup();
    const r = await runApiTryOn(input, { ...s, limits, perKeyPerMinute: 30, provider: provider(async () => ({ bytes: new Uint8Array([1]), mimeType: "image/png" })) });
    expect(r).toMatchObject({ ok: true, id: "gen-api-1", resultUrl: "https://signed/tryon-results/api/m1/gen-api-1.png" });
    expect(s.created[0]).toMatchObject({ source: "api", apiKeyId: "k1", userId: null, personPhotoId: null, externalRef: "ord_1" });
    expect(s.usageRows).toHaveLength(1);
  });
  it("enforces the per-key rate limit and the monthly allowance before spending", async () => {
    const gen = vi.fn();
    const a = setup({ keyLastMinute: 30 });
    expect(await runApiTryOn(input, { ...a, limits, perKeyPerMinute: 30, provider: provider(gen) })).toMatchObject({ ok: false, status: 429, code: "rate_limited" });
    const b = setup({ merchant: { used: 500, included: 500, hardCap: true, status: "active" } });
    expect(await runApiTryOn(input, { ...b, limits, perKeyPerMinute: 30, provider: provider(gen) })).toMatchObject({ ok: false, status: 429, code: "quota_exceeded" });
    const c = setup({ merchant: { used: 0, included: 500, hardCap: true, status: "suspended" } });
    expect(await runApiTryOn(input, { ...c, limits, perKeyPerMinute: 30, provider: provider(gen) })).toMatchObject({ ok: false, status: 403, code: "account_suspended" });
    expect(gen).not.toHaveBeenCalled();
  });
  it("does not bill failures and returns stable error codes", async () => {
    const s = setup();
    const r = await runApiTryOn(input, { ...s, limits, perKeyPerMinute: 30, provider: provider(async () => { throw new ProviderError("content_rejected", "nsfw"); }) });
    expect(r).toMatchObject({ ok: false, status: 422, code: "content_rejected", id: "gen-api-1" });
    expect(s.completed[0]).toMatchObject({ status: "rejected", costUsd: 0 });
    expect(s.usageRows).toHaveLength(0);
  });
  it("reports provider_unavailable honestly when no provider is configured", async () => {
    const s = setup();
    expect(await runApiTryOn(input, { ...s, limits, perKeyPerMinute: 30, provider: null })).toMatchObject({ ok: false, status: 503, code: "provider_unavailable" });
  });
});

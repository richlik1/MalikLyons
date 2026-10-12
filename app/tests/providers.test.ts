import { describe, expect, it, vi } from "vitest";
import { FashnProvider } from "@/lib/providers/fashn";
import { VertexTryOnProvider } from "@/lib/providers/vertex";
import { createProvider } from "@/lib/providers";
import { ProviderError } from "@/lib/providers/types";

const input = {
  person: { bytes: new Uint8Array([1, 2]), mimeType: "image/jpeg" },
  garment: { bytes: new Uint8Array([3, 4]), mimeType: "image/png" },
  category: "tops" as const,
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("FashnProvider", () => {
  it("submits a job, polls until completed and decodes base64 output", async () => {
    const out = Buffer.from([7, 7, 7]).toString("base64");
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({ id: "pred-1", error: null }))
      .mockResolvedValueOnce(json({ id: "pred-1", status: "processing" }))
      .mockResolvedValueOnce(json({ id: "pred-1", status: "completed", output: [`data:image/png;base64,${out}`] }));
    const p = new FashnProvider({ apiKey: "k", fetchImpl, pollIntervalMs: 1 });
    const res = await p.generate(input);
    expect([...res.bytes]).toEqual([7, 7, 7]);
    expect(res.providerJobId).toBe("pred-1");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.fashn.ai/v1/run");
    expect(init.headers.Authorization).toBe("Bearer k");
    const body = JSON.parse(init.body);
    expect(body.model_name).toBe("tryon-v1.6");
    expect(body.inputs.model_image).toMatch(/^data:image\/jpeg;base64,/);
    expect(body.inputs.category).toBe("tops");
  });

  it("maps moderation failures to content_rejected", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({ id: "x" }))
      .mockResolvedValueOnce(json({ id: "x", status: "failed", error: { name: "ContentModerationError", message: "blocked" } }));
    await expect(new FashnProvider({ apiKey: "k", fetchImpl, pollIntervalMs: 1 }).generate(input)).rejects.toMatchObject({ code: "content_rejected" });
  });

  it("maps HTTP 429 to retryable rate_limited", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response("slow down", { status: 429 }));
    await expect(new FashnProvider({ apiKey: "k", fetchImpl }).generate(input)).rejects.toMatchObject({ code: "rate_limited", retryable: true });
  });

  it("times out instead of polling forever", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json({ id: "x" })).mockImplementation(async () => json({ id: "x", status: "in_queue" }));
    await expect(new FashnProvider({ apiKey: "k", fetchImpl, pollIntervalMs: 1, timeoutMs: 10 }).generate(input)).rejects.toMatchObject({ code: "timeout" });
  });

  it("refuses to construct without an API key", () => {
    expect(() => new FashnProvider({ apiKey: "" })).toThrow(ProviderError);
  });
});

describe("VertexTryOnProvider", () => {
  it("calls :predict with base64 person and product images", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json({ predictions: [{ bytesBase64Encoded: Buffer.from([5]).toString("base64"), mimeType: "image/png" }] }));
    const p = new VertexTryOnProvider({ project: "proj", getAccessToken: async () => "tok", fetchImpl });
    const res = await p.generate(input);
    expect([...res.bytes]).toEqual([5]);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://us-central1-aiplatform.googleapis.com/v1/projects/proj/locations/us-central1/publishers/google/models/virtual-try-on-001:predict");
    const body = JSON.parse(init.body);
    expect(body.instances[0].personImage.image.bytesBase64Encoded).toBe(Buffer.from([1, 2]).toString("base64"));
    expect(body.instances[0].productImages[0].image.bytesBase64Encoded).toBe(Buffer.from([3, 4]).toString("base64"));
    expect(body.parameters.sampleCount).toBe(1);
  });

  it("treats a filtered/empty prediction as content_rejected", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json({ predictions: [{ raiFilteredReason: "filtered" }] }));
    await expect(new VertexTryOnProvider({ project: "p", getAccessToken: async () => "t", fetchImpl }).generate(input)).rejects.toMatchObject({ code: "content_rejected" });
  });
});

describe("createProvider", () => {
  it("returns null (never a fake provider) when unconfigured", () => {
    expect(createProvider({})).toBeNull();
    expect(createProvider({ TRYON_PROVIDER: "fashn" })).toBeNull();
    expect(createProvider({ TRYON_PROVIDER: "mock" })).toBeNull();
  });
  it("builds FASHN with configured cost", () => {
    const p = createProvider({ TRYON_PROVIDER: "fashn", FASHN_API_KEY: "k", FASHN_COST_PER_IMAGE_USD: "0.049" });
    expect(p?.id).toBe("fashn");
    expect(p?.costPerImageUsd).toBe(0.049);
  });
});

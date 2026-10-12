import { fromBase64, mapHttpStatus, toBase64, type FetchLike } from "./http";
import { ProviderError, type TryOnInput, type TryOnOutput, type TryOnProvider } from "./types";

// Google Vertex AI Virtual Try-On (synchronous :predict).
// Lifecycle: virtual-try-on-001 is GA (Jan 2026) with a documented retirement date of
// 2027-03-15. Plan migration before relying on it. See docs/01-research-report.md.

export interface VertexOptions {
  project: string;
  location?: string;
  model?: string;
  costPerImageUsd?: number;
  getAccessToken: () => Promise<string>;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

export class VertexTryOnProvider implements TryOnProvider {
  readonly id = "google-vertex";
  readonly model: string;
  // Google documents tops, bottoms and footwear; we only enable the categories in our MVP scope.
  readonly supportedCategories = ["tops", "bottoms", "one-pieces"] as const;
  readonly costPerImageUsd: number;
  private readonly location: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(private readonly opts: VertexOptions) {
    if (!opts.project) throw new ProviderError("not_configured", "GOOGLE_CLOUD_PROJECT is not set");
    this.model = opts.model ?? "virtual-try-on-001";
    this.location = opts.location ?? "us-central1";
    this.costPerImageUsd = opts.costPerImageUsd ?? 0.06;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 90_000;
  }

  async generate(input: TryOnInput, signal?: AbortSignal): Promise<TryOnOutput> {
    const token = await this.opts.getAccessToken();
    const url =
      `https://${this.location}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(this.opts.project)}` +
      `/locations/${this.location}/publishers/google/models/${this.model}:predict`;

    const timeout = AbortSignal.timeout(this.timeoutMs);
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      body: JSON.stringify({
        instances: [
          {
            personImage: { image: { bytesBase64Encoded: toBase64(input.person.bytes) } },
            productImages: [{ image: { bytesBase64Encoded: toBase64(input.garment.bytes) } }],
          },
        ],
        parameters: { sampleCount: 1, personGeneration: "allow_adult", addWatermark: true },
      }),
    }).catch((err: unknown) => {
      if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
        throw new ProviderError("timeout", "Vertex AI request timed out", true);
      }
      throw err;
    });

    const text = await res.text();
    if (!res.ok) throw mapHttpStatus(res.status, text);
    const body = JSON.parse(text) as {
      predictions?: { bytesBase64Encoded?: string; mimeType?: string; raiFilteredReason?: string }[];
    };
    const prediction = body.predictions?.[0];
    if (!prediction || prediction.raiFilteredReason) {
      throw new ProviderError("content_rejected", prediction?.raiFilteredReason ?? "No image returned (possibly safety-filtered)");
    }
    if (!prediction.bytesBase64Encoded) throw new ProviderError("provider_error", "Vertex AI returned no image bytes");
    return { bytes: fromBase64(prediction.bytesBase64Encoded), mimeType: prediction.mimeType ?? "image/png" };
  }
}

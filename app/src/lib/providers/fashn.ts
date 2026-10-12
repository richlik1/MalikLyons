import { fromBase64, mapHttpStatus, sleep, toBase64, type FetchLike } from "./http";
import { ProviderError, type TryOnInput, type TryOnOutput, type TryOnProvider } from "./types";

// FASHN async API: POST /v1/run returns a prediction id; poll GET /v1/status/:id.
// Verify field names against https://docs.fashn.ai before production — they are
// implemented from FASHN's public v1 docs and have not been exercised with a live key here.

export interface FashnOptions {
  apiKey: string;
  model?: string;
  costPerImageUsd?: number;
  baseUrl?: string;
  fetchImpl?: FetchLike;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

type FashnStatus = {
  id: string;
  status: "starting" | "in_queue" | "processing" | "completed" | "failed" | "canceled";
  output?: string[] | null;
  error?: { name?: string; message?: string } | null;
};

export class FashnProvider implements TryOnProvider {
  readonly id = "fashn";
  readonly model: string;
  readonly supportedCategories = ["tops", "bottoms", "one-pieces"] as const;
  readonly costPerImageUsd: number;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;

  constructor(private readonly opts: FashnOptions) {
    if (!opts.apiKey) throw new ProviderError("not_configured", "FASHN_API_KEY is not set");
    this.model = opts.model ?? "tryon-v1.6";
    this.costPerImageUsd = opts.costPerImageUsd ?? 0.075;
    this.baseUrl = opts.baseUrl ?? "https://api.fashn.ai/v1";
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.pollIntervalMs = opts.pollIntervalMs ?? 1500;
    this.timeoutMs = opts.timeoutMs ?? 90_000;
  }

  private headers() {
    return { Authorization: `Bearer ${this.opts.apiKey}`, "Content-Type": "application/json" };
  }

  private imageRef(img: TryOnInput["person"]): string {
    return img.signedUrl ?? `data:${img.mimeType};base64,${toBase64(img.bytes)}`;
  }

  async generate(input: TryOnInput, signal?: AbortSignal): Promise<TryOnOutput> {
    const started = Date.now();
    const runRes = await this.fetchImpl(`${this.baseUrl}/run`, {
      method: "POST",
      headers: this.headers(),
      signal,
      body: JSON.stringify({
        model_name: this.model,
        inputs: {
          model_image: this.imageRef(input.person),
          garment_image: this.imageRef(input.garment),
          category: input.category,
          moderation_level: "conservative",
          output_format: "png",
          return_base64: true,
        },
      }),
    });
    const runText = await runRes.text();
    if (!runRes.ok) throw mapHttpStatus(runRes.status, runText);
    const run = JSON.parse(runText) as { id?: string; error?: unknown };
    if (!run.id) throw new ProviderError("provider_error", "FASHN did not return a prediction id");

    while (Date.now() - started < this.timeoutMs) {
      await sleep(this.pollIntervalMs);
      const res = await this.fetchImpl(`${this.baseUrl}/status/${encodeURIComponent(run.id)}`, {
        headers: this.headers(),
        signal,
      });
      const text = await res.text();
      if (!res.ok) throw mapHttpStatus(res.status, text);
      const status = JSON.parse(text) as FashnStatus;

      if (status.status === "completed") {
        const first = status.output?.[0];
        if (!first) throw new ProviderError("provider_error", "FASHN completed without output");
        return { ...(await this.decodeOutput(first, signal)), providerJobId: run.id };
      }
      if (status.status === "failed" || status.status === "canceled") {
        const name = status.error?.name ?? "";
        const message = status.error?.message ?? "Generation failed";
        if (/content|moderation|nsfw/i.test(name + message)) throw new ProviderError("content_rejected", message);
        if (/pose|image|load|detect/i.test(name)) throw new ProviderError("invalid_input", message);
        throw new ProviderError("provider_error", message);
      }
    }
    throw new ProviderError("timeout", `FASHN did not finish within ${this.timeoutMs}ms`, true);
  }

  private async decodeOutput(output: string, signal?: AbortSignal): Promise<Omit<TryOnOutput, "providerJobId">> {
    const dataUrl = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(output);
    if (dataUrl) return { mimeType: dataUrl[1], bytes: fromBase64(dataUrl[2]) };
    if (output.startsWith("https://")) {
      const res = await this.fetchImpl(output, { signal });
      if (!res.ok) throw new ProviderError("provider_error", `Could not download FASHN output (${res.status})`);
      return { mimeType: res.headers.get("content-type") ?? "image/png", bytes: new Uint8Array(await res.arrayBuffer()) };
    }
    // Some responses return bare base64 when return_base64 is set.
    return { mimeType: "image/png", bytes: fromBase64(output) };
  }
}

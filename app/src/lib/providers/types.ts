// Provider abstraction: every virtual try-on vendor implements this interface so the
// rest of the app never depends on a specific vendor's API shape.

export type GarmentCategory = "tops" | "bottoms" | "one-pieces";

export interface ImageInput {
  /** Raw image bytes (server-side only). */
  bytes: Uint8Array;
  mimeType: string;
  /** Optional short-lived signed URL for providers that prefer fetching by URL. */
  signedUrl?: string;
}

export interface TryOnInput {
  person: ImageInput;
  garment: ImageInput;
  category: GarmentCategory;
}

export interface TryOnOutput {
  bytes: Uint8Array;
  mimeType: string;
  providerJobId?: string;
}

export type ProviderErrorCode =
  | "not_configured"
  | "invalid_input"
  | "content_rejected"
  | "rate_limited"
  | "timeout"
  | "provider_error";

export class ProviderError extends Error {
  constructor(
    public readonly code: ProviderErrorCode,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface TryOnProvider {
  readonly id: string;
  readonly model: string;
  readonly supportedCategories: readonly GarmentCategory[];
  /** Estimated cost per successful image in USD (for monitoring; not a bill). */
  readonly costPerImageUsd: number;
  generate(input: TryOnInput, signal?: AbortSignal): Promise<TryOnOutput>;
}

import { ProviderError } from "./types";

export type FetchLike = typeof fetch;

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export function fromBase64(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

export function mapHttpStatus(status: number, body: string): ProviderError {
  if (status === 400 || status === 422) return new ProviderError("invalid_input", `Provider rejected input (${status})`);
  if (status === 401 || status === 403) return new ProviderError("not_configured", `Provider auth failed (${status})`);
  if (status === 429) return new ProviderError("rate_limited", "Provider rate limit reached", true);
  if (status >= 500) return new ProviderError("provider_error", `Provider unavailable (${status})`, true);
  return new ProviderError("provider_error", `Unexpected provider response (${status}): ${body.slice(0, 200)}`);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

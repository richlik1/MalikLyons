import "server-only";
import { GoogleAuth } from "google-auth-library";
import { FashnProvider } from "./fashn";
import { VertexTryOnProvider } from "./vertex";
import { ProviderError, type TryOnProvider } from "./types";

export * from "./types";

type Env = Record<string, string | undefined>;

/**
 * Build the configured provider from server-side environment variables.
 * Returns null when no provider is configured — callers must show an honest
 * "unavailable" state. There is intentionally no simulated fallback.
 */
export function createProvider(env: Env = process.env): TryOnProvider | null {
  const choice = env.TRYON_PROVIDER;
  try {
    if (choice === "fashn") {
      if (!env.FASHN_API_KEY) return null;
      // FASHN_BASE_URL is for local contract testing only (check:env rejects it when deployed).
      // Runs against a stub are logged as "contract-stub" at $0 so logs never look like real spend.
      const stub = Boolean(env.FASHN_BASE_URL);
      return new FashnProvider({
        apiKey: env.FASHN_API_KEY,
        model: stub ? "contract-stub" : env.FASHN_MODEL,
        costPerImageUsd: stub ? 0 : num(env.FASHN_COST_PER_IMAGE_USD),
        baseUrl: env.FASHN_BASE_URL || undefined,
      });
    }
    if (choice === "google-vertex") {
      if (!env.GOOGLE_CLOUD_PROJECT) return null;
      const credentials = env.GOOGLE_APPLICATION_CREDENTIALS_JSON
        ? JSON.parse(env.GOOGLE_APPLICATION_CREDENTIALS_JSON)
        : undefined;
      const auth = new GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
      return new VertexTryOnProvider({
        project: env.GOOGLE_CLOUD_PROJECT,
        location: env.GOOGLE_CLOUD_LOCATION,
        model: env.VERTEX_TRYON_MODEL,
        costPerImageUsd: num(env.VERTEX_COST_PER_IMAGE_USD),
        getAccessToken: async () => {
          const token = await auth.getAccessToken();
          if (!token) throw new ProviderError("not_configured", "Could not obtain Google access token");
          return token;
        },
      });
    }
  } catch (err) {
    console.error("[provider] configuration error", err instanceof Error ? err.message : err);
    return null;
  }
  return null;
}

function num(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

// Private-by-default access gate for deployed environments (staging, pre-launch production).
// Pure functions so they can be unit-tested and used from Edge middleware.

export type Env = Record<string, string | undefined>;

// Endpoints that authenticate themselves (CRON_SECRET, Shopify HMAC, health token) or are
// public by design for storefront widgets (experiments: CORS-restricted, no personal data).
const BYPASS = ["/api/cron/", "/api/shopify/webhooks", "/api/health", "/api/experiments/"];

export function gateEnabled(env: Env): boolean {
  const appEnv = env.APP_ENV ?? "development";
  if (appEnv === "development") return env.SITE_ACCESS_MODE === "private";
  // Deployed: private unless explicitly public AND a public launch was approved.
  return !(env.SITE_ACCESS_MODE === "public" && env.PUBLIC_LAUNCH_APPROVED === "true");
}

export function isBypassed(pathname: string): boolean {
  return BYPASS.some((p) => pathname === p || pathname.startsWith(p));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Returns true if the Basic auth header carries the configured password (any username). */
export function checkBasicAuth(header: string | null, password: string | undefined): boolean {
  if (!password || password.length < 16 || !header?.startsWith("Basic ")) return false;
  try {
    const decoded = atob(header.slice(6));
    const idx = decoded.indexOf(":");
    return idx >= 0 && safeEqual(decoded.slice(idx + 1), password);
  } catch {
    return false;
  }
}

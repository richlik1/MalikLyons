import { describe, expect, it } from "vitest";
import { validateEnv } from "@/lib/env";
import { checkBasicAuth, gateEnabled, isBypassed } from "@/lib/site-access";

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (role: string) => `${b64({ alg: "HS256" })}.${b64({ role })}.sig`;

const goodStaging = {
  APP_ENV: "staging",
  NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt("anon"),
  SUPABASE_SERVICE_ROLE_KEY: jwt("service_role"),
  NEXT_PUBLIC_SITE_URL: "https://staging.trendset.example",
  CRON_SECRET: "x".repeat(40),
  SITE_ACCESS_PASSWORD: "p".repeat(20),
  TRYON_PROVIDER: "fashn",
  FASHN_API_KEY: "fa-test-key-123",
  TRYON_GLOBAL_DAILY_BUDGET_USD: "20",
};

describe("validateEnv", () => {
  it("accepts a complete private staging configuration", () => {
    const r = validateEnv(goodStaging);
    expect(r.errors).toEqual([]);
    expect(r.features).toMatchObject({ supabase: true, tryOnProvider: "fashn", siteAccess: "private", billingMode: "disabled" });
  });
  it("catches a service-role key placed in the public anon variable", () => {
    expect(validateEnv({ ...goodStaging, NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt("service_role") }).errors.join()).toMatch(/not an anon key/);
  });
  it("catches secrets exposed through NEXT_PUBLIC_ variables", () => {
    const r = validateEnv({ ...goodStaging, NEXT_PUBLIC_DEBUG: goodStaging.FASHN_API_KEY, NEXT_PUBLIC_FASHN_API_KEY: "x" });
    expect(r.errors.some((e) => e.includes("NEXT_PUBLIC_DEBUG"))).toBe(true);
    expect(r.errors.some((e) => e.includes("NEXT_PUBLIC_FASHN_API_KEY"))).toBe(true);
  });
  it("refuses a public deployment without explicit launch approval", () => {
    expect(validateEnv({ ...goodStaging, SITE_ACCESS_MODE: "public" }).ok).toBe(false);
    expect(validateEnv({ ...goodStaging, SITE_ACCESS_MODE: "public", PUBLIC_LAUNCH_APPROVED: "true" }).ok).toBe(true);
  });
  it("refuses live billing and live Stripe keys", () => {
    expect(validateEnv({ ...goodStaging, BILLING_MODE: "live" }).ok).toBe(false);
    expect(validateEnv({ ...goodStaging, STRIPE_SECRET_KEY: "sk_live_abc" }).ok).toBe(false);
  });
  it("refuses a FASHN base URL override outside development", () => {
    expect(validateEnv({ ...goodStaging, FASHN_BASE_URL: "http://127.0.0.1:54340/v1" }).ok).toBe(false);
  });
  it("requires complete Shopify configuration and a 32-byte key", () => {
    expect(validateEnv({ ...goodStaging, SHOPIFY_API_KEY: "k" }).errors.join()).toMatch(/partially configured/);
    const full = { SHOPIFY_API_KEY: "k", SHOPIFY_API_SECRET: "s", SHOPIFY_SCOPES: "read_products", SHOPIFY_TOKEN_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") };
    expect(validateEnv({ ...goodStaging, ...full }).errors.join()).toMatch(/32 bytes/);
  });
  it("is lenient in development but warns", () => {
    const r = validateEnv({});
    expect(r.ok).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe("site access gate", () => {
  it("is on by default for deployed environments", () => {
    expect(gateEnabled({ APP_ENV: "staging" })).toBe(true);
    expect(gateEnabled({ APP_ENV: "production" })).toBe(true);
    expect(gateEnabled({ APP_ENV: "production", SITE_ACCESS_MODE: "public" })).toBe(true);
    expect(gateEnabled({ APP_ENV: "production", SITE_ACCESS_MODE: "public", PUBLIC_LAUNCH_APPROVED: "true" })).toBe(false);
    expect(gateEnabled({})).toBe(false);
  });
  it("lets self-authenticating server endpoints through", () => {
    expect(isBypassed("/api/shopify/webhooks")).toBe(true);
    expect(isBypassed("/api/cron/purge")).toBe(true);
    expect(isBypassed("/api/experiments/assign")).toBe(true);
    expect(isBypassed("/api/try-on")).toBe(false);
    expect(isBypassed("/api/waitlist")).toBe(false);
  });
  it("checks the basic-auth password", () => {
    const pw = "correct-horse-battery";
    expect(checkBasicAuth(`Basic ${btoa(`tester:${pw}`)}`, pw)).toBe(true);
    expect(checkBasicAuth(`Basic ${btoa("tester:wrong")}`, pw)).toBe(false);
    expect(checkBasicAuth(null, pw)).toBe(false);
    expect(checkBasicAuth(`Basic ${btoa(`t:${pw}`)}`, "short")).toBe(false);
  });
});

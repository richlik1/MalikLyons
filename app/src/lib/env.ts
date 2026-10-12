// Environment validation for staging/production. Pure and dependency-free so it can run in
// `npm run check:env` (Node type-stripping), in /api/health, and in unit tests.
// It reports variable NAMES and problems only, never values.

export type Env = Record<string, string | undefined>;

export interface EnvReport {
  ok: boolean;
  appEnv: "development" | "staging" | "production";
  errors: string[];
  warnings: string[];
  features: {
    supabase: boolean;
    tryOnProvider: string | null;
    shopify: boolean;
    billingMode: "disabled" | "shadow";
    siteAccess: "private" | "public";
  };
}

function jwtRole(token: string | undefined): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const json = JSON.parse(Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    return typeof json.role === "string" ? json.role : null;
  } catch {
    return null;
  }
}

const isLocal = (u: string) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u);

export function validateEnv(env: Env): EnvReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const appEnvRaw = env.APP_ENV ?? (env.NODE_ENV === "production" ? "production" : "development");
  const appEnv = (["development", "staging", "production"].includes(appEnvRaw) ? appEnvRaw : "development") as EnvReport["appEnv"];
  if (env.APP_ENV && appEnv !== env.APP_ENV) errors.push("APP_ENV must be development, staging or production");
  const deployed = appEnv !== "development";

  // --- Supabase
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const supabase = Boolean(url && env.NEXT_PUBLIC_SUPABASE_ANON_KEY && env.SUPABASE_SERVICE_ROLE_KEY);
  for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
    if (!env[k]) (deployed ? errors : warnings).push(`${k} is not set`);
  }
  if (url && !url.startsWith("https://") && !(isLocal(url) && !deployed)) errors.push("NEXT_PUBLIC_SUPABASE_URL must use https outside local development");
  const anonRole = jwtRole(env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  if (anonRole && anonRole !== "anon") errors.push("NEXT_PUBLIC_SUPABASE_ANON_KEY is not an anon key (wrong role) — this would expose elevated access to browsers");
  if (env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.startsWith("sb_secret_")) errors.push("NEXT_PUBLIC_SUPABASE_ANON_KEY contains a secret key");
  const svcRole = jwtRole(env.SUPABASE_SERVICE_ROLE_KEY);
  if (svcRole && svcRole !== "service_role") errors.push("SUPABASE_SERVICE_ROLE_KEY does not have the service_role role");

  // --- No secrets in browser-exposed variables
  const secretValues = ["SUPABASE_SERVICE_ROLE_KEY", "FASHN_API_KEY", "GOOGLE_APPLICATION_CREDENTIALS_JSON", "SHOPIFY_API_SECRET", "CRON_SECRET", "SITE_ACCESS_PASSWORD", "SHOPIFY_TOKEN_ENCRYPTION_KEY", "STRIPE_SECRET_KEY"]
    .map((k) => env[k])
    .filter((v): v is string => Boolean(v && v.length >= 8));
  for (const [k, v] of Object.entries(env)) {
    if (!k.startsWith("NEXT_PUBLIC_") || !v) continue;
    if (secretValues.includes(v)) errors.push(`${k} contains the value of a server-only secret`);
    if (k !== "NEXT_PUBLIC_SUPABASE_ANON_KEY" && /(SECRET|SERVICE|PRIVATE|PASSWORD|API_KEY|TOKEN)/.test(k)) errors.push(`${k}: secrets must never use the NEXT_PUBLIC_ prefix`);
    if (/^sk_(live|test)_/.test(v) || jwtRole(v) === "service_role") errors.push(`${k} looks like a secret key`);
  }

  // --- Site URL & cron
  if (!env.NEXT_PUBLIC_SITE_URL) (deployed ? errors : warnings).push("NEXT_PUBLIC_SITE_URL is not set");
  else if (deployed && !env.NEXT_PUBLIC_SITE_URL.startsWith("https://")) errors.push("NEXT_PUBLIC_SITE_URL must use https");
  if (!env.CRON_SECRET || env.CRON_SECRET.length < 32) (deployed ? errors : warnings).push("CRON_SECRET must be at least 32 characters (retention purge is disabled without it)");

  // --- Try-on provider
  let tryOnProvider: string | null = null;
  const p = env.TRYON_PROVIDER;
  if (!p) warnings.push("TRYON_PROVIDER is not set: try-on will show as unavailable");
  else if (p === "fashn") {
    if (!env.FASHN_API_KEY) errors.push("TRYON_PROVIDER=fashn but FASHN_API_KEY is not set");
    else tryOnProvider = "fashn";
    if (env.FASHN_BASE_URL && deployed && env.FASHN_BASE_URL !== "https://api.fashn.ai/v1") errors.push("FASHN_BASE_URL must not be overridden in staging/production");
  } else if (p === "google-vertex") {
    if (!env.GOOGLE_CLOUD_PROJECT) errors.push("TRYON_PROVIDER=google-vertex but GOOGLE_CLOUD_PROJECT is not set");
    else tryOnProvider = "google-vertex";
    if (env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
      try { JSON.parse(env.GOOGLE_APPLICATION_CREDENTIALS_JSON); } catch { errors.push("GOOGLE_APPLICATION_CREDENTIALS_JSON is not valid JSON"); }
    }
    warnings.push("virtual-try-on-001 lists a retirement date of 2027-03-15; keep a second provider ready");
  } else errors.push(`TRYON_PROVIDER "${p}" is not supported (use fashn or google-vertex)`);

  // --- Limits
  for (const k of ["TRYON_LIMIT_PER_USER_PER_MINUTE", "TRYON_LIMIT_PER_USER_PER_DAY", "TRYON_GLOBAL_DAILY_BUDGET_USD", "PERSON_PHOTO_RETENTION_DAYS"]) {
    const v = env[k];
    if (v !== undefined && v !== "" && !(Number(v) > 0)) errors.push(`${k} must be a positive number`);
  }
  if (!env.TRYON_GLOBAL_DAILY_BUDGET_USD) warnings.push("TRYON_GLOBAL_DAILY_BUDGET_USD not set: defaulting to $20/day");
  if (appEnv === "staging" && Number(env.TRYON_GLOBAL_DAILY_BUDGET_USD) > 50) warnings.push("Staging daily AI budget is above $50");

  // --- Access control: deployed environments are private unless a public launch is approved.
  const publicApproved = env.PUBLIC_LAUNCH_APPROVED === "true";
  const siteAccess: "private" | "public" = env.SITE_ACCESS_MODE === "public" ? "public" : "private";
  if (deployed && siteAccess === "public" && !publicApproved) errors.push("SITE_ACCESS_MODE=public requires PUBLIC_LAUNCH_APPROVED=true (public launch is a deliberate decision)");
  if (deployed && siteAccess === "private" && (env.SITE_ACCESS_PASSWORD ?? "").length < 16) errors.push("SITE_ACCESS_PASSWORD must be at least 16 characters while the site is private");
  if (appEnv === "production" && publicApproved) warnings.push("PUBLIC_LAUNCH_APPROVED=true: the site is publicly reachable");

  // --- Shopify (all-or-nothing)
  const shopifyKeys = ["SHOPIFY_API_KEY", "SHOPIFY_API_SECRET", "SHOPIFY_SCOPES", "SHOPIFY_TOKEN_ENCRYPTION_KEY"];
  const shopifySet = shopifyKeys.filter((k) => env[k]);
  const shopify = shopifySet.length === shopifyKeys.length;
  if (shopifySet.length && !shopify) errors.push(`Shopify is partially configured; missing: ${shopifyKeys.filter((k) => !env[k]).join(", ")}`);
  if (env.SHOPIFY_TOKEN_ENCRYPTION_KEY && Buffer.from(env.SHOPIFY_TOKEN_ENCRYPTION_KEY, "base64").length !== 32) errors.push("SHOPIFY_TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded");

  // --- Billing: this build cannot charge money.
  const bm = env.BILLING_MODE ?? "disabled";
  if (bm === "live") errors.push("BILLING_MODE=live is not supported by this build. Live billing requires a reviewed release.");
  else if (bm !== "disabled" && bm !== "shadow") errors.push("BILLING_MODE must be disabled or shadow");
  if (env.STRIPE_SECRET_KEY?.startsWith("sk_live_")) errors.push("A live Stripe key is configured; this build does not support live billing");

  return {
    ok: errors.length === 0,
    appEnv,
    errors,
    warnings,
    features: { supabase, tryOnProvider, shopify, billingMode: bm === "shadow" ? "shadow" : "disabled", siteAccess },
  };
}

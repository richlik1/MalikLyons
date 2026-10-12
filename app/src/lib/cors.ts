import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Storefront widgets call experiment endpoints cross-origin. Only the merchant's own
// website / Shopify domains (and TrendSet itself) are allowed.

export async function allowedOriginsForMerchant(svc: SupabaseClient, merchantId: string): Promise<Set<string>> {
  const hosts = new Set<string>();
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  if (site) hosts.add(new URL(site).host);
  const [{ data: m }, { data: shops }] = await Promise.all([
    svc.from("merchants").select("website_url").eq("id", merchantId).maybeSingle(),
    svc.from("shopify_installations").select("shop_domain").eq("merchant_id", merchantId).is("uninstalled_at", null),
  ]);
  if (m?.website_url) {
    try {
      const h = new URL(m.website_url).host;
      hosts.add(h);
      hosts.add(h.startsWith("www.") ? h.slice(4) : `www.${h}`);
    } catch {}
  }
  for (const s of shops ?? []) hosts.add(s.shop_domain);
  return hosts;
}

export function corsHeaders(origin: string | null, allowedHosts: Set<string>): HeadersInit | null {
  if (!origin) return {}; // same-origin or server-to-server
  try {
    const u = new URL(origin);
    if (u.protocol !== "https:" && u.hostname !== "localhost" && u.hostname !== "127.0.0.1") return null;
    if (!allowedHosts.has(u.host)) return null;
  } catch {
    return null;
  }
  return { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "content-type", Vary: "Origin" };
}

export const PREFLIGHT_HEADERS = { "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "content-type", "Access-Control-Max-Age": "600" };

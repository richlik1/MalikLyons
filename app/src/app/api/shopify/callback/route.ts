import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { encryptToken, exchangeCodeForToken, isValidShopDomain, verifyOAuthQuery } from "@/lib/shopify";
import { shopifyConfig } from "@/lib/shopify-config";
import { createAdminClient } from "@/lib/supabase/server";

const STATE_TTL_MS = 10 * 60 * 1000;

// OAuth callback: verify HMAC, consume the one-time state, exchange the code, store the
// token encrypted, and link the shop to the merchant who started the install.
export async function GET(req: Request) {
  const cfg = shopifyConfig();
  if (!cfg) return jsonError(503, "shopify_not_configured", "Shopify integration is not configured.");
  const url = new URL(req.url);
  const p = url.searchParams;
  const shop = p.get("shop")?.toLowerCase() ?? null;
  const code = p.get("code");
  const state = p.get("state");
  if (!isValidShopDomain(shop) || !code || !state) return jsonError(400, "invalid_callback", "Invalid callback.");
  if (!verifyOAuthQuery(p, cfg.apiSecret)) return jsonError(401, "bad_hmac", "Invalid request signature.");

  const svc = createAdminClient();
  const { data: st } = await svc.from("shopify_oauth_states").delete().eq("state", state).select("shop_domain, user_id, created_at").maybeSingle();
  if (!st || st.shop_domain !== shop || Date.now() - new Date(st.created_at).getTime() > STATE_TTL_MS) {
    return jsonError(401, "bad_state", "This install link has expired. Please start again from TrendSet Studio.");
  }
  const { data: merchant } = await svc.from("merchants").select("id").eq("owner_id", st.user_id).maybeSingle();
  if (!merchant) return jsonError(403, "no_merchant", "Create your TrendSet store first.");

  try {
    const { accessToken, scope } = await exchangeCodeForToken({ shop, code, apiKey: cfg.apiKey, apiSecret: cfg.apiSecret });
    const { error } = await svc.from("shopify_installations").upsert(
      { shop_domain: shop, merchant_id: merchant.id, access_token_ciphertext: encryptToken(accessToken, cfg.encKey), scopes: scope, installed_at: new Date().toISOString(), uninstalled_at: null, updated_at: new Date().toISOString() },
      { onConflict: "shop_domain" },
    );
    if (error) throw error;
  } catch (e) {
    console.error("[shopify] install failed", e instanceof Error ? e.message : e);
    return jsonError(502, "install_failed", "Couldn't complete the Shopify connection.");
  }
  return NextResponse.redirect(new URL("/studio?shopify=connected", process.env.NEXT_PUBLIC_SITE_URL ?? url.origin));
}

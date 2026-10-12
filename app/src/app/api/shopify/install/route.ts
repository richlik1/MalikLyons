import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { buildAuthorizeUrl, isValidShopDomain, verifyOAuthQuery } from "@/lib/shopify";
import { shopifyConfig } from "@/lib/shopify-config";
import { createAdminClient, createUserClient, getSessionUser } from "@/lib/supabase/server";

// Starts the OAuth install. Requires a signed-in TrendSet merchant so the installation is
// linked to the right tenant. If Shopify initiated the install (hmac present), verify it first.
export async function GET(req: Request) {
  const cfg = shopifyConfig();
  if (!cfg) return jsonError(503, "shopify_not_configured", "Shopify integration is not configured on this server.");
  const url = new URL(req.url);
  const shop = url.searchParams.get("shop")?.toLowerCase() ?? null;
  if (!isValidShopDomain(shop)) return jsonError(400, "invalid_shop", "Enter your shop's .myshopify.com domain.");
  if (url.searchParams.has("hmac") && !verifyOAuthQuery(url.searchParams, cfg.apiSecret)) return jsonError(401, "bad_hmac", "Invalid request signature.");

  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(`/api/shopify/install?shop=${shop}`)}`, url.origin));
  const { data: merchant } = await (await createUserClient()).from("merchants").select("id").eq("owner_id", user.id).maybeSingle();
  if (!merchant) return NextResponse.redirect(new URL("/studio?shopify=create-store-first", url.origin));

  const state = randomBytes(24).toString("base64url");
  const { error } = await createAdminClient().from("shopify_oauth_states").insert({ state, shop_domain: shop, user_id: user.id });
  if (error) return jsonError(500, "state_failed", "Couldn't start the install.");
  return NextResponse.redirect(buildAuthorizeUrl({ shop, apiKey: cfg.apiKey, scopes: cfg.scopes, redirectUri: cfg.redirectUri, state }));
}

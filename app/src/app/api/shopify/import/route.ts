import { NextResponse } from "next/server";
import { jsonError, sameOrigin } from "@/lib/http";
import { validateImage } from "@/lib/image";
import { decryptToken, guessCategory, mapProducts, PRODUCTS_QUERY, shopifyGraphQL } from "@/lib/shopify";
import { shopifyConfig } from "@/lib/shopify-config";
import { createAdminClient, createUserClient, getSessionUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 120;

// Imports active products from the merchant's connected Shopify store. Products with an
// unsupported category or no image are skipped and reported, never guessed silently.
// New products are imported INACTIVE so the merchant reviews preview quality first.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return jsonError(403, "bad_origin", "Cross-site request rejected.");
  const cfg = shopifyConfig();
  if (!cfg) return jsonError(503, "shopify_not_configured", "Shopify integration is not configured.");
  const user = await getSessionUser();
  if (!user) return jsonError(401, "unauthenticated", "Please sign in.");
  const { data: merchant } = await (await createUserClient()).from("merchants").select("id").eq("owner_id", user.id).maybeSingle();
  if (!merchant) return jsonError(403, "not_merchant", "Create your store first.");

  const svc = createAdminClient();
  const { data: inst } = await svc.from("shopify_installations").select("shop_domain, access_token_ciphertext").eq("merchant_id", merchant.id).is("uninstalled_at", null).maybeSingle();
  if (!inst?.access_token_ciphertext) return jsonError(409, "not_connected", "Connect your Shopify store first.");

  const token = decryptToken(inst.access_token_ciphertext, cfg.encKey);
  const products = mapProducts(await shopifyGraphQL(inst.shop_domain, token, PRODUCTS_QUERY, { first: 50 }), inst.shop_domain);
  const report = { imported: 0, skipped: [] as { title: string; reason: string }[] };

  for (const p of products) {
    const category = guessCategory(p.productType, p.title);
    if (!category) { report.skipped.push({ title: p.title, reason: "unsupported category" }); continue; }
    if (!p.imageUrl || !p.url?.startsWith("https://")) { report.skipped.push({ title: p.title, reason: "missing image or URL" }); continue; }
    if (!new URL(p.imageUrl).hostname.endsWith("cdn.shopify.com")) { report.skipped.push({ title: p.title, reason: "image not on Shopify CDN" }); continue; }
    const res = await fetch(p.imageUrl);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const check = validateImage(bytes, { minDimension: 256 });
    if (!res.ok || !check.ok) { report.skipped.push({ title: p.title, reason: "image failed validation" }); continue; }
    const path = `${user.id}/shopify-${p.externalId.split("/").pop()}.${check.info.mimeType.split("/")[1].replace("jpeg", "jpg")}`;
    await svc.storage.from("garments").upload(path, bytes, { contentType: check.info.mimeType, upsert: true });
    const fields = { name: p.title.slice(0, 160), price_cents: p.priceCents, currency: p.currency ?? "USD", purchase_url: p.url, image_path: path };
    const { data: existing } = await svc.from("products").select("id").eq("merchant_id", merchant.id).eq("external_source", "shopify").eq("external_id", p.externalId).maybeSingle();
    // Re-imports refresh catalog fields but keep the merchant's activation and category choices.
    const { error } = existing
      ? await svc.from("products").update(fields).eq("id", existing.id)
      : await svc.from("products").insert({ ...fields, merchant_id: merchant.id, category, external_source: "shopify", external_id: p.externalId, is_active: false });
    if (error) report.skipped.push({ title: p.title, reason: "save failed" });
    else report.imported++;
  }
  return NextResponse.json(report);
}

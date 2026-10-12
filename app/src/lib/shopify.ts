import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Shopify app primitives. Implemented from Shopify's public OAuth/webhook documentation and
// unit-tested with self-generated vectors. NOT yet exercised against a real development store.

export const SHOP_DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
export const isValidShopDomain = (shop: string | null | undefined): shop is string => Boolean(shop && SHOP_DOMAIN_RE.test(shop));

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Verifies the `hmac` query parameter Shopify adds to OAuth/install redirects. */
export function verifyOAuthQuery(params: URLSearchParams, secret: string): boolean {
  const hmac = params.get("hmac");
  if (!hmac || !secret) return false;
  const message = [...params.entries()]
    .filter(([k]) => k !== "hmac" && k !== "signature")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const digest = createHmac("sha256", secret).update(message).digest("hex");
  return safeEqual(digest, hmac);
}

/** Verifies X-Shopify-Hmac-Sha256 over the RAW request body (before any JSON parsing). */
export function verifyWebhook(rawBody: string | Buffer, hmacHeader: string | null, secret: string): boolean {
  if (!hmacHeader || !secret) return false;
  const digest = createHmac("sha256", secret).update(rawBody).digest("base64");
  return safeEqual(digest, hmacHeader);
}

export function buildAuthorizeUrl(o: { shop: string; apiKey: string; scopes: string; redirectUri: string; state: string }): string {
  const u = new URL(`https://${o.shop}/admin/oauth/authorize`);
  u.searchParams.set("client_id", o.apiKey);
  u.searchParams.set("scope", o.scopes);
  u.searchParams.set("redirect_uri", o.redirectUri);
  u.searchParams.set("state", o.state);
  return u.toString();
}

export async function exchangeCodeForToken(
  o: { shop: string; code: string; apiKey: string; apiSecret: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ accessToken: string; scope: string }> {
  const res = await fetchImpl(`https://${o.shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: o.apiKey, client_secret: o.apiSecret, code: o.code }),
  });
  if (!res.ok) throw new Error(`Shopify token exchange failed (${res.status})`);
  const body = (await res.json()) as { access_token?: string; scope?: string };
  if (!body.access_token) throw new Error("Shopify token exchange returned no token");
  return { accessToken: body.access_token, scope: body.scope ?? "" };
}

// --- Token encryption at rest (AES-256-GCM). Format: v1.<iv>.<tag>.<ciphertext> (base64url)
export function encryptToken(plain: string, keyB64: string): string {
  const key = Buffer.from(keyB64, "base64");
  if (key.length !== 32) throw new Error("encryption key must be 32 bytes");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptToken(blob: string, keyB64: string): string {
  const [v, iv, tag, ct] = blob.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("unrecognized token format");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(keyB64, "base64"), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

// --- Experiment attribution from orders. The storefront widget writes hidden cart attributes
// (_ts_exp, _ts_vid) when a visitor is assigned; Shopify copies them to the order.
export interface OrderAttribution {
  experimentId: string;
  visitorId: string;
  orderId: string;
  valueCents: number;
}

export function attributionFromOrder(order: unknown): OrderAttribution | null {
  const o = order as { id?: number | string; total_price?: string; note_attributes?: { name?: string; value?: string }[] };
  const attrs = new Map((o.note_attributes ?? []).map((a) => [a.name ?? "", a.value ?? ""]));
  const exp = attrs.get("_ts_exp");
  const vid = attrs.get("_ts_vid");
  if (!o.id || !exp || !vid) return null;
  if (!/^[0-9a-f-]{36}$/i.test(exp) || !/^[A-Za-z0-9_-]{8,64}$/.test(vid)) return null;
  const value = Math.round(Number(o.total_price ?? "0") * 100);
  return { experimentId: exp, visitorId: vid, orderId: String(o.id), valueCents: Number.isFinite(value) && value >= 0 ? value : 0 };
}

// --- Product import (Admin GraphQL API)
export interface ShopifyProduct {
  externalId: string;
  title: string;
  productType: string;
  url: string | null;
  imageUrl: string | null;
  priceCents: number | null;
  currency: string | null;
}

export const PRODUCTS_QUERY = `query TrendSetProducts($first: Int!) {
  products(first: $first, query: "status:active") {
    nodes {
      id title productType handle onlineStoreUrl
      featuredMedia { preview { image { url } } }
      priceRangeV2 { minVariantPrice { amount currencyCode } }
    }
  }
}`;

export function mapProducts(json: unknown, shop: string): ShopifyProduct[] {
  const nodes = (json as { data?: { products?: { nodes?: unknown[] } } }).data?.products?.nodes ?? [];
  return nodes.map((n) => {
    const p = n as {
      id: string; title: string; productType?: string; handle?: string; onlineStoreUrl?: string | null;
      featuredMedia?: { preview?: { image?: { url?: string } } } | null;
      priceRangeV2?: { minVariantPrice?: { amount?: string; currencyCode?: string } };
    };
    const amount = p.priceRangeV2?.minVariantPrice?.amount;
    return {
      externalId: p.id,
      title: p.title,
      productType: p.productType ?? "",
      url: p.onlineStoreUrl ?? (p.handle ? `https://${shop}/products/${p.handle}` : null),
      imageUrl: p.featuredMedia?.preview?.image?.url ?? null,
      priceCents: amount ? Math.round(Number(amount) * 100) : null,
      currency: p.priceRangeV2?.minVariantPrice?.currencyCode ?? null,
    };
  });
}

/** Best-effort category guess; merchants can correct it. Only categories we support. */
export function guessCategory(productType: string, title: string): "tops" | "bottoms" | "one-pieces" | null {
  const s = `${productType} ${title}`.toLowerCase();
  if (/(dress|jumpsuit|romper|overall)/.test(s)) return "one-pieces";
  if (/(pant|trouser|jean|short|skirt|jogger|sweatpant|cargo)/.test(s)) return "bottoms";
  if (/(hoodie|tee|t-shirt|shirt|top|jacket|sweater|sweatshirt|crewneck|coat|polo|tank|knit|cardigan|fleece)/.test(s)) return "tops";
  return null;
}

export async function shopifyGraphQL(shop: string, token: string, query: string, variables: Record<string, unknown>, fetchImpl: typeof fetch = fetch) {
  const version = process.env.SHOPIFY_API_VERSION ?? "2025-10";
  const res = await fetchImpl(`https://${shop}/admin/api/${version}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Shopify GraphQL failed (${res.status})`);
  return res.json();
}

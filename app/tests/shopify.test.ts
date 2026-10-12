import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  attributionFromOrder, buildAuthorizeUrl, decryptToken, encryptToken, exchangeCodeForToken, guessCategory,
  isValidShopDomain, mapProducts, verifyOAuthQuery, verifyWebhook,
} from "@/lib/shopify";

const SECRET = "test-shopify-secret";

function signQuery(params: Record<string, string>) {
  const msg = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("&");
  return new URLSearchParams({ ...params, hmac: createHmac("sha256", SECRET).update(msg).digest("hex") });
}

describe("shop domain validation", () => {
  it("accepts myshopify domains only", () => {
    expect(isValidShopDomain("trendset-dev.myshopify.com")).toBe(true);
    for (const bad of ["evil.com", "x.myshopify.com.evil.com", "https://a.myshopify.com", "-a.myshopify.com", "", "A.myshopify.com"]) {
      expect(isValidShopDomain(bad)).toBe(false);
    }
  });
});

describe("OAuth query HMAC", () => {
  const params = { code: "abc", shop: "trendset-dev.myshopify.com", state: "s1", timestamp: "1760000000" };
  it("accepts a correctly signed query", () => expect(verifyOAuthQuery(signQuery(params), SECRET)).toBe(true));
  it("rejects tampering, a wrong secret, or a missing hmac", () => {
    const q = signQuery(params);
    q.set("shop", "attacker.myshopify.com");
    expect(verifyOAuthQuery(q, SECRET)).toBe(false);
    expect(verifyOAuthQuery(signQuery(params), "other")).toBe(false);
    expect(verifyOAuthQuery(new URLSearchParams(params), SECRET)).toBe(false);
  });
});

describe("webhook HMAC", () => {
  const body = JSON.stringify({ id: 1, total_price: "59.00" });
  const header = createHmac("sha256", SECRET).update(body).digest("base64");
  it("accepts the raw body signature", () => expect(verifyWebhook(body, header, SECRET)).toBe(true));
  it("rejects a re-serialized or modified body", () => {
    expect(verifyWebhook(JSON.stringify(JSON.parse(body), null, 2), header, SECRET)).toBe(false);
    expect(verifyWebhook(body.replace("59", "1"), header, SECRET)).toBe(false);
    expect(verifyWebhook(body, null, SECRET)).toBe(false);
  });
});

describe("authorize URL & token exchange", () => {
  it("builds the authorize URL on the shop domain", () => {
    const u = new URL(buildAuthorizeUrl({ shop: "a.myshopify.com", apiKey: "k", scopes: "read_products", redirectUri: "https://app.example/api/shopify/callback", state: "st" }));
    expect(u.host).toBe("a.myshopify.com");
    expect(u.pathname).toBe("/admin/oauth/authorize");
    expect(u.searchParams.get("state")).toBe("st");
  });
  it("exchanges a code for a token", async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: "shpat_x", scope: "read_products" })));
    await expect(exchangeCodeForToken({ shop: "a.myshopify.com", code: "c", apiKey: "k", apiSecret: "s" }, f)).resolves.toEqual({ accessToken: "shpat_x", scope: "read_products" });
    expect(f.mock.calls[0][0]).toBe("https://a.myshopify.com/admin/oauth/access_token");
  });
});

describe("token encryption", () => {
  const key = randomBytes(32).toString("base64");
  it("round-trips and uses a fresh IV each time", () => {
    const a = encryptToken("shpat_secret", key);
    expect(a).not.toContain("shpat_secret");
    expect(encryptToken("shpat_secret", key)).not.toBe(a);
    expect(decryptToken(a, key)).toBe("shpat_secret");
  });
  it("detects tampering and wrong keys", () => {
    const blob = encryptToken("shpat_secret", key).split(".");
    blob[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptToken(blob.join("."), key)).toThrow();
    expect(() => decryptToken(encryptToken("x", key), randomBytes(32).toString("base64"))).toThrow();
  });
});

describe("order attribution", () => {
  const exp = "6f1c1f0e-3b7a-4c55-9d43-2a1b7e9a1c11";
  it("extracts experiment, visitor and value from hidden cart attributes", () => {
    expect(attributionFromOrder({ id: 42, total_price: "118.50", note_attributes: [{ name: "_ts_exp", value: exp }, { name: "_ts_vid", value: "visitor-abc123" }] }))
      .toEqual({ experimentId: exp, visitorId: "visitor-abc123", orderId: "42", valueCents: 11850 });
  });
  it("ignores orders without attribution or with malformed values", () => {
    expect(attributionFromOrder({ id: 1, note_attributes: [] })).toBeNull();
    expect(attributionFromOrder({ id: 1, note_attributes: [{ name: "_ts_exp", value: "x" }, { name: "_ts_vid", value: "visitor-abc123" }] })).toBeNull();
  });
});

describe("product mapping", () => {
  it("maps GraphQL nodes and falls back to the handle URL", () => {
    const json = { data: { products: { nodes: [{ id: "gid://shopify/Product/1", title: "Box Hoodie", productType: "Hoodies", handle: "box-hoodie", onlineStoreUrl: null, featuredMedia: { preview: { image: { url: "https://cdn.shopify.com/h.png" } } }, priceRangeV2: { minVariantPrice: { amount: "65.0", currencyCode: "USD" } } }] } } };
    expect(mapProducts(json, "a.myshopify.com")[0]).toEqual({ externalId: "gid://shopify/Product/1", title: "Box Hoodie", productType: "Hoodies", url: "https://a.myshopify.com/products/box-hoodie", imageUrl: "https://cdn.shopify.com/h.png", priceCents: 6500, currency: "USD" });
  });
  it("guesses supported categories and returns null otherwise", () => {
    expect(guessCategory("Hoodies", "Box Hoodie")).toBe("tops");
    expect(guessCategory("", "Cargo Pant")).toBe("bottoms");
    expect(guessCategory("Accessories", "Bucket Hat")).toBeNull();
  });
});

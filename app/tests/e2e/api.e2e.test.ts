import { createServerClient } from "@supabase/ssr";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { png } from "../fixtures";
import { admin, ANON, URL_ } from "../integration/helpers";

// Public API + website widget, end to end on the local stack. AI provider = LOCAL CONTRACT STUB.
const BASE = process.env.E2E_BASE_URL ?? "";
const d = BASE && URL_ ? describe : describe.skip;
const personB64 = Buffer.from(png(800, 1200)).toString("base64");

async function cookieSession(signIn: (c: ReturnType<typeof createServerClient>) => Promise<unknown>) {
  const jar = new Map<string, string>();
  const c = createServerClient(URL_, ANON, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (cs) => cs.forEach(({ name, value }) => jar.set(name, value)) } });
  await signIn(c);
  const { data } = await c.auth.getUser();
  return { id: data.user!.id, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") };
}
async function owner(label: string) {
  const email = `${label}-${crypto.randomUUID().slice(0, 8)}@trendset.test`, password = `pw-${crypto.randomUUID()}`;
  await admin().auth.admin.createUser({ email, password, email_confirm: true });
  return cookieSession((c) => c.auth.signInWithPassword({ email, password }));
}
const app = (path: string, cookie: string, init: RequestInit = {}) =>
  fetch(BASE + path, { ...init, headers: { origin: BASE, cookie, ...((init.headers as Record<string, string>) ?? {}) } });
const api = (path: string, key: string | null, init: RequestInit = {}) =>
  fetch(BASE + path, { ...init, headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), "content-type": "application/json", ...((init.headers as Record<string, string>) ?? {}) } });

async function setupMerchant(label: string, site: string) {
  const o = await owner(label);
  const m = await app("/api/merchant", o.cookie, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: `${label} brand`, websiteUrl: site }) });
  const merchantId = (await m.json()).id;
  const form = new FormData();
  form.set("name", `${label} hoodie`); form.set("category", "tops"); form.set("purchaseUrl", `${site}/p/hoodie`);
  form.set("image", new Blob([png(600, 800)], { type: "image/png" }), "h.png");
  const productId = (await (await app("/api/merchant/products", o.cookie, { method: "POST", body: form })).json()).id;
  const mk = async (kind: string, allowedOrigins: string[] = []) => (await (await app("/api/merchant/api-keys", o.cookie, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, name: kind, allowedOrigins }) })).json());
  const sk = await mk("secret");
  const pk = await mk("publishable", [site]);
  return { ...o, merchantId, productId, sk, pk };
}

d("public API + widget (end to end)", () => {
  let A: Awaited<ReturnType<typeof setupMerchant>>, B: Awaited<ReturnType<typeof setupMerchant>>, tryOnId: string;
  beforeAll(async () => {
    A = await setupMerchant("api-a", "https://shop-a.example");
    B = await setupMerchant("api-b", "https://shop-b.example");
  });
  afterAll(async () => { for (const u of [A, B]) if (u) await admin().auth.admin.deleteUser(u.id); });

  it("issues keys once, in the right format, storing only a hash", async () => {
    expect(A.sk.key).toMatch(/^ts_sk_[0-9A-Za-z]{32}$/);
    expect(A.pk.key).toMatch(/^ts_pk_[0-9A-Za-z]{32}$/);
    const row = await admin().from("api_keys").select("key_hash, prefix").eq("id", A.sk.id).single();
    expect(row.data!.key_hash).not.toContain(A.sk.key);
    expect(A.sk.key.startsWith(row.data!.prefix)).toBe(true);
  });

  it("rejects missing, malformed, publishable-in-API and browser-side secret keys", async () => {
    expect((await api("/api/v1/products", null)).status).toBe(401);
    expect((await api("/api/v1/products", "ts_sk_nope")).status).toBe(401);
    expect((await api("/api/v1/products", A.pk.key)).status).toBe(403);
    expect((await api("/api/v1/products", A.sk.key, { headers: { origin: "https://shop-a.example" } })).status).toBe(400);
  });

  it("creates a try-on from a catalog product (STUBBED provider) and retrieves it", async () => {
    const r = await api("/api/v1/try-ons", A.sk.key, { method: "POST", body: JSON.stringify({ person_image_base64: personB64, product_id: A.productId, external_ref: "order_42" }) });
    const body = await r.json();
    expect(r.status, JSON.stringify(body)).toBe(201);
    expect(body).toMatchObject({ object: "try_on", status: "succeeded", product_id: A.productId, external_ref: "order_42" });
    expect((await fetch(body.result_url)).status).toBe(200);
    tryOnId = body.id;
    const g = await admin().from("generations").select("source, api_key_id, user_id, person_photo_id, result_path").eq("id", tryOnId).single();
    expect(g.data).toMatchObject({ source: "api", api_key_id: A.sk.id, user_id: null, person_photo_id: null });
    expect(g.data!.result_path.startsWith(`api/${A.merchantId}/`)).toBe(true);
    const got = await (await api(`/api/v1/try-ons/${tryOnId}`, A.sk.key)).json();
    expect(got).toMatchObject({ id: tryOnId, status: "succeeded" });
    expect(got.result_url).toContain("/storage/v1/object/sign/tryon-results/");
  });

  it("accepts a raw garment image with a category", async () => {
    const r = await api("/api/v1/try-ons", A.sk.key, { method: "POST", body: JSON.stringify({ person_image_base64: personB64, garment_image_base64: Buffer.from(png(600, 800)).toString("base64"), category: "tops" }) });
    expect(r.status).toBe(201);
  });

  it("isolates tenants: another merchant can't read A's try-on or use A's products", async () => {
    expect((await api(`/api/v1/try-ons/${tryOnId}`, B.sk.key)).status).toBe(404);
    expect((await api("/api/v1/try-ons", B.sk.key, { method: "POST", body: JSON.stringify({ person_image_base64: personB64, product_id: A.productId }) })).status).toBe(404);
    const list = await (await api("/api/v1/products", B.sk.key)).json();
    expect(list.data.map((p: { id: string }) => p.id)).toEqual([B.productId]);
  });

  it("blocks server-side request forgery via image URLs", async () => {
    for (const url of ["https://127.0.0.1/x.png", "https://169.254.169.254/latest/meta-data", "http://example.com/a.png", "https://localhost/a.png"]) {
      const r = await api("/api/v1/try-ons", A.sk.key, { method: "POST", body: JSON.stringify({ person_image_url: url, product_id: A.productId }) });
      expect(r.status, url).toBe(422);
    }
  });

  it("validates request bodies", async () => {
    const r = await api("/api/v1/try-ons", A.sk.key, { method: "POST", body: JSON.stringify({ person_image_base64: personB64 }) });
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe("invalid_request");
  });

  it("reports metered usage", async () => {
    const u = await (await api("/api/v1/usage", A.sk.key)).json();
    expect(u).toMatchObject({ object: "usage", plan: "pilot", used: 2, included: 500, billing_status: "not_billing" });
  });

  it("revoked keys stop working immediately", async () => {
    const extra = await (await app("/api/merchant/api-keys", A.cookie, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "secret", name: "temp" }) })).json();
    expect((await api("/api/v1/products", extra.key)).status).toBe(200);
    expect((await app(`/api/merchant/api-keys/${extra.id}`, A.cookie, { method: "DELETE" })).status).toBe(200);
    expect((await api("/api/v1/products", extra.key)).status).toBe(401);
    expect((await app(`/api/merchant/api-keys/${A.sk.id}`, B.cookie, { method: "DELETE" })).status).toBe(404); // can't revoke others' keys
  });

  it("serves the widget script and the OpenAPI spec", async () => {
    const w = await fetch(`${BASE}/widget.js`);
    expect(w.status).toBe(200);
    expect(await w.text()).toContain("data-trendset-product");
    const spec = await (await fetch(`${BASE}/api/v1/openapi.json`)).json();
    expect(spec.paths["/api/v1/try-ons"].post).toBeDefined();
  });

  it("widget: refuses other websites and unknown keys", async () => {
    const evil = await (await fetch(`${BASE}/embed/${A.productId}?key=${A.pk.key}`, { headers: { referer: "https://evil.example/page" } })).text();
    expect(evil).toContain("isn&#x27;t enabled for this website");
    const bad = await (await fetch(`${BASE}/embed/${A.productId}?key=ts_pk_${"x".repeat(32)}`)).text();
    expect(bad).toContain("not valid");
    const wrongProduct = await (await fetch(`${BASE}/embed/${B.productId}?key=${A.pk.key}`, { headers: { referer: "https://shop-a.example/p" } })).text();
    expect(wrongProduct).toContain("isn&#x27;t available");
  });

  it("widget: an anonymous shopper can try on the merchant's product, attributed to the publishable key", async () => {
    const page = await (await fetch(`${BASE}/embed/${A.productId}?key=${A.pk.key}`, { headers: { referer: "https://shop-a.example/p" } })).text();
    expect(page).toContain("Starting your private session");
    const shopper = await cookieSession((c) => c.auth.signInAnonymously());
    const f = new FormData();
    f.set("file", new Blob([png(800, 1200)], { type: "image/png" }), "me.png"); f.set("consent", "true"); f.set("consentVersion", "2026-10-12.v1");
    const photo = await (await app("/api/photos", shopper.cookie, { method: "POST", body: f })).json();
    const r = await app("/api/try-on", shopper.cookie, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ photoId: photo.id, productId: A.productId, embedKey: A.pk.key }) });
    const body = await r.json();
    expect(r.status, JSON.stringify(body)).toBe(200);
    const g = await admin().from("generations").select("source, api_key_id, merchant_id").eq("id", body.generationId).single();
    expect(g.data).toEqual({ source: "embed", api_key_id: A.pk.id, merchant_id: A.merchantId });
    // the widget key can't be used for another merchant's product
    expect((await app("/api/try-on", shopper.cookie, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ photoId: photo.id, productId: B.productId, embedKey: A.pk.key }) })).status).toBe(403);
    // anonymous shoppers can't open a store
    expect((await app("/api/merchant", shopper.cookie, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "x" }) })).status).toBe(403);
    await admin().auth.admin.deleteUser(shopper.id);
  });
});

import { createHmac } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { png } from "../fixtures";
import { admin, ANON, URL_ } from "../integration/helpers";

// Runs the real Next.js app (E2E_BASE_URL) against the local Supabase-compatible stack.
// The AI provider is the LOCAL FASHN CONTRACT STUB (scripts/fashn-stub.mjs): this proves
// TrendSet's pipeline end to end, NOT the quality or availability of FASHN itself.
const BASE = process.env.E2E_BASE_URL ?? "";
const d = BASE && URL_ ? describe : describe.skip;

async function sessionCookie(email: string, password: string): Promise<string> {
  const jar = new Map<string, string>();
  const client = createServerClient(URL_, ANON, {
    cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (c) => c.forEach(({ name, value }) => jar.set(name, value)) },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function newUser(label: string) {
  const email = `${label}-${crypto.randomUUID().slice(0, 8)}@trendset.test`;
  const password = `pw-${crypto.randomUUID()}`;
  const { data } = await admin().auth.admin.createUser({ email, password, email_confirm: true });
  return { id: data.user!.id, cookie: await sessionCookie(email, password) };
}

// For a private staging deployment set E2E_BASIC_AUTH="user:password" (sent as a header;
// fetch does not allow credentials in the URL).
const GATE: Record<string, string> = process.env.E2E_BASIC_AUTH ? { authorization: `Basic ${Buffer.from(process.env.E2E_BASIC_AUTH).toString("base64")}` } : {};
const req = (path: string, init: RequestInit & { cookie?: string } = {}) =>
  fetch(BASE + path, {
    ...init,
    redirect: "manual",
    headers: { origin: BASE, ...GATE, ...(init.cookie ? { cookie: init.cookie } : {}), ...((init.headers as Record<string, string>) ?? {}) },
  });

d("end-to-end: app routes on the local stack", () => {
  let shopper: { id: string; cookie: string }, owner: { id: string; cookie: string };
  let merchantId: string, productId: string, photoId: string, generationId: string;

  beforeAll(async () => {
    shopper = await newUser("e2e-shopper");
    owner = await newUser("e2e-owner");
    const svc = admin();
    // Merchant onboarding through the app route
    const m = await req("/api/merchant", { method: "POST", cookie: owner.cookie, headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "E2E Brand", websiteUrl: "https://e2e-brand.example" }) });
    expect(m.status).toBe(200);
    merchantId = (await m.json()).id;
    // Product upload through the app route (multipart, validated image → public garments bucket)
    const form = new FormData();
    form.set("name", "E2E Box Hoodie"); form.set("category", "tops"); form.set("price", "65.00"); form.set("purchaseUrl", "https://e2e-brand.example/p/hoodie");
    form.set("image", new Blob([png(600, 800)], { type: "image/png" }), "hoodie.png");
    const p = await req("/api/merchant/products", { method: "POST", cookie: owner.cookie, body: form });
    expect(p.status).toBe(200);
    productId = (await p.json()).id;
    const role = await svc.from("profiles").select("role").eq("id", owner.id).single();
    expect(role.data?.role).toBe("merchant");
  });

  afterAll(async () => {
    const svc = admin();
    await svc.auth.admin.deleteUser(owner.id);
  });

  it("serves the landing page without performance claims", async () => {
    const html = await (await req("/")).text();
    expect(html).toContain("Let shoppers see your pieces on themselves");
    expect(html).not.toMatch(/\d+(\.\d+)?\s?%|\d(\.\d)?×/);
  });

  it("records landing events and waitlist signups (duplicate emails look identical)", async () => {
    const visitorId = `e2e-${crypto.randomUUID()}`;
    expect((await req("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ visitorId, event: "page_view" }) })).status).toBe(204);
    const email = `e2e-${crypto.randomUUID().slice(0, 6)}@brand.test`;
    const body = JSON.stringify({ visitorId, email, brandName: "E2E", platform: "shopify" });
    expect((await req("/api/waitlist", { method: "POST", headers: { "content-type": "application/json" }, body })).status).toBe(200);
    expect((await req("/api/waitlist", { method: "POST", headers: { "content-type": "application/json" }, body })).status).toBe(200);
    const rows = await admin().from("landing_events").select("event").eq("visitor_id", visitorId);
    expect(rows.data?.map((r) => r.event).sort()).toEqual(["page_view", "waitlist_submit"]);
  });

  it("rejects photo uploads without consent and non-images disguised as images", async () => {
    const f1 = new FormData();
    f1.set("file", new Blob([png(800, 1200)], { type: "image/png" }), "me.png");
    expect((await req("/api/photos", { method: "POST", cookie: shopper.cookie, body: f1 })).status).toBe(400);
    const f2 = new FormData();
    f2.set("file", new Blob(["<script>alert(1)</script>"], { type: "image/png" }), "me.png");
    f2.set("consent", "true"); f2.set("consentVersion", "2026-10-12.v1");
    expect((await req("/api/photos", { method: "POST", cookie: shopper.cookie, body: f2 })).status).toBe(422);
  });

  it("stores a consented photo privately", async () => {
    const f = new FormData();
    f.set("file", new Blob([png(800, 1200)], { type: "image/png" }), "me.png");
    f.set("consent", "true"); f.set("consentVersion", "2026-10-12.v1");
    const r = await req("/api/photos", { method: "POST", cookie: shopper.cookie, body: f });
    expect(r.status).toBe(200);
    const body = await r.json();
    photoId = body.id;
    expect(body.previewUrl).toContain("/storage/v1/object/sign/person-photos/");
    const row = await admin().from("person_photos").select("storage_path, consent_version, expires_at").eq("id", photoId).single();
    expect(row.data?.storage_path.startsWith(`${shopper.id}/`)).toBe(true);
    expect(row.data?.consent_version).toBe("2026-10-12.v1");
  });

  it("generates a try-on through the provider pipeline (STUBBED provider), meters usage and stores the result", async () => {
    const r = await req("/api/try-on", { method: "POST", cookie: shopper.cookie, headers: { "content-type": "application/json" }, body: JSON.stringify({ photoId, productId }) });
    const body = await r.json();
    expect(r.status, JSON.stringify(body)).toBe(200);
    generationId = body.generationId;
    expect(body.product.purchaseUrl).toBe("https://e2e-brand.example/p/hoodie");
    const img = await fetch(body.resultUrl);
    expect(img.status).toBe(200);
    const svc = admin();
    const g = await svc.from("generations").select("status, provider, model, cost_usd, latency_ms, result_path, provider_job_id").eq("id", generationId).single();
    expect(g.data).toMatchObject({ status: "succeeded", provider: "fashn", cost_usd: 0 });
    expect(g.data!.result_path.startsWith(`${shopper.id}/`)).toBe(true);
    expect(g.data!.provider_job_id).toMatch(/^stub-/);
    expect(g.data!.model).toBe("contract-stub");
    const u = await svc.from("usage_events").select("merchant_id, quantity").eq("generation_id", generationId).single();
    expect(u.data).toEqual({ merchant_id: merchantId, quantity: 1 });
  });

  it("records the click-through to the merchant's product page", async () => {
    expect((await req(`/api/generations/${generationId}/click`, { method: "POST", cookie: shopper.cookie })).status).toBe(204);
    const g = await admin().from("generations").select("shop_clicked_at").eq("id", generationId).single();
    expect(g.data?.shop_clicked_at).not.toBeNull();
  });

  it("does not let another user save, click or delete someone else's look or photo", async () => {
    const other = await newUser("e2e-other");
    expect((await req(`/api/generations/${generationId}`, { method: "PATCH", cookie: other.cookie, headers: { "content-type": "application/json" }, body: JSON.stringify({ saved: true }) })).status).toBe(404);
    expect((await req(`/api/photos/${photoId}`, { method: "DELETE", cookie: other.cookie })).status).toBe(404);
    expect((await req("/api/try-on", { method: "POST", cookie: other.cookie, headers: { "content-type": "application/json" }, body: JSON.stringify({ photoId, productId }) })).status).toBe(404);
    await admin().auth.admin.deleteUser(other.id);
  });

  it("enforces the merchant's monthly allowance before calling the provider", async () => {
    const svc = admin();
    await svc.from("merchants").update({ monthly_generation_quota: 1 }).eq("id", merchantId);
    const r = await req("/api/try-on", { method: "POST", cookie: shopper.cookie, headers: { "content-type": "application/json" }, body: JSON.stringify({ photoId, productId }) });
    expect(r.status).toBe(429);
    expect((await r.json()).error.code).toBe("merchant_quota");
    await svc.from("merchants").update({ monthly_generation_quota: null }).eq("id", merchantId);
  });

  it("runs a randomized experiment: CORS-restricted assignment, events, and order attribution via a signed Shopify webhook", async () => {
    const svc = admin();
    const created = await req("/api/merchant/experiments", { method: "POST", cookie: owner.cookie, headers: { "content-type": "application/json" }, body: JSON.stringify({ key: `e2e-${Date.now()}`, hypothesis: "Try-on increases add to cart for hoodies" }) });
    expect(created.status).toBe(200);
    const expId = (await created.json()).id;
    expect((await req(`/api/merchant/experiments/${expId}`, { method: "PATCH", cookie: owner.cookie, headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "start" }) })).status).toBe(200);

    const vid = `e2evisitor${Date.now()}`;
    const evil = await fetch(`${BASE}/api/experiments/assign`, { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" }, body: JSON.stringify({ experimentId: expId, visitorId: vid }) });
    expect(evil.status).toBe(403);
    const ok = await fetch(`${BASE}/api/experiments/assign`, { method: "POST", headers: { origin: "https://e2e-brand.example", "content-type": "application/json" }, body: JSON.stringify({ experimentId: expId, visitorId: vid }) });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://e2e-brand.example");
    const { arm } = await ok.json();
    const again = await (await fetch(`${BASE}/api/experiments/assign`, { method: "POST", headers: { origin: "https://e2e-brand.example", "content-type": "application/json" }, body: JSON.stringify({ experimentId: expId, visitorId: vid }) })).json();
    expect(again.arm).toBe(arm);
    const ev = await fetch(`${BASE}/api/experiments/events`, { method: "POST", headers: { origin: "https://e2e-brand.example", "content-type": "application/json" }, body: JSON.stringify({ experimentId: expId, visitorId: vid, event: "add_to_cart" }) });
    expect(ev.status).toBe(204);
    const fakePurchase = await fetch(`${BASE}/api/experiments/events`, { method: "POST", headers: { origin: "https://e2e-brand.example", "content-type": "application/json" }, body: JSON.stringify({ experimentId: expId, visitorId: vid, event: "purchase" }) });
    expect(fakePurchase.status).toBe(400);

    // Signed orders/create webhook from the merchant's (test) shop
    const shop = `e2e-${Date.now()}.myshopify.com`;
    await svc.from("shopify_installations").insert({ shop_domain: shop, merchant_id: merchantId, access_token_ciphertext: null });
    const order = JSON.stringify({ id: Date.now(), total_price: "65.00", note_attributes: [{ name: "_ts_exp", value: expId }, { name: "_ts_vid", value: vid }] });
    const sign = (b: string) => createHmac("sha256", process.env.SHOPIFY_API_SECRET!).update(b).digest("base64");
    const hook = (b: string, hmac: string, id: string) => fetch(`${BASE}/api/shopify/webhooks`, { method: "POST", headers: { "x-shopify-hmac-sha256": hmac, "x-shopify-topic": "orders/create", "x-shopify-shop-domain": shop, "x-shopify-webhook-id": id, "content-type": "application/json" }, body: b });
    expect((await hook(order, "bm90LXZhbGlk", "w-bad")).status).toBe(401);
    expect((await hook(order, sign(order), `w-${Date.now()}`)).status).toBe(200);
    expect((await hook(order, sign(order), `w-retry-${Date.now()}`)).status).toBe(200); // same order again → deduped
    const summary = await svc.rpc("experiment_summary", { p_experiment: expId });
    // service-role calls see no auth.uid(); read events directly instead
    const events = await svc.from("experiment_events").select("event, arm, value_cents, source").eq("experiment_id", expId).order("id");
    expect(events.data).toEqual([
      { event: "add_to_cart", arm, value_cents: null, source: "browser" },
      { event: "purchase", arm, value_cents: 6500, source: "shopify_webhook" },
    ]);
    expect(summary.error).toBeNull();
    await svc.from("shopify_installations").delete().eq("shop_domain", shop);
  });

  it("deleting a photo removes it and its results from storage", async () => {
    const svc = admin();
    const before = await svc.from("generations").select("result_path").eq("id", generationId).single();
    expect((await req(`/api/photos/${photoId}`, { method: "DELETE", cookie: shopper.cookie })).status).toBe(200);
    expect((await svc.storage.from("tryon-results").download(before.data!.result_path)).data).toBeNull();
    expect((await svc.from("person_photos").select("id").eq("id", photoId)).data).toEqual([]);
    expect((await svc.from("generations").select("result_path").eq("id", generationId).single()).data?.result_path).toBeNull();
  });

  it("deleting the account removes the user and their storage folders", async () => {
    expect((await req("/api/account", { method: "DELETE", cookie: shopper.cookie })).status).toBe(200);
    const svc = admin();
    expect((await svc.auth.admin.getUserById(shopper.id)).data.user).toBeNull();
    expect((await svc.storage.from("person-photos").list(shopper.id)).data ?? []).toEqual([]);
  });

  it("exposes a health report only with the cron secret", async () => {
    const pub = await (await req("/api/health")).json();
    expect(Object.keys(pub)).toEqual(["ok"]);
    const full = await (await fetch(BASE + "/api/health", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } })).json();
    expect(full.checks).toMatchObject({ database: true, storageBuckets: true, personPhotosPrivate: true });
  });
});

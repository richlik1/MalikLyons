import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, configured, createUser, deleteUser, tinyPng, type TestUser } from "./helpers";

// Cross-tenant security tests: every assertion runs through the real Auth, PostgREST and
// Storage services with real user JWTs, so RLS and storage policies are what is tested.
const d = configured ? describe : describe.skip;

d("tenant isolation (RLS + storage policies)", () => {
  let alice: TestUser, bob: TestUser, merchantA: TestUser, merchantB: TestUser, staff: TestUser;
  let alicePhotoId: string, aliceGenId: string, productA: string, productInactive: string, merchantAId: string, merchantBId: string;
  const alicePath = () => `${alice.id}/photo.png`;

  beforeAll(async () => {
    [alice, bob, merchantA, merchantB, staff] = await Promise.all([
      createUser("alice"), createUser("bob"), createUser("merchant-a"), createUser("merchant-b"), createUser("staff"),
    ]);
    const svc = admin();
    await svc.from("profiles").update({ role: "admin" }).eq("id", staff.id);

    // Alice uploads her own photo through the user-scoped client (as the app does).
    const up = await alice.client.storage.from("person-photos").upload(alicePath(), tinyPng(), { contentType: "image/png" });
    expect(up.error).toBeNull();
    const photo = await alice.client.from("person_photos").insert({
      user_id: alice.id, storage_path: alicePath(), mime_type: "image/png", byte_size: 33,
      consent_version: "test", consented_at: new Date().toISOString(), expires_at: new Date(Date.now() + 864e5).toISOString(),
    }).select("id").single();
    expect(photo.error).toBeNull();
    alicePhotoId = photo.data!.id;

    const ma = await merchantA.client.from("merchants").insert({ owner_id: merchantA.id, name: "A Brand" }).select("id").single();
    const mb = await merchantB.client.from("merchants").insert({ owner_id: merchantB.id, name: "B Brand" }).select("id").single();
    expect(ma.error).toBeNull(); expect(mb.error).toBeNull();
    merchantAId = ma.data!.id; merchantBId = mb.data!.id;

    const p = await merchantA.client.from("products").insert([
      { merchant_id: merchantAId, name: "Hoodie", category: "tops", purchase_url: "https://a.example/h", image_path: `${merchantA.id}/h.png`, is_active: true },
      { merchant_id: merchantAId, name: "Hidden", category: "tops", purchase_url: "https://a.example/x", image_path: `${merchantA.id}/x.png`, is_active: false },
    ]).select("id, name");
    expect(p.error).toBeNull();
    productA = p.data!.find((r) => r.name === "Hoodie")!.id;
    productInactive = p.data!.find((r) => r.name === "Hidden")!.id;

    // Generations are written by the server with the service role.
    const g = await svc.from("generations").insert({
      user_id: alice.id, merchant_id: merchantAId, product_id: productA, person_photo_id: alicePhotoId,
      provider: "test", model: "m", status: "succeeded", cost_usd: 0.075, result_path: `${alice.id}/r.png`,
    }).select("id").single();
    expect(g.error).toBeNull();
    aliceGenId = g.data!.id;
    await svc.storage.from("tryon-results").upload(`${alice.id}/r.png`, tinyPng(), { contentType: "image/png" });
  });

  afterAll(async () => {
    const svc = admin();
    for (const [bucket, prefix] of [["person-photos", alice?.id], ["tryon-results", alice?.id]] as const) {
      if (!prefix) continue;
      const { data } = await svc.storage.from(bucket).list(prefix);
      if (data?.length) await svc.storage.from(bucket).remove(data.map((o) => `${prefix}/${o.name}`));
    }
    await Promise.all([alice, bob, merchantA, merchantB, staff].map(deleteUser));
  });

  it("a shopper cannot read another shopper's photo rows", async () => {
    const { data } = await bob.client.from("person_photos").select("id").eq("id", alicePhotoId);
    expect(data).toEqual([]);
    const own = await alice.client.from("person_photos").select("id").eq("id", alicePhotoId);
    expect(own.data).toHaveLength(1);
  });

  it("a shopper cannot download, overwrite, list or delete another shopper's stored photo", async () => {
    const dl = await bob.client.storage.from("person-photos").download(alicePath());
    expect(dl.data).toBeNull();
    const signed = await bob.client.storage.from("person-photos").createSignedUrl(alicePath(), 60);
    expect(signed.data).toBeNull();
    const write = await bob.client.storage.from("person-photos").upload(`${alice.id}/evil.png`, tinyPng(), { contentType: "image/png" });
    expect(write.error).not.toBeNull();
    const list = await bob.client.storage.from("person-photos").list(alice.id);
    expect(list.data ?? []).toEqual([]);
    await bob.client.storage.from("person-photos").remove([alicePath()]);
    const stillThere = await alice.client.storage.from("person-photos").download(alicePath());
    expect(stillThere.data).not.toBeNull();
  });

  it("a shopper cannot read another shopper's try-on results", async () => {
    expect((await bob.client.from("generations").select("id").eq("id", aliceGenId)).data).toEqual([]);
    expect((await bob.client.storage.from("tryon-results").download(`${alice.id}/r.png`)).data).toBeNull();
    expect((await alice.client.storage.from("tryon-results").download(`${alice.id}/r.png`)).data).not.toBeNull();
  });

  it("users cannot write results directly to the results bucket", async () => {
    const w = await alice.client.storage.from("tryon-results").upload(`${alice.id}/forged.png`, tinyPng(), { contentType: "image/png" });
    expect(w.error).not.toBeNull();
  });

  it("users cannot insert generation rows (cost/usage is server-controlled)", async () => {
    const { error } = await alice.client.from("generations").insert({ user_id: alice.id, provider: "x", model: "y", status: "succeeded" });
    expect(error).not.toBeNull();
  });

  it("users can toggle saved but cannot change status, cost or result path", async () => {
    const ok = await alice.client.from("generations").update({ saved: true }).eq("id", aliceGenId).select("saved").single();
    expect(ok.error).toBeNull();
    expect(ok.data?.saved).toBe(true);
    const bad = await alice.client.from("generations").update({ cost_usd: 0 }).eq("id", aliceGenId);
    expect(bad.error).not.toBeNull();
    const bad2 = await alice.client.from("generations").update({ result_path: `${bob.id}/x.png` }).eq("id", aliceGenId);
    expect(bad2.error).not.toBeNull();
  });

  it("a shopper cannot change another shopper's saved flag", async () => {
    const r = await bob.client.from("generations").update({ saved: false }).eq("id", aliceGenId).select("id");
    expect(r.data ?? []).toEqual([]);
  });

  it("a user cannot escalate their own role", async () => {
    const r = await alice.client.from("profiles").update({ role: "admin" }).eq("id", alice.id);
    expect(r.error).not.toBeNull();
    const p = await admin().from("profiles").select("role").eq("id", alice.id).single();
    expect(p.data?.role).toBe("shopper");
  });

  it("feedback can only be left on your own generations", async () => {
    const bad = await bob.client.from("feedback").insert({ generation_id: aliceGenId, user_id: bob.id, rating: 1 });
    expect(bad.error).not.toBeNull();
    const ok = await alice.client.from("feedback").insert({ generation_id: aliceGenId, user_id: alice.id, rating: 5 });
    expect(ok.error).toBeNull();
  });

  it("a merchant cannot create or modify products in another merchant's catalog", async () => {
    const ins = await merchantB.client.from("products").insert({ merchant_id: merchantAId, name: "Spoof", category: "tops", purchase_url: "https://b.example", image_path: "x" });
    expect(ins.error).not.toBeNull();
    const upd = await merchantB.client.from("products").update({ purchase_url: "https://evil.example" }).eq("id", productA).select("id");
    expect(upd.data ?? []).toEqual([]);
    const del = await merchantB.client.from("products").delete().eq("id", productA).select("id");
    expect(del.data ?? []).toEqual([]);
    const still = await admin().from("products").select("purchase_url").eq("id", productA).single();
    expect(still.data?.purchase_url).toBe("https://a.example/h");
  });

  it("a merchant cannot read another merchant's account or private stats", async () => {
    expect((await merchantB.client.from("merchants").select("id").eq("id", merchantAId)).data).toEqual([]);
    const stats = await merchantB.client.rpc("merchant_product_stats", { p_merchant: merchantAId });
    expect(stats.data ?? []).toEqual([]);
    const own = await merchantA.client.rpc("merchant_product_stats", { p_merchant: merchantAId });
    expect((own.data ?? []).length).toBe(2);
  });

  it("merchants cannot see shopper photos, even of shoppers who tried their products", async () => {
    expect((await merchantA.client.from("person_photos").select("id")).data).toEqual([]);
    expect((await merchantA.client.storage.from("person-photos").download(alicePath())).data).toBeNull();
  });

  it("admins can read generation logs but NOT personal photos", async () => {
    expect((await staff.client.from("generations").select("id").eq("id", aliceGenId)).data).toHaveLength(1);
    expect((await staff.client.from("person_photos").select("id")).data).toEqual([]);
    expect((await staff.client.storage.from("person-photos").download(alicePath())).data).toBeNull();
  });

  it("anonymous visitors see active products only and no waitlist or analytics data", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    const products = await anon.from("products").select("id");
    const ids = (products.data ?? []).map((p) => p.id);
    expect(ids).toContain(productA);
    expect(ids).not.toContain(productInactive);
    await admin().from("waitlist_signups").insert({ visitor_id: "v-test-1234", email: `w-${crypto.randomUUID()}@x.test`, brand_name: "W" });
    expect((await anon.from("waitlist_signups").select("id")).data ?? []).toEqual([]);
    expect((await anon.from("landing_events").select("id")).data ?? []).toEqual([]);
    expect((await anon.from("generations").select("id")).data ?? []).toEqual([]);
    const ins = await anon.from("waitlist_signups").insert({ visitor_id: "v-anon-1234", email: "anon@x.test", brand_name: "X" });
    expect(ins.error).not.toBeNull();
  });

  it("a non-admin cannot read waitlist, conversion or cost views", async () => {
    expect((await alice.client.from("waitlist_signups").select("id")).data ?? []).toEqual([]);
    expect((await alice.client.from("generation_stats_daily").select("*")).data ?? []).toEqual([]);
    expect((await staff.client.from("waitlist_signups").select("id")).data?.length ?? 0).toBeGreaterThan(0);
  });

  it("F1: shoppers cannot read internal cost or raw provider errors on their own generations", async () => {
    const cost = await alice.client.from("generations").select("cost_usd").eq("id", aliceGenId);
    expect(cost.error).not.toBeNull();
    const err = await alice.client.from("generations").select("error_message").eq("id", aliceGenId);
    expect(err.error).not.toBeNull();
    const allowed = await alice.client.from("generations").select("id, status, saved").eq("id", aliceGenId);
    expect(allowed.data).toHaveLength(1);
    expect((await alice.client.from("generation_stats_daily").select("*")).data ?? []).toEqual([]);
  });

  it("F2: merchants cannot change their own plan or quota", async () => {
    const r = await merchantA.client.from("merchants").update({ monthly_generation_quota: 999999 }).eq("id", merchantAId);
    expect(r.error).not.toBeNull();
    const r2 = await merchantA.client.from("merchants").update({ plan: "enterprise" }).eq("id", merchantAId);
    expect(r2.error).not.toBeNull();
    const r3 = await merchantA.client.from("merchants").update({ name: "A Brand Renamed" }).eq("id", merchantAId);
    expect(r3.error).toBeNull();
    const ins = await bob.client.from("merchants").insert({ owner_id: bob.id, name: "Bob", monthly_generation_quota: 1e6 });
    expect(ins.error).not.toBeNull();
  });

  it("F3: shoppers cannot extend photo retention", async () => {
    const upd = await alice.client.from("person_photos").update({ expires_at: "2099-01-01T00:00:00Z" }).eq("id", alicePhotoId);
    expect(upd.error).not.toBeNull();
    const ins = await bob.client.from("person_photos").insert({
      user_id: bob.id, storage_path: `${bob.id}/p.png`, mime_type: "image/png", byte_size: 1,
      consent_version: "t", consented_at: new Date().toISOString(), expires_at: "2099-01-01T00:00:00Z",
    });
    expect(ins.error).not.toBeNull();
    const backdated = await bob.client.from("person_photos").insert({
      user_id: bob.id, storage_path: `${bob.id}/q.png`, mime_type: "image/png", byte_size: 1, created_at: "2098-01-01T00:00:00Z",
      consent_version: "t", consented_at: new Date().toISOString(), expires_at: "2099-01-01T00:00:00Z",
    });
    expect(backdated.error).not.toBeNull();
  });

  it("deleting a user who has generations succeeds and detaches the usage log", async () => {
    const temp = await createUser("temp-gen");
    const g = await admin().from("generations").insert({ user_id: temp.id, provider: "t", model: "m", status: "succeeded", cost_usd: 0.075 }).select("id").single();
    expect(g.error).toBeNull();
    const del = await admin().auth.admin.deleteUser(temp.id);
    expect(del.error).toBeNull();
    const row = await admin().from("generations").select("user_id, cost_usd").eq("id", g.data!.id).single();
    expect(row.data).toEqual({ user_id: null, cost_usd: 0.075 });
  });

  it("deleting a user cascades their personal rows", async () => {
    const temp = await createUser("temp");
    await temp.client.from("person_photos").insert({
      user_id: temp.id, storage_path: `${temp.id}/p.png`, mime_type: "image/png", byte_size: 1,
      consent_version: "t", consented_at: new Date().toISOString(), expires_at: new Date(Date.now() + 864e5).toISOString(),
    });
    await deleteUser(temp);
    const left = await admin().from("person_photos").select("id").eq("user_id", temp.id);
    expect(left.data).toEqual([]);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, configured, createUser, deleteUser, type TestUser } from "./helpers";

// Integration tests for migrations 0003–0006 (experiments, usage ledger, pilot, Shopify)
// through the real PostgREST/Auth services with real user JWTs.
const d = configured ? describe : describe.skip;

d("experiments, usage ledger, pilot program, Shopify tables", () => {
  let ownerA: TestUser, ownerB: TestUser, staff: TestUser, shopper: TestUser;
  let merchantA: string, merchantB: string, expA: string, productA: string, genId: string;

  beforeAll(async () => {
    [ownerA, ownerB, staff, shopper] = await Promise.all([createUser("owner-a"), createUser("owner-b"), createUser("staff2"), createUser("shopper2")]);
    const svc = admin();
    await svc.from("profiles").update({ role: "admin" }).eq("id", staff.id);
    merchantA = (await ownerA.client.from("merchants").insert({ owner_id: ownerA.id, name: "A" }).select("id").single()).data!.id;
    merchantB = (await ownerB.client.from("merchants").insert({ owner_id: ownerB.id, name: "B" }).select("id").single()).data!.id;
    const e = await ownerA.client.from("experiments").insert({ merchant_id: merchantA, key: "hoodies-v1", hypothesis: "Try-on increases add to cart on hoodies" }).select("id").single();
    expect(e.error).toBeNull();
    expA = e.data!.id;
    productA = (await ownerA.client.from("products").insert({ merchant_id: merchantA, name: "H", category: "tops", purchase_url: "https://a.example/h", image_path: "x" }).select("id").single()).data!.id;
    genId = (await svc.from("generations").insert({ user_id: shopper.id, merchant_id: merchantA, product_id: productA, provider: "t", model: "m", status: "succeeded", cost_usd: 0.075 }).select("id").single()).data!.id;
  });

  afterAll(async () => {
    await Promise.all([ownerA, ownerB, staff, shopper].map(deleteUser));
  });

  describe("experiments", () => {
    it("merchants cannot create experiments for another merchant", async () => {
      const r = await ownerB.client.from("experiments").insert({ merchant_id: merchantA, key: "spoof-x", hypothesis: "spoofed experiment here" });
      expect(r.error).not.toBeNull();
    });
    it("merchants cannot read another merchant's experiments or summaries", async () => {
      expect((await ownerB.client.from("experiments").select("id").eq("id", expA)).data).toEqual([]);
      expect((await ownerB.client.rpc("experiment_summary", { p_experiment: expA })).data ?? []).toEqual([]);
    });
    it("merchants cannot set status/salt directly (server-controlled transitions)", async () => {
      expect((await ownerA.client.from("experiments").update({ status: "running" }).eq("id", expA)).error).not.toBeNull();
      expect((await ownerA.client.from("experiments").select("salt").eq("id", expA)).error).not.toBeNull();
    });
    it("raw assignments/events are not writable or readable by merchants", async () => {
      expect((await ownerA.client.from("experiment_assignments").insert({ experiment_id: expA, visitor_id: "visitor-0001", arm: "treatment" })).error).not.toBeNull();
      expect((await ownerA.client.from("experiment_events").select("id")).data ?? []).toEqual([]);
    });
    it("the summary counts intent-to-treat per arm and dedupes orders", async () => {
      const svc = admin();
      await svc.from("experiments").update({ status: "running", started_at: new Date().toISOString() }).eq("id", expA);
      const rows = [
        { experiment_id: expA, visitor_id: "visitor-t1", arm: "treatment" }, { experiment_id: expA, visitor_id: "visitor-t2", arm: "treatment" },
        { experiment_id: expA, visitor_id: "visitor-c1", arm: "control" }, { experiment_id: expA, visitor_id: "visitor-c2", arm: "control" },
      ];
      expect((await svc.from("experiment_assignments").insert(rows)).error).toBeNull();
      await svc.from("experiment_events").insert([
        { experiment_id: expA, visitor_id: "visitor-t1", arm: "treatment", event: "add_to_cart" },
        { experiment_id: expA, visitor_id: "visitor-t1", arm: "treatment", event: "add_to_cart" },
        { experiment_id: expA, visitor_id: "visitor-t1", arm: "treatment", event: "purchase", value_cents: 6500, external_order_id: "1001", source: "shopify_webhook" },
        { experiment_id: expA, visitor_id: "visitor-c1", arm: "control", event: "add_to_cart" },
      ], { defaultToNull: false }); // mixed-shape bulk insert: let column defaults apply
      const dup = await svc.from("experiment_events").insert({ experiment_id: expA, visitor_id: "visitor-t1", arm: "treatment", event: "purchase", value_cents: 6500, external_order_id: "1001", source: "browser" });
      expect(dup.error?.code).toBe("23505");
      const orphan = await svc.from("experiment_events").insert({ experiment_id: expA, visitor_id: "never-assigned", arm: "treatment", event: "add_to_cart" });
      expect(orphan.error).not.toBeNull();
      const { data } = await ownerA.client.rpc("experiment_summary", { p_experiment: expA });
      const t = data!.find((r: { arm: string }) => r.arm === "treatment");
      const c = data!.find((r: { arm: string }) => r.arm === "control");
      expect(t).toMatchObject({ visitors: 2, add_to_cart: 1, purchasers: 1, revenue_cents: 6500 });
      expect(c).toMatchObject({ visitors: 2, add_to_cart: 1, purchasers: 0 });
    });
  });

  describe("usage ledger & quotas", () => {
    it("plans are publicly readable (prices are marked as test prices)", async () => {
      const { data } = await shopper.client.from("plans").select("key, is_test_price");
      expect(data?.map((p) => p.key).sort()).toEqual(["enterprise", "growth", "pilot", "pro", "starter"]);
      expect(data?.every((p) => p.is_test_price)).toBe(true);
    });
    it("the ledger is append-only and dedupes per generation", async () => {
      const svc = admin();
      expect((await svc.from("usage_events").insert({ merchant_id: merchantA, generation_id: genId, unit_cost_usd: 0.075, billing_period: "2026-10-01" })).error).toBeNull();
      expect((await svc.from("usage_events").insert({ merchant_id: merchantA, generation_id: genId, unit_cost_usd: 0.075, billing_period: "2026-10-01" })).error?.code).toBe("23505");
      expect((await svc.from("usage_events").update({ quantity: 100 }).eq("generation_id", genId)).error).not.toBeNull();
      expect((await svc.from("usage_events").delete().eq("generation_id", genId)).error).not.toBeNull();
      expect((await svc.from("usage_events").update({ reported_to_billing_at: new Date().toISOString() }).eq("generation_id", genId)).error).toBeNull();
    });
    it("users cannot write or read the raw ledger", async () => {
      expect((await ownerA.client.from("usage_events").insert({ merchant_id: merchantA, unit_cost_usd: 0, billing_period: "2026-10-01" })).error).not.toBeNull();
      expect((await ownerA.client.from("usage_events").select("id")).data ?? []).toEqual([]);
    });
    it("merchant usage summary: own store only, with plan allowance", async () => {
      const own = await ownerA.client.rpc("merchant_usage_summary", { p_merchant: merchantA, p_period: "2026-10-01" });
      expect(own.data?.[0]).toMatchObject({ plan: "pilot", used: 1, included: 500, hard_cap: true, estimated_total_cents: 0, billing_status: "not_billing" });
      expect((await ownerB.client.rpc("merchant_usage_summary", { p_merchant: merchantA, p_period: "2026-10-01" })).data ?? []).toEqual([]);
    });
    it("merchants cannot change their billing status", async () => {
      expect((await ownerA.client.from("merchants").update({ billing_status: "active" }).eq("id", merchantA)).error).not.toBeNull();
    });
  });

  describe("pilot program", () => {
    beforeAll(async () => {
      await admin().from("pilot_enrollments").insert({ merchant_id: merchantA, status: "live", products_limit: 2, admin_notes: "internal only", start_date: "2026-10-01" });
    });
    it("merchants see their enrollment but not internal notes or conversion outcome", async () => {
      expect((await ownerA.client.from("pilot_enrollments").select("status, products_limit").eq("merchant_id", merchantA)).data).toEqual([{ status: "live", products_limit: 2 }]);
      expect((await ownerA.client.from("pilot_enrollments").select("admin_notes")).error).not.toBeNull();
      expect((await ownerB.client.from("pilot_enrollments").select("status").eq("merchant_id", merchantA)).data).toEqual([]);
      expect((await ownerA.client.from("pilot_enrollments").update({ products_limit: 999 }).eq("merchant_id", merchantA)).error).not.toBeNull();
    });
    it("the database enforces the pilot product limit", async () => {
      expect((await ownerA.client.from("products").insert({ merchant_id: merchantA, name: "H2", category: "tops", purchase_url: "https://a.example/2", image_path: "y", is_active: true })).error).toBeNull();
      const third = await ownerA.client.from("products").insert({ merchant_id: merchantA, name: "H3", category: "tops", purchase_url: "https://a.example/3", image_path: "z", is_active: true });
      expect(third.error?.message).toMatch(/pilot product limit/);
      expect((await ownerA.client.from("products").insert({ merchant_id: merchantA, name: "H4", category: "tops", purchase_url: "https://a.example/4", image_path: "w", is_active: false })).error).toBeNull();
    });
    it("merchant feedback: own store only, one per week", async () => {
      const row = { merchant_id: merchantA, submitted_by: ownerA.id, pilot_week: 1, likelihood_to_recommend: 8, value_rating: 4, quality_rating: 3, would_pay: "maybe" };
      expect((await ownerA.client.from("merchant_feedback").insert(row)).error).toBeNull();
      expect((await ownerA.client.from("merchant_feedback").insert(row)).error?.code).toBe("23505");
      expect((await ownerB.client.from("merchant_feedback").insert({ ...row, submitted_by: ownerB.id, pilot_week: 2 })).error).not.toBeNull();
      expect((await ownerB.client.from("merchant_feedback").select("id").eq("merchant_id", merchantA)).data).toEqual([]);
    });
    it("only admins see the pilot scorecard", async () => {
      expect((await ownerA.client.from("pilot_scorecard").select("*")).data ?? []).toEqual([]);
      const s = await staff.client.from("pilot_scorecard").select("name, status, latest_ltr, latest_would_pay, tryon_attempts").eq("merchant_id", merchantA);
      expect(s.data?.[0]).toMatchObject({ name: "A", status: "live", latest_ltr: 8, latest_would_pay: "maybe", tryon_attempts: 1 });
    });
  });

  describe("Shopify tables", () => {
    const shop = `a-dev-${crypto.randomUUID().slice(0, 8)}.myshopify.com`;
    afterAll(async () => { await admin().from("shopify_installations").delete().eq("shop_domain", shop); });
    it("are inaccessible to users, including admins via the API", async () => {
      expect((await admin().from("shopify_installations").insert({ shop_domain: shop, merchant_id: merchantA, access_token_ciphertext: "v1.x.y.z", scopes: "read_products" })).error).toBeNull();
      for (const c of [ownerA.client, staff.client]) {
        expect((await c.from("shopify_installations").select("*")).data ?? []).toEqual([]);
        expect((await c.from("shopify_oauth_states").insert({ state: "s", shop_domain: shop })).error).not.toBeNull();
      }
    });
    it("merchants see only their own connection status (never the token)", async () => {
      expect((await ownerA.client.rpc("shopify_status", { p_merchant: merchantA })).data).toEqual([expect.objectContaining({ shop_domain: shop })]);
      expect(JSON.stringify((await ownerA.client.rpc("shopify_status", { p_merchant: merchantA })).data)).not.toContain("v1.x.y.z");
      expect((await ownerB.client.rpc("shopify_status", { p_merchant: merchantA })).data ?? []).toEqual([]);
    });
    it("rejects invalid shop domains at the database level", async () => {
      expect((await admin().from("shopify_installations").insert({ shop_domain: "evil.com" })).error).not.toBeNull();
    });
  });
});

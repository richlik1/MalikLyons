import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, configured, createUser, deleteUser, type TestUser } from "./helpers";

const d = configured ? describe : describe.skip;

d("api_keys table (migration 0008)", () => {
  let a: TestUser, b: TestUser, shopper: TestUser, merchantA: string, keyId: string;
  beforeAll(async () => {
    [a, b, shopper] = await Promise.all([createUser("key-a"), createUser("key-b"), createUser("key-shopper")]);
    merchantA = (await a.client.from("merchants").insert({ owner_id: a.id, name: "KA" }).select("id").single()).data!.id;
    await b.client.from("merchants").insert({ owner_id: b.id, name: "KB" });
    keyId = (await admin().from("api_keys").insert({ merchant_id: merchantA, kind: "secret", prefix: "ts_sk_abcd", key_hash: `h-${crypto.randomUUID()}` }).select("id").single()).data!.id;
  });
  afterAll(async () => { await Promise.all([a, b, shopper].map(deleteUser)); });

  it("owners see their keys but never the hash", async () => {
    expect((await a.client.from("api_keys").select("id, prefix").eq("id", keyId)).data).toEqual([{ id: keyId, prefix: "ts_sk_abcd" }]);
    expect((await a.client.from("api_keys").select("key_hash")).error).not.toBeNull();
  });
  it("other merchants and shoppers see nothing", async () => {
    expect((await b.client.from("api_keys").select("id")).data).toEqual([]);
    expect((await shopper.client.from("api_keys").select("id")).data).toEqual([]);
  });
  it("nobody can create, change or revoke keys directly through the API", async () => {
    expect((await a.client.from("api_keys").insert({ merchant_id: merchantA, kind: "secret", prefix: "x", key_hash: "y" })).error).not.toBeNull();
    expect((await a.client.from("api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", keyId)).error).not.toBeNull();
    expect((await b.client.from("api_keys").delete().eq("id", keyId).select("id")).data ?? []).toEqual([]);
  });
  it("Pro test tier reflects the corrected allowance", async () => {
    expect((await a.client.from("plans").select("included_generations, overage_cents_per_generation").eq("key", "pro").single()).data).toEqual({ included_generations: 2500, overage_cents_per_generation: 15 });
  });
});

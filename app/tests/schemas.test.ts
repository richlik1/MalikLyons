import { describe, expect, it } from "vitest";
import { productFieldsSchema, waitlistSchema } from "@/lib/schemas";

describe("waitlistSchema", () => {
  const base = { visitorId: "abcdefgh-1234", email: "Founder@Brand.COM ", brandName: "Brand" };
  it("normalises email", () => {
    expect(waitlistSchema.parse(base).email).toBe("founder@brand.com");
  });
  it("rejects honeypot submissions", () => {
    expect(waitlistSchema.safeParse({ ...base, company: "bot inc" }).success).toBe(false);
  });
  it("rejects invalid store URLs", () => {
    expect(waitlistSchema.safeParse({ ...base, storeUrl: "javascript:alert(1)" }).success).toBe(false);
  });
});

describe("productFieldsSchema", () => {
  const base = { name: "Hoodie", category: "tops", purchaseUrl: "https://shop.example/p/1", price: "59.00" };
  it("accepts a valid product", () => expect(productFieldsSchema.safeParse(base).success).toBe(true));
  it("requires https purchase URLs", () => expect(productFieldsSchema.safeParse({ ...base, purchaseUrl: "http://shop.example" }).success).toBe(false));
  it("rejects malformed prices", () => expect(productFieldsSchema.safeParse({ ...base, price: "1e9" }).success).toBe(false));
});

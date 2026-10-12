import { describe, expect, it } from "vitest";
import { sameOrigin } from "@/lib/http";

const mk = (url: string, headers: Record<string, string>) => new Request(url, { method: "POST", headers });

describe("sameOrigin", () => {
  it("accepts the host the browser addressed even if req.url differs (proxy / next start)", () => {
    expect(sameOrigin(mk("http://localhost:3000/api/x", { origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000" }))).toBe(true);
    expect(sameOrigin(mk("http://internal:3000/api/x", { origin: "https://staging.trendset.example", host: "internal:3000", "x-forwarded-host": "staging.trendset.example" }))).toBe(true);
  });
  it("rejects other origins", () => {
    expect(sameOrigin(mk("http://localhost:3000/api/x", { origin: "https://evil.example", host: "localhost:3000" }))).toBe(false);
    expect(sameOrigin(mk("http://localhost:3000/api/x", { origin: "null", host: "localhost:3000" }))).toBe(false);
  });
  it("allows requests without an Origin header (server-to-server)", () => {
    expect(sameOrigin(mk("http://localhost:3000/api/x", { host: "localhost:3000" }))).toBe(true);
  });
});

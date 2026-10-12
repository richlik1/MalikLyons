import { describe, expect, it } from "vitest";
import { MAX_IMAGE_BYTES, validateImage } from "@/lib/image";
import { jpeg, png, webpVp8x } from "./fixtures";

describe("validateImage", () => {
  it("accepts PNG, JPEG and WebP and reads dimensions", () => {
    expect(validateImage(png(800, 1200))).toEqual({ ok: true, info: { mimeType: "image/png", width: 800, height: 1200 } });
    expect(validateImage(jpeg(1024, 768))).toEqual({ ok: true, info: { mimeType: "image/jpeg", width: 1024, height: 768 } });
    expect(validateImage(webpVp8x(600, 900))).toEqual({ ok: true, info: { mimeType: "image/webp", width: 600, height: 900 } });
  });

  it("rejects files whose bytes are not an image, regardless of name or MIME", () => {
    const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    expect(validateImage(html).ok).toBe(false);
    const gif = new TextEncoder().encode("GIF89a.......");
    expect(validateImage(gif).ok).toBe(false);
  });

  it("rejects empty and oversized files", () => {
    expect(validateImage(new Uint8Array())).toMatchObject({ ok: false });
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    big.set(png(800, 800));
    expect(validateImage(big)).toMatchObject({ ok: false, error: expect.stringContaining("8 MB") });
  });

  it("enforces minimum and maximum dimensions", () => {
    expect(validateImage(png(300, 1000), { minDimension: 512 })).toMatchObject({ ok: false });
    expect(validateImage(png(7000, 1000))).toMatchObject({ ok: false });
  });

  it("rejects truncated headers", () => {
    expect(validateImage(png(800, 800).subarray(0, 14)).ok).toBe(false);
  });
});

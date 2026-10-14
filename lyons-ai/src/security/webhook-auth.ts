import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * n8n -> agent webhook authentication.
 * Header `x-lyons-timestamp`: unix seconds. Header `x-lyons-signature`: hex
 * HMAC-SHA256 over `${timestamp}.${rawBody}`. Requests older than the tolerance
 * are rejected to prevent replay.
 */
export function signWebhook(secret: string, timestamp: number, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

export function verifyWebhook(opts: {
  secret: string;
  timestampHeader: string | undefined;
  signatureHeader: string | undefined;
  rawBody: string;
  nowSeconds?: number;
  toleranceSeconds?: number;
}): { ok: true } | { ok: false; reason: string } {
  const { secret, timestampHeader, signatureHeader, rawBody } = opts;
  if (!timestampHeader || !signatureHeader) return { ok: false, reason: "missing signature headers" };
  const ts = Number(timestampHeader);
  if (!Number.isInteger(ts)) return { ok: false, reason: "bad timestamp" };
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > (opts.toleranceSeconds ?? 300)) return { ok: false, reason: "timestamp outside tolerance" };
  const expected = Buffer.from(signWebhook(secret, ts, rawBody), "hex");
  const given = Buffer.from(signatureHeader, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "bad signature" };
  return { ok: true };
}

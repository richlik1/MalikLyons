import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { MAX_IMAGE_BYTES, validateImage, type SupportedMime } from "./image";

// Fetches images referenced by API callers (person_image_url / garment_image_url) without
// letting them reach our internal network (SSRF): https only, port 443, every resolved address
// must be public, no redirects, size and time limits, content validated by magic bytes.
// Residual risk: DNS rebinding between lookup and connect — acceptable for v1, noted in docs.

export class RemoteImageError extends Error {}

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) || a >= 224
    );
  }
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === "::" || v === "::1") return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || /^ff/.test(v);
  }
  return true; // unknown format: refuse
}

type Lookup = (host: string) => Promise<{ address: string }[]>;
const defaultLookup: Lookup = (host) => lookup(host, { all: true, verbatim: true });

export async function fetchRemoteImage(
  rawUrl: string,
  opts: { minDimension?: number; fetchImpl?: typeof fetch; lookupImpl?: Lookup; timeoutMs?: number } = {},
): Promise<{ bytes: Uint8Array; mimeType: SupportedMime }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new RemoteImageError("Image URL is not valid.");
  }
  if (url.protocol !== "https:") throw new RemoteImageError("Image URLs must use https.");
  if (url.port && url.port !== "443") throw new RemoteImageError("Image URLs must use the default https port.");
  if (url.username || url.password) throw new RemoteImageError("Image URLs must not contain credentials.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [{ address: host }] : await (opts.lookupImpl ?? defaultLookup)(host).catch(() => []);
  if (!addrs.length) throw new RemoteImageError("Image host could not be resolved.");
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new RemoteImageError("Image host is not publicly reachable.");

  const res = await (opts.fetchImpl ?? fetch)(url, { redirect: "manual", signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000) }).catch(() => null);
  if (!res) throw new RemoteImageError("Image could not be downloaded.");
  if (res.status >= 300 && res.status < 400) throw new RemoteImageError("Image URL redirects; provide the final URL.");
  if (!res.ok) throw new RemoteImageError(`Image download failed (${res.status}).`);
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > MAX_IMAGE_BYTES) throw new RemoteImageError("Image is larger than 8 MB.");

  const reader = res.body?.getReader();
  if (!reader) throw new RemoteImageError("Image could not be downloaded.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_IMAGE_BYTES) {
      await reader.cancel();
      throw new RemoteImageError("Image is larger than 8 MB.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { bytes.set(c, off); off += c.length; }
  const check = validateImage(bytes, { minDimension: opts.minDimension });
  if (!check.ok) throw new RemoteImageError(check.error);
  return { bytes, mimeType: check.info.mimeType };
}

export function decodeBase64Image(b64: string, minDimension?: number): { bytes: Uint8Array; mimeType: SupportedMime } {
  const clean = b64.replace(/^data:image\/[a-z+]+;base64,/i, "");
  if (clean.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4) throw new RemoteImageError("Image is larger than 8 MB.");
  const bytes = new Uint8Array(Buffer.from(clean, "base64"));
  const check = validateImage(bytes, { minDimension });
  if (!check.ok) throw new RemoteImageError(check.error);
  return { bytes, mimeType: check.info.mimeType };
}

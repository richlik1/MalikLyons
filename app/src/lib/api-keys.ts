import { createHash, randomBytes } from "node:crypto";

// API keys: ts_sk_… (secret, server-to-server) and ts_pk_… (publishable, website widget).
// Only sha256(key) is stored. Plaintext is returned once at creation.

export type KeyKind = "secret" | "publishable";
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export function generateApiKey(kind: KeyKind): { plaintext: string; prefix: string; hash: string } {
  const bytes = randomBytes(32);
  let body = "";
  for (const b of bytes) body += ALPHABET[b % 62]; // 32 chars × log2(62) ≈ 190 bits
  const plaintext = `${kind === "secret" ? "ts_sk_" : "ts_pk_"}${body}`;
  return { plaintext, prefix: plaintext.slice(0, 10), hash: hashApiKey(plaintext) };
}

export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

export function keyKindOf(plaintext: string): KeyKind | null {
  if (/^ts_sk_[0-9A-Za-z]{32}$/.test(plaintext)) return "secret";
  if (/^ts_pk_[0-9A-Za-z]{32}$/.test(plaintext)) return "publishable";
  return null;
}

export function bearerToken(header: string | null): string | null {
  const m = header?.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : null;
}

/** Normalizes "https://shop.example/path" → "https://shop.example"; rejects non-http(s). */
export function normalizeOrigin(input: string): string | null {
  try {
    const u = new URL(input.trim());
    if (u.protocol !== "https:" && !(u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname))) return null;
    return u.origin;
  } catch {
    return null;
  }
}

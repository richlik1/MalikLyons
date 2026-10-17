import "server-only";
import { NextResponse } from "next/server";
import { bearerToken, hashApiKey, keyKindOf, type KeyKind } from "./api-keys";
import { createAdminClient } from "./supabase/server";

export interface ApiCaller { keyId: string; merchantId: string; kind: KeyKind; allowedOrigins: string[] }

export function apiError(status: number, code: string, message: string, headers?: Record<string, string>) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Request-Id": crypto.randomUUID(), ...headers } });
}

/** Authenticates `Authorization: Bearer ts_sk_…`. Secret keys must never be used from browsers. */
export async function authenticateSecretKey(req: Request): Promise<ApiCaller | NextResponse> {
  const token = bearerToken(req.headers.get("authorization"));
  if (!token) return apiError(401, "missing_api_key", "Provide your secret key: Authorization: Bearer ts_sk_…");
  const kind = keyKindOf(token);
  if (kind === "publishable") return apiError(403, "wrong_key_type", "Publishable keys (ts_pk_) only work with the website widget. Use a secret key (ts_sk_) from your server.");
  if (kind !== "secret") return apiError(401, "invalid_api_key", "API key is not valid.");
  if (req.headers.get("origin")) {
    return apiError(400, "secret_key_in_browser", "Secret keys must only be used from your server. Use the website widget with a publishable key for browsers.");
  }
  const caller = await lookupKey(token, "secret");
  return caller ?? apiError(401, "invalid_api_key", "API key is not valid or has been revoked.");
}

export async function lookupKey(plaintext: string, kind: KeyKind): Promise<ApiCaller | null> {
  if (keyKindOf(plaintext) !== kind) return null;
  const svc = createAdminClient();
  const { data } = await svc
    .from("api_keys")
    .select("id, merchant_id, kind, allowed_origins, merchants(status)")
    .eq("key_hash", hashApiKey(plaintext))
    .is("revoked_at", null)
    .maybeSingle();
  if (!data || data.kind !== kind) return null;
  const merchant = data.merchants as unknown as { status: string } | null;
  if (merchant?.status === "suspended") return null;
  void svc.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data.id).then(() => {});
  return { keyId: data.id, merchantId: data.merchant_id, kind, allowedOrigins: data.allowed_origins ?? [] };
}

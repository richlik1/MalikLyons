import { NextResponse } from "next/server";
import { z } from "zod";
import { generateApiKey, normalizeOrigin } from "@/lib/api-keys";
import { jsonError, parseJson, sameOrigin } from "@/lib/http";
import { createAdminClient, createUserClient, getSessionUser } from "@/lib/supabase/server";

const schema = z.object({
  kind: z.enum(["secret", "publishable"]),
  name: z.string().trim().min(1).max(60).default("Default"),
  allowedOrigins: z.array(z.string().max(200)).max(10).default([]),
});

const MAX_ACTIVE_KEYS = 10;

// Creates an API key for the signed-in merchant. The plaintext is returned ONCE.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return jsonError(403, "bad_origin", "Cross-site request rejected.");
  const user = await getSessionUser();
  if (!user) return jsonError(401, "unauthenticated", "Please sign in.");
  const parsed = await parseJson(req, schema);
  if (!parsed.ok) return parsed.res;
  const { data: merchant } = await (await createUserClient()).from("merchants").select("id").eq("owner_id", user.id).maybeSingle();
  if (!merchant) return jsonError(403, "not_merchant", "Create your store first.");

  const origins = (parsed.data.allowedOrigins ?? []).map(normalizeOrigin);
  if (origins.some((o) => !o)) return jsonError(400, "invalid_origin", "Allowed sites must be full URLs like https://yourstore.com");
  if (parsed.data.kind === "publishable" && origins.length === 0) {
    return jsonError(400, "origins_required", "Add at least one website where the widget will run.");
  }

  const svc = createAdminClient();
  const { count } = await svc.from("api_keys").select("id", { count: "exact", head: true }).eq("merchant_id", merchant.id).is("revoked_at", null);
  if ((count ?? 0) >= MAX_ACTIVE_KEYS) return jsonError(409, "too_many_keys", `Revoke a key first (max ${MAX_ACTIVE_KEYS} active).`);

  const key = generateApiKey(parsed.data.kind);
  const { data, error } = await svc
    .from("api_keys")
    .insert({ merchant_id: merchant.id, kind: parsed.data.kind, name: parsed.data.name ?? "Default", prefix: key.prefix, key_hash: key.hash, allowed_origins: origins as string[], created_by: user.id })
    .select("id")
    .single();
  if (error) return jsonError(500, "key_failed", "Couldn't create the key.");
  return NextResponse.json({ id: data.id, key: key.plaintext, note: "Copy this key now. It will not be shown again." }, { headers: { "Cache-Control": "no-store" } });
}

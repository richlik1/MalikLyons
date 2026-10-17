import { NextResponse } from "next/server";
import { jsonError, sameOrigin } from "@/lib/http";
import { createAdminClient, createUserClient, getSessionUser } from "@/lib/supabase/server";

// Revokes a key immediately. RLS on the user client confirms the key belongs to this merchant.
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return jsonError(403, "bad_origin", "Cross-site request rejected.");
  const user = await getSessionUser();
  if (!user) return jsonError(401, "unauthenticated", "Please sign in.");
  const { id } = await ctx.params;
  const { data: key } = await (await createUserClient()).from("api_keys").select("id").eq("id", id).maybeSingle();
  if (!key) return jsonError(404, "not_found", "Key not found.");
  await createAdminClient().from("api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", id).is("revoked_at", null);
  return NextResponse.json({ revoked: true });
}

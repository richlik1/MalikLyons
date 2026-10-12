import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, parseJson, sameOrigin } from "@/lib/http";
import { createUserClient, getSessionUser } from "@/lib/supabase/server";

// Activate/deactivate a product or correct its category. RLS limits this to the owner's
// products; the pilot product limit is enforced by a database trigger.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return jsonError(403, "bad_origin", "Cross-site request rejected.");
  const user = await getSessionUser();
  if (!user) return jsonError(401, "unauthenticated", "Please sign in.");
  const parsed = await parseJson(req, z.object({ isActive: z.boolean().optional(), category: z.enum(["tops", "bottoms", "one-pieces"]).optional() }).refine((v) => v.isActive !== undefined || v.category !== undefined));
  if (!parsed.ok) return parsed.res;
  const { id } = await ctx.params;
  const patch: Record<string, unknown> = {};
  if (parsed.data.isActive !== undefined) patch.is_active = parsed.data.isActive;
  if (parsed.data.category) patch.category = parsed.data.category;
  const { data, error } = await (await createUserClient()).from("products").update(patch).eq("id", id).select("id, is_active, category").maybeSingle();
  if (error?.message?.includes("pilot product limit")) return jsonError(409, "pilot_limit", error.message);
  if (error || !data) return jsonError(404, "not_found", "Product not found.");
  return NextResponse.json(data);
}

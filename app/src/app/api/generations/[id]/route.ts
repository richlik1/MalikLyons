import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, parseJson, sameOrigin } from "@/lib/http";
import { createUserClient, getSessionUser } from "@/lib/supabase/server";

// Save / unsave a look. The DB trigger only lets users change the "saved" column.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return jsonError(403, "bad_origin", "Cross-site request rejected.");
  const user = await getSessionUser();
  if (!user) return jsonError(401, "unauthenticated", "Please sign in.");
  const parsed = await parseJson(req, z.object({ saved: z.boolean() }));
  if (!parsed.ok) return parsed.res;
  const { id } = await ctx.params;

  const supabase = await createUserClient();
  const { data, error } = await supabase
    .from("generations")
    .update({ saved: parsed.data.saved })
    .eq("id", id)
    .eq("status", "succeeded")
    .select("id, saved")
    .maybeSingle();
  if (error || !data) return jsonError(404, "not_found", "Look not found.");
  return NextResponse.json(data);
}

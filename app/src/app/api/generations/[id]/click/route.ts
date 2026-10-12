import { NextResponse } from "next/server";
import { jsonError, sameOrigin } from "@/lib/http";
import { createAdminClient, getSessionUser } from "@/lib/supabase/server";

// Records the first click from a try-on result to the merchant's product page.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return jsonError(403, "bad_origin", "Cross-site request rejected.");
  const user = await getSessionUser();
  if (!user) return jsonError(401, "unauthenticated", "Please sign in.");
  const { id } = await ctx.params;
  await createAdminClient()
    .from("generations")
    .update({ shop_clicked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id) // ownership enforced explicitly (service role bypasses RLS)
    .is("shop_clicked_at", null);
  return new NextResponse(null, { status: 204 });
}

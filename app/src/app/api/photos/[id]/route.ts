import { NextResponse } from "next/server";
import { jsonError, sameOrigin } from "@/lib/http";
import { createAdminClient, getSessionUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Delete a personal photo and every try-on result generated from it.
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return jsonError(403, "bad_origin", "Cross-site request rejected.");
  const user = await getSessionUser();
  if (!user) return jsonError(401, "unauthenticated", "Please sign in.");
  const { id } = await ctx.params;

  const admin = createAdminClient();
  const { data: photo } = await admin
    .from("person_photos")
    .select("id, storage_path")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!photo) return jsonError(404, "not_found", "Photo not found.");

  const { data: gens } = await admin
    .from("generations")
    .select("id, result_path")
    .eq("person_photo_id", id)
    .eq("user_id", user.id);
  const resultPaths = (gens ?? []).map((g) => g.result_path).filter((p): p is string => Boolean(p));

  if (resultPaths.length) await admin.storage.from("tryon-results").remove(resultPaths);
  await admin.storage.from("person-photos").remove([photo.storage_path]);
  // Keep the generation rows (cost/usage log) but detach them from personal data.
  await admin.from("generations").update({ result_path: null, saved: false }).eq("person_photo_id", id);
  await admin.from("person_photos").delete().eq("id", id);

  return NextResponse.json({ deleted: true, resultsDeleted: resultPaths.length });
}

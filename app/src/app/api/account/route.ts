import { NextResponse } from "next/server";
import { jsonError, sameOrigin } from "@/lib/http";
import { createAdminClient, createUserClient, getSessionUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

async function removeFolder(admin: ReturnType<typeof createAdminClient>, bucket: string, folder: string) {
  // Storage has no recursive delete; page through the user's folder.
  for (;;) {
    const { data, error } = await admin.storage.from(bucket).list(folder, { limit: 100 });
    if (error) throw error;
    if (!data?.length) return;
    const { error: rmError } = await admin.storage.from(bucket).remove(data.map((o) => `${folder}/${o.name}`));
    if (rmError) throw rmError;
    if (data.length < 100) return;
  }
}

// Permanently delete the account: photos, results, then the auth user (rows cascade).
export async function DELETE(req: Request) {
  if (!sameOrigin(req)) return jsonError(403, "bad_origin", "Cross-site request rejected.");
  const user = await getSessionUser();
  if (!user) return jsonError(401, "unauthenticated", "Please sign in.");

  const admin = createAdminClient();
  try {
    await removeFolder(admin, "person-photos", user.id);
    await removeFolder(admin, "tryon-results", user.id);
    await removeFolder(admin, "garments", user.id);
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) throw error;
  } catch (err) {
    console.error("[account] deletion failed", err);
    return jsonError(500, "delete_failed", "Deletion didn't finish. Please try again or contact privacy@trendset.example.");
  }
  const supabase = await createUserClient();
  await supabase.auth.signOut();
  return NextResponse.json({ deleted: true });
}

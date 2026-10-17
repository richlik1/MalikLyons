import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Retention enforcement: deletes person photos past expires_at, plus results made from them.
// Schedule daily (see vercel.json). Protected by CRON_SECRET.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const { data: expired, error } = await admin
    .from("person_photos")
    .select("id, storage_path")
    .lt("expires_at", new Date().toISOString())
    .limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let photos = 0;
  let results = 0;
  for (const p of expired ?? []) {
    const { data: gens } = await admin.from("generations").select("result_path").eq("person_photo_id", p.id);
    const paths = (gens ?? []).map((g) => g.result_path).filter((x): x is string => Boolean(x));
    if (paths.length) await admin.storage.from("tryon-results").remove(paths);
    await admin.storage.from("person-photos").remove([p.storage_path]);
    await admin.from("generations").update({ result_path: null, saved: false }).eq("person_photo_id", p.id);
    await admin.from("person_photos").delete().eq("id", p.id);
    photos++;
    results += paths.length;
  }
  // API results (merchant-controlled shopper data): same retention window, measured from creation.
  const days = Math.min(Math.max(Number(process.env.PERSON_PHOTO_RETENTION_DAYS) || 30, 1), 365);
  const cutoff = new Date(Date.now() - days * 864e5).toISOString();
  const { data: apiRows } = await admin.from("generations").select("id, result_path").eq("source", "api").not("result_path", "is", null).lt("created_at", cutoff).limit(500);
  const apiPaths = (apiRows ?? []).map((r) => r.result_path as string);
  if (apiPaths.length) {
    await admin.storage.from("tryon-results").remove(apiPaths);
    await admin.from("generations").update({ result_path: null }).in("id", (apiRows ?? []).map((r) => r.id));
  }
  return NextResponse.json({ photosDeleted: photos, resultsDeleted: results + apiPaths.length });
}

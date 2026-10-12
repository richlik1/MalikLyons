import { NextResponse } from "next/server";
import { validateEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Public: { ok } only. With `Authorization: Bearer <CRON_SECRET>`: configuration report
// (names and problems, never values) plus live database/storage reachability checks.
export async function GET(req: Request) {
  const report = validateEnv(process.env);
  const authorized = Boolean(process.env.CRON_SECRET) && req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
  if (!authorized) return NextResponse.json({ ok: report.ok }, { status: report.ok ? 200 : 503 });

  const checks: Record<string, boolean | string> = {};
  if (report.features.supabase) {
    try {
      const svc = createAdminClient();
      const db = await svc.from("profiles").select("id", { head: true, count: "exact" });
      checks.database = !db.error || db.error.message;
      const buckets = await svc.storage.listBuckets();
      const names = new Set((buckets.data ?? []).map((b) => b.id));
      checks.storageBuckets = ["person-photos", "tryon-results", "garments"].every((b) => names.has(b)) || "missing buckets";
      const photos = (buckets.data ?? []).find((b) => b.id === "person-photos");
      checks.personPhotosPrivate = photos ? !photos.public : "missing";
    } catch (e) {
      checks.database = e instanceof Error ? e.message : "error";
    }
  }
  const ok = report.ok && Object.values(checks).every((v) => v === true);
  return NextResponse.json({ ...report, ok, envOk: report.ok, checks }, { status: ok ? 200 : 503 });
}

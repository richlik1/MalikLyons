import { NextResponse } from "next/server";
import { jsonError, parseJson, sameOrigin } from "@/lib/http";
import { feedbackSchema } from "@/lib/schemas";
import { createUserClient, getSessionUser } from "@/lib/supabase/server";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return jsonError(403, "bad_origin", "Cross-site request rejected.");
  const user = await getSessionUser();
  if (!user) return jsonError(401, "unauthenticated", "Please sign in.");
  const parsed = await parseJson(req, feedbackSchema);
  if (!parsed.ok) return parsed.res;

  const supabase = await createUserClient(); // RLS checks the generation belongs to this user
  const { error } = await supabase.from("feedback").upsert(
    { generation_id: parsed.data.generationId, user_id: user.id, rating: parsed.data.rating, comment: parsed.data.comment ?? null },
    { onConflict: "generation_id,user_id" },
  );
  if (error) return jsonError(400, "feedback_failed", "Couldn't save feedback.");
  return NextResponse.json({ ok: true });
}

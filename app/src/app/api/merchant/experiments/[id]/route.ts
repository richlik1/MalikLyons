import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, parseJson, sameOrigin } from "@/lib/http";
import { createAdminClient, createUserClient, getSessionUser } from "@/lib/supabase/server";

// Status transitions are server-controlled so started_at/stopped_at can be trusted:
// draft → running → stopped. A stopped experiment cannot be restarted (start a new one).
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return jsonError(403, "bad_origin", "Cross-site request rejected.");
  const user = await getSessionUser();
  if (!user) return jsonError(401, "unauthenticated", "Please sign in.");
  const parsed = await parseJson(req, z.object({ action: z.enum(["start", "stop"]) }));
  if (!parsed.ok) return parsed.res;
  const { id } = await ctx.params;

  const supabase = await createUserClient(); // RLS: only the owner's experiments are visible
  const { data: exp } = await supabase.from("experiments").select("id, status").eq("id", id).maybeSingle();
  if (!exp) return jsonError(404, "not_found", "Experiment not found.");

  const now = new Date().toISOString();
  const patch =
    parsed.data.action === "start" && exp.status === "draft" ? { status: "running", started_at: now }
    : parsed.data.action === "stop" && exp.status === "running" ? { status: "stopped", stopped_at: now }
    : null;
  if (!patch) return jsonError(409, "invalid_transition", `Can't ${parsed.data.action} an experiment that is ${exp.status}.`);
  const { error } = await createAdminClient().from("experiments").update(patch).eq("id", id).eq("status", exp.status);
  if (error) return jsonError(500, "update_failed", "Couldn't update the experiment.");
  return NextResponse.json({ id, ...patch });
}

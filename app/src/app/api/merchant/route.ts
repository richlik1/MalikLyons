import { NextResponse } from "next/server";
import { jsonError, parseJson, sameOrigin } from "@/lib/http";
import { merchantSchema } from "@/lib/schemas";
import { createAdminClient, createUserClient, getSessionUser } from "@/lib/supabase/server";

// Retailer onboarding: create the merchant (tenant) and grant the merchant role.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return jsonError(403, "bad_origin", "Cross-site request rejected.");
  const user = await getSessionUser();
  if (!user) return jsonError(401, "unauthenticated", "Please sign in.");
  if (user.is_anonymous) return jsonError(403, "account_required", "Sign in with your email to create a store.");
  const parsed = await parseJson(req, merchantSchema);
  if (!parsed.ok) return parsed.res;

  const supabase = await createUserClient();
  const existing = await supabase.from("merchants").select("id").eq("owner_id", user.id).maybeSingle();
  if (existing.data) return NextResponse.json({ id: existing.data.id });

  const { data, error } = await supabase
    .from("merchants")
    .insert({ owner_id: user.id, name: parsed.data.name, website_url: parsed.data.websiteUrl ?? null })
    .select("id")
    .single();
  if (error) return jsonError(400, "merchant_failed", "Couldn't create your store.");

  // Role change is privileged (guarded by DB trigger), so it uses the service role.
  await createAdminClient().from("profiles").update({ role: "merchant" }).eq("id", user.id).neq("role", "admin");
  return NextResponse.json({ id: data.id });
}

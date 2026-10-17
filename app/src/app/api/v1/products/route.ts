import { NextResponse } from "next/server";
import { authenticateSecretKey } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/server";

/** GET /api/v1/products — your account's try-on-enabled products. */
export async function GET(req: Request) {
  const caller = await authenticateSecretKey(req);
  if (caller instanceof NextResponse) return caller;
  const svc = createAdminClient();
  const { data } = await svc
    .from("products")
    .select("id, name, category, price_cents, currency, purchase_url, image_path, is_active, external_source, external_id, created_at")
    .eq("merchant_id", caller.merchantId)
    .order("created_at", { ascending: false })
    .limit(200);
  return NextResponse.json({
    object: "list",
    data: (data ?? []).map(({ image_path, ...p }) => ({ ...p, object: "product", image_url: svc.storage.from("garments").getPublicUrl(image_path).data.publicUrl })),
  });
}

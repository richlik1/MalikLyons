import { NextResponse } from "next/server";
import { jsonError, sameOrigin } from "@/lib/http";
import { validateImage } from "@/lib/image";
import { productFieldsSchema } from "@/lib/schemas";
import { createUserClient, getSessionUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Product upload: garment image + name, category, price and purchase URL.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return jsonError(403, "bad_origin", "Cross-site request rejected.");
  const user = await getSessionUser();
  if (!user) return jsonError(401, "unauthenticated", "Please sign in.");

  const supabase = await createUserClient();
  const { data: merchant } = await supabase.from("merchants").select("id").eq("owner_id", user.id).maybeSingle();
  if (!merchant) return jsonError(403, "not_merchant", "Create your store first.");

  const form = await req.formData().catch(() => null);
  if (!form) return jsonError(400, "bad_form", "Expected multipart form data.");
  const fields = productFieldsSchema.safeParse({
    name: form.get("name"),
    category: form.get("category"),
    price: form.get("price") ?? "",
    purchaseUrl: form.get("purchaseUrl"),
  });
  if (!fields.success) {
    const i = fields.error.issues[0];
    return jsonError(400, "invalid_request", `${i.path.join(".")}: ${i.message}`);
  }
  const file = form.get("image");
  if (!(file instanceof File)) return jsonError(400, "image_required", "Please add a product image.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = validateImage(bytes, { minDimension: 256 });
  if (!check.ok) return jsonError(422, "invalid_image", check.error);

  const path = `${user.id}/${crypto.randomUUID()}.${check.info.mimeType.split("/")[1].replace("jpeg", "jpg")}`;
  const up = await supabase.storage.from("garments").upload(path, bytes, { contentType: check.info.mimeType });
  if (up.error) return jsonError(500, "upload_failed", "Couldn't upload the image.");

  const { data, error } = await supabase
    .from("products")
    .insert({
      merchant_id: merchant.id,
      name: fields.data.name,
      category: fields.data.category,
      price_cents: fields.data.price ? Math.round(Number(fields.data.price) * 100) : null,
      purchase_url: fields.data.purchaseUrl,
      image_path: path,
    })
    .select("id")
    .single();
  if (error) {
    await supabase.storage.from("garments").remove([path]);
    return jsonError(400, "product_failed", "Couldn't save the product.");
  }
  return NextResponse.json({ id: data.id });
}

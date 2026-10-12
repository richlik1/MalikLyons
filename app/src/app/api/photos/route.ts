import { NextResponse } from "next/server";
import { CONSENT_VERSION } from "@/lib/consent";
import { jsonError, sameOrigin } from "@/lib/http";
import { MIN_PERSON_DIMENSION, validateImage } from "@/lib/image";
import { createUserClient, getSessionUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Upload a personal photo. Requires explicit consent; validated by content; stored in a
// private bucket under the user's own folder (enforced again by storage RLS).
export async function POST(req: Request) {
  if (!sameOrigin(req)) return jsonError(403, "bad_origin", "Cross-site request rejected.");
  const user = await getSessionUser();
  if (!user) return jsonError(401, "unauthenticated", "Please sign in.");

  const form = await req.formData().catch(() => null);
  if (!form) return jsonError(400, "bad_form", "Expected multipart form data.");
  if (form.get("consent") !== "true" || form.get("consentVersion") !== CONSENT_VERSION) {
    return jsonError(400, "consent_required", "Please read and accept the photo consent first.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) return jsonError(400, "file_required", "Please choose a photo.");

  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = validateImage(bytes, { minDimension: MIN_PERSON_DIMENSION });
  if (!check.ok) return jsonError(422, "invalid_image", check.error);

  const retentionDays = Math.min(Math.max(Number(process.env.PERSON_PHOTO_RETENTION_DAYS) || 30, 1), 365);
  const ext = check.info.mimeType.split("/")[1].replace("jpeg", "jpg");
  const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
  const supabase = await createUserClient();

  const up = await supabase.storage.from("person-photos").upload(path, bytes, { contentType: check.info.mimeType });
  if (up.error) {
    console.error("[photos] upload failed", up.error.message);
    return jsonError(500, "upload_failed", "We couldn't save your photo. Please try again.");
  }

  const now = new Date();
  const { data, error } = await supabase
    .from("person_photos")
    .insert({
      user_id: user.id,
      storage_path: path,
      mime_type: check.info.mimeType,
      byte_size: bytes.length,
      width: check.info.width,
      height: check.info.height,
      consent_version: CONSENT_VERSION,
      consented_at: now.toISOString(),
      expires_at: new Date(now.getTime() + retentionDays * 86_400_000).toISOString(),
    })
    .select("id, expires_at")
    .single();
  if (error) {
    await supabase.storage.from("person-photos").remove([path]);
    console.error("[photos] insert failed", error.message);
    return jsonError(500, "upload_failed", "We couldn't save your photo. Please try again.");
  }

  const signed = await supabase.storage.from("person-photos").createSignedUrl(path, 600);
  return NextResponse.json({ id: data.id, expiresAt: data.expires_at, previewUrl: signed.data?.signedUrl ?? null });
}

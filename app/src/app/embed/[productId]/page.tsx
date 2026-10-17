import { headers } from "next/headers";
import { EmbedSignIn } from "@/components/EmbedSignIn";
import { TryOnFlow, type CatalogItem } from "@/components/TryOnFlow";
import { lookupKey } from "@/lib/api-auth";
import { createProvider } from "@/lib/providers";
import { createAdminClient, createUserClient, getSessionUser, supabaseConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Try-on opened from a merchant's website via /widget.js and a publishable key.
export default async function EmbedPage({ params, searchParams }: { params: Promise<{ productId: string }>; searchParams: Promise<{ key?: string }> }) {
  const { productId } = await params;
  const { key } = await searchParams;
  if (!supabaseConfigured()) return <Notice text="Try-on is not configured." />;
  const caller = key ? await lookupKey(key, "publishable") : null;
  if (!caller) return <Notice text="This try-on link is not valid. Please contact the store." />;

  // Soft origin check: if the browser sent a Referer, it must be one of the key's allowed sites.
  const referer = (await headers()).get("referer");
  if (referer) {
    let refOrigin = "";
    try { refOrigin = new URL(referer).origin; } catch {}
    const self = process.env.NEXT_PUBLIC_SITE_URL ? new URL(process.env.NEXT_PUBLIC_SITE_URL).origin : "";
    if (refOrigin !== self && !caller.allowedOrigins.includes(refOrigin)) return <Notice text="Try-on isn't enabled for this website." />;
  }

  const svc = createAdminClient();
  const [{ data: merchant }, { data: products }] = await Promise.all([
    svc.from("merchants").select("name").eq("id", caller.merchantId).single(),
    svc.from("products").select("id, name, category, price_cents, currency, purchase_url, image_path").eq("merchant_id", caller.merchantId).eq("is_active", true).order("created_at", { ascending: false }).limit(60),
  ]);
  if (!(products ?? []).some((p) => p.id === productId)) return <Notice text="This product isn't available for try-on." />;

  const user = await getSessionUser();
  if (!user) return <div className="container-page py-8"><h1 className="text-2xl font-black">Try it on · {merchant?.name}</h1><EmbedSignIn /></div>;

  const catalog: CatalogItem[] = (products ?? []).map((p) => ({
    id: p.id, name: p.name, category: p.category, brand: merchant?.name ?? "",
    price: p.price_cents != null ? new Intl.NumberFormat("en-US", { style: "currency", currency: p.currency }).format(p.price_cents / 100) : null,
    purchaseUrl: p.purchase_url, imageUrl: svc.storage.from("garments").getPublicUrl(p.image_path).data.publicUrl,
  }));
  const supabase = await createUserClient();
  const { data: photo } = await supabase.from("person_photos").select("id, storage_path, expires_at").gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(1).maybeSingle();
  let existingPhoto: { id: string; previewUrl: string; expiresAt: string } | null = null;
  if (photo) {
    const signed = await supabase.storage.from("person-photos").createSignedUrl(photo.storage_path, 600);
    if (signed.data) existingPhoto = { id: photo.id, previewUrl: signed.data.signedUrl, expiresAt: photo.expires_at };
  }
  const provider = createProvider();
  return (
    <div className="container-page py-6">
      <p className="eyebrow">Virtual try-on · powered by TrendSet</p>
      <h1 className="mt-1 text-2xl font-black tracking-tight">{merchant?.name}</h1>
      {!provider && <p className="notice mt-4">Try-on generation is temporarily unavailable.</p>}
      <TryOnFlow catalog={catalog} existingPhoto={existingPhoto} providerReady={Boolean(provider)} initialProduct={productId} embedKey={key} />
      <p className="mt-6 text-xs text-ink-muted">Your photo stays private and is deleted automatically. <a className="underline" href="/account" target="_blank">Manage or delete your data</a>.</p>
    </div>
  );
}

function Notice({ text }: { text: string }) {
  return <div className="container-page py-16"><p className="notice">{text}</p></div>;
}

import { TryOnFlow, type CatalogItem } from "@/components/TryOnFlow";
import { createProvider } from "@/lib/providers";
import { createUserClient, getSessionUser, supabaseConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function TryOnPage() {
  if (!supabaseConfigured()) {
    return <Unavailable message="Supabase isn't configured yet. See docs/07-deployment.md." />;
  }
  const user = await getSessionUser();
  if (!user) return null; // middleware redirects to /login

  const supabase = await createUserClient();
  const [{ data: products }, { data: photo }] = await Promise.all([
    supabase
      .from("products")
      .select("id, name, category, price_cents, currency, purchase_url, image_path, merchants(name)")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(60),
    supabase
      .from("person_photos")
      .select("id, storage_path, expires_at")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const catalog: CatalogItem[] = (products ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    brand: (p.merchants as unknown as { name: string } | null)?.name ?? "",
    price: p.price_cents != null ? new Intl.NumberFormat("en-US", { style: "currency", currency: p.currency }).format(p.price_cents / 100) : null,
    purchaseUrl: p.purchase_url,
    imageUrl: supabase.storage.from("garments").getPublicUrl(p.image_path).data.publicUrl,
  }));

  let existingPhoto: { id: string; previewUrl: string; expiresAt: string } | null = null;
  if (photo) {
    const signed = await supabase.storage.from("person-photos").createSignedUrl(photo.storage_path, 600);
    if (signed.data) existingPhoto = { id: photo.id, previewUrl: signed.data.signedUrl, expiresAt: photo.expires_at };
  }

  const provider = createProvider();
  return (
    <div className="container-page py-8">
      <h1 className="text-3xl font-black tracking-tight">Virtual fitting room</h1>
      <p className="mt-1 text-ink-soft">Upload a photo, pick a piece, see an AI preview.</p>
      {!provider && (
        <p className="notice mt-4" role="status">
          Try-on generation is unavailable: no AI provider is configured on this server. You can still upload a photo and browse the catalog.
        </p>
      )}
      <TryOnFlow catalog={catalog} existingPhoto={existingPhoto} providerReady={Boolean(provider)} />
    </div>
  );
}

function Unavailable({ message }: { message: string }) {
  return (
    <div className="container-page py-16">
      <p className="notice">{message}</p>
    </div>
  );
}

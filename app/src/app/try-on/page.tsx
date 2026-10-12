import { TryOnFlow, type CatalogItem } from "@/components/TryOnFlow";
import { createProvider } from "@/lib/providers";
import { isValidShopDomain } from "@/lib/shopify";
import { createAdminClient, createUserClient, getSessionUser, supabaseConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

// Deep links: /try-on?product=<uuid> or /try-on?shop=<x.myshopify.com>&shopify_product=<numeric id>
async function resolveInitialProduct(sp: Record<string, string | string[] | undefined>): Promise<string | null> {
  const product = typeof sp.product === "string" ? sp.product : null;
  if (product && UUID.test(product)) return product;
  const shop = typeof sp.shop === "string" ? sp.shop.toLowerCase() : null;
  const sid = typeof sp.shopify_product === "string" ? sp.shopify_product : null;
  if (!isValidShopDomain(shop) || !sid || !/^\d{1,20}$/.test(sid) || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const svc = createAdminClient();
  const { data: inst } = await svc.from("shopify_installations").select("merchant_id").eq("shop_domain", shop).is("uninstalled_at", null).maybeSingle();
  if (!inst?.merchant_id) return null;
  const { data: p } = await svc.from("products").select("id").eq("merchant_id", inst.merchant_id).eq("external_source", "shopify").eq("external_id", `gid://shopify/Product/${sid}`).eq("is_active", true).maybeSingle();
  return p?.id ?? null;
}

export default async function TryOnPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
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
  const initialProduct = await resolveInitialProduct(await searchParams);
  return (
    <div className="container-page py-8">
      <h1 className="text-3xl font-black tracking-tight">Virtual fitting room</h1>
      <p className="mt-1 text-ink-soft">Upload a photo, pick a piece, see an AI preview.</p>
      {!provider && (
        <p className="notice mt-4" role="status">
          Try-on generation is unavailable: no AI provider is configured on this server. You can still upload a photo and browse the catalog.
        </p>
      )}
      <TryOnFlow catalog={catalog} existingPhoto={existingPhoto} providerReady={Boolean(provider)} initialProduct={catalog.some((c) => c.id === initialProduct) ? initialProduct : null} />
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

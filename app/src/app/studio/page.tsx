import { MerchantOnboarding, ProductForm } from "@/components/StudioForms";
import { createUserClient, getSessionUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function StudioPage() {
  const user = await getSessionUser();
  if (!user) return null;
  const supabase = await createUserClient();
  const { data: merchant } = await supabase.from("merchants").select("id, name, plan, monthly_generation_quota").eq("owner_id", user.id).maybeSingle();

  if (!merchant) {
    return (
      <div className="container-page max-w-xl py-10">
        <h1 className="text-3xl font-black tracking-tight">Set up your store</h1>
        <p className="mb-6 mt-2 text-ink-soft">Add your brand to start uploading products for try-on.</p>
        <MerchantOnboarding />
      </div>
    );
  }

  const [{ data: products }, { data: stats }] = await Promise.all([
    supabase.from("products").select("id, name, category, price_cents, purchase_url, is_active").eq("merchant_id", merchant.id).order("created_at", { ascending: false }),
    supabase.rpc("merchant_product_stats", { p_merchant: merchant.id }),
  ]);
  const statsById = new Map((stats ?? []).map((s: { product_id: string; tryons: number; succeeded: number; saved: number }) => [s.product_id, s]));
  const totals = (stats ?? []).reduce(
    (a: { tryons: number; succeeded: number; saved: number }, s: { tryons: number; succeeded: number; saved: number }) => ({
      tryons: a.tryons + Number(s.tryons), succeeded: a.succeeded + Number(s.succeeded), saved: a.saved + Number(s.saved),
    }),
    { tryons: 0, succeeded: 0, saved: 0 },
  );

  return (
    <div className="container-page space-y-8 py-8">
      <div>
        <p className="eyebrow">Studio · {merchant.plan} plan</p>
        <h1 className="text-3xl font-black tracking-tight">{merchant.name}</h1>
      </div>
      <dl className="grid grid-cols-3 gap-3">
        {[["Try-ons started", totals.tryons], ["Previews generated", totals.succeeded], ["Looks saved", totals.saved]].map(([k, v]) => (
          <div key={k} className="card p-4"><dt className="text-xs text-ink-muted">{k}</dt><dd className="mt-1 text-2xl font-black tabular-nums">{v}</dd></div>
        ))}
      </dl>
      <p className="text-xs text-ink-muted">Counts only. Shopper photos and identities are never shown to merchants. Purchase attribution needs the storefront integration (roadmap).</p>

      <section>
        <h2 className="eyebrow">Products</h2>
        {(products ?? []).length === 0 ? <p className="mt-3 text-ink-soft">No products yet.</p> : (
          <div className="mt-3 overflow-x-auto rounded-card border border-line bg-paper-raised">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-ink-muted"><tr><th className="p-3">Name</th><th className="p-3">Category</th><th className="p-3">Price</th><th className="p-3 text-right">Try-ons</th><th className="p-3 text-right">Saved</th></tr></thead>
              <tbody>
                {products!.map((p) => {
                  const s = statsById.get(p.id) as { tryons: number; saved: number } | undefined;
                  return (
                    <tr key={p.id} className="border-b border-line last:border-0">
                      <td className="p-3"><a className="underline" href={p.purchase_url} target="_blank" rel="noopener noreferrer">{p.name}</a></td>
                      <td className="p-3">{p.category}</td>
                      <td className="p-3 tabular-nums">{p.price_cents != null ? `$${(p.price_cents / 100).toFixed(2)}` : "—"}</td>
                      <td className="p-3 text-right tabular-nums">{s?.tryons ?? 0}</td>
                      <td className="p-3 text-right tabular-nums">{s?.saved ?? 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="max-w-xl">
        <h2 className="eyebrow mb-3">Add a product</h2>
        <ProductForm />
      </section>
    </div>
  );
}

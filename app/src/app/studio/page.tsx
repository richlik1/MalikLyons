import { ApiKeysPanel, ExperimentControls, ExperimentCreateForm, MerchantFeedbackForm, ProductActiveToggle, ShopifyPanel } from "@/components/StudioPanels";
import { MerchantOnboarding, ProductForm } from "@/components/StudioForms";
import { analyze, type ArmSummary } from "@/lib/experiments";
import { createUserClient, getSessionUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function StudioPage() {
  const user = await getSessionUser();
  if (!user) return null;
  const supabase = await createUserClient();
  const { data: merchant } = await supabase.from("merchants").select("id, name, plan").eq("owner_id", user.id).maybeSingle();

  if (!merchant) {
    return (
      <div className="container-page max-w-xl py-10">
        <h1 className="text-3xl font-black tracking-tight">Set up your store</h1>
        <p className="mb-6 mt-2 text-ink-soft">Add your brand to start uploading products for try-on.</p>
        <MerchantOnboarding />
      </div>
    );
  }

  const [{ data: products }, { data: stats }, { data: usageRows }, { data: pilot }, { data: feedbackRows }, { data: experiments }, { data: shopRows }, { data: apiKeys }] = await Promise.all([
    supabase.from("products").select("id, name, category, price_cents, purchase_url, is_active").eq("merchant_id", merchant.id).order("created_at", { ascending: false }),
    supabase.rpc("merchant_product_stats", { p_merchant: merchant.id }),
    supabase.rpc("merchant_usage_summary", { p_merchant: merchant.id }),
    supabase.from("pilot_enrollments").select("status, start_date, end_date, products_limit, offered_price_cents, agreement_signed_at, dpa_signed_at").eq("merchant_id", merchant.id).maybeSingle(),
    supabase.from("merchant_feedback").select("pilot_week").eq("merchant_id", merchant.id),
    supabase.from("experiments").select("id, key, hypothesis, status, treatment_pct, primary_metric, planned_visitors_per_arm, started_at").eq("merchant_id", merchant.id).order("created_at", { ascending: false }),
    supabase.rpc("shopify_status", { p_merchant: merchant.id }),
    supabase.from("api_keys").select("id, kind, name, prefix, allowed_origins, created_at, last_used_at, revoked_at").eq("merchant_id", merchant.id).order("created_at", { ascending: false }),
  ]);
  const connectedShop = ((shopRows ?? []) as { shop_domain: string }[])[0]?.shop_domain ?? null;
  const shopifyConfigured = Boolean(process.env.SHOPIFY_API_KEY && process.env.SHOPIFY_API_SECRET && process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY);
  const usage = (usageRows ?? [])[0] as { used: number; included: number; hard_cap: boolean; estimated_total_cents: number; billing_status: string } | undefined;
  const readouts = await Promise.all(
    (experiments ?? []).map(async (x) => {
      const { data } = await supabase.rpc("experiment_summary", { p_experiment: x.id });
      return analyze((data ?? []) as ArmSummary[], { treatmentPct: x.treatment_pct, plannedVisitorsPerArm: x.planned_visitors_per_arm });
    }),
  );
  const weeksDone = new Set((feedbackRows ?? []).map((f) => f.pilot_week));
  const pilotWeek = pilot?.start_date ? Math.min(12, Math.max(0, Math.floor((Date.now() - new Date(pilot.start_date).getTime()) / (7 * 864e5)) + 1)) : 0;
  const checklist = [
    ["Store created", true],
    ["Pilot agreement signed", Boolean(pilot?.agreement_signed_at)],
    ["Data-processing agreement signed", Boolean(pilot?.dpa_signed_at)],
    ["At least 5 products added", (products ?? []).filter((p) => p.is_active).length >= 5],
    ["First shopper try-on generated", (stats ?? []).some((s: { succeeded: number }) => Number(s.succeeded) > 0)],
    [`Week ${pilotWeek} feedback submitted`, weeksDone.has(pilotWeek)],
  ] as const;
  type Stat = { product_id: string; tryons: number; succeeded: number; saved: number; shop_clicks: number };
  const statsById = new Map((stats ?? []).map((s: Stat) => [s.product_id, s]));
  const totals = (stats ?? []).reduce(
    (a: Omit<Stat, "product_id">, s: Stat) => ({
      tryons: a.tryons + Number(s.tryons), succeeded: a.succeeded + Number(s.succeeded), saved: a.saved + Number(s.saved), shop_clicks: a.shop_clicks + Number(s.shop_clicks),
    }),
    { tryons: 0, succeeded: 0, saved: 0, shop_clicks: 0 },
  );

  return (
    <div className="container-page space-y-8 py-8">
      <div>
        <p className="eyebrow">Studio · {merchant.plan} plan</p>
        <h1 className="text-3xl font-black tracking-tight">{merchant.name}</h1>
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Try-ons started", totals.tryons], ["Previews generated", totals.succeeded], ["Looks saved", totals.saved], ["Clicks to product page", totals.shop_clicks]].map(([k, v]) => (
          <div key={k} className="card p-4"><dt className="text-xs text-ink-muted">{k}</dt><dd className="mt-1 text-2xl font-black tabular-nums">{v}</dd></div>
        ))}
      </dl>
      <p className="text-xs text-ink-muted">Counts only. Shopper photos and identities are never shown to merchants. These are engagement counts, not evidence of sales impact. Use an experiment (below) for that.</p>

      {usage && (
        <section className="card">
          <h2 className="eyebrow">This month&apos;s usage</h2>
          <p className="mt-2 text-2xl font-black tabular-nums">{usage.used} / {usage.included} <span className="text-base font-semibold text-ink-muted">previews</span></p>
          <p className="mt-1 text-sm text-ink-soft">
            {usage.hard_cap ? "Try-on pauses when the allowance is reached." : "Usage above the allowance is billed as overage."}{" "}
            Billing status: <strong>{usage.billing_status === "not_billing" ? "not billing (pilot)" : usage.billing_status}</strong>. No charges are made by this version of TrendSet.
          </p>
        </section>
      )}

      {pilot && (
        <section className="space-y-3">
          <h2 className="eyebrow">Pilot · {pilot.status}{pilot.start_date ? ` · week ${pilotWeek}` : ""}</h2>
          <ul className="card space-y-2 text-sm">
            {checklist.map(([label, done]) => (
              <li key={label} className="flex items-center gap-2"><span aria-hidden className={done ? "text-ok" : "text-ink-muted"}>{done ? "✓" : "○"}</span><span className={done ? "" : "text-ink-soft"}>{label}</span><span className="sr-only">{done ? "done" : "to do"}</span></li>
            ))}
          </ul>
          <p className="text-xs text-ink-muted">Pilot limit: {pilot.products_limit} active products{pilot.offered_price_cents != null ? ` · post-pilot price offered: $${(pilot.offered_price_cents / 100).toFixed(0)}/mo` : ""}.</p>
          {!weeksDone.has(pilotWeek) && <MerchantFeedbackForm suggestedWeek={pilotWeek} />}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="eyebrow">Experiments</h2>
        <p className="text-sm text-ink-soft">Randomly show try-on to some visitors and not others, then compare. Results only become meaningful at the planned sample size, and they need the storefront integration to collect events.</p>
        {(experiments ?? []).map((x, i) => {
          const r = readouts[i];
          const m = r.metrics.find((mm) => mm.metric === (x.primary_metric === "purchase" ? "purchasers" : x.primary_metric));
          return (
            <div key={x.id} className="card space-y-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">{x.key} <span className="font-normal text-ink-muted">· {x.status} · {x.treatment_pct}% see try-on</span></p>
                <ExperimentControls id={x.id} status={x.status} />
              </div>
              <p className="text-ink-soft">{x.hypothesis}</p>
              <p className="tabular-nums">Visitors — with try-on: {r.visitors.treatment.toLocaleString()} · without: {r.visitors.control.toLocaleString()}{r.progress != null ? ` · ${Math.round(r.progress * 100)}% of planned sample` : ""}</p>
              {m && (
                <p className="tabular-nums">
                  {x.primary_metric}: {(m.treatmentRate * 100).toFixed(2)}% vs {(m.controlRate * 100).toFixed(2)}% · difference {(m.absoluteDiff * 100).toFixed(2)} pts
                  (90% CI {(m.ci90[0] * 100).toFixed(2)} to {(m.ci90[1] * 100).toFixed(2)}) · <strong>{m.verdict.replace("_", " ")}</strong>
                </p>
              )}
              {r.notes.slice(0, 2).map((n) => <p key={n} className="text-xs text-ink-muted">{n}</p>)}
            </div>
          );
        })}
        <ExperimentCreateForm />
      </section>

      <section>
        <h2 className="eyebrow">Products</h2>
        {(products ?? []).length === 0 ? <p className="mt-3 text-ink-soft">No products yet.</p> : (
          <div className="mt-3 overflow-x-auto rounded-card border border-line bg-paper-raised">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-ink-muted"><tr><th className="p-3">Name</th><th className="p-3">Status</th><th className="p-3">Category</th><th className="p-3">Price</th><th className="p-3 text-right">Try-ons</th><th className="p-3 text-right">Saved</th><th className="p-3 text-right">Clicks</th></tr></thead>
              <tbody>
                {products!.map((p) => {
                  const s = statsById.get(p.id) as Stat | undefined;
                  return (
                    <tr key={p.id} className="border-b border-line last:border-0">
                      <td className="p-3"><a className="underline" href={p.purchase_url} target="_blank" rel="noopener noreferrer">{p.name}</a></td>
                      <td className="p-3"><ProductActiveToggle id={p.id} active={p.is_active} /></td>
                      <td className="p-3">{p.category}</td>
                      <td className="p-3 tabular-nums">{p.price_cents != null ? `$${(p.price_cents / 100).toFixed(2)}` : "—"}</td>
                      <td className="p-3 text-right tabular-nums">{s?.tryons ?? 0}</td>
                      <td className="p-3 text-right tabular-nums">{s?.saved ?? 0}</td>
                      <td className="p-3 text-right tabular-nums">{s?.shop_clicks ?? 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="eyebrow">Website widget &amp; API keys</h2>
        <ApiKeysPanel keys={apiKeys ?? []} siteUrl={process.env.NEXT_PUBLIC_SITE_URL ?? ""} sampleProductId={(products ?? []).find((p) => p.is_active)?.id ?? null} />
      </section>

      <section className="max-w-xl space-y-3">
        <h2 className="eyebrow">Shopify</h2>
        <ShopifyPanel connectedShop={connectedShop} configured={shopifyConfigured} />
      </section>

      <section className="max-w-xl">
        <h2 className="eyebrow mb-3">Add a product</h2>
        <ProductForm />
      </section>
    </div>
  );
}

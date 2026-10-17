"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

async function send(url: string, method: string, body: unknown) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  if (res?.ok) return null;
  return ((await res?.json().catch(() => null))?.error?.message as string | undefined) ?? "Something went wrong.";
}

export function MerchantFeedbackForm({ suggestedWeek }: { suggestedWeek: number }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  if (done) return <p className="notice" role="status">Thanks — feedback recorded for week {suggestedWeek}.</p>;
  return (
    <form
      className="card space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const price = String(f.get("priceNamed") ?? "").trim();
        const err = await send("/api/merchant/feedback", "POST", {
          pilotWeek: Number(f.get("pilotWeek")),
          likelihoodToRecommend: Number(f.get("ltr")),
          valueRating: Number(f.get("value")),
          qualityRating: Number(f.get("quality")),
          wouldPay: f.get("wouldPay"),
          priceNamed: price ? Number(price) : undefined,
          topIssue: f.get("topIssue") || undefined,
          comment: f.get("comment") || undefined,
        });
        if (err) setError(err); else { setDone(true); router.refresh(); }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className="label" htmlFor="pilotWeek">Pilot week</label><input id="pilotWeek" name="pilotWeek" type="number" min={0} max={12} defaultValue={suggestedWeek} className="field" required /></div>
        <div><label className="label" htmlFor="ltr">How likely are you to recommend TrendSet to another brand? (0–10)</label><input id="ltr" name="ltr" type="number" min={0} max={10} className="field" required /></div>
        <div><label className="label" htmlFor="value">How valuable was TrendSet to your store this week? (1–5)</label><input id="value" name="value" type="number" min={1} max={5} className="field" required /></div>
        <div><label className="label" htmlFor="quality">How good were the previews for your products? (1–5)</label><input id="quality" name="quality" type="number" min={1} max={5} className="field" required /></div>
        <div>
          <label className="label" htmlFor="wouldPay">If the pilot ended today, would you pay to keep it?</label>
          <select id="wouldPay" name="wouldPay" className="field" required defaultValue="">
            <option value="" disabled>Select…</option><option value="yes">Yes</option><option value="maybe">Maybe</option><option value="no">No</option>
          </select>
        </div>
        <div><label className="label" htmlFor="priceNamed">What monthly price (USD) would feel fair? <span className="text-ink-muted">(optional)</span></label><input id="priceNamed" name="priceNamed" inputMode="decimal" className="field" placeholder="e.g. 49" /></div>
      </div>
      <div><label className="label" htmlFor="topIssue">Biggest problem or missing feature this week</label><textarea id="topIssue" name="topIssue" className="field min-h-[72px] py-2" maxLength={1000} /></div>
      <div><label className="label" htmlFor="comment">Anything else? <span className="text-ink-muted">(optional)</span></label><textarea id="comment" name="comment" className="field min-h-[72px] py-2" maxLength={2000} /></div>
      {error && <p className="error-text" role="alert">{error}</p>}
      <button className="btn-primary">Submit weekly feedback</button>
    </form>
  );
}

export function ExperimentCreateForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="card space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const formEl = e.currentTarget;
        const f = new FormData(formEl);
        const planned = String(f.get("planned") ?? "").trim();
        const err = await send("/api/merchant/experiments", "POST", {
          key: f.get("key"), hypothesis: f.get("hypothesis"), primaryMetric: f.get("metric"),
          treatmentPct: Number(f.get("pct") || 50), plannedVisitorsPerArm: planned ? Number(planned) : undefined,
        });
        if (err) setError(err); else { formEl.reset(); setError(null); router.refresh(); }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className="label" htmlFor="x-key">Key</label><input id="x-key" name="key" className="field" placeholder="hoodies-tryon-v1" required pattern="[a-z0-9-]{3,40}" /></div>
        <div>
          <label className="label" htmlFor="x-metric">Primary metric (decide before starting)</label>
          <select id="x-metric" name="metric" className="field" defaultValue="add_to_cart">
            <option value="add_to_cart">Add to cart</option><option value="checkout_started">Checkout started</option><option value="purchase">Purchase (needs Shopify orders webhook)</option>
          </select>
        </div>
        <div><label className="label" htmlFor="x-pct">Share of visitors who see try-on (%)</label><input id="x-pct" name="pct" type="number" min={1} max={99} defaultValue={50} className="field" /></div>
        <div><label className="label" htmlFor="x-planned">Planned visitors per group</label><input id="x-planned" name="planned" type="number" min={1} className="field" placeholder="from the sample-size calculator" /></div>
      </div>
      <div><label className="label" htmlFor="x-hyp">Hypothesis</label><input id="x-hyp" name="hypothesis" className="field" required minLength={10} maxLength={500} placeholder="Showing try-on on hoodie pages increases add-to-cart" /></div>
      {error && <p className="error-text" role="alert">{error}</p>}
      <button className="btn-ghost">Create draft experiment</button>
    </form>
  );
}

export function ExperimentControls({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (status === "stopped") return null;
  const action = status === "draft" ? "start" : "stop";
  return (
    <button
      className={action === "start" ? "btn-primary min-h-[36px] px-3" : "btn-danger min-h-[36px] px-3"}
      disabled={busy}
      onClick={async () => {
        if (action === "stop" && !confirm("Stop this experiment? It can't be restarted. Stop only at the planned sample size.")) return;
        setBusy(true);
        await send(`/api/merchant/experiments/${id}`, "PATCH", { action });
        setBusy(false);
        router.refresh();
      }}
    >
      {action === "start" ? "Start" : "Stop"}
    </button>
  );
}

export function ProductActiveToggle({ id, active }: { id: string; active: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        className="btn-ghost min-h-[32px] px-3 text-xs"
        onClick={async () => {
          const err = await send(`/api/merchant/products/${id}`, "PATCH", { isActive: !active });
          if (err) setError(err); else { setError(null); router.refresh(); }
        }}
      >
        {active ? "Live · pause" : "Paused · go live"}
      </button>
      {error && <span className="error-text text-xs" role="alert">{error}</span>}
    </span>
  );
}

export function ShopifyPanel({ connectedShop, configured }: { connectedShop: string | null; configured: boolean }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!configured) return <p className="notice">Shopify connection is not configured on this server yet.</p>;
  if (!connectedShop) {
    return (
      <form className="card flex flex-col gap-3 sm:flex-row sm:items-end" action="/api/shopify/install" method="get">
        <div className="flex-1"><label className="label" htmlFor="shop">Your Shopify domain</label><input id="shop" name="shop" className="field" placeholder="your-store.myshopify.com" required pattern="[a-z0-9][a-z0-9-]*\.myshopify\.com" /></div>
        <button className="btn-primary">Connect Shopify</button>
      </form>
    );
  }
  return (
    <div className="card space-y-2 text-sm">
      <p>Connected to <strong>{connectedShop}</strong>.</p>
      <button
        className="btn-ghost"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const res = await fetch("/api/shopify/import", { method: "POST" }).catch(() => null);
          const body = await res?.json().catch(() => null);
          setBusy(false);
          setMsg(res?.ok ? `Imported ${body.imported} product(s) as paused; skipped ${body.skipped.length}. Review previews, then set products live.` : body?.error?.message ?? "Import failed.");
          router.refresh();
        }}
      >
        {busy ? "Importing…" : "Import products from Shopify"}
      </button>
      {msg && <p className="text-ink-soft" role="status">{msg}</p>}
    </div>
  );
}

type ApiKeyRow = { id: string; kind: string; name: string; prefix: string; allowed_origins: string[]; created_at: string; last_used_at: string | null; revoked_at: string | null };

export function ApiKeysPanel({ keys, siteUrl, sampleProductId }: { keys: ApiKeyRow[]; siteUrl: string; sampleProductId: string | null }) {
  const router = useRouter();
  const [created, setCreated] = useState<{ key: string; kind: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = keys.filter((k) => !k.revoked_at);
  const pk = created?.kind === "publishable" ? created.key : "ts_pk_…";
  return (
    <div className="space-y-3">
      {created && (
        <div className="notice space-y-2" role="status">
          <p><strong>Copy your {created.kind} key now.</strong> It won&apos;t be shown again.</p>
          <code className="block break-all rounded-lg bg-paper-raised p-2 text-xs">{created.key}</code>
        </div>
      )}
      {active.length > 0 && (
        <div className="overflow-x-auto rounded-card border border-line bg-paper-raised">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-ink-muted"><tr><th className="p-3">Name</th><th className="p-3">Type</th><th className="p-3">Key</th><th className="p-3">Allowed sites</th><th className="p-3">Last used</th><th className="p-3" /></tr></thead>
            <tbody>
              {active.map((k) => (
                <tr key={k.id} className="border-b border-line last:border-0">
                  <td className="p-3">{k.name}</td>
                  <td className="p-3">{k.kind === "secret" ? "Secret (server API)" : "Publishable (widget)"}</td>
                  <td className="p-3 font-mono text-xs">{k.prefix}…</td>
                  <td className="p-3 text-xs">{k.allowed_origins.join(", ") || "—"}</td>
                  <td className="p-3 text-xs">{k.last_used_at ? new Date(k.last_used_at).toLocaleString() : "never"}</td>
                  <td className="p-3 text-right">
                    <button className="btn-danger min-h-[32px] px-3 text-xs" onClick={async () => {
                      if (!confirm("Revoke this key? Anything using it stops working immediately.")) return;
                      await fetch(`/api/merchant/api-keys/${k.id}`, { method: "DELETE" });
                      router.refresh();
                    }}>Revoke</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form
        className="card grid gap-3 sm:grid-cols-[1fr_1fr_2fr_auto] sm:items-end"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          const f = new FormData(e.currentTarget);
          const kind = String(f.get("kind"));
          const res = await fetch("/api/merchant/api-keys", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind, name: f.get("name") || "Default", allowedOrigins: String(f.get("origins") || "").split(/[\s,]+/).filter(Boolean) }),
          });
          const body = await res.json().catch(() => null);
          if (res.ok) { setCreated({ key: body.key, kind }); router.refresh(); } else setError(body?.error?.message ?? "Couldn't create the key.");
        }}
      >
        <div><label className="label" htmlFor="k-name">Name</label><input id="k-name" name="name" className="field" placeholder="Production" maxLength={60} /></div>
        <div>
          <label className="label" htmlFor="k-kind">Type</label>
          <select id="k-kind" name="kind" className="field" defaultValue="publishable">
            <option value="publishable">Publishable (website widget)</option>
            <option value="secret">Secret (server API)</option>
          </select>
        </div>
        <div><label className="label" htmlFor="k-origins">Allowed websites (widget)</label><input id="k-origins" name="origins" className="field" placeholder="https://yourstore.com" /></div>
        <button className="btn-primary">Create key</button>
      </form>
      {error && <p className="error-text" role="alert">{error}</p>}
      <details className="card text-sm">
        <summary className="cursor-pointer font-semibold">Install on your website (2 lines)</summary>
        <p className="mt-2 text-ink-soft">Paste on any product page. The button opens TrendSet&apos;s try-on in a new window for that product.</p>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-paper-sunken p-3 text-xs">{`<script src="${siteUrl}/widget.js" data-key="${pk}" defer></script>
<button data-trendset-product="${sampleProductId ?? "<product id>"}">See it on you</button>`}</pre>
        <p className="mt-3 text-ink-soft">Server API (secret key):</p>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-paper-sunken p-3 text-xs">{`curl -X POST ${siteUrl}/api/v1/try-ons \\
  -H "Authorization: Bearer ts_sk_…" -H "Content-Type: application/json" \\
  -d '{"person_image_url":"https://…/shopper.jpg","product_id":"${sampleProductId ?? "<product id>"}"}'`}</pre>
        <p className="mt-2 text-xs text-ink-muted">Full reference: <a className="underline" href="/developers">/developers</a></p>
      </details>
    </div>
  );
}

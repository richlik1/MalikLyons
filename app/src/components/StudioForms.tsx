"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function MerchantOnboarding() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="card space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const f = new FormData(e.currentTarget);
        const res = await fetch("/api/merchant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: f.get("name"), websiteUrl: f.get("websiteUrl") }),
        });
        setBusy(false);
        if (res.ok) router.refresh();
        else setError((await res.json().catch(() => null))?.error?.message ?? "Something went wrong.");
      }}
    >
      <div><label className="label" htmlFor="name">Brand name</label><input id="name" name="name" className="field" required maxLength={120} /></div>
      <div><label className="label" htmlFor="websiteUrl">Store URL</label><input id="websiteUrl" name="websiteUrl" className="field" type="url" placeholder="https://" /></div>
      {error && <p className="error-text" role="alert">{error}</p>}
      <button className="btn-primary" disabled={busy}>{busy ? "Creating…" : "Create store"}</button>
    </form>
  );
}

export function ProductForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="card space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const formEl = e.currentTarget;
        const res = await fetch("/api/merchant/products", { method: "POST", body: new FormData(formEl) });
        setBusy(false);
        if (res.ok) { formEl.reset(); router.refresh(); }
        else setError((await res.json().catch(() => null))?.error?.message ?? "Something went wrong.");
      }}
    >
      <div><label className="label" htmlFor="p-name">Product name</label><input id="p-name" name="name" className="field" required maxLength={160} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="p-cat">Category</label>
          <select id="p-cat" name="category" className="field" defaultValue="tops">
            <option value="tops">Tops / hoodies / jackets</option>
            <option value="bottoms">Bottoms</option>
            <option value="one-pieces">One-pieces</option>
          </select>
        </div>
        <div><label className="label" htmlFor="p-price">Price (USD)</label><input id="p-price" name="price" className="field" inputMode="decimal" placeholder="59.00" /></div>
      </div>
      <div><label className="label" htmlFor="p-url">Purchase URL</label><input id="p-url" name="purchaseUrl" className="field" type="url" required placeholder="https://yourstore.com/products/…" /></div>
      <div>
        <label className="label" htmlFor="p-img">Product image</label>
        <input id="p-img" name="image" type="file" accept="image/jpeg,image/png,image/webp" required className="block w-full text-sm" />
        <p className="mt-1 text-xs text-ink-muted">Flat-lay or ghost-mannequin on a plain background works best. Min 256px, max 8 MB.</p>
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
      <button className="btn-primary" disabled={busy}>{busy ? "Uploading…" : "Add product"}</button>
    </form>
  );
}

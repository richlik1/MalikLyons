"use client";
import { useState } from "react";
import { CONSENT_POINTS, CONSENT_VERSION, FIT_DISCLAIMER } from "@/lib/consent";

export interface CatalogItem {
  id: string;
  name: string;
  brand: string;
  category: string;
  price: string | null;
  purchaseUrl: string;
  imageUrl: string;
}

type Photo = { id: string; previewUrl: string; expiresAt: string };
type Result = { generationId: string; resultUrl: string; personUrl: string; product: { id: string; name: string; purchaseUrl: string } };

export function TryOnFlow({ catalog, existingPhoto, providerReady, initialProduct = null }: { catalog: CatalogItem[]; existingPhoto: Photo | null; providerReady: boolean; initialProduct?: string | null }) {
  const [photo, setPhoto] = useState<Photo | null>(existingPhoto);
  const [selected, setSelected] = useState<string | null>(initialProduct);
  const [status, setStatus] = useState<"idle" | "generating">("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function generate() {
    if (!photo || !selected) return;
    setStatus("generating");
    setError(null);
    setResult(null);
    const res = await fetch("/api/try-on", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photoId: photo.id, productId: selected }),
    }).catch(() => null);
    const body = await res?.json().catch(() => null);
    setStatus("idle");
    if (res?.ok && body) setResult(body as Result);
    else setError(body?.error?.message ?? "Network error. Please try again.");
  }

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <section aria-labelledby="step-photo" className="space-y-4">
        <h2 id="step-photo" className="eyebrow">1 · Your photo</h2>
        {photo ? (
          <div className="card">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo.previewUrl} alt="Your uploaded photo" className="mx-auto max-h-80 rounded-xl object-contain" />
            <p className="mt-3 text-xs text-ink-muted">Private. Auto-deletes {new Date(photo.expiresAt).toLocaleDateString()}.</p>
            <button className="btn-ghost mt-3 w-full" onClick={() => { setPhoto(null); setResult(null); }}>Use a different photo</button>
          </div>
        ) : (
          <PhotoUpload onUploaded={setPhoto} />
        )}
      </section>

      <section aria-labelledby="step-garment" className="space-y-4">
        <h2 id="step-garment" className="eyebrow">2 · Pick a piece</h2>
        {catalog.length === 0 ? (
          <p className="notice">No products yet. Merchants can add products in the Studio.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" role="listbox" aria-label="Garments">
            {catalog.map((item) => (
              <li key={item.id}>
                <button
                  role="option"
                  aria-selected={selected === item.id}
                  onClick={() => { setSelected(item.id); setResult(null); }}
                  className={`w-full rounded-card border bg-paper-raised p-2 text-left transition ${selected === item.id ? "border-ink ring-2 ring-ink" : "border-line hover:border-ink-muted"}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.imageUrl} alt="" className="aspect-[3/4] w-full rounded-lg bg-paper-sunken object-contain" loading="lazy" />
                  <p className="mt-2 truncate text-sm font-semibold">{item.name}</p>
                  <p className="truncate text-xs text-ink-muted">{[item.brand, item.price].filter(Boolean).join(" · ")}</p>
                </button>
              </li>
            ))}
          </ul>
        )}

        <button className="btn-accent w-full" disabled={!providerReady || !photo || !selected || status === "generating"} onClick={generate}>
          {status === "generating" ? "Generating your preview…" : "3 · Generate try-on"}
        </button>
        {status === "generating" && <p className="text-sm text-ink-muted" role="status">This can take a little while. Please keep this page open.</p>}
        {error && <p className="error-text" role="alert">{error}</p>}
      </section>

      {result && <ResultView result={result} />}
    </div>
  );
}

function PhotoUpload({ onUploaded }: { onUploaded: (p: Photo) => void }) {
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) return setError("Images must be 8 MB or smaller.");
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("file", file);
    form.set("consent", "true");
    form.set("consentVersion", CONSENT_VERSION);
    const res = await fetch("/api/photos", { method: "POST", body: form }).catch(() => null);
    const body = await res?.json().catch(() => null);
    setBusy(false);
    if (res?.ok && body?.previewUrl) onUploaded({ id: body.id, previewUrl: body.previewUrl, expiresAt: body.expiresAt });
    else setError(body?.error?.message ?? "Upload failed. Please try again.");
    e.target.value = "";
  }

  return (
    <div className="card space-y-4">
      <fieldset>
        <legend className="font-semibold">Before you upload</legend>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-soft">
          {CONSENT_POINTS.map((p) => <li key={p}>{p}</li>)}
        </ul>
        <label className="mt-3 flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-1 h-5 w-5" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span>I agree to the above and the <a className="underline" href="/privacy" target="_blank">photo policy</a>.</span>
        </label>
      </fieldset>
      <p className="text-sm text-ink-muted">Best results: a well-lit, front-facing photo, arms relaxed, plain background. JPEG, PNG or WebP, up to 8 MB.</p>
      <label className={`btn-primary w-full ${!agreed || busy ? "pointer-events-none opacity-50" : "cursor-pointer"}`}>
        {busy ? "Uploading…" : "Choose photo"}
        <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={!agreed || busy} onChange={onChange} />
      </label>
      {error && <p className="error-text" role="alert">{error}</p>}
    </div>
  );
}

function ResultView({ result }: { result: Result }) {
  const [view, setView] = useState<"after" | "before">("after");
  const [saved, setSaved] = useState(false);
  const [rating, setRating] = useState<number | null>(null);

  async function toggleSave() {
    const res = await fetch(`/api/generations/${result.generationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ saved: !saved }),
    }).catch(() => null);
    if (res?.ok) setSaved(!saved);
  }

  async function rate(n: number) {
    setRating(n);
    await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ generationId: result.generationId, rating: n }),
    }).catch(() => null);
  }

  return (
    <section aria-labelledby="result-heading" className="card lg:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="result-heading" className="text-xl font-bold">{result.product.name}</h2>
        <div className="inline-flex rounded-full border border-line p-1" role="tablist" aria-label="Compare">
          {(["before", "after"] as const).map((v) => (
            <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}
              className={`min-h-[36px] rounded-full px-4 text-sm font-semibold ${view === v ? "bg-ink text-paper" : "text-ink-soft"}`}>
              {v === "before" ? "Before" : "After"}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <figure className={view === "before" ? "" : "hidden sm:block"}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={result.personUrl} alt="Your original photo" className="w-full rounded-xl bg-paper-sunken object-contain" />
          <figcaption className="mt-1 text-xs text-ink-muted">Before</figcaption>
        </figure>
        <figure className={view === "after" ? "" : "hidden sm:block"}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={result.resultUrl} alt={`AI-generated preview of you wearing ${result.product.name}`} className="w-full rounded-xl bg-paper-sunken object-contain" />
          <figcaption className="mt-1 text-xs text-ink-muted">After · AI-generated</figcaption>
        </figure>
      </div>

      <p className="notice mt-4">{FIT_DISCLAIMER}</p>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <a
          className="btn-primary"
          href={result.product.purchaseUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => { fetch(`/api/generations/${result.generationId}/click`, { method: "POST", keepalive: true }).catch(() => {}); }}
        >
          Shop this item ↗
        </a>
        <button className="btn-ghost" onClick={toggleSave}>{saved ? "Saved ✓" : "Save look"}</button>
      </div>

      <div className="mt-5">
        <p className="text-sm font-medium">How useful was this preview?</p>
        <div className="mt-2 flex gap-2" role="radiogroup" aria-label="Rating">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} role="radio" aria-checked={rating === n} onClick={() => rate(n)}
              className={`h-11 w-11 rounded-full border text-sm font-semibold ${rating === n ? "border-ink bg-ink text-paper" : "border-line"}`}>{n}</button>
          ))}
        </div>
      </div>
    </section>
  );
}

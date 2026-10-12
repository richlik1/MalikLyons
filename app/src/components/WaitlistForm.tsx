"use client";
import { useState } from "react";
import { getVisitorId, utmSource } from "@/lib/visitor";

export function WaitlistForm() {
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState("sending");
    setError(null);
    const f = new FormData(e.currentTarget);
    const params = new URLSearchParams(window.location.search);
    const res = await fetch("/api/waitlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        visitorId: getVisitorId(),
        email: f.get("email"),
        brandName: f.get("brandName"),
        storeUrl: f.get("storeUrl") || undefined,
        platform: f.get("platform") || undefined,
        monthlyOrders: f.get("monthlyOrders") || undefined,
        biggestProblem: f.get("biggestProblem") || undefined,
        utmSource: utmSource(),
        utmCampaign: params.get("utm_campaign")?.slice(0, 100) ?? undefined,
        company: f.get("company") || undefined,
      }),
    }).catch(() => null);
    if (res?.ok) return setState("done");
    const body = await res?.json().catch(() => null);
    setError(body?.error?.message ?? "Something went wrong. Please try again.");
    setState("error");
  }

  if (state === "done") {
    return (
      <div className="card" role="status">
        <p className="text-lg font-semibold">You&apos;re on the list.</p>
        <p className="mt-1 text-ink-soft">We&apos;re recruiting a small group of pilot brands. If your brand is a fit for the current pilot, we&apos;ll contact you by email.</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="email">Work email</label>
          <input className="field" id="email" name="email" type="email" required autoComplete="email" />
        </div>
        <div>
          <label className="label" htmlFor="brandName">Brand name</label>
          <input className="field" id="brandName" name="brandName" required autoComplete="organization" />
        </div>
        <div>
          <label className="label" htmlFor="storeUrl">Store URL <span className="text-ink-muted">(optional)</span></label>
          <input className="field" id="storeUrl" name="storeUrl" type="url" placeholder="https://" inputMode="url" />
        </div>
        <div>
          <label className="label" htmlFor="platform">Platform</label>
          <select className="field" id="platform" name="platform" defaultValue="">
            <option value="">Select…</option>
            <option value="shopify">Shopify</option>
            <option value="woocommerce">WooCommerce</option>
            <option value="bigcommerce">BigCommerce</option>
            <option value="custom">Custom site</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="monthlyOrders">Online orders per month</label>
          <select className="field" id="monthlyOrders" name="monthlyOrders" defaultValue="">
            <option value="">Select…</option>
            <option value="0-50">0–50</option>
            <option value="51-500">51–500</option>
            <option value="501-5000">501–5,000</option>
            <option value="5000+">5,000+</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="biggestProblem">What&apos;s the hardest part of selling clothes online right now? <span className="text-ink-muted">(optional)</span></label>
          <textarea className="field min-h-[88px] py-2" id="biggestProblem" name="biggestProblem" maxLength={1000} />
        </div>
      </div>
      {/* Honeypot */}
      <div aria-hidden="true" className="hidden">
        <label>Company <input name="company" tabIndex={-1} autoComplete="off" /></label>
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
      <button className="btn-primary w-full sm:w-auto" disabled={state === "sending"}>
        {state === "sending" ? "Joining…" : "Apply for the pilot"}
      </button>
      <p className="text-xs text-ink-muted">We&apos;ll only use your email to contact you about the pilot. No spam, no list sharing.</p>
    </form>
  );
}

"use client";
import { useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const next = new URLSearchParams(window.location.search).get("next") ?? "/try-on";
    const { error } = await createBrowserSupabase().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    if (error) {
      setError(error.message);
      setState("error");
    } else setState("sent");
  }

  return (
    <div className="container-page max-w-md py-16">
      <h1 className="text-3xl font-black tracking-tight">Sign in</h1>
      <p className="mt-2 text-ink-soft">We&apos;ll email you a secure sign-in link. No password needed.</p>
      {state === "sent" ? (
        <p className="notice mt-6" role="status">Check {email} for your sign-in link.</p>
      ) : (
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" className="field" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          {error && <p className="error-text" role="alert">{error}</p>}
          <button className="btn-primary w-full" disabled={state === "sending"}>{state === "sending" ? "Sending…" : "Email me a link"}</button>
        </form>
      )}
    </div>
  );
}

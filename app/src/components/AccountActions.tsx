"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";

export function DeletePhotoButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn-danger min-h-[36px] px-3"
      disabled={busy}
      onClick={async () => {
        if (!confirm("Delete this photo and every preview made from it? This can't be undone.")) return;
        setBusy(true);
        await fetch(`/api/photos/${id}`, { method: "DELETE" });
        router.refresh();
      }}
    >
      {busy ? "Deleting…" : "Delete"}
    </button>
  );
}

export function AccountActions() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="space-y-3">
      <h2 className="eyebrow">Account</h2>
      <div className="flex flex-col gap-3 sm:flex-row">
        <button className="btn-ghost" onClick={async () => { await createBrowserSupabase().auth.signOut(); router.push("/"); router.refresh(); }}>
          Sign out
        </button>
        <button
          className="btn-danger"
          disabled={busy}
          onClick={async () => {
            if (!confirm("Permanently delete your account, photos, previews and saved looks?")) return;
            setBusy(true);
            const res = await fetch("/api/account", { method: "DELETE" });
            if (res.ok) { router.push("/"); router.refresh(); }
            else { setBusy(false); setError((await res.json().catch(() => null))?.error?.message ?? "Deletion failed."); }
          }}
        >
          {busy ? "Deleting…" : "Delete account and all data"}
        </button>
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
    </section>
  );
}

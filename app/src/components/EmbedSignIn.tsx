"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";

// Shoppers arriving from a merchant's site get an anonymous session (no account needed).
// They can still delete their photos and data from the Account page.
export function EmbedSignIn() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    createBrowserSupabase().auth.signInAnonymously().then(({ error }) => {
      if (error) setError("We couldn't start a session. Please enable cookies and try again.");
      else router.refresh();
    });
  }, [router]);
  return <p className="notice mt-6" role="status">{error ?? "Starting your private session…"}</p>;
}

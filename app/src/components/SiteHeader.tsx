import Link from "next/link";
import { getSessionUser } from "@/lib/supabase/server";

export async function SiteHeader() {
  const user = await getSessionUser();
  return (
    <header className="border-b border-line bg-paper/90 backdrop-blur">
      <nav className="container-page flex h-14 items-center justify-between" aria-label="Main">
        <Link href="/" className="text-lg font-black tracking-tight">
          TRENDSET
        </Link>
        <div className="flex items-center gap-1 text-sm">
          {user ? (
            <>
              <Link className="rounded-full px-3 py-2 hover:bg-paper-sunken" href="/try-on">Try on</Link>
              <Link className="rounded-full px-3 py-2 hover:bg-paper-sunken" href="/studio">Studio</Link>
              <Link className="rounded-full px-3 py-2 hover:bg-paper-sunken" href="/account">Account</Link>
            </>
          ) : (
            <Link className="rounded-full px-3 py-2 hover:bg-paper-sunken" href="/login">Sign in</Link>
          )}
        </div>
      </nav>
    </header>
  );
}

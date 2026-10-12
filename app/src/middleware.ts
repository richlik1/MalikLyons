import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { checkBasicAuth, gateEnabled, isBypassed } from "@/lib/site-access";

// 1) Private-site gate for staging / pre-launch (HTTP Basic auth, noindex).
// 2) Refreshes the Supabase session cookie and guards signed-in areas.
const PROTECTED = ["/try-on", "/account", "/studio", "/admin"];

export async function middleware(request: NextRequest) {
  const env = process.env as Record<string, string | undefined>;
  const gated = gateEnabled(env);
  const path = request.nextUrl.pathname;

  if (gated && !isBypassed(path) && !checkBasicAuth(request.headers.get("authorization"), env.SITE_ACCESS_PASSWORD)) {
    return new NextResponse("TrendSet staging — authorized testers only.", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="TrendSet staging", charset="UTF-8"', "X-Robots-Tag": "noindex, nofollow" },
    });
  }

  let response = NextResponse.next({ request });
  const finish = (res: NextResponse) => {
    if (gated) res.headers.set("X-Robots-Tag", "noindex, nofollow");
    return res;
  };

  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key || path.startsWith("/api/")) return finish(response);

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data } = await supabase.auth.getUser();

  if (!data.user && PROTECTED.some((p) => path.startsWith(p))) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
    return finish(NextResponse.redirect(login));
  }
  return finish(response);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

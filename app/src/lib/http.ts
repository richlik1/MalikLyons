import "server-only";
import { NextResponse } from "next/server";
import type { ZodSchema } from "zod";

export function jsonError(status: number, code: string, message: string, headers?: HeadersInit) {
  return NextResponse.json({ error: { code, message } }, { status, headers });
}

export async function parseJson<T>(req: Request, schema: ZodSchema<T>): Promise<{ ok: true; data: T } | { ok: false; res: NextResponse }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { ok: false, res: jsonError(400, "bad_json", "Request body must be JSON.") };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, res: jsonError(400, "invalid_request", `${first.path.join(".") || "body"}: ${first.message}`) };
  }
  return { ok: true, data: parsed.data };
}

/**
 * Rejects cross-site requests to state-changing endpoints (CSRF defense alongside SameSite
 * cookies). Compares the Origin header with the host the client actually addressed (Host /
 * X-Forwarded-Host) and the configured site URL — not req.url, which can differ behind proxies.
 */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // non-browser clients and some same-origin requests omit Origin
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  return allowedHosts(req).has(originHost);
}

export function allowedHosts(req: Request): Set<string> {
  const hosts = new Set<string>();
  const add = (v: string | null | undefined) => v && v.split(",").forEach((h) => h.trim() && hosts.add(h.trim()));
  add(req.headers.get("x-forwarded-host"));
  add(req.headers.get("host"));
  try { hosts.add(new URL(req.url).host); } catch {}
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    try { hosts.add(new URL(process.env.NEXT_PUBLIC_SITE_URL).host); } catch {}
  }
  return hosts;
}

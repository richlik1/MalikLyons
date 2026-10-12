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

/** Rejects cross-site form posts to state-changing JSON endpoints. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // same-origin fetches from some browsers omit Origin on GET; POSTs from our UI include it
  try {
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false;
  }
}

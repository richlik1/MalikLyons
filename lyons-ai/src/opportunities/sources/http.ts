export type FetchLike = typeof fetch;

export class SourceError extends Error {}

/** JSON request with timeout. Error messages never include the URL (it may carry an API key). */
export async function fetchJson<T>(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit & { timeoutMs?: number; label: string },
  signal?: AbortSignal,
): Promise<T> {
  const timeout = AbortSignal.timeout(init.timeoutMs ?? 30_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, signal: combined, headers: { accept: "application/json", ...(init.headers ?? {}) } });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new SourceError(`${init.label}: network error (${(err as Error).name})`);
  }
  if (res.status === 429) throw new SourceError(`${init.label}: rate limited (HTTP 429)`);
  if (!res.ok) throw new SourceError(`${init.label}: HTTP ${res.status}`);
  try {
    return (await res.json()) as T;
  } catch {
    throw new SourceError(`${init.label}: response was not JSON`);
  }
}

/** Parses MM/DD/YYYY, YYYY-MM-DD, ISO date-times, and "Mon DD, YYYY ..." forms. Date-only values mean end of that day, US Eastern. */
export function parseDate(raw: unknown): Date | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const s = raw.trim();
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return endOfDayEastern(Number(m[3]), Number(m[1]), Number(m[2]));
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return endOfDayEastern(Number(m[1]), Number(m[2]), Number(m[3]));
  const cleaned = s.replace(/\b(EST|EDT|CST|CDT|MST|MDT|PST|PDT|ET)\b/g, "").trim();
  const t = Date.parse(cleaned);
  return Number.isNaN(t) ? undefined : new Date(t);
}

function endOfDayEastern(y: number, mo: number, d: number): Date {
  // 23:59 at UTC-4 (EDT). In winter (EST) that is 22:59 local: never later than the real deadline.
  return new Date(Date.UTC(y, mo - 1, d, 23 + 4, 59));
}

export function parseMoney(raw: unknown): number | undefined {
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? raw : undefined;
  if (typeof raw !== "string") return undefined;
  const n = Number(raw.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function normalizeTitle(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
    // Inline formatting tags vanish without adding spaces; other tags become a space.
    .replace(/<\/?(b|i|em|strong|span|a|u|small|sup|sub)\b[^>]*>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

/** Classifies the money involved from source text. Conservative: unknown unless the text says so. */
export function inferFundingType(text: string): "grant" | "loan" | "reimbursement" | "paid_program" | "tax_incentive" | "unknown" {
  const t = text.toLowerCase();
  if (/\b(loan|microloan|line of credit|financing at \d|interest rate)\b/.test(t)) return "loan";
  if (/\breimburse(ment|d|s)?\b/.test(t)) return "reimbursement";
  if (/\btax (credit|abatement|incentive|exemption)\b/.test(t)) return "tax_incentive";
  if (/\b(tuition|registration fee|enrollment fee|cost to attend|program fee)\b/.test(t)) return "paid_program";
  if (/\bgrants?\b/.test(t)) return "grant";
  return "unknown";
}

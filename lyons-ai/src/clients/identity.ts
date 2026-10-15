/**
 * Client identity matching with explicit confidence. Only near-certain matches
 * (exact email or phone already linked to one client) are applied automatically;
 * everything else becomes a suggestion for the owner, and conflicting signals
 * are never resolved silently.
 */

export const AUTO_LINK_THRESHOLD = 0.9;

const FREE_MAIL = new Set(["gmail.com", "googlemail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com", "me.com", "aol.com", "live.com", "msn.com", "proton.me", "protonmail.com"]);

export function normalizeEmail(raw: string): string | null {
  const m = /([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/.exec(raw.trim());
  if (!m) return null;
  let local = m[1]!.toLowerCase();
  const domain = m[2]!.toLowerCase();
  if (domain === "gmail.com" || domain === "googlemail.com") local = local.split("+")[0]!; // Gmail ignores +tags
  return `${local}@${domain === "googlemail.com" ? "gmail.com" : domain}`;
}

/** US-centric E.164 normalisation; returns null for anything ambiguous. */
export function normalizePhone(raw: string): string | null {
  const plus = raw.trim().startsWith("+");
  const digits = raw.replace(/\D/g, "");
  if (plus && digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export function isFreeMailDomain(domain: string): boolean {
  return FREE_MAIL.has(domain.toLowerCase());
}

export function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !["llc", "inc", "co", "the", "and", "mr", "mrs", "ms", "dr"].includes(t));
}

export interface KnownIdentity {
  clientId: string;
  kind: string;
  value: string;
}

export interface KnownClient {
  id: string;
  name: string;
  company: string | null;
}

export interface Observation {
  email?: string;
  phone?: string;
  name?: string;
  source: string;
}

export interface MatchResult {
  clientId: string | null;
  confidence: number;
  reason: string;
  /** True when signals point to different clients; never auto-linked. */
  conflict: boolean;
  /** Suggestions (lower-confidence candidates) for the owner to confirm. */
  suggestions: { clientId: string; confidence: number; reason: string }[];
}

export function matchObservation(o: Observation, identities: KnownIdentity[], clients: KnownClient[]): MatchResult {
  const email = o.email ? normalizeEmail(o.email) : null;
  const phone = o.phone ? normalizePhone(o.phone) : null;
  const byEmail = email ? identities.find((i) => i.kind === "email" && i.value === email) : undefined;
  const byPhone = phone ? identities.find((i) => (i.kind === "phone" || i.kind === "imessage_handle") && i.value === phone) : undefined;

  if (byEmail && byPhone && byEmail.clientId !== byPhone.clientId) {
    return {
      clientId: null,
      confidence: 0,
      reason: "Email and phone belong to different clients",
      conflict: true,
      suggestions: [
        { clientId: byEmail.clientId, confidence: 0.5, reason: "email match" },
        { clientId: byPhone.clientId, confidence: 0.5, reason: "phone match" },
      ],
    };
  }
  if (byEmail) return { clientId: byEmail.clientId, confidence: 1, reason: "exact email match", conflict: false, suggestions: [] };
  if (byPhone) return { clientId: byPhone.clientId, confidence: 0.95, reason: "exact phone match", conflict: false, suggestions: [] };

  const suggestions: MatchResult["suggestions"] = [];
  const domain = email?.split("@")[1];
  if (domain && !isFreeMailDomain(domain)) {
    const owners = new Set(identities.filter((i) => i.kind === "domain" && i.value === domain).map((i) => i.clientId));
    if (owners.size === 1) suggestions.push({ clientId: [...owners][0]!, confidence: 0.6, reason: `same company domain (${domain})` });
  }
  if (o.name) {
    const tokens = nameTokens(o.name);
    for (const c of clients) {
      const ct = nameTokens(c.name);
      if (!tokens.length || !ct.length) continue;
      if (tokens.join(" ") === ct.join(" ")) suggestions.push({ clientId: c.id, confidence: 0.5, reason: `same name (${c.name})` });
      else {
        const overlap = tokens.filter((t) => ct.includes(t)).length / Math.max(tokens.length, ct.length);
        if (overlap >= 0.5 && tokens.length > 1) suggestions.push({ clientId: c.id, confidence: 0.3, reason: `similar name (${c.name})` });
      }
    }
  }
  const distinct = new Set(suggestions.map((s) => s.clientId));
  suggestions.sort((a, b) => b.confidence - a.confidence);
  return {
    clientId: null,
    confidence: suggestions[0]?.confidence ?? 0,
    reason: suggestions.length ? "needs owner confirmation" : "no match",
    conflict: distinct.size > 1,
    suggestions,
  };
}

const REQUEST_SIGNALS = /\?|\b(can you|could you|please|let me know|need (a|an|to)|quote|estimate|availability|available|schedule|reschedule|when can|how much|invoice|confirm|asap|urgent)\b/i;

/** Heuristic: does an inbound message ask for something? Bulk mail never does. */
export function looksLikeRequest(text: string, bulk: boolean): boolean {
  return !bulk && REQUEST_SIGNALS.test(text);
}

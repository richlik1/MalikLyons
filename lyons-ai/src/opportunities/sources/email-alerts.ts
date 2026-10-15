import { extractBody } from "../../integrations/google/gmail.js";
import type { Mailbox } from "../../gmail-cleanup/mailbox.js";
import { senderDomain } from "../../gmail-cleanup/classify.js";
import type { SourceEntry } from "../registry.js";
import type { Candidate, OwnerProfile, SourceAdapter, VerificationResult } from "../types.js";
import { stripHtml } from "./http.js";

/**
 * Official email alerts (SIGMA VSS, Bonfire/City of Detroit, SAM.gov saved
 * searches). Portals that require a vendor login are never scraped; their own
 * notification emails are the authorised channel. Verification requires the
 * sender's domain to be on the source's list AND Gmail's authentication result
 * to show DMARC or SPF pass for it (spoofed alerts are rejected).
 */
export interface AlertMailbox extends Mailbox {
  getFull(id: string): Promise<{ authResults: string; text: string }>;
}

export function domainMatches(host: string, domains: string[]): boolean {
  const h = host.toLowerCase();
  return domains.some((d) => h === d || h.endsWith(`.${d}`));
}

export function extractLinks(text: string, domains: string[]): string[] {
  const urls = [...text.matchAll(/https:\/\/[^\s"'<>)\]]+/g)].map((m) => m[0].replace(/[.,;]+$/, ""));
  return [...new Set(urls.filter((u) => {
    try {
      return domainMatches(new URL(u).hostname, domains);
    } catch {
      return false;
    }
  }))];
}

export function authPassed(authResults: string, domain: string): boolean {
  const ar = authResults.toLowerCase();
  const d = domain.toLowerCase();
  return new RegExp(`dmarc=pass[^;]*header\\.from=([a-z0-9-]+\\.)*${d.replace(/\./g, "\\.")}`).test(ar) || new RegExp(`spf=pass[^;]*@([a-z0-9-]+\\.)*${d.replace(/\./g, "\\.")}`).test(ar);
}

export class EmailAlertSource implements SourceAdapter {
  readonly name = "email_alerts";
  readonly categories = ["contracts" as const];

  constructor(
    private readonly entry: Pick<SourceEntry, "id" | "domains" | "opportunity_type" | "config">,
    private readonly mailbox: () => Promise<AlertMailbox | null>,
  ) {}

  configured(): boolean {
    return true; // availability is checked at run time (Google may not be connected)
  }

  async discover(_p: OwnerProfile, _signal: AbortSignal): Promise<Candidate[]> {
    const mb = await this.mailbox();
    if (!mb) throw new Error("Google business account not connected (needed to read official alert emails).");
    const ids = await mb.listIds(`${this.entry.config.gmailQuery ?? ""} -in:spam -in:trash`.trim(), 25);
    const out: Candidate[] = [];
    for (const id of ids) {
      const m = await mb.getMeta(id);
      const full = await mb.getFull(id);
      const links = extractLinks(full.text, this.entry.domains);
      out.push({
        source: this.name,
        sourceId: id,
        category: this.entry.config.category ?? "contracts",
        title: m.subject.replace(/^(fwd?|re):\s*/i, "").slice(0, 300),
        organization: senderDomain(m.from),
        url: links[0] ?? `https://mail.google.com/mail/u/0/#inbox/${id}`,
        summary: full.text.replace(/\s+/g, " ").slice(0, 600),
        opportunityType: this.entry.opportunity_type,
        fundingType: "contract",
        sourceRegistryId: this.entry.id,
        deadlineAt: null,
        raw: { messageId: id, from: m.from, links, authResults: full.authResults },
      });
    }
    return out;
  }

  async verify(c: Candidate): Promise<VerificationResult> {
    const raw = c.raw as { from: string; authResults: string; links: string[] };
    const domain = senderDomain(raw.from);
    const fromOk = domainMatches(domain, this.entry.config.senderDomains ?? this.entry.domains);
    const authOk = authPassed(raw.authResults ?? "", domain);
    const checks = [
      { name: "official sender domain", passed: fromOk, detail: domain || "unknown" },
      { name: "email authentication (DMARC/SPF pass)", passed: authOk, detail: authOk ? "pass" : "no passing result for the sender domain" },
      { name: "links to the official portal", passed: true, detail: raw.links.length ? raw.links[0]! : "no portal link found (open the email)" },
    ];
    return { ok: fromOk && authOk, method: "email:official-alert", authoritativeUrl: c.url, checkedAt: new Date(), checks };
  }
}

/** Reads full text + Authentication-Results for alert parsing (Gmail implementation). */
export async function gmailFullText(api: { users: { messages: { get(p: object): Promise<{ data: { payload?: any } }> } } }, id: string) {
  const r = await api.users.messages.get({ userId: "me", id, format: "full" });
  const headers = (r.data.payload?.headers ?? []) as { name?: string; value?: string }[];
  const authResults = headers.filter((h) => h.name?.toLowerCase() === "authentication-results").map((h) => h.value ?? "").join("; ");
  return { authResults, text: stripHtml(extractBody(r.data.payload)) };
}

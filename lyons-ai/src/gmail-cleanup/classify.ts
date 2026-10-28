/**
 * Deterministic mailbox classification. Conservative by design: anything that
 * could be a business record is protected and never archived or trashed.
 */

export interface MessageMeta {
  id: string;
  threadId?: string;
  labelIds: string[];
  from: string;
  to?: string;
  subject: string;
  date?: string;
  snippet?: string;
  listUnsubscribe?: string;
  listUnsubscribePost?: string;
  listId?: string;
  precedence?: string;
  internalDate?: number;
}

export type MailCategory =
  | "spam"
  | "promotions"
  | "newsletter"
  | "social"
  | "receipt"
  | "invoice"
  | "financial"
  | "legal"
  | "client"
  | "other";

export interface Classification {
  category: MailCategory;
  /** Why this message must never be archived or trashed (null = not protected). */
  protected: string | null;
}

export interface ClassifierContext {
  clientEmails: Set<string>;
  clientDomains: Set<string>;
}

const FREE_MAIL = new Set(["gmail.com", "googlemail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com", "me.com", "aol.com", "live.com", "msn.com", "proton.me", "protonmail.com"]);

const RE = {
  invoice: /\b(invoice|inv[-# ]?\d|amount due|payment due|past due|bill (is )?(ready|due)|statement (is )?ready|remittance)\b/i,
  receipt: /\b(receipt|order (confirmation|confirmed|#)|your order|payment (received|confirmation|successful)|purchase confirmation|thanks for your (order|purchase|payment)|transaction (receipt|confirmation))\b/i,
  financial: /\b(bank|deposit|withdrawal|wire|ach|1099|w-?2|w-?9|tax|irs|payroll|adp|quickbooks|paystub|pay stub|credit card statement|loan|mortgage|insurance (policy|premium|claim)|venmo|zelle|paypal|stripe payout|square payout)\b/i,
  legal: /\b(contract|agreement|lease|docusign|adobe sign|hellosign|signature (requested|required)|legal notice|court|subpoena|summons|attorney|notari[sz]ed|terms of (service|use) update|license (renewal|expir))\b/i,
};

export function senderEmail(from: string): string {
  const m = /<([^>]+)>/.exec(from);
  return (m ? m[1]! : from).trim().toLowerCase();
}

export function senderDomain(from: string): string {
  return senderEmail(from).split("@")[1] ?? "";
}

/** A label the owner created (Gmail system labels are uppercase or CATEGORY_*). */
function hasUserLabel(labels: string[]): boolean {
  return labels.some((l) => l.startsWith("Label_"));
}

export function classifyMessage(m: MessageMeta, ctx: ClassifierContext): Classification {
  const labels = m.labelIds;
  const text = `${m.subject} ${m.snippet ?? ""}`;
  const email = senderEmail(m.from);
  const domain = senderDomain(m.from);

  // Business records first: these win over promotions/newsletter signals.
  if (ctx.clientEmails.has(email) || (domain && !FREE_MAIL.has(domain) && ctx.clientDomains.has(domain))) {
    return { category: "client", protected: "from a known client" };
  }
  if (labels.includes("SPAM")) return { category: "spam", protected: null };
  if (RE.legal.test(text)) return { category: "legal", protected: "legal/contract record" };
  if (RE.invoice.test(text)) return { category: "invoice", protected: "invoice/billing record" };
  if (RE.financial.test(text)) return { category: "financial", protected: "financial record" };
  if (RE.receipt.test(text)) return { category: "receipt", protected: "receipt/order record" };

  const userProtected = labels.includes("STARRED")
    ? "starred"
    : hasUserLabel(labels)
      ? "has your own label"
      : labels.includes("IMPORTANT") && !labels.includes("CATEGORY_PROMOTIONS") && !m.listUnsubscribe
        ? "marked important"
        : null;

  const bulk = Boolean(m.listUnsubscribe || m.listId || /^(bulk|list)$/i.test(m.precedence ?? ""));
  let category: MailCategory = "other";
  if (labels.includes("CATEGORY_PROMOTIONS")) category = "promotions";
  else if (labels.includes("CATEGORY_SOCIAL")) category = "social";
  else if (bulk) category = "newsletter";
  return { category, protected: userProtected };
}

export type CleanupAction = "archive" | "trash" | "keep";

export interface PlanOptions {
  /** Only messages older than this are proposed for archiving. */
  archiveOlderThanDays: number;
  /** If set, promotions/social older than this many days are proposed for Trash (still recoverable 30 days). */
  trashOlderThanDays: number | null;
  now: Date;
}

/** Decide what to do with one message. Protected and non-bulk mail is always kept. */
export function decideAction(m: MessageMeta, c: Classification, o: PlanOptions): CleanupAction {
  if (c.protected) return "keep";
  if (!["promotions", "newsletter", "social"].includes(c.category)) return "keep";
  if (!m.labelIds.includes("INBOX")) return "keep"; // already out of the inbox
  const ageDays = m.internalDate ? (o.now.getTime() - m.internalDate) / 86_400_000 : 0;
  if (o.trashOlderThanDays !== null && c.category !== "newsletter" && ageDays >= o.trashOlderThanDays) return "trash";
  if (ageDays >= o.archiveOlderThanDays) return "archive";
  return "keep";
}

export interface UnsubscribeInfo {
  method: "one_click" | "link" | "mailto" | "none";
  url?: string;
  mailto?: string;
}

/** Parses List-Unsubscribe / List-Unsubscribe-Post (RFC 2369 / RFC 8058). */
export function parseUnsubscribe(listUnsubscribe: string | undefined, listUnsubscribePost: string | undefined): UnsubscribeInfo {
  if (!listUnsubscribe) return { method: "none" };
  const parts = [...listUnsubscribe.matchAll(/<([^>]+)>/g)].map((x) => x[1]!.trim());
  const https = parts.find((p) => p.toLowerCase().startsWith("https://"));
  const mailto = parts.find((p) => p.toLowerCase().startsWith("mailto:"));
  if (https && /list-unsubscribe=one-click/i.test(listUnsubscribePost ?? "")) return { method: "one_click", url: https, mailto };
  if (https) return { method: "link", url: https, mailto };
  if (mailto) return { method: "mailto", mailto };
  return { method: "none" };
}

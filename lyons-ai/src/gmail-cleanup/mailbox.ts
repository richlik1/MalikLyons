import { gmail, type gmail_v1 } from "@googleapis/gmail";
import type { OAuth2Client } from "google-auth-library";
import type { MessageMeta } from "./classify.js";

/**
 * The only mailbox operations cleanup can perform. There is deliberately no
 * delete/batchDelete here: the most destructive action is Trash, which Gmail
 * keeps recoverable for 30 days.
 */
export interface Mailbox {
  listIds(query: string, max: number): Promise<string[]>;
  getMeta(id: string): Promise<MessageMeta>;
  ensureLabel(name: string): Promise<string>;
  /** Up to 1000 ids per call. */
  batchModify(ids: string[], addLabelIds: string[], removeLabelIds: string[]): Promise<void>;
  trash(id: string): Promise<void>;
  untrash(id: string): Promise<void>;
}

const HEADERS = ["From", "To", "Subject", "Date", "List-Unsubscribe", "List-Unsubscribe-Post", "List-Id", "Precedence"];

export class GmailMailbox implements Mailbox {
  private readonly api: gmail_v1.Gmail;
  constructor(auth: OAuth2Client) {
    this.api = gmail({ version: "v1", auth });
  }

  async listIds(query: string, max: number): Promise<string[]> {
    const ids: string[] = [];
    let pageToken: string | undefined;
    while (ids.length < max) {
      const r = await this.api.users.messages.list({ userId: "me", q: query, maxResults: Math.min(500, max - ids.length), pageToken });
      ids.push(...(r.data.messages ?? []).map((m) => m.id!).filter(Boolean));
      pageToken = r.data.nextPageToken ?? undefined;
      if (!pageToken) break;
    }
    return ids;
  }

  async getMeta(id: string): Promise<MessageMeta> {
    const r = await this.api.users.messages.get({ userId: "me", id, format: "metadata", metadataHeaders: HEADERS });
    const h = (name: string) => r.data.payload?.headers?.find((x) => x.name?.toLowerCase() === name.toLowerCase())?.value ?? undefined;
    return {
      id,
      threadId: r.data.threadId ?? undefined,
      labelIds: r.data.labelIds ?? [],
      from: h("From") ?? "",
      to: h("To"),
      subject: h("Subject") ?? "",
      date: h("Date"),
      snippet: r.data.snippet ?? undefined,
      listUnsubscribe: h("List-Unsubscribe"),
      listUnsubscribePost: h("List-Unsubscribe-Post"),
      listId: h("List-Id"),
      precedence: h("Precedence"),
      internalDate: r.data.internalDate ? Number(r.data.internalDate) : undefined,
    };
  }

  async ensureLabel(name: string): Promise<string> {
    const list = await this.api.users.labels.list({ userId: "me" });
    const found = list.data.labels?.find((l) => l.name === name);
    if (found?.id) return found.id;
    const created = await this.api.users.labels.create({
      userId: "me",
      requestBody: { name, labelListVisibility: "labelShow", messageListVisibility: "show" },
    });
    return created.data.id!;
  }

  async batchModify(ids: string[], addLabelIds: string[], removeLabelIds: string[]): Promise<void> {
    if (!ids.length) return;
    await this.api.users.messages.batchModify({ userId: "me", requestBody: { ids, addLabelIds, removeLabelIds } });
  }

  async trash(id: string): Promise<void> {
    await this.api.users.messages.trash({ userId: "me", id });
  }

  async untrash(id: string): Promise<void> {
    await this.api.users.messages.untrash({ userId: "me", id });
  }
}

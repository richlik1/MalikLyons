import type { Scope } from "../core/types.js";

export function isOwner(fromId: number | undefined, chatType: string | undefined, ownerId: number | undefined): boolean {
  return ownerId !== undefined && fromId === ownerId && chatType === "private";
}

/** Callback data for approval buttons: "ap:<uuid>:y" / "ap:<uuid>:n" (< 64 bytes). */
export function approvalCallbackData(approvalId: string, approve: boolean): string {
  return `ap:${approvalId}:${approve ? "y" : "n"}`;
}

export function parseApprovalCallback(data: string): { approvalId: string; approve: boolean } | null {
  const m = /^ap:([0-9a-f-]{36}):([yn])$/.exec(data);
  return m ? { approvalId: m[1]!, approve: m[2] === "y" } : null;
}

export function parseScope(arg: string | undefined): Scope | null {
  const a = arg?.trim().toLowerCase();
  return a === "business" || a === "personal" ? a : null;
}

const KINDS = ["client", "project", "goal", "preference", "person", "fact"] as const;

/** "/remember client Acme Rentals: prefers invoices on the 1st" */
export function parseRemember(text: string): { kind: (typeof KINDS)[number]; subject: string; content: string } | null {
  const m = /^\s*(\w+)\s+([^:]{1,200}):\s*([\s\S]{1,4000})$/.exec(text);
  if (!m) return null;
  const kind = m[1]!.toLowerCase() as (typeof KINDS)[number];
  if (!KINDS.includes(kind)) return null;
  return { kind, subject: m[2]!.trim(), content: m[3]!.trim() };
}

export function taskTitle(input: string): string {
  const firstLine = input.trim().split("\n")[0] ?? "";
  return firstLine.length > 60 ? `${firstLine.slice(0, 57)}...` : firstLine || "Untitled task";
}

/** Telegram caps messages at 4096 chars. */
export function chunkMessage(text: string, size = 4000): string[] {
  if (text.length <= size) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > size) {
    let cut = rest.lastIndexOf("\n", size);
    if (cut < size / 2) cut = size;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, "");
  }
  if (rest) out.push(rest);
  return out;
}

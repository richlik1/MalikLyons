export interface ApprovalRequest {
  approvalId: string;
  taskId: string;
  toolName: string;
  summary: string;
  risk: string;
  expiresAt: Date;
}

export interface Button {
  text: string;
  /** Callback payload (Telegram limit: 64 bytes). */
  data: string;
}

/** Outbound channel to the owner. Telegram in production; an in-memory fake in tests. */
export interface Notifier {
  send(chatId: number | null, text: string): Promise<void>;
  /** Message with inline buttons. Falls back to plain text where buttons aren't supported. */
  sendWithButtons?(chatId: number | null, text: string, buttons: Button[][]): Promise<void>;
  /** Returns the channel's message id so the prompt can be edited after a decision. */
  requestApproval(chatId: number | null, req: ApprovalRequest): Promise<number | null>;
}

export class NullNotifier implements Notifier {
  async send(): Promise<void> {}
  async requestApproval(): Promise<number | null> {
    return null;
  }
}

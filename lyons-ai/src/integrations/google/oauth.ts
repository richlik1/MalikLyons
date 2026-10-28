import { randomBytes } from "node:crypto";
import { OAuth2Client, type Credentials } from "google-auth-library";
import type { Config } from "../../config.js";
import type { Scope } from "../../core/types.js";
import type { Store } from "../../db/store.js";
import type { SecretBox } from "../../security/crypto.js";

/**
 * Least-privilege scopes for the MVP:
 *  - gmail.readonly: read/search mail
 *  - gmail.compose: create drafts. NOTE: Google bundles "send" into this scope;
 *    LYONS AI has no send code path in the MVP, and any future send tool is
 *    classed external_communication (approval required).
 *  - calendar.events: read events and (with approval) create them
 *  - gmail.modify: label/archive/trash for Gmail cleanup (no permanent delete
 *    code path exists; trash stays recoverable for 30 days)
 *  - contacts.readonly: match clients across Gmail and Google Contacts
 * Accounts connected before a scope was added must reconnect (/connect_google).
 */
export const GOOGLE_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/contacts.readonly",
];

const PROVIDER = "google";

export class GoogleNotConnectedError extends Error {
  constructor(label: Scope) {
    super(`Google ${label} account is not connected. Send /connect_google ${label} in Telegram to connect it.`);
  }
}

export class GoogleAuthManager {
  constructor(
    private readonly cfg: Config,
    private readonly store: Store,
    private readonly box: SecretBox,
  ) {}

  get configured(): boolean {
    return Boolean(this.cfg.GOOGLE_CLIENT_ID && this.cfg.GOOGLE_CLIENT_SECRET);
  }

  get redirectUri(): string {
    return new URL("/oauth/google/callback", this.cfg.PUBLIC_BASE_URL).toString();
  }

  private newClient(): OAuth2Client {
    if (!this.configured) throw new Error("Google OAuth is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET missing).");
    return new OAuth2Client({
      clientId: this.cfg.GOOGLE_CLIENT_ID,
      clientSecret: this.cfg.GOOGLE_CLIENT_SECRET,
      redirectUri: this.redirectUri,
    });
  }

  /** Builds a consent URL bound to a single-use, 10-minute CSRF state. */
  async createAuthUrl(label: Scope): Promise<string> {
    const state = randomBytes(24).toString("base64url");
    await this.store.createOAuthState(state, PROVIDER, label, 10 * 60_000);
    return this.newClient().generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: GOOGLE_SCOPES,
      state,
      include_granted_scopes: false,
    });
  }

  async handleCallback(code: string, state: string): Promise<{ label: Scope; email: string | null }> {
    const st = await this.store.consumeOAuthState(state);
    if (!st || st.provider !== PROVIDER) throw new Error("Invalid or expired OAuth state.");
    const client = this.newClient();
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) throw new Error("Google did not return a refresh token. Remove the app's access at myaccount.google.com/permissions and try again.");
    let email: string | null = null;
    if (tokens.id_token) {
      const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: this.cfg.GOOGLE_CLIENT_ID });
      email = ticket.getPayload()?.email ?? null;
    }
    await this.persist(st.account_label, email, tokens);
    await this.store.audit("owner", "oauth.connected", null, { provider: PROVIDER, account: st.account_label, email });
    return { label: st.account_label, email };
  }

  private async persist(label: Scope, email: string | null, tokens: Credentials): Promise<void> {
    await this.store.saveOAuthCredential({
      provider: PROVIDER,
      accountLabel: label,
      accountEmail: email,
      scopes: (tokens.scope ?? GOOGLE_SCOPES.join(" ")).split(" "),
      encryptedTokens: this.box.encrypt(JSON.stringify(tokens), `${PROVIDER}:${label}`),
    });
  }

  /** Returns an authorised client for the given account; refreshed tokens are re-encrypted and saved. */
  async clientFor(label: Scope): Promise<OAuth2Client> {
    const row = await this.store.getOAuthCredential(PROVIDER, label);
    if (!row) throw new GoogleNotConnectedError(label);
    const tokens = JSON.parse(this.box.decrypt(row.encrypted_tokens, `${PROVIDER}:${label}`)) as Credentials;
    const client = this.newClient();
    client.setCredentials(tokens);
    client.on("tokens", (fresh) => {
      void this.persist(label, row.account_email, { ...tokens, ...fresh });
    });
    return client;
  }

  async status(label: Scope): Promise<string> {
    const row = await this.store.getOAuthCredential(PROVIDER, label);
    return row ? `connected (${row.account_email ?? "unknown email"})` : "not connected";
  }

  async disconnect(label: Scope): Promise<void> {
    const row = await this.store.getOAuthCredential(PROVIDER, label);
    if (!row) return;
    try {
      const tokens = JSON.parse(this.box.decrypt(row.encrypted_tokens, `${PROVIDER}:${label}`)) as Credentials;
      if (tokens.refresh_token) await this.newClient().revokeToken(tokens.refresh_token);
    } finally {
      await this.store.deleteOAuthCredential(PROVIDER, label);
      await this.store.audit("owner", "oauth.disconnected", null, { provider: PROVIDER, account: label });
    }
  }
}

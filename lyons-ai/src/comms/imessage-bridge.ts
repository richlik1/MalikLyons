import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { looksLikeRequest, normalizeEmail, normalizePhone } from "../clients/identity.js";
import type { ClientService } from "../clients/service.js";
import type { Config } from "../config.js";
import type { Notifier } from "../core/notifier.js";
import type { Store } from "../db/store.js";
import { verifyWebhook } from "../security/webhook-auth.js";

/**
 * Server side of the macOS iMessage bridge (deploy/macos-bridge/).
 *
 * Apple offers no iMessage API. The bridge runs on the owner's own Mac, reads
 * the local Messages database (with Full Disk Access the owner grants), and
 * sends through the Messages app via AppleScript. Privacy: the bridge first
 * downloads the list of known client handles and only uploads conversations
 * with those handles; this endpoint also drops anything it can't match.
 */

const Inbound = z.object({
  messages: z
    .array(
      z.object({
        guid: z.string().min(1).max(200),
        handle: z.string().min(1).max(320),
        from_me: z.boolean(),
        text: z.string().max(10_000),
        sent_at: z.string().datetime({ offset: true }),
      }),
    )
    .max(500),
});

const Ack = z.object({ id: z.string().uuid(), ok: z.boolean(), error: z.string().max(500).optional() });

export function normalizeHandle(h: string): string | null {
  return normalizePhone(h) ?? normalizeEmail(h);
}

export function registerIMessageBridge(
  app: FastifyInstance,
  d: { config: Config; store: Store; clients: ClientService; notifier: Notifier },
): void {
  const { config, store, clients, notifier } = d;

  const auth = (req: FastifyRequest) => {
    if (!config.MAC_BRIDGE_SECRET) return { ok: false as const, reason: "bridge disabled" };
    const raw = (req.body as { raw?: string } | undefined)?.raw ?? "";
    return verifyWebhook({
      secret: config.MAC_BRIDGE_SECRET,
      timestampHeader: req.headers["x-lyons-timestamp"] as string | undefined,
      signatureHeader: req.headers["x-lyons-signature"] as string | undefined,
      rawBody: raw,
    });
  };
  const halted = async () => (await store.isPaused()) || (await store.isModulePaused("communications"));

  app.get("/bridge/imessage/handles", async (req, res) => {
    const a = auth(req);
    if (!a.ok) return res.code(401).send({ error: a.reason });
    const r = await store.db.query<{ value: string }>("SELECT DISTINCT value FROM client_identities WHERE kind IN ('phone', 'email', 'imessage_handle')");
    return { handles: r.rows.map((x) => x.value) };
  });

  app.post("/bridge/imessage/inbound", async (req, res) => {
    const a = auth(req);
    if (!a.ok) return res.code(401).send({ error: a.reason });
    if (await halted()) return res.code(423).send({ error: "communications paused" });
    const body = Inbound.safeParse((req.body as { json: unknown }).json);
    if (!body.success) return res.code(400).send({ error: body.error.issues });
    let stored = 0;
    let ignored = 0;
    for (const m of body.data.messages) {
      const handle = normalizeHandle(m.handle);
      const r = handle
        ? await clients.resolve({ phone: normalizePhone(m.handle) ?? undefined, email: normalizeEmail(m.handle) ?? undefined, source: "imessage" })
        : { clientId: null };
      if (!r.clientId) {
        ignored++; // not a known client: not stored
        continue;
      }
      const ok = await clients.recordEvent(r.clientId, {
        at: new Date(m.sent_at),
        kind: "message",
        direction: m.from_me ? "out" : "in",
        channel: "imessage",
        source: "imessage",
        externalId: m.guid,
        summary: m.text,
        requiresResponse: !m.from_me && looksLikeRequest(m.text, false),
      });
      if (ok) stored++;
    }
    return { stored, ignored };
  });

  app.get("/bridge/imessage/outbox", async (req, res) => {
    const a = auth(req);
    if (!a.ok) return res.code(401).send({ error: a.reason });
    if (await halted()) return { messages: [] }; // kill switch / module pause stops all sends
    const r = await store.db.query<{ id: string; to_address: string; body: string }>(
      "SELECT id, to_address, body FROM outbound_messages WHERE channel = 'imessage' AND status = 'queued' ORDER BY created_at LIMIT 20",
    );
    return { messages: r.rows.map((m) => ({ id: m.id, handle: m.to_address, text: m.body })) };
  });

  app.post("/bridge/imessage/ack", async (req, res) => {
    const a = auth(req);
    if (!a.ok) return res.code(401).send({ error: a.reason });
    const body = Ack.safeParse((req.body as { json: unknown }).json);
    if (!body.success) return res.code(400).send({ error: body.error.issues });
    const r = await store.db.query<{ client_id: string | null; to_address: string; body: string; status: string }>(
      "SELECT client_id, to_address, body, status FROM outbound_messages WHERE id = $1 AND channel = 'imessage'",
      [body.data.id],
    );
    const m = r.rows[0];
    if (!m) return res.code(404).send({ error: "unknown message" });
    if (m.status !== "queued") return { ok: true, status: m.status }; // duplicate ack
    await clients.markOutbound(body.data.id, body.data.ok ? "sent" : "failed", body.data.ok ? "delivered to Messages app" : body.data.error ?? "failed");
    await store.audit("imessage_bridge", body.data.ok ? "imessage.sent" : "imessage.failed", null, { outboundId: body.data.id, to: m.to_address });
    if (body.data.ok && m.client_id) {
      await clients.recordEvent(m.client_id, { at: new Date(), kind: "message", direction: "out", channel: "imessage", source: "lyons_outbound", externalId: body.data.id, summary: m.body });
    }
    if (!body.data.ok) await notifier.send(null, `⚠️ iMessage to ${m.to_address} was NOT sent: ${body.data.error ?? "unknown error"}`);
    return { ok: true };
  });
}

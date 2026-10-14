import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import type { Config } from "../config.js";
import type { Notifier } from "../core/notifier.js";
import type { AgentRegistry } from "../core/registry.js";
import type { Store } from "../db/store.js";
import type { GoogleAuthManager } from "../integrations/google/oauth.js";
import { triggerBriefing } from "../scheduler/briefings.js";
import { wrapUntrusted } from "../security/untrusted.js";
import { verifyWebhook } from "../security/webhook-auth.js";
import { taskTitle } from "../telegram/parse.js";

const BriefingBody = z.object({
  kind: z.enum(["morning", "evening"]),
  scope: z.enum(["business", "personal"]).default("business"),
});

/**
 * n8n event -> task. `instruction` is written by the owner inside the n8n
 * workflow (trusted). `payload` carries event data (e.g. a new email or a
 * StayOps webhook) and is always treated as untrusted.
 */
const TaskBody = z.object({
  instruction: z.string().min(1).max(4000),
  payload: z.unknown().optional(),
  scope: z.enum(["business", "personal"]).default("business"),
  agent: z.string().default("chief_of_staff"),
  dedupe_key: z.string().max(200).optional(),
});

const html = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><body style="font-family:system-ui;padding:24px"><h2>${title}</h2><p>${body}</p></body>`;

export function buildServer(d: {
  config: Config;
  store: Store;
  google: GoogleAuthManager;
  agents: AgentRegistry;
  notifier: Notifier;
}): FastifyInstance {
  const { config, store, google, notifier } = d;
  const app = Fastify({ logger: false, bodyLimit: 256 * 1024 });

  // Keep the raw body so webhook signatures are verified over exact bytes.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    try {
      done(null, { raw: body as string, json: body ? JSON.parse(body as string) : {} });
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  app.get("/healthz", async (_req, res) => {
    try {
      await store.db.query("SELECT 1");
      return { ok: true, paused: await store.isPaused() };
    } catch {
      return res.code(503).send({ ok: false });
    }
  });

  app.get("/oauth/google/callback", async (req, res) => {
    const q = req.query as { code?: string; state?: string; error?: string };
    res.type("text/html");
    if (q.error || !q.code || !q.state) return res.code(400).send(html("Google connection cancelled", "No changes were made."));
    try {
      const { label, email } = await google.handleCallback(q.code, q.state);
      await notifier.send(null, `🔗 Google ${label} account connected (${email ?? "unknown email"}).`);
      return html("Connected", `Your ${label} Google account is connected to LYONS AI. You can close this tab.`);
    } catch (err) {
      await store.audit("system", "oauth.failed", null, { error: (err as Error).message });
      return res.code(400).send(html("Connection failed", "The link was invalid, expired, or already used. Request a new one with /connect_google."));
    }
  });

  const authorise = (req: { headers: Record<string, unknown>; body: unknown }) => {
    if (!config.WEBHOOK_SHARED_SECRET) return { ok: false as const, reason: "webhooks disabled" };
    const raw = (req.body as { raw?: string } | undefined)?.raw ?? "";
    return verifyWebhook({
      secret: config.WEBHOOK_SHARED_SECRET,
      timestampHeader: req.headers["x-lyons-timestamp"] as string | undefined,
      signatureHeader: req.headers["x-lyons-signature"] as string | undefined,
      rawBody: raw,
    });
  };

  app.post("/hooks/briefing", async (req, res) => {
    const auth = authorise(req);
    if (!auth.ok) return res.code(401).send({ error: auth.reason });
    const body = BriefingBody.safeParse((req.body as { json: unknown }).json);
    if (!body.success) return res.code(400).send({ error: body.error.issues });
    if (await store.isPaused()) return res.code(423).send({ error: "kill switch active" });
    const r = await triggerBriefing(store, { ...body.data, timeZone: config.TIMEZONE, chatId: null });
    return r.created ? { created: true, taskId: r.task.id } : { created: false, reason: r.reason };
  });

  app.post("/hooks/task", async (req, res) => {
    const auth = authorise(req);
    if (!auth.ok) return res.code(401).send({ error: auth.reason });
    const body = TaskBody.safeParse((req.body as { json: unknown }).json);
    if (!body.success) return res.code(400).send({ error: body.error.issues });
    if (!d.agents.get(body.data.agent)) return res.code(400).send({ error: "unknown agent" });
    if (await store.isPaused()) return res.code(423).send({ error: "kill switch active" });
    if (body.data.dedupe_key && !(await store.claimScheduledRun("webhook", body.data.dedupe_key))) {
      return { created: false, reason: "duplicate dedupe_key" };
    }
    const input =
      body.data.payload === undefined
        ? body.data.instruction
        : `${body.data.instruction}\n\nEvent data:\n${wrapUntrusted("n8n_event", JSON.stringify(body.data.payload, null, 1))}`;
    const task = await store.createTask({
      title: taskTitle(body.data.instruction),
      input,
      scope: body.data.scope,
      source: "webhook",
      agent: body.data.agent,
    });
    if (body.data.dedupe_key) await store.attachScheduledRunTask("webhook", body.data.dedupe_key, task.id);
    return { created: true, taskId: task.id };
  });

  return app;
}

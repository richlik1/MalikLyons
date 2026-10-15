import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Logger } from "pino";
import { normalizePhone } from "../clients/identity.js";
import type { ClientService } from "../clients/service.js";
import type { Config } from "../config.js";
import type { LlmClient } from "../core/llm.js";
import type { Notifier } from "../core/notifier.js";
import type { Store } from "../db/store.js";
import {
  decideTurn,
  DEFAULT_KNOWLEDGE,
  FALLBACK_TURN,
  guardReply,
  KNOWLEDGE_KEY,
  preRoute,
  type Captured,
  type ReceptionistKnowledge,
  type Turn,
} from "./brain.js";
import { gather, say, twiml, validTwilioRequest, xml } from "./twilio.js";

interface CallRow {
  call_sid: string;
  from_number: string | null;
  client_id: string | null;
  status: string;
  turns: number;
  empty_turns: number;
  transcript: Turn[];
  intent: string | null;
  captured: Captured;
  escalated: boolean;
  guard_events: string[];
  voicemail_url: string | null;
  voicemail_text: string | null;
  owner_notified: boolean;
}

const GREETING = (name: string) =>
  `Thanks for calling ${name}. You're speaking with an automated AI assistant, and this call is transcribed so our team can follow up. How can I help you today?`;

export function registerReceptionist(
  app: FastifyInstance,
  d: { config: Config; store: Store; clients: ClientService; notifier: Notifier; llm: LlmClient; log: Logger },
): void {
  const { config, store, clients, notifier, log } = d;
  const voice = config.RECEPTIONIST_VOICE;

  const xmlReply = (res: FastifyReply, body: string) => res.type("text/xml").send(twiml(body));

  /** Rejects anything that isn't a correctly signed Twilio request. */
  const verified = (req: FastifyRequest, res: FastifyReply): Record<string, string> | null => {
    if (!config.RECEPTIONIST_ENABLED || !config.TWILIO_AUTH_TOKEN) {
      res.code(404).send();
      return null;
    }
    const params = (req.body ?? {}) as Record<string, string>;
    const url = new URL(req.url, config.PUBLIC_BASE_URL).toString();
    if (!validTwilioRequest(config.TWILIO_AUTH_TOKEN, url, params, req.headers["x-twilio-signature"] as string | undefined)) {
      void store.audit("twilio", "receptionist.bad_signature", null, { path: req.url });
      res.code(403).send();
      return null;
    }
    return params;
  };

  const halted = async () => (await store.isPaused()) || (await store.isModulePaused("receptionist"));
  const knowledge = async () => (await store.getSetting<ReceptionistKnowledge>(KNOWLEDGE_KEY)) ?? DEFAULT_KNOWLEDGE;
  const getCall = async (sid: string) => (await store.db.query<CallRow>("SELECT * FROM calls WHERE call_sid = $1", [sid])).rows[0] ?? null;

  const voicemail = (prompt = "Please leave your name, number, and what you need after the tone, and the owner will call you back.") =>
    `${say(prompt, voice)}<Record maxLength="120" playBeep="true" action="/voice/voicemail" method="POST" transcribe="true" transcribeCallback="/voice/transcription"/>${say("We didn't get a recording. Goodbye.", voice)}<Hangup/>`;

  async function finalize(sid: string, status?: "completed" | "escalated" | "voicemail" | "failed") {
    if (status) await store.db.query("UPDATE calls SET status = $2, ended_at = coalesce(ended_at, now()) WHERE call_sid = $1", [sid, status]);
    const c = await getCall(sid);
    if (!c || c.owner_notified) return;
    const client = c.client_id ? (await store.db.query<{ name: string }>("SELECT name FROM clients WHERE id = $1", [c.client_id])).rows[0]?.name : undefined;
    const cap = c.captured ?? {};
    const lines = [
      `📞 Call from ${c.from_number ?? "unknown number"}${client ? ` (matches client ${client} by caller ID — unverified)` : ""}`,
      `Outcome: ${c.status}${c.escalated ? " (escalated to you)" : ""} · intent: ${c.intent ?? "unknown"}`,
      cap.name ? `Name: ${cap.name}` : "",
      cap.callback_number ? `Callback number: ${cap.callback_number}` : "",
      cap.service ? `Needs: ${cap.service}` : "",
      cap.address_area ? `Area: ${cap.address_area}` : "",
      cap.preferred_times ? `Preferred times: ${cap.preferred_times}` : "",
      cap.notes ? `Notes: ${cap.notes}` : "",
      c.voicemail_text ? `Voicemail: ${c.voicemail_text}` : "",
      c.guard_events.length ? `Safety filter replaced ${c.guard_events.length} reply part(s) (${[...new Set(c.guard_events)].join(", ")}).` : "",
      "",
      "Transcript:",
      ...c.transcript.slice(-12).map((t) => `${t.role === "caller" ? "Caller" : "AI"}: ${t.text}`),
      "",
      "Nothing was promised to the caller. Reply to follow up or ask me to draft a callback plan.",
    ].filter((l) => l !== "");
    await notifier.send(null, lines.join("\n"));
    await store.db.query("UPDATE calls SET owner_notified = true WHERE call_sid = $1", [sid]);
    if (c.client_id) {
      await clients.recordEvent(c.client_id, {
        at: new Date(),
        kind: "call",
        direction: "in",
        channel: "phone",
        source: "receptionist",
        externalId: sid,
        summary: [c.intent, cap.service, cap.preferred_times ? `prefers ${cap.preferred_times}` : "", cap.notes].filter(Boolean).join(" · ") || "Inbound call",
        requiresResponse: true,
      });
    }
    await store.audit("receptionist", "receptionist.call_summarized", null, { callSid: sid, status: c.status, intent: c.intent });
  }

  async function escalate(sid: string, reason: string): Promise<string> {
    await store.db.query("UPDATE calls SET escalated = true, intent = coalesce(intent, 'urgent') WHERE call_sid = $1", [sid]);
    const c = await getCall(sid);
    await notifier.send(null, `🚨 Caller ${c?.from_number ?? "unknown"} needs you now (${reason}).${config.OWNER_PHONE ? " Transferring the call to your phone." : " No OWNER_PHONE set — taking a voicemail."}`);
    if (!config.OWNER_PHONE) return voicemail("I'm flagging this as urgent for the owner right now. Please leave a message after the tone.");
    return `${say("I'll connect you with the owner now. Please hold.", voice)}<Dial timeout="20" action="/voice/dial-result" method="POST">${xml(config.OWNER_PHONE)}</Dial>`;
  }

  app.post("/voice/incoming", async (req, res) => {
    const p = verified(req, res);
    if (!p) return;
    const sid = p.CallSid ?? "";
    const from = p.From ?? null;
    const phone = from ? normalizePhone(from) : null;
    const match = phone ? await clients.resolve({ phone, source: "receptionist" }) : { clientId: null };
    await store.db.query("INSERT INTO calls (call_sid, from_number, to_number, client_id) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING", [
      sid,
      from,
      p.To ?? null,
      match.clientId,
    ]);
    await store.audit("receptionist", "receptionist.call_started", null, { callSid: sid, from });
    const kb = await knowledge();
    if (await halted()) {
      await store.db.query("UPDATE calls SET status = 'voicemail' WHERE call_sid = $1", [sid]);
      return xmlReply(res, voicemail(`Thanks for calling ${kb.businessName}. Please leave your name, number, and what you need after the tone.`));
    }
    await store.db.query("UPDATE calls SET transcript = transcript || $2::jsonb WHERE call_sid = $1", [
      sid,
      JSON.stringify([{ role: "assistant", text: GREETING(kb.businessName), at: new Date().toISOString() }]),
    ]);
    return xmlReply(res, gather(GREETING(kb.businessName), voice, "/voice/gather"));
  });

  app.post("/voice/gather", async (req, res) => {
    const p = verified(req, res);
    if (!p) return;
    const sid = p.CallSid ?? "";
    const call = await getCall(sid);
    if (!call) return xmlReply(res, voicemail());
    if (await halted()) return xmlReply(res, voicemail());
    const speech = (p.SpeechResult ?? "").trim();

    if (!speech) {
      const empties = call.empty_turns + 1;
      await store.db.query("UPDATE calls SET empty_turns = $2 WHERE call_sid = $1", [sid, empties]);
      if (empties >= 2) {
        await store.db.query("UPDATE calls SET status = 'voicemail' WHERE call_sid = $1", [sid]);
        return xmlReply(res, voicemail());
      }
      return xmlReply(res, gather("Sorry, I didn't hear anything. How can I help you today?", voice, "/voice/gather"));
    }

    const transcript: Turn[] = [...call.transcript, { role: "caller", text: speech.slice(0, 1000), at: new Date().toISOString() }];
    const route = preRoute(speech);
    if (route) {
      await store.db.query("UPDATE calls SET transcript = $2, turns = turns + 1 WHERE call_sid = $1", [sid, JSON.stringify(transcript)]);
      const twimlBody = await escalate(sid, route === "urgent" ? "caller reported an urgent issue" : "caller asked for a person");
      await finalize(sid, "escalated");
      return xmlReply(res, twimlBody);
    }

    let turn = FALLBACK_TURN;
    const overLimit = call.turns + 1 >= config.RECEPTIONIST_MAX_TURNS;
    const overBudget = (await store.spendToday(config.TIMEZONE)) >= config.DAILY_SPEND_LIMIT_USD;
    if (overBudget) {
      await store.db.query("UPDATE calls SET transcript = $2, status = 'voicemail' WHERE call_sid = $1", [sid, JSON.stringify(transcript)]);
      return xmlReply(res, voicemail("Thanks. So the owner gets every detail, please leave your name, number and request after the tone."));
    }
    try {
      const r = await decideTurn(d.llm, await knowledge(), transcript, AbortSignal.timeout(9000));
      if (r) turn = r;
    } catch (err) {
      log.warn({ err, sid }, "receptionist model call failed; using fallback");
    }
    const guarded = guardReply(turn.reply);
    const captured = { ...(call.captured ?? {}), ...Object.fromEntries(Object.entries(turn.captured).filter(([, v]) => v)) };
    const done = turn.done || overLimit;
    const reply = overLimit && !turn.done ? "Thank you, I have everything the owner needs and they'll call you back. Goodbye." : guarded.text;
    transcript.push({ role: "assistant", text: reply, at: new Date().toISOString() });
    await store.db.query(
      `UPDATE calls SET transcript = $2, turns = turns + 1, intent = $3, captured = $4, guard_events = guard_events || $5::jsonb WHERE call_sid = $1`,
      [sid, JSON.stringify(transcript), turn.intent, JSON.stringify(captured), JSON.stringify(guarded.violations)],
    );

    if (turn.escalate) {
      const body = await escalate(sid, `assistant flagged: ${turn.intent}`);
      await finalize(sid, "escalated");
      return xmlReply(res, body);
    }
    if (done) {
      await finalize(sid, "completed");
      return xmlReply(res, `${say(reply, voice)}<Hangup/>`);
    }
    return xmlReply(res, gather(reply, voice, "/voice/gather"));
  });

  app.post("/voice/dial-result", async (req, res) => {
    const p = verified(req, res);
    if (!p) return;
    if (p.DialCallStatus === "completed") return xmlReply(res, "<Hangup/>");
    return xmlReply(res, voicemail("The owner couldn't pick up. Please leave a message after the tone and they'll call you right back."));
  });

  app.post("/voice/voicemail", async (req, res) => {
    const p = verified(req, res);
    if (!p) return;
    await store.db.query("UPDATE calls SET voicemail_url = $2, status = CASE WHEN status = 'escalated' THEN status ELSE 'voicemail' END, ended_at = now() WHERE call_sid = $1", [
      p.CallSid ?? "",
      p.RecordingUrl ?? null,
    ]);
    return xmlReply(res, `${say("Thanks, your message has been saved. Goodbye.", voice)}<Hangup/>`);
  });

  app.post("/voice/transcription", async (req, res) => {
    const p = verified(req, res);
    if (!p) return;
    const sid = p.CallSid ?? "";
    await store.db.query("UPDATE calls SET voicemail_text = $2 WHERE call_sid = $1", [sid, (p.TranscriptionText ?? "").slice(0, 4000)]);
    await store.db.query("UPDATE calls SET owner_notified = false WHERE call_sid = $1 AND status = 'voicemail'", [sid]);
    await finalize(sid);
    return res.code(204).send();
  });

  app.post("/voice/status", async (req, res) => {
    const p = verified(req, res);
    if (!p) return;
    if (["completed", "busy", "failed", "no-answer", "canceled"].includes(p.CallStatus ?? "")) {
      const c = await getCall(p.CallSid ?? "");
      if (c && c.status === "in_progress") await finalize(c.call_sid, p.CallStatus === "completed" ? "completed" : "failed");
      else if (c && c.status === "voicemail" && !c.voicemail_url) await finalize(c.call_sid);
    }
    return res.code(204).send();
  });
}

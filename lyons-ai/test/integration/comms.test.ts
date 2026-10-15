import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { defaultAgents } from "../../src/agents/index.js";
import { AutomationPolicies } from "../../src/clients/policies.js";
import { ClientService } from "../../src/clients/service.js";
import { ClientSync } from "../../src/clients/sync.js";
import { registerIMessageBridge } from "../../src/comms/imessage-bridge.js";
import { AgentRegistry, ToolRegistry } from "../../src/core/registry.js";
import { TaskRunner } from "../../src/core/runner.js";
import type { ToolDefinition } from "../../src/core/types.js";
import { Worker } from "../../src/core/worker.js";
import type { Db } from "../../src/db/pool.js";
import { Store } from "../../src/db/store.js";
import { registerStorageBridge, storageTools } from "../../src/device/storage.js";
import type { MessageMeta } from "../../src/gmail-cleanup/classify.js";
import type { Mailbox } from "../../src/gmail-cleanup/mailbox.js";
import { GmailCleanupService } from "../../src/gmail-cleanup/service.js";
import { buildServer } from "../../src/http/server.js";
import { GoogleAuthManager } from "../../src/integrations/google/oauth.js";
import { registerReceptionist } from "../../src/receptionist/routes.js";
import { twilioSignature } from "../../src/receptionist/twilio.js";
import { SecretBox } from "../../src/security/crypto.js";
import { signWebhook } from "../../src/security/webhook-auth.js";
import { FakeLlm, freshDb, hasDb, lastToolResult, RecordingNotifier, silentLog, testConfig, textResponse, toolUseResponse } from "../helpers.js";

const NOW = Date.now();
const daysAgo = (n: number) => NOW - n * 86_400_000;

class FakeMailbox implements Mailbox {
  msgs = new Map<string, MessageMeta>();
  labels = new Map<string, string>();
  modifyCalls: { ids: string[]; add: string[]; remove: string[] }[] = [];
  trashed = new Set<string>();
  add(m: MessageMeta) {
    this.msgs.set(m.id, m);
  }
  async listIds(_q: string, max: number) {
    return [...this.msgs.keys()].slice(0, max);
  }
  async getMeta(id: string) {
    return structuredClone(this.msgs.get(id)!);
  }
  async ensureLabel(name: string) {
    if (!this.labels.has(name)) this.labels.set(name, `Label_${this.labels.size + 100}`);
    return this.labels.get(name)!;
  }
  async batchModify(ids: string[], add: string[], remove: string[]) {
    this.modifyCalls.push({ ids, add, remove });
    for (const id of ids) {
      const m = this.msgs.get(id)!;
      m.labelIds = [...new Set([...m.labelIds.filter((l) => !remove.includes(l)), ...add])];
    }
  }
  async trash(id: string) {
    this.trashed.add(id);
  }
  async untrash(id: string) {
    this.trashed.delete(id);
  }
}

describe.skipIf(!hasDb)("Communications, cleanup, clients, bridges, receptionist (Postgres)", () => {
  let db: Db;
  let store: Store;
  let clients: ClientService;
  let notifier: RecordingNotifier;

  beforeAll(async () => {
    db = await freshDb();
    store = new Store(db);
    clients = new ClientService(db, store);
  });
  afterAll(async () => db?.end());
  beforeEach(async () => {
    await db.query(`TRUNCATE tasks, task_messages, tool_calls, approvals, settings, spend_ledger, clients, identity_suggestions, outbound_messages,
      automation_policies, cleanup_plans, calls, storage_reports, memories RESTART IDENTITY CASCADE`);
    notifier = new RecordingNotifier();
  });

  // ---------------- Gmail cleanup ----------------
  describe("Gmail cleanup", () => {
    function inbox() {
      const mb = new FakeMailbox();
      mb.add({ id: "p1", labelIds: ["INBOX", "CATEGORY_PROMOTIONS"], from: "Deals <deals@shop.example>", subject: "50% off", internalDate: daysAgo(60), listUnsubscribe: "<https://shop.example/u/1>", listUnsubscribePost: "List-Unsubscribe=One-Click" });
      mb.add({ id: "p2", labelIds: ["INBOX", "CATEGORY_PROMOTIONS"], from: "Deals <deals@shop.example>", subject: "Weekend sale", internalDate: daysAgo(200), listUnsubscribe: "<https://shop.example/u/1>", listUnsubscribePost: "List-Unsubscribe=One-Click" });
      mb.add({ id: "p3", labelIds: ["INBOX", "CATEGORY_PROMOTIONS"], from: "Deals <deals@shop.example>", subject: "Last chance", internalDate: daysAgo(90), listUnsubscribe: "<https://shop.example/u/1>", listUnsubscribePost: "List-Unsubscribe=One-Click" });
      mb.add({ id: "inv", labelIds: ["INBOX", "CATEGORY_PROMOTIONS"], from: "Billing <billing@supplier.example>", subject: "Invoice #881 due", internalDate: daysAgo(120) });
      mb.add({ id: "cl", labelIds: ["INBOX"], from: "Nicole <nicole@acmerentals.com>", subject: "Turnover schedule", internalDate: daysAgo(100) });
      mb.add({ id: "new", labelIds: ["INBOX", "CATEGORY_PROMOTIONS"], from: "Deals <deals@shop.example>", subject: "Today only", internalDate: daysAgo(2) });
      mb.add({ id: "spam", labelIds: ["SPAM"], from: "x@spam.example", subject: "You won", internalDate: daysAgo(40), listUnsubscribe: "<https://spam.example/u>" });
      return mb;
    }

    it("scans read-only, protects records and clients, and reports counts with recovery options", async () => {
      await clients.upsertClient({ name: "Nicole Smith", emails: ["nicole@acmerentals.com"] });
      const mb = inbox();
      const svc = new GmailCleanupService(db, store);
      const r = await svc.scan(mb, { scope: "business", query: "in:inbox", maxMessages: 100, archiveOlderThanDays: 30, trashOlderThanDays: null });
      expect(mb.modifyCalls).toHaveLength(0); // scanning changes nothing
      expect(r.summary.byAction).toEqual({ archive: 3, trash: 0, keep: 4 });
      expect(r.summary.protectedByReason).toMatchObject({ "invoice/billing record": 1, "from a known client": 1 });
      expect(r.summary.unsubscribeSuggestions).toBe(1); // shop (3 msgs); never spam
      expect(r.report).toMatch(/Nothing is ever permanently deleted/);
      expect(r.report).toMatch(/Archived mail stays in All Mail with the label "LYONS\/Cleanup-/);
    });

    it("applies exactly the approved plan, idempotently, and reverts it", async () => {
      const mb = inbox();
      const svc = new GmailCleanupService(db, store);
      const { planId } = await svc.scan(mb, { scope: "business", query: "in:inbox", maxMessages: 100, archiveOlderThanDays: 30, trashOlderThanDays: 150 });
      await expect(svc.apply(mb, planId, true, { archive: 99, trash: 1 })).rejects.toThrow(/Counts don't match/);
      expect(mb.modifyCalls).toHaveLength(0);

      const r = await svc.apply(mb, planId, true, { archive: 2, trash: 1 });
      expect(r).toMatchObject({ archived: 2, trashed: 1 });
      expect(mb.msgs.get("inv")!.labelIds).toContain("INBOX"); // protected untouched
      expect(mb.msgs.get("cl")!.labelIds).toContain("INBOX");
      expect(mb.msgs.get("p1")!.labelIds).not.toContain("INBOX");
      expect(mb.trashed).toEqual(new Set(["p2"]));
      const calls = mb.modifyCalls.length;
      await svc.apply(mb, planId, true, { archive: 2, trash: 1 }); // re-apply: no new changes
      expect(mb.modifyCalls.filter((c) => c.ids.length).length).toBe(calls);

      const back = await svc.revert(mb, planId);
      expect(back.restored).toBe(3);
      expect(mb.trashed.size).toBe(0);
      expect(mb.msgs.get("p1")!.labelIds).toContain("INBOX");
      expect((await svc.getPlan(planId))!.status).toBe("reverted");
      await expect(svc.apply(mb, planId, false)).rejects.toThrow(/reverted/);
    });

    it("unsubscribes only via one-click, verifies the sender, and refuses private URLs", async () => {
      const svc = new GmailCleanupService(db, store);
      await svc.scan(inbox(), { scope: "business", query: "in:inbox", maxMessages: 100, archiveOlderThanDays: 30, trashOlderThanDays: null });
      const cand = (await db.query<{ id: string }>("SELECT id FROM unsubscribe_candidates")).rows[0]!;
      const posts: { url: string; body: string }[] = [];
      const fetchOk = (async (url: string, init: RequestInit) => {
        posts.push({ url, body: String(init.body) });
        return new Response("", { status: 200 });
      }) as unknown as typeof fetch;
      await expect(svc.unsubscribe(cand.id, fetchOk, async () => ["93.184.216.34"], "someone-else@x.com")).rejects.toThrow(/Sender mismatch/);
      expect(await svc.unsubscribe(cand.id, fetchOk, async () => ["10.0.0.8"], "deals@shop.example")).toMatch(/Refused/);
      expect(posts).toHaveLength(0);
      await db.query("UPDATE unsubscribe_candidates SET status = 'suggested'");
      expect(await svc.unsubscribe(cand.id, fetchOk, async () => ["93.184.216.34"], "deals@shop.example")).toMatch(/Unsubscribed from deals@shop.example/);
      expect(posts).toEqual([{ url: "https://shop.example/u/1", body: "List-Unsubscribe=One-Click" }]);
    });
  });

  // ---------------- Clients & timeline ----------------
  describe("client relationships", () => {
    it("auto-links exact matches, queues uncertain ones, and links after owner confirmation", async () => {
      const { client } = await clients.upsertClient({ name: "Acme Rentals", emails: ["nicole@acmerentals.com"], domains: ["acmerentals.com"], phones: ["313-555-0101"] });
      expect((await clients.resolve({ email: "Nicole@AcmeRentals.com", source: "t" })).clientId).toBe(client.id);
      expect((await clients.resolve({ phone: "+1 313 555 0101", source: "t" })).clientId).toBe(client.id);
      const unsure = await clients.resolve({ email: "accounts@acmerentals.com", source: "gmail" });
      expect(unsure.clientId).toBeNull();
      const [s] = await clients.pendingSuggestions();
      expect(s).toMatchObject({ value: "accounts@acmerentals.com", client_name: "Acme Rentals" });
      expect(await clients.decideSuggestion(s!.id, true)).toMatch(/Linked/);
      expect((await clients.resolve({ email: "accounts@acmerentals.com", source: "gmail" })).clientId).toBe(client.id);
    });

    it("refuses to give one identifier to two clients", async () => {
      await clients.upsertClient({ name: "A", emails: ["shared@x.com"] });
      const r = await clients.upsertClient({ name: "B", emails: ["shared@x.com"] });
      expect(r.conflicts[0]).toMatch(/already belongs to another client/);
    });

    it("tracks unanswered requests, replies, and outbound status (draft → sent → replied)", async () => {
      const { client } = await clients.upsertClient({ name: "Acme Rentals", emails: ["nicole@acmerentals.com"] });
      await clients.recordEvent(client.id, { at: new Date(daysAgo(2)), kind: "email", direction: "in", source: "gmail", externalId: "e1", summary: "Can you add unit 5?", requiresResponse: true });
      expect((await clients.unanswered(24)).map((x) => x.summary)).toEqual(["Can you add unit 5?"]);
      const out = await clients.recordOutbound({ clientId: client.id, channel: "email", to: "nicole@acmerentals.com", subject: "Re: unit 5", body: "Yes", status: "sent" });
      await clients.recordEvent(client.id, { at: new Date(daysAgo(1)), kind: "email", direction: "out", source: "gmail", externalId: "e2", summary: "Re: unit 5" });
      expect(await clients.unanswered(24)).toHaveLength(0);
      await db.query("UPDATE outbound_messages SET sent_at = $2 WHERE id = $1", [out, new Date(daysAgo(1))]);
      await clients.recordEvent(client.id, { at: new Date(), kind: "email", direction: "in", source: "gmail", externalId: "e3", summary: "Thanks!" });
      expect((await clients.outboundHistory(client.id))[0]!.status).toBe("replied");
    });

    it("syncs Gmail: stores only client mail, flags requests, and confirms drafts as sent", async () => {
      const { client } = await clients.upsertClient({ name: "Acme Rentals", emails: ["nicole@acmerentals.com"] });
      await clients.recordOutbound({ clientId: client.id, channel: "email", to: "nicole@acmerentals.com", subject: "Quote for unit 5", body: "...", status: "draft" });
      const mb = new FakeMailbox();
      mb.add({ id: "in1", labelIds: ["INBOX"], from: "Nicole <nicole@acmerentals.com>", subject: "Can you quote unit 5?", snippet: "Need it by Friday", internalDate: daysAgo(3) });
      mb.add({ id: "x1", labelIds: ["INBOX"], from: "Friend <pal@gmail.com>", subject: "Dinner?", internalDate: daysAgo(1) });
      mb.add({ id: "out1", labelIds: ["SENT"], from: "me@lyons.example", to: "Nicole <nicole@acmerentals.com>", subject: "Quote for unit 5", internalDate: daysAgo(1) });
      const s = await new ClientSync(clients, store).syncMail(mb, "business");
      expect(s).toMatchObject({ scanned: 3, linked: 2, unmatched: 1, newEvents: 2, outboundMarkedSent: 1 });
      const tl = await clients.timeline(client.id);
      expect(tl.map((e) => e.summary)).toEqual(["Quote for unit 5", "Can you quote unit 5? — Need it by Friday"]);
      expect(tl[1]!.responded_at).not.toBeNull(); // the sent quote answered it
      expect(JSON.stringify(await db.query("SELECT * FROM client_events"))).not.toContain("Dinner");
      expect((await new ClientSync(clients, store).syncMail(mb, "business")).newEvents).toBe(0); // idempotent
    });

    it("contacts only enrich known clients", async () => {
      const { client } = await clients.upsertClient({ name: "Acme Rentals", emails: ["nicole@acmerentals.com"] });
      const r = await new ClientSync(clients, store).syncContacts({
        list: async () => [
          { resourceName: "people/1", name: "Nicole", emails: ["nicole@acmerentals.com"], phones: ["(313) 555-0199"] },
          { resourceName: "people/2", name: "Mom", emails: ["mom@gmail.com"], phones: ["(313) 555-0000"] },
        ],
      });
      expect(r.enriched).toBe(1);
      expect((await clients.resolve({ phone: "3135550199", source: "t" })).clientId).toBe(client.id);
      expect((await clients.resolve({ phone: "3135550000", source: "t" })).clientId).toBeNull();
    });
  });

  // ---------------- Automation policies ----------------
  describe("automation policies", () => {
    function sendTool(policies: AutomationPolicies, sent: string[]): ToolDefinition<{ to: string; subject: string }> {
      return {
        name: "send_test",
        description: "send",
        input: z.object({ to: z.string(), subject: z.string() }),
        risk: "external_communication",
        idempotent: false,
        describeAction: (i) => `send ${i.subject} to ${i.to}`,
        autoApprove: (i) => policies.covers("email", i.to, i.subject),
        async run(i) {
          sent.push(i.to);
          await clients.recordOutbound({ clientId: null, channel: "email", to: i.to, subject: i.subject, body: "b", status: "sent", policyId: (await policies.covers("email", i.to, i.subject)) ?? undefined });
          return { content: "sent" };
        },
      };
    }

    async function runTask(policies: AutomationPolicies, sent: string[], to: string, subject: string) {
      const tools = new ToolRegistry().register(sendTool(policies, sent));
      const agents = new AgentRegistry().register({ name: "chief_of_staff", description: "", instructions: "", tools: ["send_test"] });
      const llm = new FakeLlm([toolUseResponse(`tu_${to}_${subject}_${Math.random()}`, "send_test", { to, subject }), textResponse("done")]);
      const runner = new TaskRunner({ store, llm, tools, agents, notifier, config: testConfig(), log: silentLog, workerId: "w" });
      const worker = new Worker({ store, runner, notifier, log: silentLog, workerId: "w", concurrency: 1, taskTimeoutMs: 60_000 });
      const task = await store.createTask({ title: "t", input: "t", scope: "business", source: "system" });
      await worker.tick();
      await worker.drain();
      return { task: (await store.getTask(task.id))!, llm };
    }

    it("requires approval until the OWNER activates a narrowly scoped policy, then enforces its cap", async () => {
      const policies = new AutomationPolicies(db, store, "America/New_York");
      const sent: string[] = [];
      const p = await policies.propose({ name: "Turnover confirmations", channel: "email", description: "Confirm next-day turnovers to Acme", rules: { recipients: ["nicole@acmerentals.com"], maxPerDay: 1, subjectPrefix: "Turnover confirmed" } }, "agent");
      expect("id" in p).toBe(true);

      expect((await runTask(policies, sent, "nicole@acmerentals.com", "Turnover confirmed: Unit 4")).task.status).toBe("awaiting_approval"); // proposed ≠ active
      await policies.setStatus((p as { id: string }).id, "active", "owner");

      const ok = await runTask(policies, sent, "nicole@acmerentals.com", "Turnover confirmed: Unit 5");
      expect(ok.task.status).toBe("completed");
      expect(sent).toEqual(["nicole@acmerentals.com"]);
      expect((await store.auditForTask(ok.task.id)).map((e) => e.event)).toContain("approval.by_policy");

      expect((await runTask(policies, sent, "nicole@acmerentals.com", "Turnover confirmed: Unit 6")).task.status).toBe("awaiting_approval"); // daily cap
      expect((await runTask(policies, sent, "other@acmerentals.com", "Turnover confirmed: Unit 7")).task.status).toBe("awaiting_approval"); // not a listed recipient
      expect((await runTask(policies, sent, "nicole@acmerentals.com", "Can we chat?")).task.status).toBe("awaiting_approval"); // wrong subject
    });
  });

  // ---------------- Bridges & receptionist over HTTP ----------------
  describe("HTTP endpoints", () => {
    const SECRET = "bridge-secret";
    const TWILIO = "twilio-auth-token";
    const config = testConfig({ MAC_BRIDGE_SECRET: SECRET, RECEPTIONIST_ENABLED: "true", TWILIO_AUTH_TOKEN: TWILIO, OWNER_PHONE: "+13135550100", PUBLIC_BASE_URL: "https://agent.example.com" });

    function server(llm = new FakeLlm([])) {
      const app = buildServer({ config, store, google: new GoogleAuthManager(config, store, new SecretBox(config.MASTER_ENCRYPTION_KEY)), agents: defaultAgents(), notifier });
      registerIMessageBridge(app, { config, store, clients, notifier });
      registerStorageBridge(app, { config, store });
      registerReceptionist(app, { config, store, clients, notifier, llm, log: silentLog });
      return app;
    }
    const signed = (body?: unknown) => {
      const raw = body === undefined ? "" : JSON.stringify(body);
      const ts = Math.floor(Date.now() / 1000);
      return { payload: raw || undefined, headers: { "content-type": "application/json", "x-lyons-timestamp": String(ts), "x-lyons-signature": signWebhook(SECRET, ts, raw) } };
    };
    const voice = (app: ReturnType<typeof server>, path: string, params: Record<string, string>, sig?: string) =>
      app.inject({
        method: "POST",
        url: path,
        payload: new URLSearchParams(params).toString(),
        headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": sig ?? twilioSignature(TWILIO, `https://agent.example.com${path}`, params) },
      });

    it("iMessage bridge: auth, client-only uploads, outbox respects pauses, acks record delivery", async () => {
      const app = server();
      const { client } = await clients.upsertClient({ name: "Acme Rentals", phones: ["313-555-0101"] });
      expect((await app.inject({ method: "GET", url: "/bridge/imessage/handles" })).statusCode).toBe(401);
      expect((await app.inject({ method: "GET", url: "/bridge/imessage/handles", ...signed() })).json()).toEqual({ handles: ["+13135550101"] });

      const up = await app.inject({
        method: "POST",
        url: "/bridge/imessage/inbound",
        ...signed({
          messages: [
            { guid: "g1", handle: "+13135550101", from_me: false, text: "Can you come Friday?", sent_at: new Date().toISOString() },
            { guid: "g2", handle: "+13135559999", from_me: false, text: "private chat", sent_at: new Date().toISOString() },
          ],
        }),
      });
      expect(up.json()).toEqual({ stored: 1, ignored: 1 });
      expect((await clients.unanswered(0, new Date(Date.now() + 1000))).map((u) => u.summary)).toEqual(["Can you come Friday?"]);

      const id = await clients.recordOutbound({ clientId: client.id, channel: "imessage", to: "+13135550101", body: "Yes, see you Friday", status: "queued" });
      await store.setModulePaused("communications", true, "owner");
      expect((await app.inject({ method: "GET", url: "/bridge/imessage/outbox", ...signed() })).json()).toEqual({ messages: [] });
      await store.setModulePaused("communications", false, "owner");
      expect((await app.inject({ method: "GET", url: "/bridge/imessage/outbox", ...signed() })).json().messages).toHaveLength(1);

      await app.inject({ method: "POST", url: "/bridge/imessage/ack", ...signed({ id, ok: true }) });
      expect((await clients.outboundHistory(client.id))[0]!.status).toBe("sent");
      expect(await clients.unanswered(0, new Date(Date.now() + 1000))).toHaveLength(0); // our reply answered it
      const id2 = await clients.recordOutbound({ clientId: client.id, channel: "imessage", to: "+13135550101", body: "x", status: "queued" });
      await app.inject({ method: "POST", url: "/bridge/imessage/ack", ...signed({ id: id2, ok: false, error: "not signed in" }) });
      expect(notifier.messages.at(-1)).toMatch(/was NOT sent: not signed in/);
    });

    it("storage: report upload, approval-gated tool validates paths, bridge pulls and acks", async () => {
      const app = server();
      const hash = "a".repeat(64);
      const rep = await app.inject({
        method: "POST",
        url: "/bridge/storage/report",
        ...signed({ device: "MacBook", summary: { scanned_files: 10, scanned_bytes: 5e9, duplicate_groups: 1, reclaimable_bytes: 2e9, roots: ["/Users/me/Downloads"] }, groups: [{ hash, size: 2e9, paths: ["/a/movie.mp4", "/b/movie copy.mp4"] }] }),
      });
      const reportId = rep.json().id;
      const [report, trash] = storageTools(store);
      expect(trash!.risk).toBe("destructive"); // always needs approval
      const ctx = { store } as never;
      expect((await report!.run({ limit: 5 }, ctx)).content).toMatch(/1\.9 GB reclaimable/);
      expect((await trash!.run({ report_id: reportId, group_hash: hash, keep_path: "/a/movie.mp4", trash_paths: ["/etc/passwd"] }, ctx)).isError).toBe(true);
      expect((await trash!.run({ report_id: reportId, group_hash: hash, keep_path: "/a/movie.mp4", trash_paths: ["/a/movie.mp4"] }, ctx)).isError).toBe(true);
      await trash!.run({ report_id: reportId, group_hash: hash, keep_path: "/a/movie.mp4", trash_paths: ["/b/movie copy.mp4"] }, ctx);
      const actions = (await app.inject({ method: "GET", url: "/bridge/storage/actions", ...signed() })).json().actions;
      expect(actions).toHaveLength(1);
      await app.inject({ method: "POST", url: "/bridge/storage/ack", ...signed({ id: actions[0].id, moved: ["/b/movie copy.mp4"], skipped: [] }) });
      expect((await db.query("SELECT status FROM storage_actions")).rows[0].status).toBe("done");
    });

    it("receptionist: rejects unsigned requests and discloses AI + transcription on answer", async () => {
      const app = server();
      expect((await voice(app, "/voice/incoming", { CallSid: "CA1", From: "+13135550101" }, "bad")).statusCode).toBe(403);
      const r = await voice(app, "/voice/incoming", { CallSid: "CA1", From: "+13135550101", To: "+13135550000" });
      expect(r.headers["content-type"]).toMatch(/text\/xml/);
      expect(r.body).toMatch(/automated AI assistant, and this call is transcribed/);
      expect(r.body).toMatch(/<Gather input="speech" action="\/voice\/gather"/);
    });

    it("receptionist: filters invented prices, captures details, and summarises to the owner", async () => {
      const llm = new FakeLlm([
        () => ({
          content: [{ type: "text", text: '{"reply":"Sure! A move-out clean is $300. What is your name?","intent":"quote_request","done":false,"escalate":false,"captured":{"service":"move-out clean"}}' }],
          stop_reason: "end_turn",
          usage: { input_tokens: 10, output_tokens: 10 },
          model: "claude-opus-5-5",
        }) as never,
        () => ({
          content: [{ type: "text", text: '{"reply":"Thanks Dana, the owner will call you back to confirm. Goodbye!","intent":"quote_request","done":true,"escalate":false,"captured":{"name":"Dana","callback_number":"313-555-0123","preferred_times":"weekday mornings"}}' }],
          stop_reason: "end_turn",
          usage: { input_tokens: 10, output_tokens: 10 },
          model: "claude-opus-5-5",
        }) as never,
      ]);
      const app = server(llm);
      await voice(app, "/voice/incoming", { CallSid: "CA2", From: "+13135550123" });
      const t1 = await voice(app, "/voice/gather", { CallSid: "CA2", SpeechResult: "How much for a move out clean" });
      expect(t1.body).not.toMatch(/\$300/);
      expect(t1.body).toMatch(/owner will follow up with an exact quote/);
      const t2 = await voice(app, "/voice/gather", { CallSid: "CA2", SpeechResult: "Dana, 313 555 0123, weekday mornings" });
      expect(t2.body).toMatch(/<Hangup\/>/);
      const call = (await db.query("SELECT * FROM calls WHERE call_sid = 'CA2'")).rows[0];
      expect(call).toMatchObject({ status: "completed", intent: "quote_request", owner_notified: true });
      expect(call.captured).toMatchObject({ service: "move-out clean", name: "Dana", preferred_times: "weekday mornings" });
      expect(call.guard_events).toEqual(["price"]);
      const summary = notifier.messages.at(-1)!;
      expect(summary).toMatch(/Call from \+13135550123/);
      expect(summary).toMatch(/Needs: move-out clean/);
      expect(summary).toMatch(/Safety filter replaced 1/);
      expect(summary).toMatch(/Nothing was promised/);
    });

    it("receptionist: escalates emergencies to the owner's phone without calling the model", async () => {
      const llm = new FakeLlm([]);
      const app = server(llm);
      await voice(app, "/voice/incoming", { CallSid: "CA3", From: "+13135550124" });
      const r = await voice(app, "/voice/gather", { CallSid: "CA3", SpeechResult: "There's a flood in the unit, it's an emergency" });
      expect(r.body).toMatch(/<Dial timeout="20" action="\/voice\/dial-result" method="POST">\+13135550100<\/Dial>/);
      expect(llm.calls).toHaveLength(0);
      expect(notifier.messages.some((m) => m.startsWith("🚨"))).toBe(true);
      const missed = await voice(app, "/voice/dial-result", { CallSid: "CA3", DialCallStatus: "no-answer" });
      expect(missed.body).toMatch(/<Record /);
    });

    it("receptionist: goes straight to voicemail when paused, and is off unless enabled", async () => {
      await store.setModulePaused("receptionist", true, "owner");
      const app = server();
      const r = await voice(app, "/voice/incoming", { CallSid: "CA4", From: "+13135550125" });
      expect(r.body).toMatch(/<Record /);
      expect(r.body).not.toMatch(/<Gather/);
      const off = buildServer({ config: testConfig(), store, google: new GoogleAuthManager(testConfig(), store, new SecretBox(config.MASTER_ENCRYPTION_KEY)), agents: defaultAgents(), notifier });
      registerReceptionist(off, { config: testConfig(), store, clients, notifier, llm: new FakeLlm([]), log: silentLog });
      expect((await off.inject({ method: "POST", url: "/voice/incoming", payload: "CallSid=x", headers: { "content-type": "application/x-www-form-urlencoded" } })).statusCode).toBe(404);
    });
  });

  it("software engineer agent cannot see client, message, or personal data tools", () => {
    const eng = defaultAgents().get("software_engineer")!;
    expect(eng.dataAccess).toEqual(["public", "business_internal"]);
    expect(eng.tools).not.toEqual(expect.arrayContaining(["client_timeline"]));
    void lastToolResult;
  });
});

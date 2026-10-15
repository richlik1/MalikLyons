import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { defaultAgents } from "../../src/agents/index.js";
import type { Db } from "../../src/db/pool.js";
import { Store } from "../../src/db/store.js";
import { esc, SessionSigner } from "../../src/http/control-center.js";
import { buildServer } from "../../src/http/server.js";
import { GoogleAuthManager } from "../../src/integrations/google/oauth.js";
import { SecretBox } from "../../src/security/crypto.js";
import { freshDb, hasDb, RecordingNotifier, resetData, testConfig } from "../helpers.js";

const TOKEN = "correct-horse-battery-staple-0123456789";

describe("Control Center helpers", () => {
  it("escapes HTML", () => {
    expect(esc(`<img src=x onerror="alert(1)">'`)).toBe("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&#39;");
  });
  it("invalidates sessions when the access token is rotated", () => {
    const key = Buffer.alloc(32, 7).toString("base64");
    const c = new SessionSigner(key, "old-token").issue(1000);
    expect(new SessionSigner(key, "old-token").verify(c, 2000)).not.toBeNull();
    expect(new SessionSigner(key, "new-token").verify(c, 2000)).toBeNull();
  });

  it("signs sessions, rejects tampering and expiry", () => {
    const s = new SessionSigner(Buffer.alloc(32, 7).toString("base64"));
    const c = s.issue(1000);
    expect(s.verify(c, 2000)).toBe(c.split(".")[0]);
    expect(s.verify(c.replace(/.$/, "x"), 2000)).toBeNull();
    expect(s.verify(c, 1000 + 13 * 3_600_000)).toBeNull();
  });
});

describe.skipIf(!hasDb)("Control Center (Postgres)", () => {
  let db: Db;
  let store: Store;
  const config = testConfig({ CONTROL_CENTER_TOKEN: TOKEN });

  beforeAll(async () => {
    db = await freshDb();
    store = new Store(db);
  });
  afterAll(async () => db?.end());
  beforeEach(() => resetData(db));

  const server = (cfg = config) =>
    buildServer({
      config: cfg,
      store,
      google: new GoogleAuthManager(cfg, store, new SecretBox(cfg.MASTER_ENCRYPTION_KEY)),
      agents: defaultAgents(),
      notifier: new RecordingNotifier(),
      sections: [{ id: "x", title: "Injected <section>", render: async () => `<p>${esc("<script>bad()</script>")}</p>` }],
    });

  async function login(app: ReturnType<typeof server>) {
    const res = await app.inject({ method: "POST", url: "/control/login", payload: `token=${TOKEN}`, headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(res.statusCode).toBe(302);
    const cookie = String(res.headers["set-cookie"]).split(";")[0]!;
    expect(String(res.headers["set-cookie"])).toMatch(/HttpOnly; SameSite=Strict/);
    const pageRes = await app.inject({ method: "GET", url: "/control", headers: { cookie } });
    const csrf = /name="csrf" value="([^"]+)"/.exec(pageRes.body)![1]!;
    return { cookie, csrf, page: pageRes.body };
  }

  const post = (app: ReturnType<typeof server>, url: string, cookie: string, form: Record<string, string>) =>
    app.inject({ method: "POST", url, payload: new URLSearchParams(form).toString(), headers: { cookie, "content-type": "application/x-www-form-urlencoded" } });

  it("is disabled without a token, and redirects unauthenticated users to login", async () => {
    const off = await server(testConfig()).inject({ method: "GET", url: "/control" });
    expect(off.statusCode).toBe(503);
    const res = await server().inject({ method: "GET", url: "/control" });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/control/login");
  });

  it("rejects a wrong token and locks out after repeated failures", async () => {
    const app = server();
    for (let i = 0; i < 5; i++) {
      const r = await app.inject({ method: "POST", url: "/control/login", payload: "token=wrong", headers: { "content-type": "application/x-www-form-urlencoded" } });
      expect(r.statusCode).toBe(401);
    }
    const locked = await app.inject({ method: "POST", url: "/control/login", payload: `token=${TOKEN}`, headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(locked.statusCode).toBe(429);
  });

  it("renders the dashboard with escaped section content", async () => {
    const { page } = await login(server());
    expect(page).toContain("EMERGENCY STOP");
    expect(page).toContain("Opportunity Intelligence");
    expect(page).toContain("Injected &lt;section&gt;");
    expect(page).not.toContain("<script>bad()");
  });

  it("requires CSRF on every action", async () => {
    const app = server();
    const { cookie } = await login(app);
    const r = await post(app, "/control/stop", cookie, { csrf: "forged" });
    expect(r.statusCode).toBe(403);
    expect(await store.isPaused()).toBe(false);
  });

  it("emergency stop, resume, and per-module pause work and are audited", async () => {
    const app = server();
    const { cookie, csrf } = await login(app);
    expect((await post(app, "/control/stop", cookie, { csrf })).statusCode).toBe(302);
    expect(await store.isPaused()).toBe(true);
    await post(app, "/control/resume", cookie, { csrf });
    expect(await store.isPaused()).toBe(false);
    await post(app, "/control/module", cookie, { csrf, module: "gmail_cleanup", paused: "true" });
    expect(await store.isModulePaused("gmail_cleanup")).toBe(true);
    expect((await post(app, "/control/module", cookie, { csrf, module: "nope", paused: "true" })).statusCode).toBe(400);
    const events = (await store.recentAudit(10)).map((e) => e.event);
    expect(events).toEqual(expect.arrayContaining(["kill_switch.on", "kill_switch.off", "module.paused", "control.login"]));
  });

  it("decides approvals from the dashboard", async () => {
    const task = await store.createTask({ title: "t", input: "t", scope: "business", source: "system" });
    const call = await store.upsertToolCall({ taskId: task.id, toolUseId: "tu", toolName: "x", input: {}, risk: "external_communication", decision: "require_approval", status: "awaiting_approval" });
    const approval = await store.createApproval({ taskId: task.id, toolCallId: call.id, summary: "Send <b>invite</b>", expiresAt: new Date(Date.now() + 3_600_000) });
    await db.query("UPDATE tasks SET status = 'awaiting_approval' WHERE id = $1", [task.id]);
    const app = server();
    const { cookie, csrf, page } = await login(app);
    expect(page).toContain("Send &lt;b&gt;invite&lt;/b&gt;");
    expect((await post(app, "/control/approval", cookie, { csrf, id: approval.id, approve: "false" })).statusCode).toBe(302);
    expect((await store.getApproval(approval.id))!.status).toBe("rejected");
    expect((await post(app, "/control/approval", cookie, { csrf, id: approval.id, approve: "true" })).statusCode).toBe(409);
  });

  it("serves a JSON state snapshot to authenticated clients only", async () => {
    const app = server();
    expect((await app.inject({ method: "GET", url: "/control/api/state" })).statusCode).toBe(302);
    const { cookie } = await login(app);
    const r = await app.inject({ method: "GET", url: "/control/api/state", headers: { cookie } });
    expect(r.json()).toMatchObject({ paused: false, pausedModules: [], pendingApprovals: [] });
  });
});

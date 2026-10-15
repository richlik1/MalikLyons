import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Config } from "../config.js";
import type { TaskRunner } from "../core/runner.js";
import { MODULES, type ModuleName } from "../core/types.js";
import type { Store } from "../db/store.js";

/**
 * Control Center: owner dashboard for approvals, completed actions, active
 * automations, module pauses and the emergency stop.
 *
 * Exposure: bound to the private network only (Caddy does not proxy /control).
 * Reach it via SSH tunnel. Auth: CONTROL_CENTER_TOKEN → signed, HttpOnly,
 * SameSite=Strict session cookie; every POST also carries a CSRF token.
 * All dynamic text is HTML-escaped (titles and subjects are third-party data).
 */

export interface ControlSection {
  id: string;
  title: string;
  /** Returns trusted HTML built with esc() around every dynamic value. */
  render(): Promise<string>;
}

export function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const MODULE_LABELS: Record<ModuleName, string> = {
  core_agent: "Core agent (tasks & tools)",
  opportunities: "Opportunity Intelligence",
  gmail_cleanup: "Gmail cleanup",
  client_relationships: "Client relationships",
  communications: "Communications hub",
  receptionist: "AI receptionist",
  browser: "Browser automation",
  device_storage: "Device & storage",
};

const SESSION_TTL_MS = 12 * 3_600_000;

export class SessionSigner {
  private readonly key: Buffer;
  constructor(masterKeyB64: string) {
    this.key = createHmac("sha256", Buffer.from(masterKeyB64, "base64")).update("lyons-control-center-v1").digest();
  }
  private mac(s: string): string {
    return createHmac("sha256", this.key).update(s).digest("base64url");
  }
  issue(now = Date.now()): string {
    const exp = String(now + SESSION_TTL_MS);
    return `${exp}.${this.mac(exp)}`;
  }
  verify(cookie: string | undefined, now = Date.now()): string | null {
    if (!cookie) return null;
    const [exp, sig] = cookie.split(".");
    if (!exp || !sig || Number(exp) < now) return null;
    const expected = Buffer.from(this.mac(exp));
    const given = Buffer.from(sig);
    return expected.length === given.length && timingSafeEqual(expected, given) ? exp : null;
  }
  csrf(sessionExp: string): string {
    return this.mac(`csrf:${sessionExp}`);
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const STYLE = `
:root{--bg:#f6f7f9;--card:#fff;--ink:#14171c;--muted:#5d6673;--line:#e3e6ea;--accent:#1f6feb;--ok:#1a7f37;--warn:#9a6700;--bad:#cf222e}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--card:#161b22;--ink:#e6edf3;--muted:#8b949e;--line:#30363d;--accent:#4493f8;--ok:#3fb950;--warn:#d29922;--bad:#f85149}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
header{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:16px;border-bottom:1px solid var(--line);background:var(--card);position:sticky;top:0}
h1{font-size:18px;margin:0;letter-spacing:.2px}h2{font-size:15px;margin:0 0 10px}
main{max-width:1100px;margin:0 auto;padding:16px;display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(320px,1fr))}
section{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;min-width:0}
.wide{grid-column:1/-1}.muted{color:var(--muted)}.pill{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;border:1px solid var(--line)}
.ok{color:var(--ok)}.warn{color:var(--warn)}.bad{color:var(--bad)}
table{width:100%;border-collapse:collapse;font-size:13px}td,th{text-align:left;padding:6px 4px;border-top:1px solid var(--line);vertical-align:top;overflow-wrap:anywhere}
button{font:inherit;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--ink);padding:5px 10px;cursor:pointer}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff}button.danger{background:var(--bad);border-color:var(--bad);color:#fff;font-weight:600}
form.inline{display:inline}.row{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;border-top:1px solid var(--line)}
.row:first-of-type{border-top:0}input{font:inherit;padding:8px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--ink);width:100%}
`;

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)}</title><style>${STYLE}</style></head><body>${body}</body></html>`;
}

export function registerControlCenter(
  app: FastifyInstance,
  d: { config: Config; store: Store; runner?: TaskRunner; sections?: ControlSection[] },
): void {
  const { config, store } = d;
  const token = config.CONTROL_CENTER_TOKEN;
  const signer = new SessionSigner(config.MASTER_ENCRYPTION_KEY);
  const failures = { count: 0, since: Date.now() };
  const secureCookie = config.PUBLIC_BASE_URL.startsWith("https://");

  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  const session = (req: FastifyRequest) => signer.verify(parseCookies(req.headers.cookie).lc_session);

  const guard = async (req: FastifyRequest, res: FastifyReply): Promise<string | null> => {
    if (!token) {
      res.code(503).type("text/html").send(page("Control Center", `<main><section class="wide"><h2>Control Center disabled</h2><p>Set CONTROL_CENTER_TOKEN on the server to enable it.</p></section></main>`));
      return null;
    }
    const exp = session(req);
    if (!exp) {
      res.redirect("/control/login");
      return null;
    }
    if (req.method === "POST") {
      const body = (req.body ?? {}) as Record<string, string>;
      if (!body.csrf || !safeEqual(body.csrf, signer.csrf(exp))) {
        res.code(403).send("Invalid CSRF token");
        return null;
      }
    }
    return exp;
  };

  app.get("/control/login", async (_req, res) => {
    res.type("text/html").send(
      page(
        "LYONS AI — Sign in",
        `<main><section class="wide" style="max-width:420px;margin:40px auto"><h2>LYONS AI Control Center</h2>
        <form method="post" action="/control/login"><p><input type="password" name="token" placeholder="Access token" autocomplete="current-password" required></p>
        <button class="primary" type="submit">Sign in</button></form></section></main>`,
      ),
    );
  });

  app.post("/control/login", async (req, res) => {
    if (!token) return res.code(503).send("disabled");
    if (Date.now() - failures.since > 15 * 60_000) Object.assign(failures, { count: 0, since: Date.now() });
    if (failures.count >= 5) return res.code(429).send("Too many attempts. Try again in 15 minutes.");
    const given = ((req.body ?? {}) as Record<string, string>).token ?? "";
    if (!safeEqual(given, token)) {
      failures.count++;
      await store.audit("control_center", "control.login_failed", null, {});
      return res.code(401).type("text/html").send(page("Sign in failed", `<main><section class="wide"><p>Wrong token. <a href="/control/login">Try again</a></p></section></main>`));
    }
    await store.audit("owner", "control.login", null, {});
    res.header("set-cookie", `lc_session=${encodeURIComponent(signer.issue())}; Path=/control; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}${secureCookie ? "; Secure" : ""}`);
    return res.redirect("/control");
  });

  app.get("/control", async (req, res) => {
    const exp = await guard(req, res);
    if (!exp) return;
    const csrf = signer.csrf(exp);
    const hidden = `<input type="hidden" name="csrf" value="${esc(csrf)}">`;
    const [paused, pausedModules, spend, pending, open, audit] = await Promise.all([
      store.isPaused(),
      store.pausedModules(),
      store.spendToday(config.TIMEZONE),
      store.pendingApprovals(),
      store.openTasks(),
      store.recentAudit(25),
    ]);

    const stop = paused
      ? `<form class="inline" method="post" action="/control/resume">${hidden}<button class="primary">Resume all autonomous execution</button></form>`
      : `<form class="inline" method="post" action="/control/stop" onsubmit="return confirm('Stop ALL autonomous execution now?')">${hidden}<button class="danger">EMERGENCY STOP</button></form>`;

    const modules = MODULES.map((m) => {
      const isPaused = pausedModules.includes(m);
      return `<div class="row"><span>${esc(MODULE_LABELS[m])} <span class="pill ${isPaused ? "warn" : "ok"}">${isPaused ? "paused" : "active"}</span></span>
        <form class="inline" method="post" action="/control/module">${hidden}<input type="hidden" name="module" value="${esc(m)}"><input type="hidden" name="paused" value="${isPaused ? "false" : "true"}">
        <button>${isPaused ? "Resume" : "Pause"}</button></form></div>`;
    }).join("");

    const approvals = pending.length
      ? pending
          .map(
            (a) => `<div class="row"><span>${esc(a.summary)}<br><span class="muted">task ${esc(a.task_id.slice(0, 8))} · expires ${esc(a.expires_at.toISOString().slice(0, 16).replace("T", " "))} UTC</span></span>
          <span><form class="inline" method="post" action="/control/approval">${hidden}<input type="hidden" name="id" value="${esc(a.id)}"><input type="hidden" name="approve" value="true"><button class="primary">Approve</button></form>
          <form class="inline" method="post" action="/control/approval">${hidden}<input type="hidden" name="id" value="${esc(a.id)}"><input type="hidden" name="approve" value="false"><button>Reject</button></form></span></div>`,
          )
          .join("")
      : `<p class="muted">Nothing waiting for you.</p>`;

    const tasks = open.length
      ? `<table><tr><th>Task</th><th>Status</th><th>Scope</th></tr>${open
          .map((t) => `<tr><td>${esc(t.title)}</td><td>${esc(t.status)}</td><td>${esc(t.scope)}</td></tr>`)
          .join("")}</table>`
      : `<p class="muted">No running or queued tasks.</p>`;

    const log = `<table><tr><th>When (UTC)</th><th>Who</th><th>Event</th><th>Details</th></tr>${audit
      .map(
        (e) =>
          `<tr><td>${esc(e.at.toISOString().slice(5, 16).replace("T", " "))}</td><td>${esc(e.actor)}</td><td>${esc(e.event)}</td><td class="muted">${esc(JSON.stringify(e.details).slice(0, 160))}</td></tr>`,
      )
      .join("")}</table>`;

    const extra = await Promise.all(
      (d.sections ?? []).map(async (s) => {
        try {
          return `<section id="${esc(s.id)}"><h2>${esc(s.title)}</h2>${await s.render()}</section>`;
        } catch (err) {
          return `<section id="${esc(s.id)}"><h2>${esc(s.title)}</h2><p class="bad">Failed to load: ${esc((err as Error).message)}</p></section>`;
        }
      }),
    );

    res.type("text/html").header("cache-control", "no-store").send(
      page(
        "LYONS AI Control Center",
        `<header><h1>LYONS AI <span class="muted">Control Center</span></h1><div>${stop}</div></header>
        <main>
          <section class="wide"><h2>Status</h2><p>Autonomous execution: ${paused ? '<b class="bad">STOPPED</b>' : '<b class="ok">running</b>'} ·
            Spend today: <b>$${spend.toFixed(2)}</b> / $${config.DAILY_SPEND_LIMIT_USD} · Pending approvals: <b>${pending.length}</b> · Open tasks: <b>${open.length}</b></p></section>
          <section><h2>Pending approvals</h2>${approvals}</section>
          <section><h2>Modules</h2>${modules}</section>
          <section><h2>Active tasks</h2>${tasks}</section>
          ${extra.join("")}
          <section class="wide"><h2>Action log</h2>${log}<p class="muted">Recovery procedures: docs/RECOVERY.md</p></section>
        </main>`,
      ),
    );
  });

  app.post("/control/stop", async (req, res) => {
    if (!(await guard(req, res))) return;
    await store.setPaused(true, "owner:control_center");
    d.runner?.abortAll("paused");
    return res.redirect("/control");
  });

  app.post("/control/resume", async (req, res) => {
    if (!(await guard(req, res))) return;
    await store.setPaused(false, "owner:control_center");
    return res.redirect("/control");
  });

  app.post("/control/module", async (req, res) => {
    if (!(await guard(req, res))) return;
    const body = req.body as Record<string, string>;
    if (!MODULES.includes(body.module as ModuleName)) return res.code(400).send("unknown module");
    await store.setModulePaused(body.module as ModuleName, body.paused === "true", "owner:control_center");
    return res.redirect("/control");
  });

  app.post("/control/approval", async (req, res) => {
    if (!(await guard(req, res))) return;
    const body = req.body as Record<string, string>;
    const r = await store.decideApproval(body.id ?? "", body.approve === "true", "owner:control_center");
    if (!r.ok) return res.code(409).type("text/html").send(page("Approval", `<main><section class="wide"><p>${esc(r.reason)} <a href="/control">Back</a></p></section></main>`));
    return res.redirect("/control");
  });

  /** JSON snapshot for a future Telegram Mini App / mobile client. */
  app.get("/control/api/state", async (req, res) => {
    if (!(await guard(req, res))) return;
    return {
      paused: await store.isPaused(),
      pausedModules: await store.pausedModules(),
      spendToday: await store.spendToday(config.TIMEZONE),
      pendingApprovals: (await store.pendingApprovals()).map((a) => ({ id: a.id, summary: a.summary, taskId: a.task_id, expiresAt: a.expires_at })),
      openTasks: (await store.openTasks()).map((t) => ({ id: t.id, title: t.title, status: t.status, scope: t.scope })),
    };
  });
}

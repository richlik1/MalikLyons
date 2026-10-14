import { existsSync } from "node:fs";
import { mkdtemp, stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { capturePageSnapshot } from "../../src/integrations/browser/page-snapshot.js";

/**
 * Drives a real headless Chromium against a local web server. Set
 * BROWSER_EXECUTABLE_PATH to a Chromium binary (the Docker image provides one).
 */
const exe = process.env.BROWSER_EXECUTABLE_PATH;
const hasBrowser = Boolean(exe && existsSync(exe));

const PAGES: Record<string, string> = {
  "/": `<html><head><title>Vendor Status</title><script src="http://tracker.invalid/t.js"></script></head>
        <body><h1>All systems operational</h1><p>Next maintenance: Friday 2am.</p><img src="http://cdn.other.test/x.png"></body></html>`,
  "/login": `<html><head><title>Sign in</title></head><body><form><input name="u"><input type="password" name="p"></form></body></html>`,
  "/captcha": `<html><body><h2>Please verify you are human</h2></body></html>`,
  "/redirect-out": "",
};

describe.skipIf(!hasBrowser)("browser page snapshot (real Chromium)", () => {
  let server: Server;
  let base: string;
  let outRoot: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === "/redirect-out") {
        res.writeHead(302, { location: "http://example.org/" }).end();
        return;
      }
      const body = PAGES[req.url ?? "/"];
      if (body === undefined) return void res.writeHead(404).end();
      res.writeHead(200, { "content-type": "text/html" }).end(body);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    base = `http://localhost:${port}`;
    outRoot = await mkdtemp(path.join(tmpdir(), "lyons-browser-"));
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const run = (p: string, allowlist = ["localhost"]) =>
    capturePageSnapshot({ url: `${base}${p}`, allowlist, outDir: path.join(outRoot, p.replace(/\W/g, "_") || "root"), timeoutMs: 20_000, executablePath: exe });

  it("captures text and screenshots, blocking off-allowlist requests", async () => {
    const r = await run("/");
    expect(r.status).toBe("succeeded");
    expect(r.title).toBe("Vendor Status");
    expect(r.text).toContain("All systems operational");
    expect(r.screenshots).toHaveLength(2);
    for (const s of r.screenshots) expect((await stat(s)).size).toBeGreaterThan(1000);
    expect(r.blockedRequests).toBeGreaterThanOrEqual(2);
    expect(r.steps.map((s) => s.action)).toEqual(["navigate", "loaded", "screenshot", "screenshot", "extracted"]);
  });

  it("stops at a login form instead of trying to get past it", async () => {
    const r = await run("/login");
    expect(r.status).toBe("stopped");
    expect(r.reason).toContain("login, MFA, or CAPTCHA");
    expect(r.text).toBe("");
  });

  it("stops at a CAPTCHA / human-verification page", async () => {
    const r = await run("/captcha");
    expect(r.status).toBe("stopped");
  });

  it("refuses URLs outside the allowlist without launching navigation", async () => {
    const r = await run("/", ["example.com"]);
    expect(r.status).toBe("stopped");
    expect(r.steps.map((s) => s.action)).toEqual(["rejected"]);
  });

  it("blocks redirects that leave the allowlist", async () => {
    const r = await run("/redirect-out");
    expect(r.status).not.toBe("succeeded");
  });
});

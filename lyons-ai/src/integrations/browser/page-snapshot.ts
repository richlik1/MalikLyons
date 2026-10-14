import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright-core";
import { z } from "zod";
import type { ToolDefinition } from "../../core/types.js";
import { wrapUntrusted } from "../../security/untrusted.js";

/**
 * Isolated browser workflow: "page snapshot".
 *
 * Opens one allowlisted URL in a fresh, cookie-less, headless browser context,
 * takes screenshots, and extracts visible text. It is read-only by design: it
 * never types, clicks, submits forms, or downloads. If it detects a login, MFA,
 * or CAPTCHA gate it stops and reports back instead of trying to get past it.
 *
 * Every network request (including subresources and redirects) is checked
 * against the domain allowlist and blocked if it does not match.
 */

export function hostAllowed(hostname: string, allowlist: string[]): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  return allowlist.some((d) => h === d || h.endsWith(`.${d}`));
}

export function checkUrl(raw: string, allowlist: string[]): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "Not a valid URL." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, reason: `Protocol ${url.protocol} is not allowed.` };
  if (url.username || url.password) return { ok: false, reason: "URLs with embedded credentials are not allowed." };
  if (!allowlist.length) return { ok: false, reason: "Browser automation is disabled (BROWSER_ALLOWED_DOMAINS is empty)." };
  if (!hostAllowed(url.hostname, allowlist)) return { ok: false, reason: `${url.hostname} is not in BROWSER_ALLOWED_DOMAINS.` };
  return { ok: true, url };
}

export interface SnapshotStep {
  at: string;
  action: string;
  detail?: string;
}

export interface SnapshotResult {
  status: "succeeded" | "stopped" | "failed";
  title: string;
  finalUrl: string;
  text: string;
  screenshots: string[];
  steps: SnapshotStep[];
  blockedRequests: number;
  reason?: string;
}

const GATE_SELECTORS = [
  'input[type="password"]',
  'iframe[src*="recaptcha"]',
  'iframe[src*="hcaptcha"]',
  'iframe[src*="challenges.cloudflare.com"]',
  'input[autocomplete="one-time-code"]',
];
const GATE_TEXT = /(verify (that )?you are (a )?human|are you a robot|enter (the )?(verification|security) code|two-factor|2-step verification)/i;

async function detectGate(page: Page): Promise<string | null> {
  for (const sel of GATE_SELECTORS) {
    if ((await page.locator(sel).count()) > 0) return `Found ${sel}`;
  }
  const body = await page.locator("body").innerText({ timeout: 2000 }).catch(() => "");
  const m = body.match(GATE_TEXT);
  return m ? `Page text: "${m[0]}"` : null;
}

export async function capturePageSnapshot(opts: {
  url: string;
  allowlist: string[];
  outDir: string;
  timeoutMs: number;
  executablePath?: string;
  maxTextChars?: number;
}): Promise<SnapshotResult> {
  const steps: SnapshotStep[] = [];
  const log = (action: string, detail?: string) => steps.push({ at: new Date().toISOString(), action, detail });
  const screenshots: string[] = [];
  let blockedRequests = 0;

  const checked = checkUrl(opts.url, opts.allowlist);
  if (!checked.ok) {
    log("rejected", checked.reason);
    return { status: "stopped", title: "", finalUrl: opts.url, text: "", screenshots, steps, blockedRequests, reason: checked.reason };
  }

  await mkdir(opts.outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: opts.executablePath });
  const deadline = setTimeout(() => void browser.close().catch(() => {}), opts.timeoutMs + 5000);
  try {
    const context = await browser.newContext({
      acceptDownloads: false,
      serviceWorkers: "block",
      permissions: [],
      viewport: { width: 1280, height: 900 },
    });
    await context.route("**/*", (route) => {
      const u = route.request().url();
      if (u.startsWith("data:") || u.startsWith("blob:")) return route.continue();
      try {
        if (hostAllowed(new URL(u).hostname, opts.allowlist)) return route.continue();
      } catch {
        /* fall through */
      }
      blockedRequests++;
      return route.abort("blockedbyclient");
    });
    const page = await context.newPage();
    page.setDefaultTimeout(opts.timeoutMs);
    log("navigate", checked.url.toString());
    const resp = await page.goto(checked.url.toString(), { waitUntil: "domcontentloaded", timeout: opts.timeoutMs });
    await page.waitForLoadState("networkidle", { timeout: Math.min(5000, opts.timeoutMs) }).catch(() => {});
    log("loaded", `HTTP ${resp?.status() ?? "?"} ${page.url()}`);

    const shot = path.join(opts.outDir, "01-loaded.png");
    await page.screenshot({ path: shot, fullPage: false });
    screenshots.push(shot);
    log("screenshot", shot);

    const finalUrl = page.url();
    const title = await page.title();
    const gate = await detectGate(page);
    if (gate) {
      log("stopped", `Access gate detected (${gate}). Not attempting to bypass.`);
      return {
        status: "stopped",
        title,
        finalUrl,
        text: "",
        screenshots,
        steps,
        blockedRequests,
        reason: `The page requires a login, MFA, or CAPTCHA (${gate}). I did not attempt to get past it; this needs the owner.`,
      };
    }
    const fullText = (await page.locator("body").innerText().catch(() => "")).replace(/\n{3,}/g, "\n\n").trim();
    const max = opts.maxTextChars ?? 15_000;
    const fullShot = path.join(opts.outDir, "02-full-page.png");
    await page.screenshot({ path: fullShot, fullPage: true });
    screenshots.push(fullShot);
    log("screenshot", fullShot);
    log("extracted", `${fullText.length} chars`);
    return { status: "succeeded", title, finalUrl, text: fullText.slice(0, max), screenshots, steps, blockedRequests };
  } catch (err) {
    log("error", (err as Error).message);
    return { status: "failed", title: "", finalUrl: opts.url, text: "", screenshots, steps, blockedRequests, reason: (err as Error).message };
  } finally {
    clearTimeout(deadline);
    await browser.close().catch(() => {});
  }
}

export function browserTools(): ToolDefinition[] {
  const input = z.object({ url: z.string().url().max(2000) });
  const tool: ToolDefinition<z.infer<typeof input>> = {
    name: "browser_page_snapshot",
    description:
      "Open an allowlisted web page in an isolated, logged-out browser; return its visible text and save screenshots. Read-only: never logs in, clicks, or submits.",
    input,
    risk: "read",
    idempotent: true,
    describeAction: (i) => `Open ${i.url} in the isolated browser and capture it`,
    async run(i, ctx) {
      const cfg = ctx.config;
      const runId = await ctx.store.createBrowserRun(ctx.taskId, "page_snapshot", i.url);
      const outDir = path.resolve(cfg.ARTIFACTS_DIR, "browser", runId);
      const r = await capturePageSnapshot({
        url: i.url,
        allowlist: cfg.BROWSER_ALLOWED_DOMAINS,
        outDir,
        timeoutMs: cfg.BROWSER_TIMEOUT_MS,
        executablePath: cfg.BROWSER_EXECUTABLE_PATH,
      });
      await ctx.store.finishBrowserRun(runId, r.status, r.screenshots, r.steps, r.reason);
      await ctx.store.audit("agent", `browser.${r.status}`, ctx.taskId, { runId, url: i.url, screenshots: r.screenshots, blockedRequests: r.blockedRequests });
      if (r.status !== "succeeded") return { content: `Browser run ${runId} ${r.status}: ${r.reason}`, isError: r.status === "failed" };
      return {
        content: `Browser run ${runId} succeeded. Title: ${r.title}. Final URL: ${r.finalUrl}. Screenshots saved: ${r.screenshots.length}. Blocked off-allowlist requests: ${r.blockedRequests}.\n${wrapUntrusted(`web:${new URL(r.finalUrl).hostname}`, r.text)}`,
      };
    },
  };
  return [tool];
}

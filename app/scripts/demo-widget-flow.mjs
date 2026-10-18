// DEMO: shows the full "plug into any website" flow on the LOCAL stack.
//  1. A demo merchant store (separate site on http://localhost:4000) with the 2-line widget.
//  2. A shopper clicks "See it on you" → TrendSet try-on opens → photo → result.
//  3. The merchant's API keys panel, the developer docs, and a real REST API call.
// Demo data only; AI output is the FASHN CONTRACT STUB ("STUB OUTPUT — Not AI").
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { chromium } from "playwright-core";
import http from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const APP = "http://127.0.0.1:3123";
const STORE = "http://localhost:4000";
const out = process.argv[2] ?? "demo";
mkdirSync(`${out}/video`, { recursive: true });
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL, ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const svc = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const assets = new URL("./demo-assets/", import.meta.url).pathname;
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

// --- Seed a merchant (owner signs in like a real user)
const email = `owner-${Date.now()}@demo.trendset.test`, password = `demo-${crypto.randomUUID()}`;
const { data: u } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
const jar = new Map();
const sb = createServerClient(URL_, ANON, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (cs) => cs.forEach(({ name, value }) => jar.set(name, value)) } });
await sb.auth.signInWithPassword({ email, password });
const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
const ownerCookies = [...jar].map(([name, value]) => ({ name, value, domain: "127.0.0.1", path: "/" }));
const post = async (path, body) => (await fetch(APP + path, { method: "POST", headers: { origin: APP, cookie, "content-type": "application/json" }, body: JSON.stringify(body) })).json();

const merchant = await post("/api/merchant", { name: "Northside Supply (demo)", websiteUrl: "https://northside.example" });
const products = {};
for (const [name, key, price] of [["Box Hoodie — Olive", "hoodie", "85.00"], ["Heavyweight Tee — Black", "tee", "42.00"], ["Work Jacket — Tan", "jacket", "140.00"], ["Crewneck — Brick", "crew", "72.00"]]) {
  const f = new FormData();
  f.set("name", name); f.set("category", "tops"); f.set("price", price); f.set("purchaseUrl", `https://northside.example/products/${key}`);
  f.set("image", new Blob([readFileSync(`${assets}garment-${key}.png`)], { type: "image/png" }), `${key}.png`);
  products[key] = (await (await fetch(APP + "/api/merchant/products", { method: "POST", headers: { origin: APP, cookie }, body: f })).json()).id;
}
const pk = await post("/api/merchant/api-keys", { kind: "publishable", name: "Website widget", allowedOrigins: [STORE] });
const sk = await post("/api/merchant/api-keys", { kind: "secret", name: "Server API", allowedOrigins: [] });
console.log("merchant", merchant.id, "pk", pk.key.slice(0, 10) + "…", "sk", sk.key.slice(0, 10) + "…");

// --- Demo merchant store (a separate website) with the 2-line TrendSet install
const hoodieImg = svc.storage.from("garments").getPublicUrl((await svc.from("products").select("image_path").eq("id", products.hoodie).single()).data.image_path).data.publicUrl;
const storeHtml = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Northside Supply — Box Hoodie</title>
<style>
 body{margin:0;font-family:Georgia,serif;background:#fff;color:#1d1d1d}
 header{display:flex;justify-content:space-between;align-items:center;padding:18px 40px;border-bottom:1px solid #eee}
 .logo{font-weight:700;letter-spacing:.3em;font-size:18px}
 .demo{background:#fff4d6;color:#7c2d12;font:12px system-ui;padding:6px 40px}
 main{display:grid;grid-template-columns:1.1fr 1fr;gap:48px;padding:40px;max-width:1100px;margin:auto}
 img{width:100%;border-radius:6px;background:#f3f1ea}
 h1{font-size:34px;margin:0 0 8px} .price{font-size:22px;margin-bottom:24px}
 .sizes button{font:14px system-ui;border:1px solid #ccc;background:#fff;padding:10px 14px;margin-right:6px;border-radius:4px}
 .cart{display:block;width:100%;margin-top:24px;padding:16px;font:600 15px system-ui;background:#1d1d1d;color:#fff;border:0;border-radius:4px}
 [data-trendset-product]{display:block;width:100%;margin-top:10px;padding:15px;font:600 15px system-ui;background:#d4ff3a;color:#1a2000;border:0;border-radius:4px;cursor:pointer}
 p{font:15px/1.6 system-ui;color:#555}
</style></head><body>
<div class="demo">DEMO STORE: an example merchant website at a different address, showing how a store installs TrendSet.</div>
<header><div class="logo">NORTHSIDE</div><nav style="font:14px system-ui">Shop · About · Cart (0)</nav></header>
<main>
 <img src="${hoodieImg}" alt="Box Hoodie">
 <div>
  <h1>Box Hoodie — Olive</h1><div class="price">$85.00</div>
  <div class="sizes"><button>S</button><button>M</button><button>L</button><button>XL</button></div>
  <button class="cart">Add to cart</button>
  <!-- TrendSet install: 2 lines -->
  <script src="${APP}/widget.js" data-key="${pk.key}" defer></script>
  <button data-trendset-product="${products.hoodie}">See it on you</button>
  <p>Heavyweight 450gsm fleece, boxy fit, dropped shoulders. Made in small batches.</p>
 </div>
</main></body></html>`;
const store = http.createServer((req, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end(storeHtml); }).listen(4000);
writeFileSync(`${out}/store-install-snippet.html`, storeHtml);

// --- Shopper flow, recorded
const browser = await chromium.launch({ executablePath: CHROME, slowMo: 250 });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: `${out}/video`, size: { width: 1280, height: 800 } } });
const page = await ctx.newPage();
await page.goto(STORE + "/products/hoodie", { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/01-store-with-button.png` });
const [popup] = await Promise.all([ctx.waitForEvent("page"), page.getByText("See it on you").click()]);
await popup.setViewportSize({ width: 480, height: 880 });
popup.on("console", (m) => console.log("[popup console]", m.text()));
await popup.getByText("Virtual try-on · powered by TrendSet").waitFor({ timeout: 20000 }).catch(async (e) => {
  console.log("[popup url]", popup.url());
  console.log("[popup text]", (await popup.locator("body").innerText()).slice(0, 500));
  throw e;
});
await popup.waitForLoadState("networkidle");
await popup.waitForTimeout(800);
await popup.screenshot({ path: `${out}/02-widget-opens.png`, fullPage: true });
await popup.getByRole("checkbox").check();
await popup.locator('input[type="file"]').setInputFiles(`${assets}sample-figure.png`);
await popup.getByText("Use a different photo").waitFor();
await popup.getByRole("button", { name: /Generate try-on/ }).scrollIntoViewIfNeeded();
await popup.waitForTimeout(600);
await popup.getByRole("button", { name: /Generate try-on/ }).click();
await popup.locator("#result-heading").waitFor({ timeout: 30000 });
await popup.locator("#result-heading").scrollIntoViewIfNeeded();
await popup.waitForTimeout(1500);
await popup.screenshot({ path: `${out}/03-widget-result.png`, fullPage: true });
await popup.mouse.wheel(0, 600);
await popup.waitForTimeout(1200);
await ctx.close(); // flushes videos

// --- Merchant: keys panel + developer docs
const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx2.addCookies(ownerCookies);
const p2 = await ctx2.newPage();
await p2.goto(APP + "/studio", { waitUntil: "networkidle" });
const section = p2.locator("section", { has: p2.getByRole("heading", { name: /Website widget/ }) });
await section.locator("summary").click();
await section.screenshot({ path: `${out}/04-studio-api-keys.png` });
await p2.goto(APP + "/developers", { waitUntil: "networkidle" });
await p2.screenshot({ path: `${out}/05-developer-docs.png`, fullPage: true });

// --- Real REST API call with the secret key (server-to-server)
const person = Buffer.from(readFileSync(`${assets}sample-figure.png`)).toString("base64");
const t0 = Date.now();
const apiRes = await fetch(APP + "/api/v1/try-ons", { method: "POST", headers: { authorization: `Bearer ${sk.key}`, "content-type": "application/json" }, body: JSON.stringify({ person_image_base64: person, product_id: products.jacket, external_ref: "order_1042" }) });
const apiBody = await apiRes.json();
const usage = await (await fetch(APP + "/api/v1/usage", { headers: { authorization: `Bearer ${sk.key}` } })).json();
const shortUrl = (u) => (u ? u.replace(/token=[^&]+/, "token=…") : u);
const transcript = `$ curl -X POST ${APP}/api/v1/try-ons \\
    -H "Authorization: Bearer ${sk.key.slice(0, 10)}…" \\
    -H "Content-Type: application/json" \\
    -d '{"person_image_base64":"…","product_id":"${products.jacket}","external_ref":"order_1042"}'

HTTP ${apiRes.status}  (${Date.now() - t0} ms)
${JSON.stringify({ ...apiBody, result_url: shortUrl(apiBody.result_url) }, null, 2)}

$ curl ${APP}/api/v1/usage -H "Authorization: Bearer ${sk.key.slice(0, 10)}…"

${JSON.stringify(usage, null, 2)}`;
writeFileSync(`${out}/api-transcript.txt`, transcript);
const p3 = await ctx2.newPage();
await p3.setViewportSize({ width: 1100, height: 900 });
await p3.setContent(`<html><body style="margin:0;background:#0f1115"><div style="padding:16px 22px;font:13px/1.5 ui-monospace,Menlo,monospace;color:#d6e2ef;white-space:pre-wrap">
<div style="color:#8b98a8;margin-bottom:10px">● ● ●   Terminal — merchant's server calling the TrendSet API (local demo; AI = stub)</div>${transcript.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/(HTTP \d+.*)/, '<span style="color:#d4ff3a">$1</span>')}</div></body></html>`);
await p3.screenshot({ path: `${out}/06-api-call.png`, fullPage: true });
await browser.close();
store.close();
console.log(transcript);

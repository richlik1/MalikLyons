// Seeds DEMO data into the LOCAL stack and captures screenshots of the running app.
// Everything shown is demo/test data; the try-on result comes from the FASHN CONTRACT STUB.
// Usage: (local stack + gateway + stub + app on :3123 running) node scripts/preview-screens.mjs <outDir>
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync } from "node:fs";

const BASE = "http://127.0.0.1:3123";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL, ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
const out = process.argv[2] ?? "preview";
mkdirSync(out, { recursive: true });
const assets = new URL("./demo-assets/", import.meta.url).pathname;
const svc = createClient(URL_, SVC, { auth: { persistSession: false } });

async function user(label, role) {
  const email = `${label}@demo.trendset.test`, password = `demo-${crypto.randomUUID()}`;
  const { data: list } = await svc.auth.admin.listUsers();
  const old = list.users.find((u) => u.email === email);
  if (old) await svc.auth.admin.deleteUser(old.id);
  const { data } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
  if (role) await svc.from("profiles").update({ role }).eq("id", data.user.id);
  const jar = new Map();
  const c = createServerClient(URL_, ANON, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (cs) => cs.forEach(({ name, value }) => jar.set(name, value)) } });
  await c.auth.signInWithPassword({ email, password });
  return { id: data.user.id, cookies: [...jar].map(([name, value]) => ({ name, value, domain: "127.0.0.1", path: "/" })) };
}

// --- Seed
const owner = await user("founder-northside", "merchant");
const shopper = await user("maya", null);
const admin = await user("ops", "admin");
const { data: merchant } = await svc.from("merchants").insert({ owner_id: owner.id, name: "Northside Supply (demo)", website_url: "https://northside.example" }).select("id").single();
const products = [
  ["Box Hoodie — Olive", "hoodie", 8500], ["Heavyweight Tee — Black", "tee", 4200], ["Work Jacket — Tan", "jacket", 14000], ["Crewneck — Brick", "crew", 7200],
];
for (const [name, key, cents] of products) {
  const path = `${owner.id}/${key}.png`;
  await svc.storage.from("garments").upload(path, readFileSync(`${assets}garment-${key}.png`), { contentType: "image/png", upsert: true });
  await svc.from("products").insert({ merchant_id: merchant.id, name, category: "tops", price_cents: cents, purchase_url: `https://northside.example/products/${key}`, image_path: path });
}
await svc.from("pilot_enrollments").insert({ merchant_id: merchant.id, status: "live", start_date: new Date(Date.now() - 9 * 864e5).toISOString().slice(0, 10), products_limit: 20, offered_price_cents: 4900, agreement_signed_at: new Date().toISOString() });
await svc.from("merchant_feedback").insert({ merchant_id: merchant.id, submitted_by: owner.id, pilot_week: 1, likelihood_to_recommend: 7, value_rating: 4, quality_rating: 3, would_pay: "maybe", price_named_cents: 3900, top_issue: "Graphic prints look soft on the tee (demo feedback)" });
await svc.from("experiments").insert({ merchant_id: merchant.id, key: "hoodies-tryon-v1", hypothesis: "Showing try-on on hoodie pages increases add-to-cart", planned_visitors_per_arm: 25740 });

// --- Screens
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const mobile = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const desktop = { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 };
async function shot(ctxOpts, cookies, path, file, prep) {
  const ctx = await browser.newContext(ctxOpts);
  if (cookies) await ctx.addCookies(cookies);
  const page = await ctx.newPage();
  await page.goto(BASE + path, { waitUntil: "networkidle" });
  if (prep) await prep(page);
  await page.screenshot({ path: `${out}/${file}`, fullPage: true });
  await ctx.close();
  console.log("captured", file);
}

await shot(desktop, null, "/", "01-landing-desktop.png");
await shot(mobile, null, "/", "02-landing-mobile.png");
await shot(mobile, shopper.cookies, "/try-on", "03-tryon-consent-mobile.png");

// Full shopper flow in one session: consent → upload → pick garment → generate → result
{
  const ctx = await browser.newContext(mobile);
  await ctx.addCookies(shopper.cookies);
  const page = await ctx.newPage();
  await page.goto(BASE + "/try-on", { waitUntil: "networkidle" });
  await page.getByRole("checkbox").check();
  await page.locator('input[type="file"]').setInputFiles(`${assets}sample-figure.png`);
  await page.getByText("Use a different photo").waitFor();
  await page.getByRole("option").first().click();
  await page.screenshot({ path: `${out}/04-tryon-ready-mobile.png`, fullPage: true });
  console.log("captured 04-tryon-ready-mobile.png");
  await page.getByRole("button", { name: /Generate try-on/ }).click();
  await page.getByRole("heading", { level: 2, name: /Box Hoodie|Heavyweight|Work Jacket|Crewneck/ }).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Save look" }).click();
  await page.getByRole("radio", { name: "4" }).click();
  await page.waitForTimeout(800);
  await page.locator("#result-heading").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/05-tryon-result-mobile.png`, fullPage: true });
  console.log("captured 05-tryon-result-mobile.png");
  await ctx.close();
}
await shot(desktop, shopper.cookies, "/account", "06-account-desktop.png");
await shot(desktop, owner.cookies, "/studio", "07-studio-desktop.png");
await shot(desktop, admin.cookies, "/admin", "08-admin-desktop.png");
await browser.close();

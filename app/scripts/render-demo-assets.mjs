// Renders DEMO illustrations (drawn, not photos) used only to preview the UI locally:
// four garment flat-lays, a drawn sample figure (no real person), and a card the FASHN
// contract stub returns so stub output is visibly "NOT AI".
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const out = new URL("./demo-assets/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const garment = (body, color, label) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1000" width="800" height="1000">
  <rect width="800" height="1000" fill="#f3f1ea"/>
  <g fill="${color}" stroke="#1a1a1a" stroke-width="6" stroke-linejoin="round">${body}</g>
  <text x="400" y="960" font-family="system-ui" font-size="28" text-anchor="middle" fill="#6b6b6b">${label} · demo illustration</text>
</svg>`;

const shapes = {
  hoodie: garment(`<path d="M290 180 Q400 110 510 180 L640 250 L720 520 L640 545 L600 400 L600 840 L200 840 L200 400 L160 545 L80 520 L160 250 Z"/>
    <path d="M330 185 Q400 290 470 185" fill="none"/><rect x="300" y="560" width="200" height="110" rx="20" fill="none"/>
    <line x1="380" y1="250" x2="375" y2="380"/><line x1="420" y1="250" x2="425" y2="380"/>`, "#2f3b2f", "Box Hoodie — Olive"),
  tee: garment(`<path d="M300 200 Q400 250 500 200 L650 260 L700 420 L610 445 L590 360 L590 830 L210 830 L210 360 L190 445 L100 420 L150 260 Z"/>
    <text x="400" y="560" font-family="system-ui" font-weight="900" font-size="64" text-anchor="middle" fill="#f3f1ea" stroke="none">DROP 07</text>`, "#111111", "Heavyweight Tee — Black"),
  jacket: garment(`<path d="M290 190 L400 230 L510 190 L650 260 L720 600 L630 620 L600 430 L600 850 L200 850 L200 430 L170 620 L80 600 L150 260 Z"/>
    <line x1="400" y1="230" x2="400" y2="850"/><rect x="250" y="520" width="90" height="60" fill="none"/><rect x="460" y="520" width="90" height="60" fill="none"/>`, "#c8b48a", "Work Jacket — Tan"),
  crew: garment(`<path d="M300 190 Q400 240 500 190 L640 250 L710 560 L630 580 L600 420 L600 830 L200 830 L200 420 L170 580 L90 560 L160 250 Z"/>
    <path d="M330 200 Q400 260 470 200" fill="none"/><rect x="200" y="790" width="400" height="40" fill="#8a2b2b"/>`, "#a33a3a", "Crewneck — Brick"),
};

const figure = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1200" width="800" height="1200">
  <rect width="800" height="1200" fill="#e9e6dd"/>
  <g fill="#bfb7a8" stroke="#6b6458" stroke-width="5">
    <circle cx="400" cy="200" r="90"/>
    <path d="M260 330 Q400 290 540 330 L600 640 L540 650 L520 470 L520 760 L280 760 L280 470 L260 650 L200 640 Z"/>
    <path d="M285 760 L300 1100 L380 1100 L400 820 L420 1100 L500 1100 L515 760 Z"/>
  </g>
  <text x="400" y="1160" font-family="system-ui" font-size="30" text-anchor="middle" fill="#6b6458">SAMPLE FIGURE — drawn placeholder, not a real person</text>
</svg>`;

const stub = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 768 1024" width="768" height="1024">
  <rect width="768" height="1024" fill="#fff4d6"/>
  <rect x="24" y="24" width="720" height="976" fill="none" stroke="#b45309" stroke-width="8" stroke-dasharray="24 16"/>
  <text x="384" y="440" font-family="system-ui" font-weight="900" font-size="64" text-anchor="middle" fill="#7c2d12">STUB OUTPUT</text>
  <text x="384" y="520" font-family="system-ui" font-size="34" text-anchor="middle" fill="#7c2d12">Not AI. Local test placeholder.</text>
  <text x="384" y="580" font-family="system-ui" font-size="26" text-anchor="middle" fill="#9a3412">A real FASHN key replaces this with</text>
  <text x="384" y="620" font-family="system-ui" font-size="26" text-anchor="middle" fill="#9a3412">the generated try-on image.</text>
</svg>`;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
async function render(svg, w, h, file) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.setContent(`<html><body style="margin:0">${svg}</body></html>`);
  await page.screenshot({ path: out + file, type: "png" });
  await page.close();
}
for (const [k, svg] of Object.entries(shapes)) await render(svg, 800, 1000, `garment-${k}.png`);
await render(figure, 800, 1200, "sample-figure.png");
await render(stub, 768, 1024, "stub-output.png");
await browser.close();
console.log("rendered to", out);

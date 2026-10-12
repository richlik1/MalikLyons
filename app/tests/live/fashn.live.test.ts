import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateImage } from "@/lib/image";
import { FashnProvider } from "@/lib/providers/fashn";

// LIVE FASHN generation. Requires:
//   FASHN_API_KEY            real key (never commit it)
//   LIVE_PERSON_IMAGE        path to a photo of a CONSENTING adult (not committed)
//   LIVE_GARMENT_IMAGE       path to a garment image you have rights to use
// Optional: FASHN_MODEL, LIVE_OUTPUT_DIR (default: OS temp dir), LIVE_EVIDENCE_FILE.
// Writes an evidence JSON (metadata only: no key, no images) for docs/evidence/.
const key = process.env.FASHN_API_KEY;
const personPath = process.env.LIVE_PERSON_IMAGE;
const garmentPath = process.env.LIVE_GARMENT_IMAGE;
const ready = Boolean(key && personPath && garmentPath);
if (process.env.FASHN_BASE_URL) throw new Error("Unset FASHN_BASE_URL: live tests must hit the real FASHN API");

(ready ? describe : describe.skip)("LIVE: FASHN try-on generation", () => {
  it("generates a real try-on image through FashnProvider", async () => {
    const person = new Uint8Array(readFileSync(personPath!));
    const garment = new Uint8Array(readFileSync(garmentPath!));
    const pv = validateImage(person, { minDimension: 512 });
    const gv = validateImage(garment, { minDimension: 256 });
    expect(pv.ok && gv.ok).toBe(true);
    if (!pv.ok || !gv.ok) return;

    const provider = new FashnProvider({ apiKey: key!, model: process.env.FASHN_MODEL });
    const started = Date.now();
    const out = await provider.generate({
      person: { bytes: person, mimeType: pv.info.mimeType },
      garment: { bytes: garment, mimeType: gv.info.mimeType },
      category: "tops",
    });
    const latencyMs = Date.now() - started;

    const ov = validateImage(out.bytes);
    expect(ov.ok).toBe(true);
    expect(out.bytes.length).toBeGreaterThan(10_000);

    const outDir = process.env.LIVE_OUTPUT_DIR ?? path.join(os.tmpdir(), "trendset-live");
    mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `fashn-${Date.now()}.${out.mimeType.split("/")[1] ?? "png"}`);
    writeFileSync(outFile, out.bytes);

    const evidence = {
      kind: "LIVE external call",
      service: "FASHN API",
      ranAt: new Date().toISOString(),
      model: provider.model,
      providerJobIdSha256: out.providerJobId ? createHash("sha256").update(out.providerJobId).digest("hex").slice(0, 16) : null,
      latencyMs,
      output: { mimeType: out.mimeType, bytes: out.bytes.length, ...(ov.ok ? { width: ov.info.width, height: ov.info.height } : {}) },
      inputs: { personSha256: sha(person), garmentSha256: sha(garment) },
      outputSavedTo: "local only (not committed)",
      humanReview: "PENDING — rate with the rubric in docs/09-merchant-pilot-plan.md §3",
    };
    const evidenceFile = process.env.LIVE_EVIDENCE_FILE ?? path.join(outDir, "fashn-live-evidence.json");
    writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2));
    console.log(`LIVE FASHN OK in ${latencyMs}ms -> ${outFile}\nevidence: ${evidenceFile}`);
  });
});

function sha(b: Uint8Array) {
  return createHash("sha256").update(b).digest("hex").slice(0, 16);
}

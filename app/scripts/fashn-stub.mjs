// LOCAL CONTRACT STUB of the FASHN v1 API, for end-to-end tests of TrendSet's own pipeline.
// It returns a fixed placeholder PNG and performs NO AI generation. Results obtained with this
// stub must never be reported as a live FASHN test. Port 54340, path prefix /v1.
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";

// Serves a visible "STUB OUTPUT — Not AI" card when rendered (scripts/render-demo-assets.mjs),
// otherwise a minimal valid PNG header.
const card = new URL("./demo-assets/stub-output.png", import.meta.url);
let png = existsSync(card) ? readFileSync(card) : null;
if (!png) {
  png = Buffer.alloc(33);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  png.writeUInt32BE(768, 16);
  png.writeUInt32BE(1024, 20);
}
const jobs = new Map();
let n = 0;

http.createServer((req, res) => {
  const send = (code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  if (req.headers.authorization !== "Bearer stub-key") return send(401, { error: "unauthorized" });
  if (req.method === "POST" && req.url === "/v1/run") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      if (!body.model_name || !body.inputs?.model_image || !body.inputs?.garment_image) return send(400, { error: "bad request" });
      const id = `stub-${++n}`;
      jobs.set(id, { polls: 0, fail: body.inputs.category === "one-pieces" });
      send(200, { id, error: null });
    });
    return;
  }
  const m = req.method === "GET" && req.url?.match(/^\/v1\/status\/(.+)$/);
  if (m) {
    const job = jobs.get(decodeURIComponent(m[1]));
    if (!job) return send(404, { error: "not found" });
    job.polls++;
    if (job.polls < 2) return send(200, { id: m[1], status: "processing" });
    if (job.fail) return send(200, { id: m[1], status: "failed", error: { name: "ImageLoadError", message: "stub failure" } });
    return send(200, { id: m[1], status: "completed", output: [`data:image/png;base64,${png.toString("base64")}`] });
  }
  send(404, { error: "no route" });
}).listen(54340, "127.0.0.1", () => console.log("FASHN contract stub on :54340 (NOT the real FASHN API)"));

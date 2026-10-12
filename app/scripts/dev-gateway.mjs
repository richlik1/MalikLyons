// Minimal stand-in for Supabase's Kong gateway: routes /auth/v1, /rest/v1, /storage/v1
// to the local service containers started by scripts/local-stack.sh. Local testing only.
import http from "node:http";

const routes = [
  ["/auth/v1", "http://127.0.0.1:54331"],
  ["/rest/v1", "http://127.0.0.1:54332"],
  ["/storage/v1", "http://127.0.0.1:54333"],
];

http
  .createServer((req, res) => {
    const match = routes.find(([prefix]) => req.url.startsWith(prefix + "/") || req.url === prefix);
    if (!match) { res.writeHead(404).end("no route"); return; }
    const [prefix, target] = match;
    const url = new URL(req.url.slice(prefix.length) || "/", target);
    const headers = { ...req.headers, host: url.host };
    // Kong converts the apikey header into an Authorization bearer when none is present.
    if (!headers.authorization && headers.apikey) headers.authorization = `Bearer ${headers.apikey}`;
    const upstream = http.request(url, { method: req.method, headers }, (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    });
    upstream.on("error", (e) => { res.writeHead(502).end(String(e)); });
    req.pipe(upstream);
  })
  .listen(54321, "127.0.0.1", () => console.log("gateway on http://127.0.0.1:54321"));

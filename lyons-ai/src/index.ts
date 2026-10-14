import { startApp } from "./app.js";
import { loadConfig } from "./config.js";

const cfg = loadConfig();
const app = await startApp(cfg);

let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    if (stopping) return;
    stopping = true;
    // In-flight tasks keep their lease state; they resume on the next start.
    app.shutdown().finally(() => process.exit(0));
  });
}

import { defineConfig } from "vitest/config";
import path from "node:path";

// End-to-end tests against a RUNNING TrendSet server (E2E_BASE_URL) backed by the local stack.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src"), "server-only": path.resolve(__dirname, "tests/server-only-stub.ts") } },
  test: { environment: "node", include: ["tests/e2e/**/*.e2e.test.ts"], testTimeout: 60_000, hookTimeout: 60_000, fileParallelism: false },
});

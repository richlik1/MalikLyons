import { defineConfig } from "vitest/config";
import path from "node:path";

// LIVE tests call real external services and cost real money. They are skipped unless the
// required credentials are present. Run explicitly: npm run test:live
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "tests/server-only-stub.ts"),
    },
  },
  test: { environment: "node", include: ["tests/live/**/*.live.test.ts"], testTimeout: 180_000 },
});

import { defineConfig } from "vitest/config";
import path from "node:path";

// Integration tests run against a real Supabase-compatible stack (see scripts/local-stack.sh)
// or a staging project. They are skipped unless NEXT_PUBLIC_SUPABASE_URL is set.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "tests/server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.int.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});

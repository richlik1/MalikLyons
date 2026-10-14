import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 30_000,
    // DB integration tests share one database; run files serially.
    fileParallelism: false,
  },
});

import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Separate config so the LIVE portal validation can never run as part of
 * `npm test`, `npx vitest run` or CI by accident. See tests/portal-live/.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    include: ["tests/portal-live/**/*.live.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 120_000,
  },
});

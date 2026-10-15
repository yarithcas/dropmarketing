import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // The demo dataset rolls with the UTC day; tests pin it to the base snapshot for stable expectations.
  test: { include: ["tests/**/*.test.ts"], environment: "node", env: { DEMO_SNAPSHOT: "2026-10-12" } },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
});

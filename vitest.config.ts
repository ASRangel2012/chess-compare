import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Pure parsing/aggregation, a mocked-fetch network test, and server
    // endpoint tests (via an ephemeral listen + fetch) — no DOM needed.
    environment: "node",
    include: ["src/**/*.test.ts", "server/**/*.test.ts"],
    globals: false,
  },
});

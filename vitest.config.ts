import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Pure parsing/aggregation + a mocked-fetch network test — no DOM needed.
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: false,
  },
});

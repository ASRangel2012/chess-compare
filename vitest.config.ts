import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Default to node: pure parsing/aggregation, mocked-fetch network tests,
    // and server endpoint tests need no DOM. Component tests (*.test.tsx)
    // opt into jsdom per file via the @vitest-environment pragma.
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "server/**/*.test.ts"],
    globals: false,
  },
});

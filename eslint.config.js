// Flat ESLint config covering the client (src/), the server (server/), the
// shared contract, and the build/dev scripts. Kept to recommended rule sets
// plus react-hooks — the goal is a CI-enforceable floor, not a style debate.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  // Build output and dependencies are never linted.
  { ignores: ["dist/", "dist-server/", "node_modules/", "coverage/"] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      // Match the codebase's convention: intentionally unused values are
      // discarded with `void x` or named with a leading underscore.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },

  // React hook rules only apply to the client tree.
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },

  // The dev launcher is plain Node ESM — no TS project behind it.
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: { process: "readonly", console: "readonly" },
    },
  }
);

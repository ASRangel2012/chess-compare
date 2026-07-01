import { describe, it, expect } from "vitest";
import { resolveCorsOptions } from "./corsConfig";

describe("resolveCorsOptions", () => {
  it("returns undefined (permissive) when unset and not in production", () => {
    expect(resolveCorsOptions(undefined, false)).toBeUndefined();
    expect(resolveCorsOptions("", false)).toBeUndefined();
    expect(resolveCorsOptions("  , ,", false)).toBeUndefined();
  });

  it("fails closed (throws) when unset in production", () => {
    expect(() => resolveCorsOptions(undefined, true)).toThrow(/CORS_ORIGIN/);
    expect(() => resolveCorsOptions("   ", true)).toThrow(/CORS_ORIGIN/);
  });

  it("parses a comma-separated list, trimming blanks", () => {
    expect(resolveCorsOptions("https://a.com, https://b.com ,", false)).toEqual({
      origin: ["https://a.com", "https://b.com"],
    });
  });

  it("allows a configured origin in production", () => {
    expect(resolveCorsOptions("https://app.example.com", true)).toEqual({
      origin: ["https://app.example.com"],
    });
  });
});

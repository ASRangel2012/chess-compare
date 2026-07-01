import { describe, it, expect } from "vitest";
import { parseTrustProxy } from "./trustProxy";

describe("parseTrustProxy", () => {
  it("defaults to false when unset/blank/'false'", () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy("")).toBe(false);
    expect(parseTrustProxy("  ")).toBe(false);
    expect(parseTrustProxy("false")).toBe(false);
    expect(parseTrustProxy("FALSE")).toBe(false);
  });

  it("parses true", () => {
    expect(parseTrustProxy("true")).toBe(true);
  });

  it("parses a non-negative hop count as a number", () => {
    expect(parseTrustProxy("1")).toBe(1);
    expect(parseTrustProxy("2")).toBe(2);
    expect(parseTrustProxy("0")).toBe(0);
  });

  it("passes through express keywords / subnets", () => {
    expect(parseTrustProxy("loopback")).toBe("loopback");
    expect(parseTrustProxy("10.0.0.0/8")).toBe("10.0.0.0/8");
  });
});

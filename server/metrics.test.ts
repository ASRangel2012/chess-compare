import { describe, it, expect } from "vitest";
import { createMetrics } from "./metrics";

/** Pull the numeric value of a single exposition line, asserting it exists. */
function valueOf(exposition: string, line: string): number {
  const match = exposition
    .split("\n")
    .find((l) => l.startsWith(`${line} `) || l === line);
  expect(match, `expected exposition to contain "${line}"`).toBeTruthy();
  return Number(match!.split(" ").pop());
}

describe("createMetrics", () => {
  it("renders HTTP request histograms with cumulative buckets, sum, and count", () => {
    const m = createMetrics();
    m.observeHttpRequest({ method: "GET", route: "/api/health", status: 200 }, 0.02);
    m.observeHttpRequest({ method: "GET", route: "/api/health", status: 200 }, 0.2);

    const out = m.render();
    const series = 'method="GET",route="/api/health",status="200"';
    // 0.02 lands in le=0.025 (1 observation); both land in le=0.25 and +Inf.
    expect(valueOf(out, `http_request_duration_seconds_bucket{${series},le="0.025"}`)).toBe(1);
    expect(valueOf(out, `http_request_duration_seconds_bucket{${series},le="0.25"}`)).toBe(2);
    expect(valueOf(out, `http_request_duration_seconds_bucket{${series},le="+Inf"}`)).toBe(2);
    expect(valueOf(out, `http_request_duration_seconds_count{${series}}`)).toBe(2);
    expect(valueOf(out, `http_request_duration_seconds_sum{${series}}`)).toBeCloseTo(0.22);
  });

  it("keeps distinct label combinations as distinct series", () => {
    const m = createMetrics();
    m.observeHttpRequest({ method: "GET", route: "/api/health", status: 200 }, 0.01);
    m.observeHttpRequest({ method: "POST", route: "/api/analyze", status: 429 }, 0.01);

    const out = m.render();
    expect(valueOf(out, 'http_request_duration_seconds_count{method="GET",route="/api/health",status="200"}')).toBe(1);
    expect(valueOf(out, 'http_request_duration_seconds_count{method="POST",route="/api/analyze",status="429"}')).toBe(1);
  });

  it("records Claude latency by outcome, and token usage only when provided", () => {
    const m = createMetrics();
    m.observeAnthropicCall("success", 12, { inputTokens: 900, outputTokens: 1500 });
    m.observeAnthropicCall("error", 90);

    const out = m.render();
    expect(valueOf(out, 'anthropic_requests_total{outcome="success"}')).toBe(1);
    expect(valueOf(out, 'anthropic_requests_total{outcome="error"}')).toBe(1);
    expect(valueOf(out, 'anthropic_request_duration_seconds_count{outcome="success"}')).toBe(1);
    expect(valueOf(out, 'anthropic_request_duration_seconds_count{outcome="error"}')).toBe(1);
    // 900 input tokens land in the le=1024 bucket; the failed call adds none.
    expect(valueOf(out, 'anthropic_input_tokens_bucket{le="1024"}')).toBe(1);
    expect(valueOf(out, "anthropic_input_tokens_count")).toBe(1);
    expect(valueOf(out, "anthropic_output_tokens_count")).toBe(1);
    expect(valueOf(out, "anthropic_output_tokens_sum")).toBe(1500);
  });

  it("counts rate-limit hits and shed requests", () => {
    const m = createMetrics();
    expect(valueOf(m.render(), "rate_limit_hits_total")).toBe(0);
    m.incRateLimitHit();
    m.incRateLimitHit();
    m.incAnalyzeShed();

    const out = m.render();
    expect(valueOf(out, "rate_limit_hits_total")).toBe(2);
    expect(valueOf(out, "analyze_shed_total")).toBe(1);
  });

  it("reads the semaphore gauge fresh at every render", () => {
    const m = createMetrics();
    let inUse = 0;
    m.registerAnalyzeInUseGauge(() => inUse, 4);

    expect(valueOf(m.render(), "analyze_semaphore_in_use")).toBe(0);
    inUse = 3;
    expect(valueOf(m.render(), "analyze_semaphore_in_use")).toBe(3);
    expect(valueOf(m.render(), "analyze_semaphore_max")).toBe(4);
  });

  it("escapes label values so a hostile string can't corrupt the exposition", () => {
    const m = createMetrics();
    m.observeHttpRequest(
      { method: 'GE"T\n', route: "spa", status: 200 },
      0.01
    );
    const out = m.render();
    // The quote and newline are escaped; the exposition stays one line per sample.
    expect(out).toContain('method="GE\\"T\\n"');
    expect(out.split("\n").every((l) => !l.includes("\r"))).toBe(true);
  });
});

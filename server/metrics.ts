/**
 * Dependency-free Prometheus metrics with text exposition (format 0.0.4).
 *
 * Same philosophy as logger.ts: the operational surface a deployment needs,
 * without pulling in a client library. A factory (not module state) so
 * createApp receives it as an injected dependency — mirroring the logger and
 * rate limiter — and tests can assert against a fresh registry.
 *
 * The registry is deliberately not generic: it exposes exactly the metrics
 * this service's dashboards and alerts need.
 *   - p50/p95/p99 API latency by route+status  (http_request_duration_seconds)
 *   - Claude latency and failure rate          (anthropic_request_duration_seconds{outcome})
 *   - token spend distribution                 (anthropic_input/output_tokens)
 *   - abuse pressure                           (rate_limit_hits_total)
 *   - load shedding + saturation               (analyze_shed_total,
 *                                               analyze_semaphore_in_use / _max)
 */

const HTTP_DURATION_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120,
];
// The Claude call is orders of magnitude slower than local routes and is
// bounded by ANTHROPIC_TIMEOUT_MS (default 90s), so its buckets skew long.
// The 45 edge exists because production Sonnet calls land in the 40-60s
// range: without it they all pooled in one 30s-wide (30, 60] bucket, and
// histogram_quantile could only interpolate — i.e. guess — inside it.
// Buckets follow observed latency and SLO thresholds, not round numbers.
const ANTHROPIC_DURATION_BUCKETS = [0.5, 1, 2.5, 5, 10, 20, 30, 45, 60, 90, 120];
const TOKEN_BUCKETS = [128, 256, 512, 1024, 2048, 4096, 8192, 16384];

type LabelPairs = [name: string, value: string][];

function escapeLabelValue(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function labelString(pairs: LabelPairs): string {
  if (pairs.length === 0) return "";
  const body = pairs
    .map(([name, value]) => `${name}="${escapeLabelValue(value)}"`)
    .join(",");
  return `{${body}}`;
}

/** One histogram series: cumulative bucket counts plus running sum and count. */
class HistogramSeries {
  readonly cumulative: number[];
  sum = 0;
  count = 0;

  constructor(readonly buckets: readonly number[]) {
    this.cumulative = new Array(buckets.length).fill(0);
  }

  observe(value: number): void {
    for (let i = 0; i < this.buckets.length; i++) {
      if (value <= this.buckets[i]) this.cumulative[i]++;
    }
    this.sum += value;
    this.count++;
  }
}

function renderHistogram(
  name: string,
  help: string,
  entries: Iterable<{ pairs: LabelPairs; series: HistogramSeries }>
): string[] {
  const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} histogram`];
  for (const { pairs, series } of entries) {
    for (let i = 0; i < series.buckets.length; i++) {
      const le: LabelPairs = [...pairs, ["le", String(series.buckets[i])]];
      lines.push(`${name}_bucket${labelString(le)} ${series.cumulative[i]}`);
    }
    const inf: LabelPairs = [...pairs, ["le", "+Inf"]];
    lines.push(`${name}_bucket${labelString(inf)} ${series.count}`);
    lines.push(`${name}_sum${labelString(pairs)} ${series.sum}`);
    lines.push(`${name}_count${labelString(pairs)} ${series.count}`);
  }
  return lines;
}

function renderScalar(
  name: string,
  help: string,
  type: "counter" | "gauge",
  entries: Iterable<{ pairs: LabelPairs; value: number }>
): string[] {
  const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`];
  for (const { pairs, value } of entries) {
    lines.push(`${name}${labelString(pairs)} ${value}`);
  }
  return lines;
}

export interface HttpRequestLabels {
  method: string;
  route: string;
  status: number;
}

export interface AnthropicUsage {
  inputTokens: number;
  outputTokens: number;
}

export type AnthropicOutcome = "success" | "error";

export interface Metrics {
  /** Observe one finished HTTP request. `route` must be a bounded label (see createApp). */
  observeHttpRequest(labels: HttpRequestLabels, seconds: number): void;
  /**
   * Observe one upstream Claude call. Usage is only known on success; a
   * truncated reply still reports "success" here because the tokens were spent
   * and the latency is real — the resulting 502 is visible in the HTTP metrics.
   */
  observeAnthropicCall(
    outcome: AnthropicOutcome,
    seconds: number,
    usage?: AnthropicUsage
  ): void;
  /** A request was rejected by the per-IP rate limiter (429). */
  incRateLimitHit(): void;
  /** A request was shed by the analyze concurrency semaphore (503). */
  incAnalyzeShed(): void;
  /** Wire the semaphore in as a gauge, read fresh at every scrape. */
  registerAnalyzeInUseGauge(collect: () => number, max: number): void;
  /** Prometheus text exposition. Serve as text/plain; version=0.0.4. */
  render(): string;
}

export function createMetrics(): Metrics {
  // Keyed by serialized labels so each label combination is one series.
  const httpSeries = new Map<
    string,
    { pairs: LabelPairs; series: HistogramSeries }
  >();
  const anthropicDuration = new Map<
    AnthropicOutcome,
    { pairs: LabelPairs; series: HistogramSeries }
  >();
  const anthropicCalls = new Map<AnthropicOutcome, number>();
  const inputTokens = new HistogramSeries(TOKEN_BUCKETS);
  const outputTokens = new HistogramSeries(TOKEN_BUCKETS);
  let rateLimitHits = 0;
  let analyzeShed = 0;
  let semaphoreInUse: (() => number) | null = null;
  let semaphoreMax = 0;

  return {
    observeHttpRequest(labels, seconds) {
      const pairs: LabelPairs = [
        ["method", labels.method],
        ["route", labels.route],
        ["status", String(labels.status)],
      ];
      const key = labelString(pairs);
      let entry = httpSeries.get(key);
      if (!entry) {
        entry = { pairs, series: new HistogramSeries(HTTP_DURATION_BUCKETS) };
        httpSeries.set(key, entry);
      }
      entry.series.observe(seconds);
    },

    observeAnthropicCall(outcome, seconds, usage) {
      let entry = anthropicDuration.get(outcome);
      if (!entry) {
        entry = {
          pairs: [["outcome", outcome]],
          series: new HistogramSeries(ANTHROPIC_DURATION_BUCKETS),
        };
        anthropicDuration.set(outcome, entry);
      }
      entry.series.observe(seconds);
      anthropicCalls.set(outcome, (anthropicCalls.get(outcome) ?? 0) + 1);
      if (usage) {
        inputTokens.observe(usage.inputTokens);
        outputTokens.observe(usage.outputTokens);
      }
    },

    incRateLimitHit() {
      rateLimitHits++;
    },

    incAnalyzeShed() {
      analyzeShed++;
    },

    registerAnalyzeInUseGauge(collect, max) {
      semaphoreInUse = collect;
      semaphoreMax = max;
    },

    render() {
      const lines: string[] = [];
      lines.push(
        ...renderHistogram(
          "http_request_duration_seconds",
          "HTTP request duration by method, route, and status.",
          httpSeries.values()
        ),
        ...renderHistogram(
          "anthropic_request_duration_seconds",
          "Upstream Claude call duration by outcome.",
          anthropicDuration.values()
        ),
        ...renderScalar(
          "anthropic_requests_total",
          "Upstream Claude calls by outcome.",
          "counter",
          [...anthropicCalls.entries()].map(([outcome, value]) => ({
            pairs: [["outcome", outcome]] as LabelPairs,
            value,
          }))
        ),
        ...renderHistogram(
          "anthropic_input_tokens",
          "Input tokens per successful Claude call.",
          [{ pairs: [], series: inputTokens }]
        ),
        ...renderHistogram(
          "anthropic_output_tokens",
          "Output tokens per successful Claude call.",
          [{ pairs: [], series: outputTokens }]
        ),
        ...renderScalar(
          "rate_limit_hits_total",
          "Requests rejected by the per-IP rate limiter.",
          "counter",
          [{ pairs: [], value: rateLimitHits }]
        ),
        ...renderScalar(
          "analyze_shed_total",
          "Analyze requests shed by the concurrency semaphore.",
          "counter",
          [{ pairs: [], value: analyzeShed }]
        )
      );
      if (semaphoreInUse) {
        lines.push(
          ...renderScalar(
            "analyze_semaphore_in_use",
            "Upstream Claude calls currently in flight.",
            "gauge",
            [{ pairs: [], value: semaphoreInUse() }]
          ),
          ...renderScalar(
            "analyze_semaphore_max",
            "Configured cap on concurrent upstream Claude calls.",
            "gauge",
            [{ pairs: [], value: semaphoreMax }]
          )
        );
      }
      return lines.join("\n") + "\n";
    },
  };
}

import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import type { Logger } from "./logger";
import { serializeError } from "./logger";
import type { RateLimiter } from "./rateLimit";
import type { Semaphore } from "./semaphore";
import type { Metrics } from "./metrics";
import {
  validateAnalyzeBody,
  buildPrompt,
  extractAnalysisJson,
  TruncatedReplyError,
  UpstreamUnavailableError,
} from "./analyze";

export interface AppDeps {
  /**
   * Sends a prompt to the model and resolves its raw text reply. `null` when no
   * API key is configured, which makes /api/analyze return a graceful 503.
   * Injecting this keeps the app testable without the Anthropic SDK or network.
   */
  createMessage: ((prompt: string) => Promise<string>) | null;
  rateLimiter: RateLimiter;
  /**
   * Bounds *global* concurrent upstream Anthropic calls (the rate limiter only
   * bounds per-IP request rate). Saturation returns 503 + Retry-After.
   */
  analyzeSemaphore: Semaphore;
  logger: Logger;
  /** Prometheus registry backing GET /metrics; fed by the middleware below. */
  metrics: Metrics;
  isProduction: boolean;
  /**
   * Express `trust proxy` setting. Must match the real deployment topology, or
   * clients can spoof X-Forwarded-For and bypass the per-IP rate limiter.
   */
  trustProxy: boolean | number | string;
  /** Absolute path to the built SPA (served in production). */
  distPath: string;
  /** Restrict CORS to specific origins; omit to allow any (fine for local dev). */
  corsOptions?: cors.CorsOptions;
}

/**
 * Wrap an async route handler so a thrown error or rejected promise is routed
 * to Express's error-handling middleware. Express 4 does not do this itself: an
 * unhandled rejection in an async handler otherwise leaves the request hanging
 * with no response.
 */
function asyncHandler(
  fn: (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => Promise<unknown>
): express.RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

/**
 * A reflected request id must be boring: bounded length and a conservative
 * charset. Anything fancier gets replaced, not echoed — the inbound value ends
 * up in a response header and in every structured log line for the request,
 * so this is the wrong place to trust client input.
 */
const SAFE_REQUEST_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Collapse a request path to a fixed label set so metric cardinality stays
 * bounded — a scanner spraying random URLs must not mint an unbounded number
 * of time series in the registry.
 */
function routeLabelFor(pathname: string): string {
  switch (pathname) {
    case "/api/analyze":
    case "/api/health":
    case "/api/health/live":
    case "/api/health/ready":
    case "/metrics":
      return pathname;
    default:
      return pathname.startsWith("/api/") ? "/api/other" : "spa";
  }
}

export function createApp(deps: AppDeps): express.Express {
  const app = express();
  // Trust proxy must match the real topology (see AppDeps.trustProxy). Default
  // false for direct exposure so a client can't spoof X-Forwarded-For to bypass
  // the per-IP rate limiter.
  app.set("trust proxy", deps.trustProxy);

  // Attach a request id (honoring an inbound X-Request-Id) for correlating logs.
  app.use((req, res, next) => {
    const inbound = req.headers["x-request-id"];
    // Cap the reflected id (log-line bloat), then require a safe charset —
    // an id that fails the check is replaced with a generated one instead of
    // being reflected into the response header and the logs.
    const candidate = typeof inbound === "string" ? inbound.slice(0, 128) : "";
    const id = SAFE_REQUEST_ID_RE.test(candidate) ? candidate : randomUUID();
    res.locals.requestId = id;
    res.setHeader("X-Request-Id", id);
    next();
  });

  // Structured access log + request metrics — emitted once the response is
  // sent so we capture the final status and duration.
  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      const durationMs = Date.now() - start;
      deps.logger.info("request", {
        requestId: res.locals.requestId,
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs,
      });
      const route = routeLabelFor((req.originalUrl ?? req.url).split("?")[0]);
      deps.metrics.observeHttpRequest(
        { method: req.method, route, status: res.statusCode },
        durationMs / 1000
      );
      // The only source of 429s on this route is the per-IP limiter, so this
      // observes limiter hits without coupling the limiter to the registry.
      if (route === "/api/analyze" && res.statusCode === 429) {
        deps.metrics.incRateLimitHit();
      }
    });
    next();
  });

  // Security headers (a dependency-free subset of what helmet sets). The CSP
  // allows the app's own origin plus the Chess.com origins it legitimately uses:
  // avatars on *.chesscomfiles.com and the public API on api.chess.com.
  const contentSecurityPolicy = [
    "default-src 'self'",
    "img-src 'self' https://*.chesscomfiles.com data:",
    "connect-src 'self' https://api.chess.com",
    "style-src 'self' 'unsafe-inline'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
  ].join("; ");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", contentSecurityPolicy);
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains"
    );
    next();
  });

  app.use(cors(deps.corsOptions));
  app.use(express.json({ limit: "1mb" }));

  app.post(
    "/api/analyze",
    deps.rateLimiter.middleware,
    asyncHandler(async (req, res) => {
    const log = deps.logger.child({
      requestId: res.locals.requestId,
      route: "analyze",
    });

    if (!deps.createMessage) {
      return res.status(503).json({
        error:
          "ANTHROPIC_API_KEY is not configured. Copy .env.example to .env and add your key.",
      });
    }

    const validation = validateAnalyzeBody(req.body);
    if (!validation.ok) {
      return res.status(400).json({ error: validation.error });
    }

    // Bound global in-flight upstream calls. Each one can hold this socket for
    // up to the Anthropic timeout, so when we're saturated, shed load
    // immediately (503 + Retry-After) instead of queueing.
    if (!deps.analyzeSemaphore.tryAcquire()) {
      deps.metrics.incAnalyzeShed();
      log.warn("analyze concurrency limit reached", {
        max: deps.analyzeSemaphore.max,
      });
      res.setHeader("Retry-After", "10");
      return res.status(503).json({
        error:
          "The AI analysis service is handling its maximum number of requests. Please retry in a few seconds.",
      });
    }

    try {
      const prompt = buildPrompt(validation.value);

      let text: string;
      try {
        text = await deps.createMessage(prompt);
      } catch (err) {
        if (err instanceof TruncatedReplyError) {
          // Upstream reply was cut off at the token cap — a bad-gateway-style
          // upstream failure with a concrete operator fix, not a generic 500.
          log.warn("model reply truncated", { err: serializeError(err) });
          return res.status(502).json({
            error:
              "The AI reply was cut off before it finished. Raise ANTHROPIC_MAX_TOKENS on the server and retry.",
          });
        }
        if (err instanceof UpstreamUnavailableError) {
          // Anthropic is rate limiting or overloaded. Retryable and temporary:
          // 503 + Retry-After tells well-behaved clients to back off, where a
          // generic 500 invites immediate manual retries (a retry storm at
          // exactly the moment the upstream is shedding load).
          log.warn("upstream rate limited/overloaded", {
            err: serializeError(err),
          });
          res.setHeader("Retry-After", "30");
          return res.status(503).json({
            error:
              "The AI service is temporarily overloaded. Please retry in a moment.",
          });
        }
        // Log the detail, return a generic message (mirrors the 502 parse path):
        // SDK/network errors can carry internal detail we must not leak.
        log.error("model request failed", { err: serializeError(err) });
        return res.status(500).json({
          error: "Analysis request failed. Please retry.",
        });
      }

      const parsed = extractAnalysisJson(text);
      if (!parsed.ok) {
        // Upstream gave us something unusable — log why, but don't leak raw model
        // text to the client.
        log.warn("model returned unusable output", { reason: parsed.error });
        return res.status(502).json({
          error: "The AI response could not be parsed. Please retry.",
        });
      }

      res.json(parsed.value);
    } finally {
      deps.analyzeSemaphore.release();
    }
    })
  );

  // Liveness: the process is up and the event loop is serving requests. The
  // bare /api/health alias is kept for compatibility (docker-compose, older
  // probes). Neither endpoint exposes config detail — hasApiKey used to be
  // served here, which was free recon for attackers probing a public
  // deployment; operators get it from the "server started" log line.
  app.get(["/api/health", "/api/health/live"], (_req, res) => {
    res.json({ ok: true });
  });

  // Readiness: safe for a load balancer to send traffic here. The app has no
  // hard external dependency (running without an API key is a supported,
  // degraded mode), so this mirrors liveness today — it exists so Kubernetes
  // probes target stable, distinct endpoints and a future dependency (shared
  // rate-limit store, cache) has a place to report.
  app.get("/api/health/ready", (_req, res) => {
    res.json({ ok: true });
  });

  // Prometheus scrape endpoint. Deliberately outside /api so the JSON-404
  // guard below stays API-scoped. On a public deployment, keep it internal:
  // scrape over the pod network and exclude /metrics at the ingress.
  app.get("/metrics", (_req, res) => {
    res.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    res.send(deps.metrics.render());
  });

  // Any unmatched /api/* route is a JSON 404 — it must never fall through to the
  // SPA fallback below, which would return index.html with a misleading 200.
  app.all("/api/*", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  if (deps.isProduction) {
    app.use(express.static(deps.distPath));
    // SPA fallback. The shell is read ONCE at startup and served from memory:
    // it is a fixed file that only changes on deploy, and sendFile here was a
    // per-request filesystem access on an unthrottled route (flagged by
    // CodeQL js/missing-rate-limiting). Serving from memory removes the fs
    // access instead of rate-limiting deep links — throttling the SPA shell
    // punishes users behind shared IPs, and volumetric DoS protection for
    // static content belongs at the ingress/CDN, not in-process. A missing
    // build now fails at boot (fail closed, like the production CORS check)
    // rather than 500ing per request at runtime.
    const spaShell = fs.readFileSync(path.join(deps.distPath, "index.html"));
    app.get("*", (_req, res) => {
      res.type("html").send(spaShell);
    });
  }

  // Last middleware: convert any error forwarded via next(err) — including async
  // handler rejections — into a generic JSON 500. Full detail is logged with the
  // request id; nothing internal is leaked to the client.
  const errorHandler: express.ErrorRequestHandler = (err, _req, res, _next) => {
    deps.logger.error("unhandled error", {
      err: serializeError(err),
      requestId: res.locals.requestId,
    });
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal error. Please retry." });
    }
  };
  app.use(errorHandler);

  return app;
}

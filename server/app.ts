import express from "express";
import cors from "cors";
import path from "path";
import { randomUUID } from "node:crypto";
import type { Logger } from "./logger";
import { serializeError } from "./logger";
import type { RateLimiter } from "./rateLimit";
import {
  validateAnalyzeBody,
  buildPrompt,
  extractAnalysisJson,
} from "./analyze";

export interface AppDeps {
  /**
   * Sends a prompt to the model and resolves its raw text reply. `null` when no
   * API key is configured, which makes /api/analyze return a graceful 503.
   * Injecting this keeps the app testable without the Anthropic SDK or network.
   */
  createMessage: ((prompt: string) => Promise<string>) | null;
  rateLimiter: RateLimiter;
  logger: Logger;
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

export function createApp(deps: AppDeps): express.Express {
  const app = express();
  // Trust proxy must match the real topology (see AppDeps.trustProxy). Default
  // false for direct exposure so a client can't spoof X-Forwarded-For to bypass
  // the per-IP rate limiter.
  app.set("trust proxy", deps.trustProxy);

  // Attach a request id (honoring an inbound X-Request-Id) for correlating logs.
  app.use((req, res, next) => {
    const inbound = req.headers["x-request-id"];
    const id = (typeof inbound === "string" && inbound) || randomUUID();
    res.locals.requestId = id;
    res.setHeader("X-Request-Id", id);
    next();
  });

  // Structured access log — one line per request, emitted once the response is
  // sent so we capture the final status and duration.
  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      deps.logger.info("request", {
        requestId: res.locals.requestId,
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs: Date.now() - start,
      });
    });
    next();
  });

  // Minimal security headers (a dependency-free subset of what helmet sets).
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
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

    const prompt = buildPrompt(validation.value);

    let text: string;
    try {
      text = await deps.createMessage(prompt);
    } catch (err) {
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
    })
  );

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, hasApiKey: Boolean(deps.createMessage) });
  });

  if (deps.isProduction) {
    app.use(express.static(deps.distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(deps.distPath, "index.html"));
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

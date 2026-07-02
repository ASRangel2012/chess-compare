import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import Anthropic from "@anthropic-ai/sdk";
import { createApp } from "./app";
import { createRateLimiter } from "./rateLimit";
import { createSemaphore } from "./semaphore";
import { createMetrics } from "./metrics";
import { TruncatedReplyError } from "./analyze";
import { logger, serializeError } from "./logger";
import { resolveCorsOptions } from "./corsConfig";
import { parseTrustProxy } from "./trustProxy";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT ?? 3001;
const isProduction = process.env.NODE_ENV === "production";
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5";
const MAX_TOKENS = Number(process.env.ANTHROPIC_MAX_TOKENS ?? 4096);
// Per-attempt upstream deadline. Sonnet needs far more than Haiku for a full
// analysis, so this is generous and env-tunable. maxRetries defaults to 0 so
// the deadline is a hard ceiling — the SDK's default of 2 retries would
// multiply a timeout into ~3x the wait. Raise ANTHROPIC_MAX_RETRIES only if
// you also accept the larger worst-case latency.
const ANTHROPIC_TIMEOUT_MS = Number(process.env.ANTHROPIC_TIMEOUT_MS ?? 90_000);
const ANTHROPIC_MAX_RETRIES = Number(process.env.ANTHROPIC_MAX_RETRIES ?? 0);
// Global ceiling on concurrent upstream Anthropic calls. Each in-flight call
// holds an Express socket for up to ANTHROPIC_TIMEOUT_MS, so this bounds both
// upstream pressure and socket usage; excess requests get an immediate 503.
const rawMaxConcurrent = Number(process.env.ANALYZE_MAX_CONCURRENT ?? 4);
const ANALYZE_MAX_CONCURRENT =
  Number.isFinite(rawMaxConcurrent) && rawMaxConcurrent >= 1
    ? Math.floor(rawMaxConcurrent)
    : 4;

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

const metrics = createMetrics();

// Get structured output via a forced tool call instead of asking the model to
// hand-write JSON. Multi-paragraph string values (the profiles and game plan)
// routinely contain literal newlines and quotes that break JSON.parse; letting
// the API return the tool input as an already-parsed object sidesteps that
// entire class of failure. We re-stringify it so the parse/shape-validation
// pipeline (and its tests) stay unchanged.
const ANALYSIS_TOOL_NAME = "emit_play_style_analysis";

const createMessage = anthropic
  ? async (prompt: string): Promise<string> => {
      const startedAt = Date.now();
      let message: Anthropic.Message;
      try {
        message = await anthropic.messages.create(
          {
          model: MODEL,
          max_tokens: MAX_TOKENS,
          tools: [
            {
              name: ANALYSIS_TOOL_NAME,
              description:
                "Return the two play-style profiles, the style matchup, and the game plan for player 1.",
              input_schema: {
                type: "object",
                properties: {
                  player1: {
                    type: "string",
                    description: "2-3 paragraph play-style profile for the first player",
                  },
                  player2: {
                    type: "string",
                    description: "2-3 paragraph play-style profile for the second player",
                  },
                  matchup: {
                    type: "string",
                    description: "1-2 paragraph analysis of how the two styles clash",
                  },
                  gamePlan: {
                    type: "string",
                    description:
                      "detailed, multi-paragraph game plan for how player 1 can beat player 2",
                  },
                },
                required: ["player1", "player2", "matchup", "gamePlan"],
              },
            },
          ],
          tool_choice: { type: "tool", name: ANALYSIS_TOOL_NAME },
          messages: [{ role: "user", content: prompt }],
          },
          // Bound the upstream call: a hung/slow model must not tie up the request.
          { timeout: ANTHROPIC_TIMEOUT_MS, maxRetries: ANTHROPIC_MAX_RETRIES }
        );
      } catch (err) {
        // A failed or timed-out call still spent real wall-clock time — record
        // it so upstream failures show up in latency dashboards, not just logs.
        metrics.observeAnthropicCall("error", (Date.now() - startedAt) / 1000);
        throw err;
      }

      const elapsedMs = Date.now() - startedAt;
      // Tokens are spent even when the reply is truncated below, so record the
      // usage before the stop_reason check — spend tracking must include it.
      metrics.observeAnthropicCall("success", elapsedMs / 1000, {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
      });

      // Observability for an AI proxy: token cost and upstream latency are the
      // first incident questions. Never log the raw model output.
      logger.info("anthropic message", {
        ms: elapsedMs,
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        stopReason: message.stop_reason,
        model: MODEL,
      });

      if (message.stop_reason === "max_tokens") {
        // Recognizable truncation error: the /api/analyze route maps this to a
        // 502 with the actionable "raise ANTHROPIC_MAX_TOKENS" message.
        throw new TruncatedReplyError(
          `Model reply hit the ${MAX_TOKENS}-token cap before finishing. Raise ANTHROPIC_MAX_TOKENS and retry.`
        );
      }

      const toolUse = message.content.find((block) => block.type === "tool_use");
      if (!toolUse || toolUse.type !== "tool_use") {
        throw new Error("Model did not return the expected structured analysis.");
      }
      // toolUse.input is already-parsed JSON; re-stringify for the shape check.
      return JSON.stringify(toolUse.input);
    }
  : null;

// Fail closed in production: refuse to start without an explicit CORS allow-list.
const corsOptions = resolveCorsOptions(process.env.CORS_ORIGIN, isProduction);
// Default false (direct exposure) so X-Forwarded-For cannot be spoofed.
const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);

const rateLimiter = createRateLimiter({ windowMs: 60_000, max: 10 });

setInterval(() => rateLimiter.sweep(), 60_000).unref();

const analyzeSemaphore = createSemaphore(ANALYZE_MAX_CONCURRENT);
// Saturation gauge: alert when in_use sits at max (every new analyze is shed).
metrics.registerAnalyzeInUseGauge(
  () => analyzeSemaphore.inUse,
  analyzeSemaphore.max
);

const app = createApp({
  createMessage,
  rateLimiter,
  analyzeSemaphore,
  logger,
  metrics,
  isProduction,
  trustProxy,
  distPath: path.join(__dirname, "../dist"),
  corsOptions,
});

const server = app.listen(PORT, () => {
  logger.info("server started", {
    port: Number(PORT),
    mode: isProduction ? "production" : "api-only",
    hasApiKey: Boolean(createMessage),
    model: MODEL,
  });
});

// Graceful shutdown: stop accepting new connections, let in-flight requests
// finish, then exit. A forced exit backstops a close() that hangs.
let shuttingDown = false;
function gracefulShutdown(signal: string, code = 0): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("shutting down", { signal });
  const forced = setTimeout(() => {
    logger.warn("forced shutdown: server.close timed out");
    // Tear down whatever is still open (in-flight requests included) so the
    // exit below isn't blocked by lingering sockets.
    server.closeAllConnections();
    process.exit(code || 1);
  }, 10_000);
  forced.unref();
  // server.close() alone waits for idle keep-alive connections to time out,
  // which routinely rode out the full force-exit window. Proactively close
  // idle sockets; in-flight requests still get to finish.
  server.closeIdleConnections();
  server.close((err) => {
    if (err) {
      logger.error("error during server.close", { err: serializeError(err) });
      process.exit(1);
      return;
    }
    logger.info("shutdown complete");
    process.exit(code);
  });
}

// Process-level safety nets. A rejected promise we never caught is logged but
// not fatal; a truly uncaught exception leaves the process in an undefined
// state, so we log it and shut down so the orchestrator can restart cleanly.
process.on("unhandledRejection", (reason) => {
  logger.error("unhandledRejection", { err: serializeError(reason) });
});
process.on("uncaughtException", (err) => {
  logger.error("uncaughtException", { err: serializeError(err) });
  gracefulShutdown("uncaughtException", 1);
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => gracefulShutdown(signal));
}

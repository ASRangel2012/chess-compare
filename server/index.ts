import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import Anthropic from "@anthropic-ai/sdk";
import { createApp } from "./app";
import { createRateLimiter } from "./rateLimit";
import { logger } from "./logger";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT ?? 3001;
const isProduction = process.env.NODE_ENV === "production";
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5";
const MAX_TOKENS = Number(process.env.ANTHROPIC_MAX_TOKENS ?? 4096);

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

// Get structured output via a forced tool call instead of asking the model to
// hand-write JSON. Multi-paragraph string values (the profiles and game plan)
// routinely contain literal newlines and quotes that break JSON.parse; letting
// the API return the tool input as an already-parsed object sidesteps that
// entire class of failure. We re-stringify it so the parse/shape-validation
// pipeline (and its tests) stay unchanged.
const ANALYSIS_TOOL_NAME = "emit_play_style_analysis";

const createMessage = anthropic
  ? async (prompt: string): Promise<string> => {
      const message = await anthropic.messages.create({
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
      });

      if (message.stop_reason === "max_tokens") {
        throw new Error(
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

const corsOrigin = process.env.CORS_ORIGIN?.split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const corsOptions =
  corsOrigin && corsOrigin.length > 0 ? { origin: corsOrigin } : undefined;

const rateLimiter = createRateLimiter({ windowMs: 60_000, max: 10 });

setInterval(() => rateLimiter.sweep(), 60_000).unref();

const app = createApp({
  createMessage,
  rateLimiter,
  logger,
  isProduction,
  distPath: path.join(__dirname, "../dist"),
  corsOptions,
});

app.listen(PORT, () => {
  logger.info("server started", {
    port: Number(PORT),
    mode: isProduction ? "production" : "api-only",
    hasApiKey: Boolean(createMessage),
    model: MODEL,
  });
});


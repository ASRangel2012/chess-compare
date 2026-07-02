/**
 * Pure helpers for the /api/analyze endpoint: request validation, prompt
 * construction, and (critically) parsing + shape-validating the model's reply.
 *
 * These are deliberately free of Express and the Anthropic SDK so they can be
 * unit tested directly — the branchy logic (bad input, malformed model output)
 * is exactly where bugs hide.
 */

import type {
  AnalyzeBody,
  PlayerGameAnalysis,
  PlayStyleInsight,
} from "../shared/contract";
// Re-export so existing importers (and tests) can keep importing these from
// this module, while the single definition lives in the shared contract.
export type { AnalyzeBody, PlayerGameAnalysis, PlayStyleInsight };

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * The model's reply hit the max_tokens cap before finishing. A distinct,
 * recognizable error so the /api/analyze route can map it to a 502 with an
 * actionable message (raise ANTHROPIC_MAX_TOKENS) instead of a generic 500.
 */
export class TruncatedReplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TruncatedReplyError";
  }
}

/**
 * The subset of PlayerGameAnalysis the prompt actually reads — and therefore
 * everything the server validates and requires. The client's wire type
 * (AnalyzeBody) also carries `username` and `commonOpenings`, but the server
 * never reads them, so it must not require them.
 */
export type PromptPlayerAnalysis = Omit<
  PlayerGameAnalysis,
  "username" | "commonOpenings"
>;

export interface ValidatedPlayerRef {
  name: string;
  analysis: PromptPlayerAnalysis;
}

/** What validateAnalyzeBody actually checked — exactly what buildPrompt needs. */
export interface ValidatedAnalyzeBody {
  player1: ValidatedPlayerRef;
  player2: ValidatedPlayerRef;
}

/**
 * Deep shape check for a single player's analysis. Truthiness alone is not
 * enough: an empty object passes a truthy test but then explodes in buildPrompt
 * when it dereferences openingsAsWhite.slice(...) on undefined. We confirm the
 * fields buildPrompt actually reads are the right runtime types so a
 * malformed-but-present body is rejected with a 400 instead of throwing.
 */
function isPromptPlayerAnalysis(a: unknown): a is PromptPlayerAnalysis {
  if (typeof a !== "object" || a === null) return false;
  const o = a as Record<string, unknown>;
  return (
    Array.isArray(o.openingsAsWhite) &&
    Array.isArray(o.openingsAsBlack) &&
    Array.isArray(o.gameLengthBuckets) &&
    typeof o.winRate === "number" &&
    typeof o.totalGames === "number" &&
    typeof o.wins === "number" &&
    typeof o.losses === "number" &&
    typeof o.draws === "number" &&
    typeof o.avgMoveCount === "number" &&
    typeof o.timeClassBreakdown === "object" &&
    o.timeClassBreakdown !== null
  );
}

/** True when a player ref carries an analysis field at all (present, non-null). */
function hasAnalysisField(ref: unknown): ref is { name?: unknown; analysis: unknown } {
  return (
    typeof ref === "object" &&
    ref !== null &&
    "analysis" in ref &&
    (ref as { analysis?: unknown }).analysis != null
  );
}

/**
 * Validate the POST body shape before we spend a Claude call on it. Returns a
 * `ValidatedAnalyzeBody` built purely from the fields that were actually
 * checked — no cast to the wider wire type, so the result can't smuggle
 * unvalidated fields (the old `body as AnalyzeBody` claimed `username` and
 * `commonOpenings` were present without ever checking them).
 */
export function validateAnalyzeBody(body: unknown): Result<ValidatedAnalyzeBody> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Missing player analysis data" };
  }
  const b = body as { player1?: unknown; player2?: unknown };
  // Missing entirely vs. present-but-malformed get distinct messages so the
  // client can tell "you forgot the data" from "the data is the wrong shape".
  if (!hasAnalysisField(b.player1) || !hasAnalysisField(b.player2)) {
    return { ok: false, error: "Missing player analysis data" };
  }
  if (
    typeof b.player1.name !== "string" ||
    typeof b.player2.name !== "string" ||
    !isPromptPlayerAnalysis(b.player1.analysis) ||
    !isPromptPlayerAnalysis(b.player2.analysis)
  ) {
    return { ok: false, error: "Malformed player analysis data" };
  }
  return {
    ok: true,
    value: {
      player1: { name: b.player1.name, analysis: b.player1.analysis },
      player2: { name: b.player2.name, analysis: b.player2.analysis },
    },
  };
}

function summarizeForPrompt(name: string, analysis: PromptPlayerAnalysis): string {
  const topWhite = analysis.openingsAsWhite
    .slice(0, 5)
    .map((o) => `${o.name} (${o.eco}): ${o.games} games, ${o.winRate}% win rate`)
    .join("\n  ");
  const topBlack = analysis.openingsAsBlack
    .slice(0, 5)
    .map((o) => `${o.name} (${o.eco}): ${o.games} games, ${o.winRate}% win rate`)
    .join("\n  ");
  const lengths = analysis.gameLengthBuckets
    .map((b) => `${b.label}: ${b.count}`)
    .join(", ");

  return `
Player: ${name}
Recent games analyzed: ${analysis.totalGames}
Record: ${analysis.wins}W / ${analysis.losses}L / ${analysis.draws}D (${analysis.winRate}% win rate)
Average game length: ${analysis.avgMoveCount} moves
Game length distribution: ${lengths}
Time controls: ${JSON.stringify(analysis.timeClassBreakdown)}
Top openings as White:
  ${topWhite || "None"}
Top openings as Black:
  ${topBlack || "None"}
`.trim();
}

export function buildPrompt(body: ValidatedAnalyzeBody): string {
  const p1 = body.player1.name;
  const p2 = body.player2.name;
  return `You are a chess coach analyzing two Chess.com players based on their recent game statistics.

${summarizeForPrompt(p1, body.player1.analysis)}

---

${summarizeForPrompt(p2, body.player2.analysis)}

Write insightful chess personality profiles for each player, a brief head-to-head style matchup, and a deep, actionable game plan for how ${p1} can beat ${p2}.

Respond in JSON only with this exact shape:
{
  "player1": "2-3 paragraph profile for ${p1}",
  "player2": "2-3 paragraph profile for ${p2}",
  "matchup": "1-2 paragraph analysis of how these styles would clash and what to watch for",
  "gamePlan": "A detailed, multi-paragraph game plan for how ${p1} should play to beat ${p2}. Ground every recommendation in the data: which openings to steer toward and which to avoid (cite ${p2}'s weakest and strongest openings by win rate and color), whether to keep the game sharp and tactical or slow and positional based on where ${p2} struggles, how to exploit their game-length and time-control tendencies, and concrete guidance for the opening, middlegame, and endgame. Be specific and prescriptive — this should read like a coach's pre-match briefing."
}

Focus on: opening preferences, tactical vs positional tendencies, game length patterns, aggression level, and time control habits. Be specific, reference the data, and avoid generic advice.`;
}

/**
 * Parse and shape-validate the play-style JSON from the model's reply.
 *
 * The reply comes from a *forced tool call* (`createMessage` re-stringifies the
 * already-parsed tool input), so it is always a bare JSON document — the old
 * "pull the first {...} out of prose or a code fence" regex path was dead code.
 * We still confirm every expected field is a non-empty string BEFORE returning
 * it — a missing gamePlan used to flow straight through to the UI as undefined
 * and crash .split() in the client. Parse/shape failures keep mapping to 502.
 */
export function extractAnalysisJson(text: string): Result<PlayStyleInsight> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "Model response was not valid JSON" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: "Model response was not a JSON object" };
  }

  const fields: (keyof PlayStyleInsight)[] = [
    "player1",
    "player2",
    "matchup",
    "gamePlan",
  ];
  const obj = parsed as Record<string, unknown>;
  const missing = fields.filter(
    (f) => typeof obj[f] !== "string" || (obj[f] as string).trim() === ""
  );
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Model response missing fields: ${missing.join(", ")}`,
    };
  }

  return {
    ok: true,
    value: {
      player1: obj.player1 as string,
      player2: obj.player2 as string,
      matchup: obj.matchup as string,
      gamePlan: obj.gamePlan as string,
    },
  };
}

/**
 * Pure helpers for the /api/analyze endpoint: request validation, prompt
 * construction, and (critically) parsing + shape-validating the model's reply.
 *
 * These are deliberately free of Express and the Anthropic SDK so they can be
 * unit tested directly — the branchy logic (bad input, malformed model output)
 * is exactly where bugs hide.
 */

export interface OpeningStats {
  name: string;
  eco: string;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
}

export interface PlayerGameAnalysis {
  totalGames: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  avgMoveCount: number;
  openingsAsWhite: OpeningStats[];
  openingsAsBlack: OpeningStats[];
  gameLengthBuckets: { label: string; count: number }[];
  timeClassBreakdown: Record<string, number>;
}

export interface AnalyzeBody {
  player1: { name: string; analysis: PlayerGameAnalysis };
  player2: { name: string; analysis: PlayerGameAnalysis };
}

export interface PlayStyleInsight {
  player1: string;
  player2: string;
  matchup: string;
  gamePlan: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/** Validate the POST body shape before we spend a Claude call on it. */
export function validateAnalyzeBody(body: unknown): Result<AnalyzeBody> {
  const b = body as Partial<AnalyzeBody> | null | undefined;
  if (!b?.player1?.analysis || !b?.player2?.analysis) {
    return { ok: false, error: "Missing player analysis data" };
  }
  return { ok: true, value: b as AnalyzeBody };
}

function summarizeForPrompt(name: string, analysis: PlayerGameAnalysis): string {
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

export function buildPrompt(body: AnalyzeBody): string {
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
 * Extract and validate the play-style JSON from the model's raw text reply.
 *
 * The model is asked for JSON-only, but may still wrap it in prose or a code
 * fence, so we pull the first {...} block. We then confirm every expected field
 * is a non-empty string BEFORE returning it — a missing `gamePlan` used to flow
 * straight through to the UI as `undefined` and crash `.split()` in the client.
 */
export function extractAnalysisJson(text: string): Result<PlayStyleInsight> {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { ok: false, error: "Model response contained no JSON object" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return { ok: false, error: "Model response was not valid JSON" };
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

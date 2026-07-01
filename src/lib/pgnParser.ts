import type { ChessGame, ParsedGame, PlayerGameAnalysis, OpeningStats } from "./types";
import { parsePgnMoves } from "./chess";
import { logger } from "./logger";

export function parsePgnHeader(pgn: string, tag: string): string | undefined {
  const match = pgn.match(new RegExp(`\\[${tag}\\s+"([^"]*)"\\]`));
  return match?.[1];
}

/**
 * Chess.com PGNs do not include an `[Opening "..."]` tag — only `[ECO]` and
 * `[ECOUrl]`. Derive a human-readable opening name from the ECOUrl slug,
 * falling back to the top-level `eco` field (which is sometimes a URL).
 * e.g. ".../openings/Italian-Game-Classical-Variation" -> "Italian Game Classical Variation"
 */
export function openingNameFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const slug = url.split("/").filter(Boolean).pop();
  if (!slug) return undefined;
  // Reject bare ECO codes (e.g. "C50", "B20") — they are not opening names. A
  // single-word slug like "Reti" is a real name, so don't require a hyphen.
  if (/^[A-E]\d{2}$/i.test(slug)) return undefined;
  const name = decodeURIComponent(slug)
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return name || undefined;
}

/** Resolve the opening name for a game from any available source. */
export function extractOpeningName(game: ChessGame): string {
  return (
    parsePgnHeader(game.pgn, "Opening") ??
    openingNameFromUrl(parsePgnHeader(game.pgn, "ECOUrl")) ??
    openingNameFromUrl(game.eco) ??
    "Unknown Opening"
  );
}

/**
 * Resolve a game's time class. Prefer the API-provided `time_class`; if it is
 * missing, derive it from the PGN `TimeControl` header. Daily/correspondence
 * controls use a "moves/seconds-per-move" form (e.g. "1/259200"); live games
 * use "base" or "base+increment" seconds (e.g. "300+2").
 */
export function deriveTimeClass(game: ChessGame): string {
  if (game.time_class) return game.time_class;
  const tc = game.time_control ?? parsePgnHeader(game.pgn, "TimeControl");
  if (!tc) return "unknown";
  if (tc.includes("/")) return "daily";
  const [baseStr, incStr] = tc.split("+");
  const base = Number(baseStr);
  const inc = Number(incStr ?? 0);
  if (!Number.isFinite(base)) return "unknown";
  if (base >= 86400) return "daily";
  const estimated = base + inc * 40;
  if (estimated < 180) return "bullet";
  if (estimated < 600) return "blitz";
  return "rapid";
}

const DRAW_RESULTS = new Set([
  "draw",
  "agreed",
  "repetition",
  "stalemate",
  "insufficient",
  "50move",
  "timevsinsufficient",
]);
const LOSS_RESULTS = new Set([
  "checkmated",
  "resigned",
  "timeout",
  "abandoned",
  "lose",
]);

export function normalizeResult(result: string): "win" | "loss" | "draw" {
  if (result === "win") return "win";
  if (DRAW_RESULTS.has(result)) return "draw";
  if (!LOSS_RESULTS.has(result)) {
    // Unknown code: still treat as a loss (safe default) but leave a breadcrumb
    // so a new Chess.com result string doesn't silently skew win rates.
    logger.debug("normalizeResult: unrecognized result code, treating as loss", {
      result,
    });
  }
  return "loss";
}

/**
 * Count *full moves* (one per White move) in a game's PGN movetext. Delegates to
 * the shared SAN tokenizer so it's robust to whitespace (e.g. "1.e4" with no
 * space after the dot) instead of the old move-number regex, which silently
 * returned 0 for tightly-formatted PGNs. Full moves = ceil(plies / 2), which
 * preserves the historical count so averages and length buckets are unchanged.
 * Exported so the head-to-head module shares one definition.
 */
export function countMoves(pgn: string): number {
  return Math.ceil(parsePgnMoves(pgn).length / 2);
}

export function parseGame(
  game: ChessGame,
  username: string
): ParsedGame | null {
  const lowerUser = username.toLowerCase();
  const isWhite = game.white.username.toLowerCase() === lowerUser;
  const isBlack = game.black.username.toLowerCase() === lowerUser;

  if (!isWhite && !isBlack) return null;

  const player = isWhite ? game.white : game.black;
  const opening = extractOpeningName(game);
  const eco = parsePgnHeader(game.pgn, "ECO") ?? "—";

  const accuracyStr = parsePgnHeader(game.pgn, "Accuracy");
  const accuracy = accuracyStr ? parseFloat(accuracyStr) : undefined;

  return {
    eco,
    opening,
    color: isWhite ? "white" : "black",
    result: normalizeResult(player.result),
    moveCount: countMoves(game.pgn),
    timeControl: game.time_control ?? parsePgnHeader(game.pgn, "TimeControl") ?? "—",
    timeClass: deriveTimeClass(game),
    rated: game.rated,
    endTime: game.end_time,
    opponent: isWhite ? game.black.username : game.white.username,
    accuracy,
  };
}

function aggregateOpenings(
  games: ParsedGame[],
  color?: "white" | "black"
): OpeningStats[] {
  const filtered = color ? games.filter((g) => g.color === color) : games;
  const map = new Map<string, OpeningStats>();

  for (const game of filtered) {
    const key = `${game.eco}|${game.opening}`;
    const existing = map.get(key) ?? {
      name: game.opening,
      eco: game.eco,
      games: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      winRate: 0,
    };

    existing.games++;
    if (game.result === "win") existing.wins++;
    else if (game.result === "loss") existing.losses++;
    else existing.draws++;

    map.set(key, existing);
  }

  return [...map.values()]
    .map((o) => ({
      ...o,
      winRate: o.games > 0 ? Math.round((o.wins / o.games) * 100) : 0,
    }))
    .sort((a, b) => b.games - a.games);
}

function buildLengthBuckets(games: ParsedGame[]): { label: string; count: number }[] {
  const buckets = [
    { label: "≤20 moves", min: 0, max: 20, count: 0 },
    { label: "21–40 moves", min: 21, max: 40, count: 0 },
    { label: "41–60 moves", min: 41, max: 60, count: 0 },
    { label: "60+ moves", min: 61, max: Infinity, count: 0 },
  ];

  for (const game of games) {
    const bucket = buckets.find(
      (b) => game.moveCount >= b.min && game.moveCount <= b.max
    );
    if (bucket) bucket.count++;
  }

  return buckets.map(({ label, count }) => ({ label, count }));
}

export function analyzeGames(
  games: ChessGame[],
  username: string
): PlayerGameAnalysis {
  const parsed = games
    .map((g) => parseGame(g, username))
    .filter((g): g is ParsedGame => g !== null);

  const wins = parsed.filter((g) => g.result === "win").length;
  const losses = parsed.filter((g) => g.result === "loss").length;
  const draws = parsed.filter((g) => g.result === "draw").length;
  const total = parsed.length;

  const timeClassBreakdown: Record<string, number> = {};
  for (const g of parsed) {
    timeClassBreakdown[g.timeClass] = (timeClassBreakdown[g.timeClass] ?? 0) + 1;
  }

  // Average full-move count (see countMoves) — measured in full moves, not plies.
  const avgMoveCount =
    total > 0
      ? Math.round(parsed.reduce((sum, g) => sum + g.moveCount, 0) / total)
      : 0;

  const openingsAsWhite = aggregateOpenings(parsed, "white");
  const openingsAsBlack = aggregateOpenings(parsed, "black");
  const commonOpenings = aggregateOpenings(parsed);

  return {
    username,
    totalGames: total,
    wins,
    losses,
    draws,
    winRate: total > 0 ? Math.round((wins / total) * 100) : 0,
    avgMoveCount,
    openingsAsWhite,
    openingsAsBlack,
    commonOpenings,
    gameLengthBuckets: buildLengthBuckets(parsed),
    timeClassBreakdown,
  };
}

import type { ChessGame, ParsedGame, PlayerGameAnalysis, OpeningStats } from "./types";

export function parsePgnHeader(pgn: string, tag: string): string | undefined {
  const match = pgn.match(new RegExp(`\\[${tag}\\s+"([^"]*)"\\]`));
  return match?.[1];
}

export function normalizeResult(
  result: string
): "win" | "loss" | "draw" {
  if (result === "win") return "win";
  if (result === "draw" || result === "agreed" || result === "repetition" || result === "stalemate" || result === "insufficient" || result === "50move" || result === "timevsinsufficient") {
    return "draw";
  }
  return "loss";
}

function countMoves(pgn: string): number {
  const moveSection = pgn.split("\n\n").slice(1).join("\n\n");
  const moves = moveSection.match(/\d+\.\s+\S+/g);
  return moves?.length ?? 0;
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
  const opening =
    parsePgnHeader(game.pgn, "Opening") ??
    parsePgnHeader(game.pgn, "ECOUrl") ??
    "Unknown Opening";
  const eco = parsePgnHeader(game.pgn, "ECO") ?? game.eco ?? "—";

  const accuracyStr = parsePgnHeader(game.pgn, "Accuracy");
  const accuracy = accuracyStr ? parseFloat(accuracyStr) : undefined;

  return {
    eco,
    opening,
    color: isWhite ? "white" : "black",
    result: normalizeResult(player.result),
    moveCount: countMoves(game.pgn),
    timeControl: game.time_control ?? parsePgnHeader(game.pgn, "TimeControl") ?? "—",
    timeClass: game.time_class ?? parsePgnHeader(game.pgn, "TimeClass") ?? "unknown",
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

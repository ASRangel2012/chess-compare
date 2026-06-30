import type { ChessGame } from "./types";
import {
  parsePgnHeader,
  normalizeResult,
  extractOpeningName,
  deriveTimeClass,
} from "./pgnParser";
import type { HeadToHeadGameEntry, HeadToHeadSummary } from "./types";

export function analyzeHeadToHead(
  games: ChessGame[],
  player1: string,
  _player2: string
): HeadToHeadSummary {
  const u1 = player1.toLowerCase();
  let player1Wins = 0;
  let player1Losses = 0;
  let player1Draws = 0;
  const entries: HeadToHeadGameEntry[] = [];

  for (const game of games) {
    const isWhite = game.white.username.toLowerCase() === u1;
    const isBlack = game.black.username.toLowerCase() === u1;
    if (!isWhite && !isBlack) continue;

    const p1 = isWhite ? game.white : game.black;
    const p2 = isWhite ? game.black : game.white;
    const result = normalizeResult(p1.result);

    if (result === "win") player1Wins++;
    else if (result === "loss") player1Losses++;
    else player1Draws++;

    const opening = extractOpeningName(game);
    const eco = parsePgnHeader(game.pgn, "ECO") ?? "—";
    const moveSection = game.pgn.split("\n\n").slice(1).join("\n\n");
    const moveCount = moveSection.match(/\d+\.\s+\S+/g)?.length ?? 0;

    entries.push({
      url: game.url,
      date: game.end_time,
      opening,
      eco,
      timeClass: deriveTimeClass(game),
      rated: game.rated,
      player1Color: isWhite ? "white" : "black",
      player1Result: result,
      player1Rating: p1.rating,
      player2Rating: p2.rating,
      moveCount,
      pgn: game.pgn,
    });
  }

  entries.sort((a, b) => b.date - a.date);

  return {
    totalGames: entries.length,
    player1Wins,
    player1Losses,
    player1Draws,
    player2Wins: player1Losses,
    player2Losses: player1Wins,
    player2Draws: player1Draws,
    games: entries,
  };
}

import { describe, it, expect } from "vitest";
import { analyzeHeadToHead } from "./headToHead";
import type { ChessGame, GamePlayer } from "./types";

function h2hGame(opts: {
  url: string;
  date: number;
  whiteUser: string;
  blackUser: string;
  whiteResult: GamePlayer["result"];
  blackResult: GamePlayer["result"];
}): ChessGame {
  return {
    url: opts.url,
    end_time: opts.date,
    rated: true,
    rules: "chess",
    time_class: "blitz",
    eco: "https://www.chess.com/openings/Sicilian-Defense",
    pgn: [
      `[White "${opts.whiteUser}"]`,
      `[Black "${opts.blackUser}"]`,
      '[ECO "B20"]',
      '[ECOUrl "https://www.chess.com/openings/Sicilian-Defense"]',
      "",
      "1. e4 c5 2. Nf3 d6 1-0",
    ].join("\n"),
    white: { username: opts.whiteUser, rating: 1600, result: opts.whiteResult },
    black: { username: opts.blackUser, rating: 1590, result: opts.blackResult },
  };
}

describe("analyzeHeadToHead", () => {
  const games: ChessGame[] = [
    // alice (white) beats bob
    h2hGame({ url: "g1", date: 100, whiteUser: "alice", blackUser: "bob", whiteResult: "win", blackResult: "checkmated" }),
    // bob (white) beats alice
    h2hGame({ url: "g2", date: 300, whiteUser: "bob", blackUser: "alice", whiteResult: "win", blackResult: "resigned" }),
    // draw
    h2hGame({ url: "g3", date: 200, whiteUser: "alice", blackUser: "bob", whiteResult: "agreed", blackResult: "agreed" }),
  ];

  it("tallies player1's record from their own perspective", () => {
    const s = analyzeHeadToHead(games, "alice", "bob");
    expect(s.totalGames).toBe(3);
    expect(s.player1Wins).toBe(1);
    expect(s.player1Losses).toBe(1);
    expect(s.player1Draws).toBe(1);
  });

  it("mirrors the record onto player2", () => {
    const s = analyzeHeadToHead(games, "alice", "bob");
    expect(s.player2Wins).toBe(s.player1Losses);
    expect(s.player2Losses).toBe(s.player1Wins);
    expect(s.player2Draws).toBe(s.player1Draws);
  });

  it("sorts the game entries newest-first", () => {
    const s = analyzeHeadToHead(games, "alice", "bob");
    expect(s.games.map((g) => g.date)).toEqual([300, 200, 100]);
  });

  it("records the correct color and result per entry", () => {
    const s = analyzeHeadToHead(games, "alice", "bob");
    const g1 = s.games.find((g) => g.url === "g1")!;
    expect(g1.player1Color).toBe("white");
    expect(g1.player1Result).toBe("win");
    const g2 = s.games.find((g) => g.url === "g2")!;
    expect(g2.player1Color).toBe("black");
    expect(g2.player1Result).toBe("loss");
  });

  it("is case-insensitive and skips games the player is not in", () => {
    const extra = [
      ...games,
      h2hGame({ url: "other", date: 400, whiteUser: "carol", blackUser: "dave", whiteResult: "win", blackResult: "resigned" }),
    ];
    const s = analyzeHeadToHead(extra, "ALICE", "BOB");
    expect(s.totalGames).toBe(3); // the carol/dave game is ignored
  });

  it("returns an empty summary for no games", () => {
    const s = analyzeHeadToHead([], "alice", "bob");
    expect(s.totalGames).toBe(0);
    expect(s.games).toEqual([]);
  });
});

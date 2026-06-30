import { describe, it, expect } from "vitest";
import {
  parsePgnHeader,
  openingNameFromUrl,
  extractOpeningName,
  deriveTimeClass,
  normalizeResult,
  parseGame,
  analyzeGames,
} from "./pgnParser";
import type { ChessGame, GamePlayer } from "./types";

/** Build a minimal Chess.com-style game for tests. */
function makeGame(overrides: Partial<ChessGame> = {}): ChessGame {
  const white: GamePlayer = { username: "alice", rating: 1500, result: "win" };
  const black: GamePlayer = { username: "bob", rating: 1480, result: "checkmated" };
  const pgn = [
    '[Event "Live Chess"]',
    '[White "alice"]',
    '[Black "bob"]',
    '[Result "1-0"]',
    '[ECO "C50"]',
    '[ECOUrl "https://www.chess.com/openings/Italian-Game-Classical-Variation"]',
    '[TimeControl "300+2"]',
    "",
    "1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 1-0",
  ].join("\n");
  return {
    url: "https://www.chess.com/game/live/1",
    pgn,
    end_time: 1_700_000_000,
    rated: true,
    white,
    black,
    time_class: "rapid",
    rules: "chess",
    ...overrides,
  };
}

describe("parsePgnHeader", () => {
  it("extracts a tag value", () => {
    expect(parsePgnHeader(makeGame().pgn, "ECO")).toBe("C50");
    expect(parsePgnHeader(makeGame().pgn, "White")).toBe("alice");
  });

  it("returns undefined for a missing tag", () => {
    expect(parsePgnHeader(makeGame().pgn, "Opening")).toBeUndefined();
  });
});

describe("openingNameFromUrl", () => {
  it("turns an ECOUrl slug into a readable name", () => {
    expect(
      openingNameFromUrl(
        "https://www.chess.com/openings/Italian-Game-Classical-Variation"
      )
    ).toBe("Italian Game Classical Variation");
  });

  it("decodes percent-encoded slugs", () => {
    expect(
      openingNameFromUrl("https://www.chess.com/openings/Bishop%27s-Opening")
    ).toBe("Bishop's Opening");
  });

  it("returns undefined for undefined or dash-less slugs", () => {
    expect(openingNameFromUrl(undefined)).toBeUndefined();
    expect(openingNameFromUrl("https://www.chess.com/openings/Sicilian")).toBeUndefined();
  });
});

describe("extractOpeningName", () => {
  it("derives the name from the ECOUrl header (Chess.com has no [Opening] tag)", () => {
    expect(extractOpeningName(makeGame())).toBe("Italian Game Classical Variation");
  });

  it("falls back to the eco field when it is a URL", () => {
    const game = makeGame({
      pgn: '[White "alice"]\n[Black "bob"]\n\n1. e4 1-0',
      eco: "https://www.chess.com/openings/Kings-Pawn-Opening",
    });
    expect(extractOpeningName(game)).toBe("Kings Pawn Opening");
  });

  it("returns 'Unknown Opening' when nothing is available", () => {
    const game = makeGame({ pgn: '[White "alice"]\n[Black "bob"]\n\n1. e4 1-0', eco: undefined });
    expect(extractOpeningName(game)).toBe("Unknown Opening");
  });
});

describe("deriveTimeClass", () => {
  it("prefers the API-provided time_class", () => {
    expect(deriveTimeClass(makeGame({ time_class: "blitz" }))).toBe("blitz");
  });

  it("treats correspondence 'moves/seconds' controls as daily", () => {
    const game = makeGame({ time_class: undefined, time_control: "1/259200" });
    expect(deriveTimeClass(game)).toBe("daily");
  });

  it.each([
    ["60", "bullet"], // est 60  -> bullet (<180)
    ["120+1", "bullet"], // est 160 -> bullet
    ["180+2", "blitz"], // est 260 -> blitz (<600)
    ["300+2", "blitz"], // est 380 -> blitz
    ["600", "rapid"], // est 600 -> rapid (not <600)
    ["86400", "daily"], // base >= 86400 -> daily
  ])("derives %s from TimeControl as %s", (tc, expected) => {
    const game = makeGame({ time_class: undefined, time_control: tc });
    expect(deriveTimeClass(game)).toBe(expected);
  });

  it("returns 'unknown' for missing or unparseable controls", () => {
    expect(deriveTimeClass(makeGame({ time_class: undefined, time_control: undefined, pgn: "no headers" }))).toBe("unknown");
    expect(deriveTimeClass(makeGame({ time_class: undefined, time_control: "abc" }))).toBe("unknown");
  });
});

describe("normalizeResult", () => {
  it("maps a win", () => {
    expect(normalizeResult("win")).toBe("win");
  });

  it.each(["checkmated", "resigned", "timeout", "abandoned"])(
    "maps %s to a loss",
    (r) => expect(normalizeResult(r)).toBe("loss")
  );

  it.each([
    "draw",
    "agreed",
    "repetition",
    "stalemate",
    "insufficient",
    "50move",
    "timevsinsufficient",
  ])("maps %s to a draw", (r) => expect(normalizeResult(r)).toBe("draw"));
});

describe("parseGame", () => {
  it("returns null when the user did not play in the game", () => {
    expect(parseGame(makeGame(), "carol")).toBeNull();
  });

  it("parses the white player's perspective", () => {
    const parsed = parseGame(makeGame(), "alice");
    expect(parsed).not.toBeNull();
    expect(parsed!.color).toBe("white");
    expect(parsed!.result).toBe("win");
    expect(parsed!.opponent).toBe("bob");
    expect(parsed!.eco).toBe("C50");
    expect(parsed!.moveCount).toBe(3); // counts full moves: 1. 2. 3.
  });

  it("parses the black player's perspective and normalizes the result", () => {
    const parsed = parseGame(makeGame(), "bob");
    expect(parsed!.color).toBe("black");
    expect(parsed!.result).toBe("loss"); // "checkmated" -> loss
    expect(parsed!.opponent).toBe("alice");
  });

  it("is case-insensitive on username", () => {
    expect(parseGame(makeGame(), "ALICE")!.color).toBe("white");
  });

  it("reads accuracy when present", () => {
    const pgn = '[White "alice"]\n[Black "bob"]\n[WhiteAccuracy "88.5"]\n[Accuracy "88.5"]\n\n1. e4 1-0';
    expect(parseGame(makeGame({ pgn }), "alice")!.accuracy).toBeCloseTo(88.5);
  });
});

describe("analyzeGames", () => {
  const games: ChessGame[] = [
    makeGame({ url: "g1", white: { username: "alice", result: "win" }, black: { username: "bob", result: "checkmated" } }),
    makeGame({
      url: "g2",
      white: { username: "carol", result: "win" },
      black: { username: "alice", result: "resigned" }, // alice loses as black
    }),
    makeGame({
      url: "g3",
      white: { username: "alice", result: "agreed" }, // draw
      black: { username: "dave", result: "agreed" },
    }),
    makeGame({ url: "g4", white: { username: "x", result: "win" }, black: { username: "y", result: "resigned" } }), // alice absent
  ];

  it("aggregates only the user's games with correct W/L/D and win rate", () => {
    const a = analyzeGames(games, "alice");
    expect(a.totalGames).toBe(3);
    expect(a.wins).toBe(1);
    expect(a.losses).toBe(1);
    expect(a.draws).toBe(1);
    expect(a.winRate).toBe(33); // round(1/3 * 100)
  });

  it("splits openings by color", () => {
    const a = analyzeGames(games, "alice");
    const whiteGames = a.openingsAsWhite.reduce((n, o) => n + o.games, 0);
    const blackGames = a.openingsAsBlack.reduce((n, o) => n + o.games, 0);
    expect(whiteGames).toBe(2); // g1, g3
    expect(blackGames).toBe(1); // g2
  });

  it("builds a time-class breakdown and length buckets", () => {
    const a = analyzeGames(games, "alice");
    expect(a.timeClassBreakdown.rapid).toBe(3);
    const bucketTotal = a.gameLengthBuckets.reduce((n, b) => n + b.count, 0);
    expect(bucketTotal).toBe(3);
  });

  it("handles an empty game list without dividing by zero", () => {
    const a = analyzeGames([], "alice");
    expect(a.totalGames).toBe(0);
    expect(a.winRate).toBe(0);
    expect(a.avgMoveCount).toBe(0);
  });
});

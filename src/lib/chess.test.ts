import { describe, it, expect } from "vitest";
import {
  replayGame,
  parsePgnMoves,
  pgnTokenCacheSize,
  PGN_TOKEN_CACHE_MAX,
  startPosition,
  squareName,
} from "./chess";

const idx = (name: string) => name.charCodeAt(0) - 97 + (name.charCodeAt(1) - 49) * 8;

describe("parsePgnMoves", () => {
  it("strips move numbers, comments, clocks, and the result", () => {
    const pgn =
      '[White "a"]\n[Black "b"]\n\n1. e4 {[%clk 0:03:00]} 1... e5 {[%clk 0:02:58]} 2. Nf3 Nc6 1-0';
    expect(parsePgnMoves(pgn)).toEqual(["e4", "e5", "Nf3", "Nc6"]);
  });

  it("handles bare movetext with NAGs", () => {
    expect(parsePgnMoves("1. d4 d5 2. c4 $1 e6 *")).toEqual(["d4", "d5", "c4", "e6"]);
  });

  it("memoizes token lists per PGN string", () => {
    const pgn = "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6";
    const first = parsePgnMoves(pgn);
    const second = parsePgnMoves(pgn);
    // Same reference proves the second call was a cache hit, not a re-tokenize.
    expect(second).toBe(first);
  });

  it("bounds the memo cache", () => {
    for (let i = 0; i < PGN_TOKEN_CACHE_MAX + 25; i++) {
      parsePgnMoves(`1. e4 e5 {game ${i}}`);
    }
    expect(pgnTokenCacheSize()).toBeLessThanOrEqual(PGN_TOKEN_CACHE_MAX);
  });
});

describe("startPosition", () => {
  it("places the back ranks and pawns", () => {
    const b = startPosition();
    expect(b[idx("a1")]).toBe("R");
    expect(b[idx("e1")]).toBe("K");
    expect(b[idx("d8")]).toBe("q");
    expect(b[idx("e2")]).toBe("P");
    expect(b[idx("e7")]).toBe("p");
    expect(b[idx("e4")]).toBeNull();
  });
});

// Fixture games reused by the no-silent-truncation regression suite below.
const FIXTURE_PGNS = {
  operaGame: `1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6
7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8
13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8#`,
  enPassant: "1. e4 d5 2. e5 f5 3. exf6",
  promotion: "1. h4 g5 2. hxg5 h6 3. gxh6 a5 4. hxg7 a4 5. gxh8=Q",
  pinDisambiguation: "1. e4 e6 2. d4 Bb4+ 3. Nc3 a5 4. Nh3 d6 5. Nf4 Nc6 6. Nd5",
} as const;

describe("replayGame — the Opera Game (Morphy, 1858)", () => {
  // Exercises captures, queenside castling, knight disambiguation (Nbd7),
  // checks, and checkmate.
  const { plies, truncated } = replayGame(FIXTURE_PGNS.operaGame);

  it("replays every half-move without breaking", () => {
    // 16 full moves (32 plies) + White's 17th = 33 plies, +1 start = 34.
    expect(plies).toHaveLength(34);
    expect(truncated).toBe(false);
  });

  it("ends with the mating rook on d8 and Black king on e8", () => {
    const final = plies[plies.length - 1].board;
    expect(final[idx("d8")]).toBe("R");
    expect(final[idx("e8")]).toBe("k");
    expect(final[plies[plies.length - 1].lastMove![1]]).toBe("R");
  });

  it("performs queenside castling at move 12 (King c1, Rook d1)", () => {
    // ply index: move 12 White = (12-1)*2 + 1 = 23rd ply -> plies[23]
    const afterCastle = plies[23].board;
    expect(afterCastle[idx("c1")]).toBe("K");
    expect(afterCastle[idx("d1")]).toBe("R");
    expect(afterCastle[idx("e1")]).toBeNull();
  });

  it("resolves the Nbd7 disambiguation (b8 knight, not f6 knight)", () => {
    // After 11...Nbd7, d7 holds a knight and f6 still holds the other knight.
    const afterNbd7 = plies[22].board;
    expect(afterNbd7[idx("d7")]).toBe("n");
    expect(afterNbd7[idx("f6")]).toBe("n");
    expect(afterNbd7[idx("b8")]).toBeNull();
  });
});

describe("replayGame — en passant", () => {
  it("removes the passed pawn on an en passant capture", () => {
    const { plies } = replayGame(FIXTURE_PGNS.enPassant);
    const final = plies[plies.length - 1].board;
    expect(final[idx("f6")]).toBe("P"); // capturing pawn landed on f6
    expect(final[idx("f5")]).toBeNull(); // the passed pawn was removed
    expect(final[idx("e5")]).toBeNull(); // capturing pawn left e5
  });
});

describe("replayGame — promotion", () => {
  it("promotes a pawn to a queen on the back rank", () => {
    const { plies } = replayGame(FIXTURE_PGNS.promotion);
    const final = plies[plies.length - 1].board;
    expect(final[idx("h8")]).toBe("Q");
  });
});

describe("replayGame — implicit disambiguation by pin", () => {
  // 1.e4 e6 2.d4 Bb4+ 3.Nc3 a5 4.Nh3 d6 5.Nf4 Nc6 6.Nd5
  // Both the c3- and f4-knights can geometrically reach d5, so the SAN carries
  // no disambiguation — but the c3-knight is pinned to the e1-king by the
  // b4-bishop, so only Nf4-d5 is legal. This is the one case that forces the
  // engine's king-safety fallback rather than plain file/rank disambiguation.
  // c3 (index 18) is scanned before f4 (index 29), so a naive candidates[0]
  // would wrongly pick the pinned knight.
  const { plies, truncated } = replayGame(FIXTURE_PGNS.pinDisambiguation);

  it("replays all 11 half-moves", () => {
    expect(truncated).toBe(false);
    expect(plies).toHaveLength(12); // 11 plies + start
    expect(plies[plies.length - 1].san).toBe("Nd5");
  });

  it("moves the unpinned f4-knight, leaving the pinned c3-knight in place", () => {
    const final = plies[plies.length - 1].board;
    expect(final[idx("d5")]).toBe("N"); // knight arrived
    expect(final[idx("f4")]).toBeNull(); // it came from f4, not c3
    expect(final[idx("c3")]).toBe("N"); // the pinned knight never moved
    expect(plies[plies.length - 1].lastMove).toEqual([idx("f4"), idx("d5")]);
  });
});

describe("replayGame — no silent truncation (regression)", () => {
  it.each(Object.entries(FIXTURE_PGNS))(
    "applies every parsed SAN for fixture %s",
    (_name, pgn) => {
      const { plies, truncated, failedSan } = replayGame(pgn);
      expect(truncated).toBe(false);
      expect(failedSan).toBeUndefined();
      // Applied plies (minus the start position) must equal the token count —
      // anything less means a move was silently dropped.
      expect(plies.length - 1).toBe(parsePgnMoves(pgn).length);
    }
  );

  it("flags a corrupt SAN as truncated and stops at the last good ply", () => {
    // "Zz9" is unparseable; everything before it must survive.
    const good = "1. e4 e5 2. Nf3";
    const { plies, truncated, failedSan } = replayGame(`${good} Zz9 3. Bc4`);
    expect(truncated).toBe(true);
    expect(failedSan).toBe("Zz9");
    expect(plies.length - 1).toBe(3); // e4, e5, Nf3 applied — nothing after
    const last = plies[plies.length - 1];
    expect(last.san).toBe("Nf3");
    expect(last.board[idx("f3")]).toBe("N");
  });

  it("throws (as truncation) on a genuinely ambiguous SAN instead of guessing", () => {
    // After 1.d4 a6 2.Nf3 b6, both the b1- and f3-knights can legally reach d2
    // and neither is pinned — bare "Nd2" is ambiguous, and picking either would
    // be a guess. The replay must stop rather than render a maybe-wrong board.
    const { plies, truncated, failedSan } = replayGame("1. d4 a6 2. Nf3 b6 3. Nd2");
    expect(truncated).toBe(true);
    expect(failedSan).toBe("Nd2");
    expect(plies.length - 1).toBe(4);
  });

  it("throws (as truncation) when no piece can play the SAN", () => {
    // No white knight can reach f6 from the start position.
    const { truncated, failedSan } = replayGame("1. Nf6");
    expect(truncated).toBe(true);
    expect(failedSan).toBe("Nf6");
  });

  it("throws (as truncation) on castling with the king off its home square", () => {
    // After 2.Ke2 the white king sits on e2. "O-O" used to execute four
    // unconditional board writes: it copied e1 (empty) onto g1 — deleting the
    // g1 knight — and moved the h1 rook onto f1 — deleting the bishop. The
    // replay then continued on a board the game never described.
    const { plies, truncated, failedSan } = replayGame("1. e4 e5 2. Ke2 Nf6 3. O-O");
    expect(truncated).toBe(true);
    expect(failedSan).toBe("O-O");
    expect(plies.length - 1).toBe(4); // e4, e5, Ke2, Nf6 applied — nothing after
    const last = plies[plies.length - 1].board;
    expect(last[idx("g1")]).toBe("N"); // knight not silently deleted
    expect(last[idx("f1")]).toBe("B"); // bishop not silently overwritten
    expect(last[idx("h1")]).toBe("R"); // rook not silently moved
  });

  it("throws (as truncation) on castling through occupied squares", () => {
    // From the start position f1/g1 are occupied; "1. O-O" is mechanically
    // impossible and must stop the replay with the board untouched.
    const { plies, truncated, failedSan } = replayGame("1. O-O e5");
    expect(truncated).toBe(true);
    expect(failedSan).toBe("O-O");
    expect(plies).toHaveLength(1); // only the start position
    expect(plies[0].board[idx("g1")]).toBe("N");
  });

  it("throws (as truncation) when the inferred pawn source is empty", () => {
    // "c5" as White's first move implies c3 or c4 holds a white pawn — neither
    // does. The old code silently 'moved' an empty square.
    const { plies, truncated, failedSan } = replayGame("1. c5 e5");
    expect(truncated).toBe(true);
    expect(failedSan).toBe("c5");
    expect(plies).toHaveLength(1); // only the start position
    expect(plies[0].board[idx("c2")]).toBe("P"); // board untouched
  });
});

describe("squareName", () => {
  it("round-trips index to algebraic", () => {
    expect(squareName(0)).toBe("a1");
    expect(squareName(63)).toBe("h8");
    expect(squareName(28)).toBe("e4");
  });
});

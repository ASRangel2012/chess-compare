import { describe, it, expect } from "vitest";
import { replayGame, parsePgnMoves, startPosition, squareName } from "./chess";

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

describe("replayGame — the Opera Game (Morphy, 1858)", () => {
  // Exercises captures, queenside castling, knight disambiguation (Nbd7),
  // checks, and checkmate.
  const pgn = `1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6
7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8
13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8#`;

  const plies = replayGame(pgn);

  it("replays every half-move without breaking", () => {
    // 16 full moves (32 plies) + White's 17th = 33 plies, +1 start = 34.
    expect(plies).toHaveLength(34);
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
    const plies = replayGame("1. e4 d5 2. e5 f5 3. exf6");
    const final = plies[plies.length - 1].board;
    expect(final[idx("f6")]).toBe("P"); // capturing pawn landed on f6
    expect(final[idx("f5")]).toBeNull(); // the passed pawn was removed
    expect(final[idx("e5")]).toBeNull(); // capturing pawn left e5
  });
});

describe("replayGame — promotion", () => {
  it("promotes a pawn to a queen on the back rank", () => {
    const plies = replayGame(
      "1. h4 g5 2. hxg5 h6 3. gxh6 a5 4. hxg7 a4 5. gxh8=Q"
    );
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
  const pgn = "1. e4 e6 2. d4 Bb4+ 3. Nc3 a5 4. Nh3 d6 5. Nf4 Nc6 6. Nd5";
  const plies = replayGame(pgn);

  it("replays all 11 half-moves", () => {
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

describe("squareName", () => {
  it("round-trips index to algebraic", () => {
    expect(squareName(0)).toBe("a1");
    expect(squareName(63)).toBe("h8");
    expect(squareName(28)).toBe("e4");
  });
});

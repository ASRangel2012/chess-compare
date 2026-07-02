/**
 * Minimal, dependency-free chess engine for *replaying* a PGN game.
 *
 * It is not a full move generator — it only needs to be correct enough to walk
 * a known-valid Chess.com game move by move and produce the board position at
 * each ply. It understands SAN including captures, castling, en passant,
 * promotion, disambiguation, and resolves the rare "implicit disambiguation by
 * pin" case via a king-safety check.
 *
 * Board indexing: 0..63, a1 = 0, h1 = 7, a8 = 56, h8 = 63.
 * Pieces are letters — uppercase = White (PNBRQK), lowercase = Black (pnbrqk).
 */

export type Color = "w" | "b";
export type Board = (string | null)[];

export interface Ply {
  /** Board after this ply (64 cells). For ply 0 this is the start position. */
  board: Board;
  /** [from, to] squares of the move that produced this position, or null at start. */
  lastMove: [number, number] | null;
  /** SAN of the move that produced this position, or null at start. */
  san: string | null;
  /** Full move number this ply belongs to (1-based). */
  moveNumber: number;
  /** Side that just moved ("w"/"b"), or null at the start position. */
  movedBy: Color | null;
}

const fileOf = (s: number) => s % 8;
const rankOf = (s: number) => Math.floor(s / 8);
const sq = (f: number, r: number) => r * 8 + f;
const onBoard = (f: number, r: number) => f >= 0 && f < 8 && r >= 0 && r < 8;
const isWhite = (p: string) => p === p.toUpperCase();
const colorOf = (p: string): Color => (isWhite(p) ? "w" : "b");

export function startPosition(): Board {
  const board: Board = new Array(64).fill(null);
  const back = ["R", "N", "B", "Q", "K", "B", "N", "R"];
  for (let f = 0; f < 8; f++) {
    board[sq(f, 0)] = back[f];
    board[sq(f, 1)] = "P";
    board[sq(f, 6)] = "p";
    board[sq(f, 7)] = back[f].toLowerCase();
  }
  return board;
}

const KNIGHT_DELTAS = [
  [1, 2], [2, 1], [2, -1], [1, -2],
  [-1, -2], [-2, -1], [-2, 1], [-1, 2],
];
const KING_DELTAS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];
const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Is `target` attacked by any piece of color `by`? */
function isAttacked(board: Board, target: number, by: Color): boolean {
  const tf = fileOf(target);
  const tr = rankOf(target);

  // Pawns: a `by`-colored pawn attacks one rank "forward" diagonally.
  const pawnRank = by === "w" ? tr - 1 : tr + 1;
  const pawnChar = by === "w" ? "P" : "p";
  for (const df of [-1, 1]) {
    if (onBoard(tf + df, pawnRank) && board[sq(tf + df, pawnRank)] === pawnChar) {
      return true;
    }
  }

  // Knights.
  const knightChar = by === "w" ? "N" : "n";
  for (const [df, dr] of KNIGHT_DELTAS) {
    if (onBoard(tf + df, tr + dr) && board[sq(tf + df, tr + dr)] === knightChar) {
      return true;
    }
  }

  // King.
  const kingChar = by === "w" ? "K" : "k";
  for (const [df, dr] of KING_DELTAS) {
    if (onBoard(tf + df, tr + dr) && board[sq(tf + df, tr + dr)] === kingChar) {
      return true;
    }
  }

  // Sliding pieces.
  const scan = (dirs: number[][], pieces: string) => {
    for (const [df, dr] of dirs) {
      let f = tf + df;
      let r = tr + dr;
      while (onBoard(f, r)) {
        const p = board[sq(f, r)];
        if (p) {
          if (colorOf(p) === by && pieces.includes(p.toUpperCase())) return true;
          break;
        }
        f += df;
        r += dr;
      }
    }
    return false;
  };
  if (scan(BISHOP_DIRS, "BQ")) return true;
  if (scan(ROOK_DIRS, "RQ")) return true;

  return false;
}

function findKing(board: Board, color: Color): number {
  const k = color === "w" ? "K" : "k";
  return board.indexOf(k);
}

/** Can a piece of `type` on `from` pseudo-legally reach `to` (path clear, ignoring check)? */
function canReach(board: Board, type: string, from: number, to: number): boolean {
  const df = fileOf(to) - fileOf(from);
  const dr = rankOf(to) - rankOf(from);
  const adf = Math.abs(df);
  const adr = Math.abs(dr);

  switch (type) {
    case "N":
      return (adf === 1 && adr === 2) || (adf === 2 && adr === 1);
    case "K":
      return adf <= 1 && adr <= 1;
    case "B":
      return adf === adr && adf > 0 && pathClear(board, from, to);
    case "R":
      return (df === 0) !== (dr === 0) && pathClear(board, from, to);
    case "Q":
      return (adf === adr || df === 0 || dr === 0) && (adf > 0 || adr > 0) && pathClear(board, from, to);
    default:
      return false;
  }
}

function pathClear(board: Board, from: number, to: number): boolean {
  const df = Math.sign(fileOf(to) - fileOf(from));
  const dr = Math.sign(rankOf(to) - rankOf(from));
  let f = fileOf(from) + df;
  let r = rankOf(from) + dr;
  while (sq(f, r) !== to) {
    if (board[sq(f, r)] !== null) return false;
    f += df;
    r += dr;
  }
  return true;
}

interface State {
  board: Board;
  turn: Color;
  ep: number; // en passant target square, or -1
}

/** Apply one SAN move, returning the new state and the [from, to] of the move. */
function applySan(state: State, sanRaw: string): { state: State; from: number; to: number } {
  const { board, turn, ep } = state;
  const san = sanRaw.replace(/[+#!?]/g, "");
  const board2 = board.slice();

  // Castling.
  if (san === "O-O" || san === "O-O-O") {
    const rank = turn === "w" ? 0 : 7;
    const kingFrom = sq(4, rank);
    const kingTo = san === "O-O" ? sq(6, rank) : sq(2, rank);
    const rookFrom = san === "O-O" ? sq(7, rank) : sq(0, rank);
    const rookTo = san === "O-O" ? sq(5, rank) : sq(3, rank);
    board2[kingTo] = board2[kingFrom];
    board2[kingFrom] = null;
    board2[rookTo] = board2[rookFrom];
    board2[rookFrom] = null;
    return {
      state: { board: board2, turn: turn === "w" ? "b" : "w", ep: -1 },
      from: kingFrom,
      to: kingTo,
    };
  }

  const m = san.match(/^([KQRBN])?([a-h])?([1-8])?x?([a-h][1-8])(?:=([QRBN]))?$/);
  if (!m) throw new Error(`Unparseable SAN: ${sanRaw}`);

  const type = m[1] ?? "P";
  const disFile = m[2] ? m[2].charCodeAt(0) - 97 : null;
  const disRank = m[3] ? m[3].charCodeAt(0) - 49 : null;
  const to = sq(m[4].charCodeAt(0) - 97, m[4].charCodeAt(1) - 49);
  const promo = m[5];

  let from: number;
  let epCapture = false;

  if (type === "P") {
    const dir = turn === "w" ? 1 : -1;
    const tf = fileOf(to);
    const tr = rankOf(to);
    if (disFile !== null) {
      // Pawn capture — source file is given explicitly in SAN.
      from = sq(disFile, tr - dir);
      if (board2[to] === null && to === ep) epCapture = true;
    } else {
      const one = sq(tf, tr - dir);
      from = board2[one] && board2[one]!.toUpperCase() === "P" ? one : sq(tf, tr - 2 * dir);
    }
    // The inferred source must actually hold the moving side's pawn — otherwise
    // the SAN is corrupt (or our inference is wrong) and executing the move
    // would silently corrupt the board.
    // (An off-board `from` indexes outside 0..63 and fails this check too.)
    const pawnChar = turn === "w" ? "P" : "p";
    if (board2[from] !== pawnChar) {
      throw new Error(`Illegal pawn move: ${sanRaw}`);
    }
  } else {
    const target = turn === "w" ? type : type.toLowerCase();
    const candidates: number[] = [];
    for (let s = 0; s < 64; s++) {
      if (board2[s] !== target) continue;
      if (disFile !== null && fileOf(s) !== disFile) continue;
      if (disRank !== null && rankOf(s) !== disRank) continue;
      if (canReach(board2, type, s, to)) candidates.push(s);
    }
    if (candidates.length === 1) {
      from = candidates[0];
    } else {
      // Multiple pseudo-legal sources with no (sufficient) SAN disambiguation:
      // only a move that doesn't leave our own king in check is legal. If that
      // filter doesn't leave exactly one candidate, the SAN is genuinely
      // ambiguous (or has no legal source) — throw rather than guess a wrong
      // board, which surfaces to the caller as a truncated replay.
      const legal = candidates.filter((s) => !leavesKingInCheck(board2, s, to, turn));
      if (legal.length !== 1) {
        throw new Error(
          candidates.length === 0
            ? `No piece can play ${sanRaw}`
            : `Ambiguous SAN: ${sanRaw}`
        );
      }
      from = legal[0];
    }
  }

  // Execute the move.
  board2[to] = promo ? (turn === "w" ? promo : promo.toLowerCase()) : board2[from];
  board2[from] = null;
  if (epCapture) {
    board2[sq(fileOf(to), rankOf(from))] = null; // remove the passed pawn
  }

  // New en passant target (only on a pawn double-push).
  let newEp = -1;
  if (type === "P" && Math.abs(rankOf(to) - rankOf(from)) === 2) {
    newEp = sq(fileOf(from), (rankOf(from) + rankOf(to)) / 2);
  }

  return {
    state: { board: board2, turn: turn === "w" ? "b" : "w", ep: newEp },
    from,
    to,
  };
}

function leavesKingInCheck(board: Board, from: number, to: number, color: Color): boolean {
  const b = board.slice();
  b[to] = b[from];
  b[from] = null;
  const king = findKing(b, color);
  if (king === -1) return false;
  return isAttacked(b, king, color === "w" ? "b" : "w");
}

/**
 * Bounded memo cache for `parsePgnMoves`. Several code paths tokenize the same
 * PGN (per-game analysis, head-to-head summarization, replay), so caching the
 * token list avoids re-tokenizing full movetext on every call. Small LRU keyed
 * by the PGN string; callers must treat the returned array as read-only.
 */
export const PGN_TOKEN_CACHE_MAX = 200;
const pgnTokenCache = new Map<string, string[]>();

/** Current number of memoized token lists. Exposed for tests. */
export function pgnTokenCacheSize(): number {
  return pgnTokenCache.size;
}

/**
 * Extract the SAN move tokens from PGN movetext, stripping headers, comments,
 * NAGs, move numbers, and the result token. Memoized per PGN string (bounded
 * LRU) — do not mutate the returned array.
 */
export function parsePgnMoves(pgn: string): string[] {
  const cached = pgnTokenCache.get(pgn);
  if (cached !== undefined) {
    // Refresh recency: Map preserves insertion order, so re-inserting moves
    // this entry to the most-recently-used position.
    pgnTokenCache.delete(pgn);
    pgnTokenCache.set(pgn, cached);
    return cached;
  }
  const tokens = tokenizePgn(pgn);
  pgnTokenCache.set(pgn, tokens);
  if (pgnTokenCache.size > PGN_TOKEN_CACHE_MAX) {
    for (const lru of pgnTokenCache.keys()) {
      pgnTokenCache.delete(lru);
      if (pgnTokenCache.size <= PGN_TOKEN_CACHE_MAX) break;
    }
  }
  return tokens;
}

function tokenizePgn(pgn: string): string[] {
  const movetext = pgn
    .replace(/\[[^\]]*\]/g, " ") // headers
    .replace(/\{[^}]*\}/g, " ") // { comments } incl. clock annotations
    .replace(/;[^\n]*/g, " ") // ; line comments
    .replace(/\$\d+/g, " ") // NAGs
    .replace(/\d+\.(\.\.)?/g, " "); // move numbers (incl. "1...")
  const results = new Set(["1-0", "0-1", "1/2-1/2", "*"]);
  return movetext
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && t !== "..." && !results.has(t));
}

export interface ReplayResult {
  /** Plies successfully replayed (index 0 = start position). */
  plies: Ply[];
  /** True when a SAN failed to apply and replay stopped early. */
  truncated: boolean;
  /** The SAN token that failed to apply, when `truncated` is true. */
  failedSan?: string;
}

/**
 * Replay a PGN into an array of plies (index 0 = start position). If a move
 * fails to parse or apply, replay stops at the last good ply and the result is
 * flagged `truncated` (with the offending SAN) so callers can warn the user
 * instead of silently rendering a wrong or shortened game.
 */
export function replayGame(pgn: string): ReplayResult {
  const sans = parsePgnMoves(pgn);
  const plies: Ply[] = [
    { board: startPosition(), lastMove: null, san: null, moveNumber: 0, movedBy: null },
  ];

  let state: State = { board: startPosition(), turn: "w", ep: -1 };
  for (let i = 0; i < sans.length; i++) {
    const movedBy = state.turn;
    try {
      const { state: next, from, to } = applySan(state, sans[i]);
      state = next;
      plies.push({
        board: next.board,
        lastMove: [from, to],
        san: sans[i],
        moveNumber: Math.floor(i / 2) + 1,
        movedBy,
      });
    } catch {
      // Best-effort: keep what replayed cleanly, but tell the caller.
      return { plies, truncated: true, failedSan: sans[i] };
    }
  }

  return { plies, truncated: false };
}

const GLYPHS: Record<string, string> = {
  K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙",
  k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟",
};

export function pieceGlyph(piece: string | null): string {
  return piece ? GLYPHS[piece] ?? "" : "";
}

export function squareName(index: number): string {
  return String.fromCharCode(97 + fileOf(index)) + String(rankOf(index) + 1);
}

export { fileOf, rankOf };

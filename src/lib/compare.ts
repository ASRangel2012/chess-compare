/**
 * Core player-comparison orchestration, extracted from the React hook so the
 * intricate bits — parallel fetching, `Promise.allSettled` profile resolution,
 * and precise error mapping — can be unit tested without a DOM or React.
 *
 * The hook (`useChessCompare`) keeps only React state and the progressive
 * head-to-head / AI streaming; the sequencing and policy live here.
 */
import {
  fetchPlayerProfile,
  fetchPlayerStats,
  fetchRecentGames,
  normalizeUsername,
  findCommonOpenings,
} from "./chessApi";
import { analyzeGames } from "./pgnParser";
import type {
  ChessGame,
  ChessPlayerProfile,
  ChessPlayerStats,
  PlayerGameAnalysis,
} from "./types";

export const MAX_GAMES = 50;

/** A comparison failure whose message is safe to show the user directly. */
export class ComparisonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComparisonError";
  }
}

export interface ComparisonCore {
  player1: {
    username: string;
    profile: ChessPlayerProfile;
    stats: ChessPlayerStats;
    analysis: PlayerGameAnalysis;
  };
  player2: {
    username: string;
    profile: ChessPlayerProfile;
    stats: ChessPlayerStats;
    analysis: PlayerGameAnalysis;
  };
  commonOpenings: { name: string; eco: string }[];
}

/** Injectable data layer so the orchestration can be tested with fakes. */
export interface CompareDeps {
  fetchPlayerProfile: (
    username: string,
    signal?: AbortSignal
  ) => Promise<ChessPlayerProfile>;
  fetchPlayerStats: (
    username: string,
    signal?: AbortSignal
  ) => Promise<ChessPlayerStats>;
  fetchRecentGames: (
    username: string,
    maxGames: number,
    signal?: AbortSignal
  ) => Promise<ChessGame[]>;
  analyzeGames: (games: ChessGame[], username: string) => PlayerGameAnalysis;
  findCommonOpenings: (
    a: { name: string; eco: string }[],
    b: { name: string; eco: string }[]
  ) => { name: string; eco: string }[];
}

const defaultDeps: CompareDeps = {
  fetchPlayerProfile,
  fetchPlayerStats,
  fetchRecentGames: (username, maxGames, signal) =>
    fetchRecentGames(username, maxGames, undefined, { signal }),
  analyzeGames,
  findCommonOpenings,
};

/**
 * Chess.com usernames are 3-25 chars of letters, digits, or underscores.
 * Validating up front rejects junk before any network call or Claude token
 * spend, and closes a mild prompt-injection vector (names are interpolated into
 * the prompt).
 */
const USERNAME_RE = /^[A-Za-z0-9_]{3,25}$/;

/** Returns a user-facing error message, or null if the inputs are valid. */
export function validateUsernames(u1: string, u2: string): string | null {
  if (!u1 || !u2) return "Please enter both usernames.";
  if (u1 === u2) return "Enter two different players to compare.";
  if (!USERNAME_RE.test(u1) || !USERNAME_RE.test(u2)) {
    return "Enter valid Chess.com usernames (3-25 letters, numbers, or underscores).";
  }
  return null;
}

/**
 * Map the settled results of the two profile lookups into a single precise
 * message: name the player(s) that don't exist, otherwise surface the first
 * real error (timeout, rate limit, …).
 */
export function resolveProfileError(
  p1Res: PromiseSettledResult<ChessPlayerProfile>,
  p2Res: PromiseSettledResult<ChessPlayerProfile>,
  u1: string,
  u2: string
): string {
  const notFound: string[] = [];
  let otherMessage: string | null = null;

  for (const [res, name] of [
    [p1Res, u1],
    [p2Res, u2],
  ] as const) {
    if (res.status === "rejected") {
      const msg =
        res.reason instanceof Error ? res.reason.message : String(res.reason);
      if (msg.startsWith("Player not found")) notFound.push(name);
      else otherMessage = msg;
    }
  }

  if (notFound.length) {
    return `No Chess.com player found for ${notFound
      .map((n) => `"${n}"`)
      .join(" and ")}. Double-check the spelling.`;
  }
  return otherMessage ?? "Couldn't load player profiles.";
}

/**
 * Resolve both players' profiles, stats, recent games, and derived analysis.
 * Throws `ComparisonError` (message safe to display) on invalid input or a
 * failed profile lookup; other errors propagate as-is (including aborts, which
 * are rethrown untouched so callers can drop superseded runs silently).
 */
export async function runComparison(
  rawUsername1: string,
  rawUsername2: string,
  opts: { maxGames?: number; deps?: CompareDeps; signal?: AbortSignal } = {}
): Promise<ComparisonCore> {
  const deps = opts.deps ?? defaultDeps;
  const maxGames = opts.maxGames ?? MAX_GAMES;
  const signal = opts.signal;

  const u1 = normalizeUsername(rawUsername1);
  const u2 = normalizeUsername(rawUsername2);

  const invalid = validateUsernames(u1, u2);
  if (invalid) throw new ComparisonError(invalid);

  // Resolve both profiles first so a single bad username yields a precise
  // "player not found" message instead of failing the whole comparison.
  const [p1Res, p2Res] = await Promise.allSettled([
    deps.fetchPlayerProfile(u1, signal),
    deps.fetchPlayerProfile(u2, signal),
  ]);

  if (p1Res.status !== "fulfilled" || p2Res.status !== "fulfilled") {
    // An aborted run is not a comparison failure — propagate the abort as-is
    // so the caller can drop it silently instead of showing an error.
    for (const res of [p1Res, p2Res]) {
      if (
        res.status === "rejected" &&
        res.reason instanceof DOMException &&
        res.reason.name === "AbortError"
      ) {
        throw res.reason;
      }
    }
    throw new ComparisonError(resolveProfileError(p1Res, p2Res, u1, u2));
  }

  // Profiles exist — fetch stats and recent games in parallel.
  const [stats1, stats2, games1, games2] = await Promise.all([
    deps.fetchPlayerStats(u1, signal),
    deps.fetchPlayerStats(u2, signal),
    deps.fetchRecentGames(u1, maxGames, signal),
    deps.fetchRecentGames(u2, maxGames, signal),
  ]);

  const analysis1 = deps.analyzeGames(games1, u1);
  const analysis2 = deps.analyzeGames(games2, u2);

  const commonOpenings = deps.findCommonOpenings(
    analysis1.commonOpenings.map((o) => ({ name: o.name, eco: o.eco })),
    analysis2.commonOpenings.map((o) => ({ name: o.name, eco: o.eco }))
  );

  return {
    player1: { username: u1, profile: p1Res.value, stats: stats1, analysis: analysis1 },
    player2: { username: u2, profile: p2Res.value, stats: stats2, analysis: analysis2 },
    commonOpenings,
  };
}

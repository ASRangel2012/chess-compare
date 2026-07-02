import { describe, it, expect } from "vitest";
import {
  validateUsernames,
  resolveProfileError,
  runComparison,
  ComparisonError,
  type CompareDeps,
} from "./compare";
import type {
  ChessPlayerProfile,
  ChessPlayerStats,
  PlayerGameAnalysis,
} from "./types";

const profile = (username: string): ChessPlayerProfile => ({
  username,
  player_id: 1,
  joined: 0,
  status: "basic",
  followers: 0,
  url: `https://chess.com/member/${username}`,
});

const fulfilled = (
  v: ChessPlayerProfile
): PromiseSettledResult<ChessPlayerProfile> => ({ status: "fulfilled", value: v });
const rejected = (
  reason: unknown
): PromiseSettledResult<ChessPlayerProfile> => ({ status: "rejected", reason });

describe("validateUsernames", () => {
  it("requires both usernames", () => {
    expect(validateUsernames("", "bob")).toBe("Please enter both usernames.");
    expect(validateUsernames("alice", "")).toBe("Please enter both usernames.");
  });

  it("rejects comparing a player against themselves", () => {
    expect(validateUsernames("alice", "alice")).toBe(
      "Enter two different players to compare."
    );
  });

  it("accepts a valid distinct pair", () => {
    expect(validateUsernames("alice", "bob")).toBeNull();
    expect(validateUsernames("hikaru", "magnus_c")).toBeNull();
  });

  it("rejects invalid characters or out-of-range length", () => {
    expect(validateUsernames("ab", "bob")).toMatch(/valid Chess\.com/);
    expect(validateUsernames("alice", "b!b")).toMatch(/valid Chess\.com/);
    expect(validateUsernames("a".repeat(26), "bob")).toMatch(/valid Chess\.com/);
    expect(validateUsernames("wu", "li")).toMatch(/valid Chess\.com/);
  });
});

describe("resolveProfileError", () => {
  it("names the single player that was not found", () => {
    const msg = resolveProfileError(
      rejected(new Error("Player not found: alice")),
      fulfilled(profile("bob")),
      "alice",
      "bob"
    );
    expect(msg).toContain('"alice"');
    expect(msg).not.toContain('"bob"');
    expect(msg).toMatch(/Double-check/);
  });

  it("names both players when neither exists", () => {
    const msg = resolveProfileError(
      rejected(new Error("Player not found: alice")),
      rejected(new Error("Player not found: bob")),
      "alice",
      "bob"
    );
    expect(msg).toContain('"alice"');
    expect(msg).toContain('"bob"');
  });

  it("surfaces a non-not-found error verbatim", () => {
    const msg = resolveProfileError(
      rejected(new Error("Chess.com request timed out. Please try again.")),
      fulfilled(profile("bob")),
      "alice",
      "bob"
    );
    expect(msg).toBe("Chess.com request timed out. Please try again.");
  });

  it("prioritizes the not-found message when errors are mixed", () => {
    const msg = resolveProfileError(
      rejected(new Error("Player not found: alice")),
      rejected(new Error("some transient error")),
      "alice",
      "bob"
    );
    expect(msg).toContain('"alice"');
  });
});

// ---------------------------------------------------------------------------

const stats = (): ChessPlayerStats => ({});
const analysisFor = (username: string): PlayerGameAnalysis => ({
  username,
  totalGames: 5,
  wins: 3,
  losses: 1,
  draws: 1,
  winRate: 60,
  avgMoveCount: 30,
  openingsAsWhite: [],
  openingsAsBlack: [],
  commonOpenings: [
    { name: "Italian Game", eco: "C50", games: 2, wins: 1, losses: 1, draws: 0, winRate: 50 },
  ],
  gameLengthBuckets: [],
  timeClassBreakdown: {},
});

function makeDeps(overrides: Partial<CompareDeps> = {}): CompareDeps {
  return {
    fetchPlayerProfile: async (u) => profile(u),
    fetchPlayerStats: async () => stats(),
    fetchRecentGames: async () => [],
    analyzeGames: (_games, u) => analysisFor(u),
    findCommonOpenings: (a, b) =>
      a.filter((x) => b.some((y) => y.eco === x.eco && y.name === x.name)),
    ...overrides,
  };
}

describe("runComparison", () => {
  it("normalizes usernames and assembles both players + common openings", async () => {
    const core = await runComparison("  Alice ", "BOB", { deps: makeDeps() });
    expect(core.player1.username).toBe("alice");
    expect(core.player2.username).toBe("bob");
    expect(core.player1.profile.username).toBe("alice");
    expect(core.commonOpenings).toEqual([{ name: "Italian Game", eco: "C50" }]);
  });

  it("throws ComparisonError for an invalid pair before any fetching", async () => {
    let calls = 0;
    const deps = makeDeps({
      fetchPlayerProfile: async (u) => {
        calls++;
        return profile(u);
      },
    });
    await expect(runComparison("alice", "alice", { deps })).rejects.toBeInstanceOf(
      ComparisonError
    );
    expect(calls).toBe(0);
  });

  it("maps a failed profile lookup to a ComparisonError naming the player", async () => {
    const deps = makeDeps({
      fetchPlayerProfile: async (u) => {
        if (u === "bob") throw new Error("Player not found: bob");
        return profile(u);
      },
    });
    await expect(runComparison("alice", "bob", { deps })).rejects.toThrow(
      ComparisonError
    );
    await expect(runComparison("alice", "bob", { deps })).rejects.toThrow(/"bob"/);
  });

  it("propagates non-profile errors (e.g. a stats failure) as-is", async () => {
    const deps = makeDeps({
      fetchPlayerStats: async () => {
        throw new Error("stats exploded");
      },
    });
    await expect(runComparison("alice", "bob", { deps })).rejects.toThrow(
      "stats exploded"
    );
  });

  it("propagates an aborted profile fetch as the abort, not a ComparisonError", async () => {
    // The hook must be able to recognize a cancelled run and stay silent; if
    // the abort were wrapped in ComparisonError it would show as a user error.
    const abort = new DOMException("The operation was aborted.", "AbortError");
    const deps = makeDeps({
      fetchPlayerProfile: async () => {
        throw abort;
      },
    });
    await expect(runComparison("alice", "bob", { deps })).rejects.toBe(abort);
  });

  it("threads its AbortSignal through to every fetch dep", async () => {
    const controller = new AbortController();
    const seen: (AbortSignal | undefined)[] = [];
    const deps = makeDeps({
      fetchPlayerProfile: async (u, signal) => {
        seen.push(signal);
        return profile(u);
      },
      fetchPlayerStats: async (_u, signal) => {
        seen.push(signal);
        return stats();
      },
      fetchRecentGames: async (_u, _m, signal) => {
        seen.push(signal);
        return [];
      },
    });
    await runComparison("alice", "bob", { deps, signal: controller.signal });
    expect(seen).toHaveLength(6); // 2 profiles + 2 stats + 2 recent-games
    expect(seen.every((s) => s === controller.signal)).toBe(true);
  });
});

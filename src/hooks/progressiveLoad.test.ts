import { describe, it, expect } from "vitest";
import {
  loadProgressive,
  type ProgressiveDeps,
  type ProgressiveHandlers,
} from "./progressiveLoad";
import type {
  ChessGame,
  HeadToHeadSummary,
  PlayStyleInsight,
  PlayerGameAnalysis,
} from "../lib/types";

const analysis = (): PlayerGameAnalysis => ({
  username: "x",
  totalGames: 5,
  wins: 3,
  losses: 1,
  draws: 1,
  winRate: 60,
  avgMoveCount: 30,
  openingsAsWhite: [],
  openingsAsBlack: [],
  commonOpenings: [],
  gameLengthBuckets: [],
  timeClassBreakdown: {},
});
const summary = (): HeadToHeadSummary => ({
  totalGames: 1,
  player1Wins: 1,
  player1Losses: 0,
  player1Draws: 0,
  player2Wins: 0,
  player2Losses: 1,
  player2Draws: 0,
  games: [],
});
const insight = (): PlayStyleInsight => ({
  player1: "a",
  player2: "b",
  matchup: "m",
  gamePlan: "g",
});

function recorder(isCurrent: () => boolean): {
  applied: string[];
  handlers: ProgressiveHandlers;
} {
  const applied: string[] = [];
  return {
    applied,
    handlers: {
      isCurrent,
      applyHeadToHead: () => applied.push("h2h"),
      setLoadingHeadToHead: (v) => applied.push(`h2hLoading:${v}`),
      applyInsights: () => applied.push("insights"),
      setAnalyzingStyle: (v) => applied.push(`analyzing:${v}`),
      reportAiError: () => applied.push("aiError"),
      logWarn: () => {},
      logError: () => {},
    },
  };
}

const input = {
  u1: "a",
  u2: "b",
  analysis1: analysis(),
  analysis2: analysis(),
  withAi: true,
};

describe("loadProgressive stale-run race", () => {
  it("applies head-to-head and insights while the run stays current", async () => {
    const deps: ProgressiveDeps = {
      fetchHeadToHeadGames: async () => [] as ChessGame[],
      analyzeHeadToHead: () => summary(),
      fetchPlayStyleAnalysis: async () => insight(),
    };
    const r = recorder(() => true);
    await loadProgressive(input, deps, r.handlers);
    await new Promise((res) => setTimeout(res, 0));
    expect(r.applied).toContain("h2h");
    expect(r.applied).toContain("insights");
  });

  it("drops head-to-head and insights once a newer run supersedes it", async () => {
    let current = 1;
    let resolveH2H!: (g: ChessGame[]) => void;
    let resolveAi!: (i: PlayStyleInsight) => void;
    const deps: ProgressiveDeps = {
      fetchHeadToHeadGames: () =>
        new Promise<ChessGame[]>((res) => {
          resolveH2H = res;
        }),
      analyzeHeadToHead: () => summary(),
      fetchPlayStyleAnalysis: () =>
        new Promise<PlayStyleInsight>((res) => {
          resolveAi = res;
        }),
    };
    const r = recorder(() => current === 1);
    const p = loadProgressive(input, deps, r.handlers);
    current = 2; // a newer compare() run supersedes this one
    resolveH2H([]);
    resolveAi(insight());
    await p;
    await new Promise((res) => setTimeout(res, 0));
    expect(r.applied).not.toContain("h2h");
    expect(r.applied).not.toContain("insights");
    expect(r.applied).not.toContain("h2hLoading:false");
    expect(r.applied).not.toContain("analyzing:false");
  });
});

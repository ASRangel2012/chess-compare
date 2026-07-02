import { describe, it, expect } from "vitest";
import {
  validateAnalyzeBody,
  extractAnalysisJson,
  buildPrompt,
  type AnalyzeBody,
  type PlayerGameAnalysis,
} from "./analyze";

function analysis(overrides: Partial<PlayerGameAnalysis> = {}): PlayerGameAnalysis {
  return {
    username: "player",
    totalGames: 10,
    wins: 5,
    losses: 3,
    draws: 2,
    winRate: 50,
    avgMoveCount: 35,
    commonOpenings: [],
    openingsAsWhite: [
      { name: "Italian Game", eco: "C50", games: 4, wins: 3, losses: 1, draws: 0, winRate: 75 },
    ],
    openingsAsBlack: [
      { name: "Sicilian Defense", eco: "B20", games: 3, wins: 1, losses: 2, draws: 0, winRate: 33 },
    ],
    gameLengthBuckets: [
      { label: "≤20 moves", count: 2 },
      { label: "21–40 moves", count: 6 },
    ],
    timeClassBreakdown: { blitz: 8, rapid: 2 },
    ...overrides,
  };
}

function body(): AnalyzeBody {
  return {
    player1: { name: "alice", analysis: analysis() },
    player2: { name: "bob", analysis: analysis() },
  };
}

describe("validateAnalyzeBody", () => {
  it("accepts a well-formed body", () => {
    const result = validateAnalyzeBody(body());
    expect(result.ok).toBe(true);
  });

  it("accepts an analysis without fields the prompt never reads", () => {
    // `username` and `commonOpenings` are part of the client wire type but the
    // server never reads them — it must not require them.
    const { username, commonOpenings, ...bare } = analysis();
    void username;
    void commonOpenings;
    const result = validateAnalyzeBody({
      player1: { name: "alice", analysis: bare },
      player2: { name: "bob", analysis: bare },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The validated value feeds buildPrompt directly, without casts.
      expect(buildPrompt(result.value)).toContain("alice");
    }
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty object", {}],
    ["missing player2 analysis", { player1: { name: "a", analysis: analysis() }, player2: { name: "b" } }],
  ])("rejects %s", (_label, input) => {
    const result = validateAnalyzeBody(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Missing player analysis data");
  });
});

describe("buildPrompt", () => {
  it("includes both player names, the JSON contract, and cited data", () => {
    const prompt = buildPrompt(body());
    expect(prompt).toContain("alice");
    expect(prompt).toContain("bob");
    expect(prompt).toContain("Respond in JSON only");
    expect(prompt).toContain("Italian Game");
    expect(prompt).toContain("75% win rate");
  });
});

describe("extractAnalysisJson", () => {
  const valid = {
    player1: "profile one",
    player2: "profile two",
    matchup: "the matchup",
    gamePlan: "the plan",
  };

  it("parses a clean JSON object", () => {
    const result = extractAnalysisJson(JSON.stringify(valid));
    expect(result).toEqual({ ok: true, value: valid });
  });

  it("preserves multi-paragraph string values verbatim", () => {
    // Tool-forced output routinely carries literal newlines inside values.
    const plan = "Open with 1. e4.\n\nThen castle early.\n\nTrade queens.";
    const result = extractAnalysisJson(JSON.stringify({ ...valid, gamePlan: plan }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.gamePlan).toBe(plan);
  });

  it("fails on input that does not parse as JSON", () => {
    const result = extractAnalysisJson("{ player1: not quoted }");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not valid JSON/i);
  });

  it.each([
    ["a bare string", JSON.stringify("just text")],
    ["a number", "42"],
    ["an array", JSON.stringify([1, 2, 3])],
    ["null", "null"],
  ])("fails when the JSON document is %s, not an object", (_label, text) => {
    const result = extractAnalysisJson(text);
    expect(result.ok).toBe(false);
  });

  it("fails when a required field is missing (the old undefined-gamePlan crash)", () => {
    const { gamePlan, ...withoutPlan } = valid;
    void gamePlan;
    const result = extractAnalysisJson(JSON.stringify(withoutPlan));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("gamePlan");
  });

  it("fails when a required field is present but blank", () => {
    const result = extractAnalysisJson(JSON.stringify({ ...valid, matchup: "   " }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("matchup");
  });
});

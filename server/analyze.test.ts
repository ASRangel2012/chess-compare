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
    totalGames: 10,
    wins: 5,
    losses: 3,
    draws: 2,
    winRate: 50,
    avgMoveCount: 35,
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

  it("extracts JSON even when wrapped in prose or a code fence", () => {
    const wrapped = "Sure! Here you go:\n```json\n" + JSON.stringify(valid) + "\n```\nHope that helps.";
    const result = extractAnalysisJson(wrapped);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.gamePlan).toBe("the plan");
  });

  it("fails when there is no JSON object at all", () => {
    const result = extractAnalysisJson("I could not complete that request.");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no JSON/i);
  });

  it("fails on a JSON-looking block that does not parse", () => {
    const result = extractAnalysisJson("{ player1: not quoted }");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not valid JSON/i);
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

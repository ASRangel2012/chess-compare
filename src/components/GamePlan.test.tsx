// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { GamePlan } from "./GamePlan";

afterEach(cleanup);

const insights = {
  player1: "profile",
  player2: "profile",
  matchup: "matchup",
  gamePlan: "Steer into the Sicilian.\n\nTrade into a rook endgame.",
};

const baseProps = {
  player1Name: "alice",
  player2Name: "bob",
  insights: null,
  loading: false,
  error: null,
  onRetry: () => {},
};

describe("GamePlan", () => {
  it("names the player while the plan is generating", () => {
    render(<GamePlan {...baseProps} loading={true} />);
    expect(screen.getByText(/game plan for alice/i)).toBeTruthy();
  });

  it("shows the AI error with a retry button that calls onRetry", () => {
    const onRetry = vi.fn();
    render(<GamePlan {...baseProps} error="AI analysis failed" onRetry={onRetry} />);
    expect(screen.getByText("AI analysis failed")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /retry analysis/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders the plan headline and paragraphs", () => {
    render(<GamePlan {...baseProps} insights={insights} />);
    expect(
      screen.getByRole("heading", { name: /how alice beats bob/i })
    ).toBeTruthy();
    expect(screen.getByText("Steer into the Sicilian.")).toBeTruthy();
    expect(screen.getByText("Trade into a rook endgame.")).toBeTruthy();
  });
});

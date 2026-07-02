// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { PlayStyleAnalysis } from "./PlayStyleAnalysis";

afterEach(cleanup);

const insights = {
  player1: "Alice attacks.\n\nShe castles late.",
  player2: "Bob defends.",
  matchup: "Sparks fly.",
  gamePlan: "Open with 1. e4.",
};

const baseProps = {
  player1Name: "alice",
  player2Name: "bob",
  insights: null,
  loading: false,
  error: null,
  onRetry: () => {},
};

describe("PlayStyleAnalysis", () => {
  it("shows the loading state while the analysis is generating", () => {
    render(<PlayStyleAnalysis {...baseProps} loading={true} />);
    expect(screen.getByText(/Generating AI play style profiles/)).toBeTruthy();
  });

  it("shows the AI error with a retry button that calls onRetry", () => {
    const onRetry = vi.fn();
    render(
      <PlayStyleAnalysis
        {...baseProps}
        error="Stats loaded, but AI analysis failed: timeout"
        onRetry={onRetry}
      />
    );
    expect(screen.getByText(/AI analysis failed: timeout/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /retry analysis/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("explains the no-API-key degraded mode when there is no error", () => {
    render(<PlayStyleAnalysis {...baseProps} />);
    expect(screen.getByText(/requires the backend server/i)).toBeTruthy();
  });

  it("renders both profiles and the matchup, splitting paragraphs", () => {
    render(<PlayStyleAnalysis {...baseProps} insights={insights} />);
    expect(screen.getByRole("heading", { name: /alice/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /bob/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /style matchup/i })).toBeTruthy();
    // "\n\n" in the profile becomes two <p> elements, not one blob.
    expect(screen.getByText("Alice attacks.")).toBeTruthy();
    expect(screen.getByText("She castles late.")).toBeTruthy();
  });
});

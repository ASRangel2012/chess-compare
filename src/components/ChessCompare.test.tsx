// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// Mock the data hook so the component can be driven into each UI state
// without any network. `state` is swapped per test via vi.hoisted.
const { hookState } = vi.hoisted(() => ({
  hookState: {
    current: {} as Record<string, unknown>,
  },
}));

vi.mock("../hooks/useChessCompare", () => ({
  useChessCompare: () => hookState.current,
}));

import { ChessCompare } from "./ChessCompare";

const baseHook = {
  loading: false,
  loadingHeadToHead: false,
  analyzingStyle: false,
  error: null as string | null,
  aiError: null as string | null,
  result: null,
  compare: vi.fn(),
  retryAiAnalysis: vi.fn(),
};

afterEach(cleanup);

describe("ChessCompare a11y states", () => {
  it("announces a comparison failure via role=alert", () => {
    // Regression: the error banner rendered with no role/aria-live, so a
    // screen reader heard nothing — while focus had also been ejected from
    // the (then-disabled) input. The two bugs compounded.
    hookState.current = { ...baseHook, error: "Player not found: nosuchuser" };
    render(<ChessCompare />);
    expect(screen.getByRole("alert").textContent).toContain(
      "Player not found"
    );
  });

  it("keeps the inputs focusable while loading (readOnly, not disabled)", () => {
    // Regression: disabled={loading} ejected keyboard/screen-reader focus to
    // <body> at the exact moment the user submitted the form.
    hookState.current = { ...baseHook, loading: true };
    render(<ChessCompare />);
    const input = screen.getByLabelText(/player 1/i) as HTMLInputElement;
    expect(input.disabled).toBe(false);
    expect(input.readOnly).toBe(true);
    input.focus();
    expect(document.activeElement).toBe(input);
  });

  it("still blocks double-submit through the submit button while loading", () => {
    hookState.current = { ...baseHook, loading: true };
    render(<ChessCompare />);
    const submit = screen.getByRole("button", { name: /compare/i });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders no alert when there is no error", () => {
    hookState.current = { ...baseHook };
    render(<ChessCompare />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

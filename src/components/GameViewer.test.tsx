// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { GameViewer } from "./GameViewer";

afterEach(cleanup);

// Scholar's mate: 7 plies, so maxIndex is 7.
const SCHOLARS_MATE = "1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0";
// The knight can't reach e5 from g8's start after 1. e4 e5 — an unappliable SAN.
const CORRUPT = "1. e4 e5 2. Nxe5 1-0";

const board = () => screen.getByRole("img");
const button = (label: string) => screen.getByRole("button", { name: label });

describe("GameViewer", () => {
  it("exposes the viewer as a named, focusable group (a11y regression)", () => {
    // A bare tabIndex={0} div announces as an unnamed stop to screen readers.
    render(<GameViewer pgn={SCHOLARS_MATE} />);
    const viewer = screen.getByRole("group", { name: /game replay/i });
    expect(viewer.getAttribute("tabindex")).toBe("0");
    viewer.focus();
    expect(document.activeElement).toBe(viewer);
    // Arrow keys must work on the focused container itself.
    fireEvent.keyDown(viewer, { key: "ArrowRight" });
    expect(board().getAttribute("aria-label")).toContain("e4");
  });

  it("starts at the initial position with the back controls disabled", () => {
    render(<GameViewer pgn={SCHOLARS_MATE} />);
    expect(board().getAttribute("aria-label")).toBe(
      "Starting position, White to move"
    );
    expect(button("First move")).toHaveProperty("disabled", true);
    expect(button("Previous move")).toHaveProperty("disabled", true);
    expect(button("Next move")).toHaveProperty("disabled", false);
  });

  it("steps forward and clamps at the final position instead of overrunning", () => {
    render(<GameViewer pgn={SCHOLARS_MATE} />);
    // 10 clicks on a 7-ply game: the clamp must stop at the last ply.
    for (let i = 0; i < 10; i++) fireEvent.click(button("Next move"));
    expect(board().getAttribute("aria-label")).toContain("Qxf7#");
    expect(button("Next move")).toHaveProperty("disabled", true);
    expect(button("Last move")).toHaveProperty("disabled", true);
  });

  it("jumps to a position from the move list", () => {
    render(<GameViewer pgn={SCHOLARS_MATE} />);
    fireEvent.click(screen.getByRole("button", { name: "Qh5" }));
    expect(board().getAttribute("aria-label")).toContain("Qh5");
    expect(screen.getByText(/3\/7/)).toBeTruthy();
  });

  it("resets to the start when a different game is loaded", () => {
    // Regression for the reset-on-new-game path (moved from useEffect to the
    // render-time adjustment): a stale index from the previous game must not
    // survive a pgn swap, not even for one frame.
    const { rerender } = render(<GameViewer pgn={SCHOLARS_MATE} />);
    fireEvent.click(button("Last move"));
    expect(board().getAttribute("aria-label")).toContain("Qxf7#");

    rerender(<GameViewer pgn="1. d4 d5 2. c4 1-0" />);
    expect(board().getAttribute("aria-label")).toBe(
      "Starting position, White to move"
    );
    expect(button("Previous move")).toHaveProperty("disabled", true);
  });

  it("shows the truncation warning and stops at the last good position", () => {
    render(<GameViewer pgn={CORRUPT} />);
    const warning = screen.getByRole("status");
    expect(warning.textContent).toContain("Replay stopped");
    expect(warning.textContent).toContain("Nxe5");
    // Only the two applied plies remain navigable.
    fireEvent.click(button("Last move"));
    expect(board().getAttribute("aria-label")).toContain("1… e5");
    expect(button("Next move")).toHaveProperty("disabled", true);
  });
});

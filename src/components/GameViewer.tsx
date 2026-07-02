import { useMemo, useState, useEffect, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  IconPlayerTrackPrev,
  IconChevronLeft,
  IconChevronRight,
  IconPlayerTrackNext,
  IconAlertTriangle,
} from "@tabler/icons-react";
import { replayGame, pieceGlyph } from "../lib/chess";

interface GameViewerProps {
  pgn: string;
  /** Which side sits at the bottom of the board. */
  orientation?: "white" | "black";
  whiteLabel?: string;
  blackLabel?: string;
}

/** "12. Nxe5" / "12… Nxe5" style label for a ply, or "Start" for ply 0. */
function plyLabel(ply: { san: string | null; moveNumber: number; movedBy: "w" | "b" | null }): string {
  if (!ply.san) return "Start";
  return `${ply.moveNumber}${ply.movedBy === "b" ? "…" : "."} ${ply.san}`;
}

export function GameViewer({
  pgn,
  orientation = "white",
  whiteLabel = "White",
  blackLabel = "Black",
}: GameViewerProps) {
  const { plies, truncated, failedSan } = useMemo(() => replayGame(pgn), [pgn]);
  const [index, setIndex] = useState(0);

  // Reset to the start whenever a different game is loaded.
  useEffect(() => setIndex(0), [pgn]);

  const maxIndex = plies.length - 1;
  const clamp = (i: number) => Math.max(0, Math.min(maxIndex, i));
  // Clamp on render too, so a stale index (e.g. mid game-switch) can never
  // index past the end of the ply list and crash.
  const safeIndex = clamp(index);
  const current = plies[safeIndex];
  const lastMove = current.lastMove;

  // The move number the replay stopped at (the first move we could NOT apply).
  const stoppedAtMove = Math.floor(maxIndex / 2) + 1;

  // Render order: rank 8 -> 1 and file a -> h (flipped for black orientation).
  const ranks = orientation === "white" ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
  const files = orientation === "white" ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "ArrowLeft") {
      setIndex((i) => clamp(i - 1));
      e.preventDefault();
    } else if (e.key === "ArrowRight") {
      setIndex((i) => clamp(i + 1));
      e.preventDefault();
    }
  };

  const sideToMove = current.movedBy === "w" ? "Black" : "White";
  const boardLabel =
    safeIndex === 0
      ? "Starting position, White to move"
      : `Position after ${plyLabel(current)}, ${sideToMove} to move`;

  return (
    <div className="game-viewer" tabIndex={0} onKeyDown={onKeyDown}>
      <div className="game-viewer-board-col">
        <div className="board-edge-label">{orientation === "white" ? blackLabel : whiteLabel}</div>
        <div className="chess-board" role="img" aria-label={boardLabel}>
          {ranks.map((r) =>
            files.map((f) => {
              const sq = r * 8 + f;
              const piece = current.board[sq];
              const isLight = (f + r) % 2 === 1;
              const isFrom = lastMove?.[0] === sq;
              const isTo = lastMove?.[1] === sq;
              const isWhitePiece = piece ? piece === piece.toUpperCase() : false;
              return (
                <div
                  key={sq}
                  className={[
                    "board-square",
                    isLight ? "light" : "dark",
                    isFrom || isTo ? "highlight" : "",
                  ].join(" ").trim()}
                >
                  {piece && (
                    <span className={`piece ${isWhitePiece ? "white" : "black"}`}>
                      {pieceGlyph(piece)}
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
        <div className="board-edge-label">{orientation === "white" ? whiteLabel : blackLabel}</div>
        {truncated && (
          <div className="replay-warning" role="status">
            <IconAlertTriangle size={14} />
            Replay stopped at move {stoppedAtMove} — couldn&apos;t parse {failedSan}
          </div>
        )}
      </div>

      <div className="game-viewer-side">
        <div className="game-viewer-controls">
          <button type="button" onClick={() => setIndex(0)} disabled={safeIndex === 0} aria-label="First move">
            <IconPlayerTrackPrev size={16} />
          </button>
          <button type="button" onClick={() => setIndex((i) => clamp(i - 1))} disabled={safeIndex === 0} aria-label="Previous move">
            <IconChevronLeft size={16} />
          </button>
          <span className="game-viewer-ply">
            {safeIndex === 0 ? "Start" : `${current.san}`} · {safeIndex}/{maxIndex}
          </span>
          <button type="button" onClick={() => setIndex((i) => clamp(i + 1))} disabled={safeIndex === maxIndex} aria-label="Next move">
            <IconChevronRight size={16} />
          </button>
          <button type="button" onClick={() => setIndex(maxIndex)} disabled={safeIndex === maxIndex} aria-label="Last move">
            <IconPlayerTrackNext size={16} />
          </button>
        </div>

        {/* Announce the current move to screen readers as the user steps through. */}
        <span className="visually-hidden" aria-live="polite">
          {plyLabel(current)}
        </span>

        <ol className="move-list">
          {plies.slice(1).map((ply, i) => {
            const plyIndex = i + 1;
            const isWhiteMove = plyIndex % 2 === 1;
            return (
              <li key={plyIndex} className={isWhiteMove ? "move-white" : "move-black"}>
                {isWhiteMove && <span className="move-no">{Math.floor(i / 2) + 1}.</span>}
                <button
                  type="button"
                  className={`move-san ${plyIndex === safeIndex ? "active" : ""}`}
                  onClick={() => setIndex(plyIndex)}
                >
                  {ply.san}
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

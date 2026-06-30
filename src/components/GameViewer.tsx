import { useMemo, useState, useEffect, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  IconPlayerTrackPrev,
  IconChevronLeft,
  IconChevronRight,
  IconPlayerTrackNext,
} from "@tabler/icons-react";
import { replayGame, pieceGlyph } from "../lib/chess";

interface GameViewerProps {
  pgn: string;
  /** Which side sits at the bottom of the board. */
  orientation?: "white" | "black";
  whiteLabel?: string;
  blackLabel?: string;
}

export function GameViewer({
  pgn,
  orientation = "white",
  whiteLabel = "White",
  blackLabel = "Black",
}: GameViewerProps) {
  const plies = useMemo(() => replayGame(pgn), [pgn]);
  const [index, setIndex] = useState(0);

  // Reset to the start whenever a different game is loaded.
  useEffect(() => setIndex(0), [pgn]);

  const maxIndex = plies.length - 1;
  const clamp = (i: number) => Math.max(0, Math.min(maxIndex, i));
  const current = plies[index];
  const lastMove = current.lastMove;

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

  return (
    <div className="game-viewer" tabIndex={0} onKeyDown={onKeyDown}>
      <div className="game-viewer-board-col">
        <div className="board-edge-label">{orientation === "white" ? blackLabel : whiteLabel}</div>
        <div className="chess-board">
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
      </div>

      <div className="game-viewer-side">
        <div className="game-viewer-controls">
          <button type="button" onClick={() => setIndex(0)} disabled={index === 0} aria-label="First move">
            <IconPlayerTrackPrev size={16} />
          </button>
          <button type="button" onClick={() => setIndex((i) => clamp(i - 1))} disabled={index === 0} aria-label="Previous move">
            <IconChevronLeft size={16} />
          </button>
          <span className="game-viewer-ply">
            {index === 0 ? "Start" : `${current.san}`} · {index}/{maxIndex}
          </span>
          <button type="button" onClick={() => setIndex((i) => clamp(i + 1))} disabled={index === maxIndex} aria-label="Next move">
            <IconChevronRight size={16} />
          </button>
          <button type="button" onClick={() => setIndex(maxIndex)} disabled={index === maxIndex} aria-label="Last move">
            <IconPlayerTrackNext size={16} />
          </button>
        </div>

        <ol className="move-list">
          {plies.slice(1).map((ply, i) => {
            const plyIndex = i + 1;
            const isWhiteMove = plyIndex % 2 === 1;
            return (
              <li key={plyIndex} className={isWhiteMove ? "move-white" : "move-black"}>
                {isWhiteMove && <span className="move-no">{Math.floor(i / 2) + 1}.</span>}
                <button
                  type="button"
                  className={`move-san ${plyIndex === index ? "active" : ""}`}
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

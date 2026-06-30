import { useState } from "react";
import {
  IconExternalLink,
  IconCircleFilled,
  IconLoader2,
  IconPlayerPlay,
} from "@tabler/icons-react";
import type { HeadToHeadSummary } from "../lib/types";
import { GameViewer } from "./GameViewer";

interface HeadToHeadHistoryProps {
  player1Name: string;
  player2Name: string;
  summary: HeadToHeadSummary;
  loading?: boolean;
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function resultLabel(result: "win" | "loss" | "draw"): string {
  if (result === "win") return "Win";
  if (result === "loss") return "Loss";
  return "Draw";
}

export function HeadToHeadHistory({
  player1Name,
  player2Name,
  summary,
  loading = false,
}: HeadToHeadHistoryProps) {
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const selectedGame = summary.games.find((g) => g.url === selectedUrl) ?? null;

  if (loading && summary.totalGames === 0) {
    return (
      <div className="card">
        <div className="loading-bar" style={{ margin: 0, border: "none" }}>
          <IconLoader2 size={18} className="spin" />
          Scanning monthly archives for direct matchups…
        </div>
      </div>
    );
  }

  if (summary.totalGames === 0) {
    return (
      <div className="card">
        <p className="empty-state">
          No direct games found in the last 48 months of {player1Name}&apos;s
          archives. They may not have played on Chess.com recently, or games
          are outside the scanned window.
        </p>
      </div>
    );
  }

  const p1WinPct =
    summary.totalGames > 0
      ? Math.round((summary.player1Wins / summary.totalGames) * 100)
      : 0;
  const p2WinPct =
    summary.totalGames > 0
      ? Math.round((summary.player2Wins / summary.totalGames) * 100)
      : 0;

  return (
    <div className="card">
      <div className="h2h-scoreboard">
        <div className="h2h-player p1">
          <span className="h2h-name">{player1Name}</span>
          <span className="h2h-record">
            {summary.player1Wins}W · {summary.player1Losses}L ·{" "}
            {summary.player1Draws}D
          </span>
          <span className="h2h-pct">{p1WinPct}% win rate</span>
        </div>
        <div className="h2h-vs">vs</div>
        <div className="h2h-player p2">
          <span className="h2h-name">{player2Name}</span>
          <span className="h2h-record">
            {summary.player2Wins}W · {summary.player2Losses}L ·{" "}
            {summary.player2Draws}D
          </span>
          <span className="h2h-pct">{p2WinPct}% win rate</span>
        </div>
      </div>

      <p className="h2h-meta">
        {summary.totalGames} game{summary.totalGames !== 1 ? "s" : ""} found
        (scanned from {player1Name}&apos;s monthly archives) — press ▶ on a row to
        replay it on the board.
      </p>

      {selectedGame && (
        <div className="h2h-viewer">
          <div className="h2h-viewer-head">
            <span>
              <span className="eco-badge">{selectedGame.eco}</span>{" "}
              {selectedGame.opening} · {formatDate(selectedGame.date)}
            </span>
            <a
              href={selectedGame.url}
              target="_blank"
              rel="noopener noreferrer"
              className="h2h-link"
            >
              Open on Chess.com <IconExternalLink size={13} />
            </a>
          </div>
          <GameViewer
            pgn={selectedGame.pgn}
            orientation={selectedGame.player1Color}
            whiteLabel={selectedGame.player1Color === "white" ? player1Name : player2Name}
            blackLabel={selectedGame.player1Color === "white" ? player2Name : player1Name}
          />
        </div>
      )}

      <table className="opening-table h2h-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Opening</th>
            <th>Format</th>
            <th>{player1Name}</th>
            <th>Result</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {summary.games.map((g) => (
            <tr key={g.url} className={g.url === selectedUrl ? "row-active" : ""}>
              <td>{formatDate(g.date)}</td>
              <td>
                <span className="eco-badge">{g.eco}</span> {g.opening}
              </td>
              <td>
                {g.timeClass}
                {g.rated ? "" : " · casual"}
              </td>
              <td>
                <span
                  className={`color-dot ${g.player1Color}`}
                  title={g.player1Color}
                >
                  <IconCircleFilled size={10} />
                </span>
                {g.player1Rating ?? "—"}
              </td>
              <td>
                <span
                  className={`h2h-result ${g.player1Result}`}
                >
                  {resultLabel(g.player1Result)}
                </span>
                <span className="h2h-moves">{g.moveCount} moves</span>
              </td>
              <td className="h2h-actions">
                <button
                  type="button"
                  className="h2h-replay"
                  onClick={() =>
                    setSelectedUrl((u) => (u === g.url ? null : g.url))
                  }
                  aria-label="Replay game on board"
                  aria-pressed={g.url === selectedUrl}
                >
                  <IconPlayerPlay size={16} />
                </button>
                <a
                  href={g.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="h2h-link"
                  aria-label="View game on Chess.com"
                >
                  <IconExternalLink size={16} />
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

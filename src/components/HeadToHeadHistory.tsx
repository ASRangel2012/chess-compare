import {
  IconExternalLink,
  IconCircleFilled,
  IconLoader2,
} from "@tabler/icons-react";
import type { HeadToHeadSummary } from "../lib/types";

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
        (scanned from {player1Name}&apos;s monthly archives)
      </p>

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
            <tr key={g.url}>
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
              <td>
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

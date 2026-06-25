import { IconUser, IconCrown, IconTrophy } from "@tabler/icons-react";
import type {
  ChessPlayerProfile,
  ChessPlayerStats,
  PlayerGameAnalysis,
} from "../lib/types";
import { getRatingForTimeClass } from "../lib/chessApi";

interface PlayerCardProps {
  player: ChessPlayerProfile;
  stats: ChessPlayerStats;
  analysis: PlayerGameAnalysis;
  variant: "player1" | "player2";
}

export function PlayerCard({
  player,
  stats,
  analysis,
  variant,
}: PlayerCardProps) {
  const blitz = getRatingForTimeClass(stats, "blitz");
  const bullet = getRatingForTimeClass(stats, "bullet");
  const rapid = getRatingForTimeClass(stats, "rapid");

  const joined = new Date(player.joined * 1000).getFullYear();

  return (
    <div className={`card player-card ${variant}`}>
      <div className="player-card-header">
        {player.avatar ? (
          <img
            src={player.avatar}
            alt={player.username}
            className="player-avatar"
          />
        ) : (
          <div className="player-avatar player-avatar-placeholder">
            <IconUser size={24} />
          </div>
        )}
        <div>
          <h3 className="player-name">
            {player.username}
            {player.title && (
              <span className="player-title">{player.title}</span>
            )}
          </h3>
          <p className="player-meta">
            {player.country && `${player.country} · `}
            Member since {joined}
            {player.followers > 0 && ` · ${player.followers.toLocaleString()} followers`}
          </p>
        </div>
      </div>

      <div className="stat-row">
        <span className="stat-label">Ratings</span>
        <span className={`stat-value ${variant === "player1" ? "p1" : "p2"}`}>
          {bullet ?? "—"} bullet
        </span>
        <span className="stat-divider">·</span>
        <span className={`stat-value ${variant === "player1" ? "p1" : "p2"}`} style={{ textAlign: "right" }}>
          {blitz ?? "—"} blitz · {rapid ?? "—"} rapid
        </span>
      </div>

      {stats.fide && (
        <div className="stat-row">
          <span className="stat-label">
            <IconCrown size={12} style={{ verticalAlign: -2 }} /> FIDE
          </span>
          <span className={`stat-value ${variant === "player1" ? "p1" : "p2"}`}>
            {stats.fide}
          </span>
          <span className="stat-divider" />
          <span className="stat-value p2" style={{ visibility: "hidden" }}>—</span>
        </div>
      )}

      <div className="stat-row">
        <span className="stat-label">
          <IconTrophy size={12} style={{ verticalAlign: -2 }} /> Recent games (
          {analysis.totalGames})
        </span>
        <span className={`stat-value ${variant === "player1" ? "p1" : "p2"}`}>
          {analysis.wins}W
        </span>
        <span className="stat-divider">/</span>
        <span className={`stat-value ${variant === "player1" ? "p1" : "p2"}`} style={{ textAlign: "right" }}>
          {analysis.losses}L / {analysis.draws}D ({analysis.winRate}%)
        </span>
      </div>
    </div>
  );
}

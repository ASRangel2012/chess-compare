import {
  IconSparkles,
  IconLoader2,
  IconRefresh,
  IconUser,
  IconSword,
} from "@tabler/icons-react";
import type { PlayStyleInsight } from "../lib/types";

interface PlayStyleAnalysisProps {
  player1Name: string;
  player2Name: string;
  insights: PlayStyleInsight | null;
  loading: boolean;
  onRetry: () => void;
}

export function PlayStyleAnalysis({
  player1Name,
  player2Name,
  insights,
  loading,
  onRetry,
}: PlayStyleAnalysisProps) {
  if (loading) {
    return (
      <div className="card">
        <div className="loading-bar" style={{ margin: 0, border: "none" }}>
          <IconLoader2 size={18} className="spin" />
          Generating AI play style profiles with Claude…
        </div>
      </div>
    );
  }

  if (!insights) {
    return (
      <div className="card">
        <div className="empty-state">
          <IconSparkles size={40} />
          <p>
            AI analysis requires the backend server with an Anthropic API key.
          </p>
          <button
            type="button"
            className="btn-secondary"
            onClick={onRetry}
            style={{ marginTop: 16 }}
          >
            <IconRefresh size={16} />
            Retry analysis
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="insight-block p1">
        <h3>
          <IconUser size={18} />
          {player1Name}
        </h3>
        {insights.player1.split("\n\n").map((para, i) => (
          <p key={i}>{para}</p>
        ))}
      </div>

      <div className="insight-block p2">
        <h3>
          <IconUser size={18} />
          {player2Name}
        </h3>
        {insights.player2.split("\n\n").map((para, i) => (
          <p key={i}>{para}</p>
        ))}
      </div>

      <div className="insight-block matchup">
        <h3>
          <IconSword size={18} />
          Style Matchup
        </h3>
        {insights.matchup.split("\n\n").map((para, i) => (
          <p key={i}>{para}</p>
        ))}
      </div>
    </div>
  );
}

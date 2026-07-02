import { IconTargetArrow, IconLoader2, IconRefresh } from "@tabler/icons-react";
import type { PlayStyleInsight } from "../lib/types";

interface GamePlanProps {
  player1Name: string;
  player2Name: string;
  insights: PlayStyleInsight | null;
  loading: boolean;
  /** AI-analysis failure message (comparison results are unaffected). */
  error?: string | null;
  onRetry: () => void;
}

export function GamePlan({
  player1Name,
  player2Name,
  insights,
  loading,
  error,
  onRetry,
}: GamePlanProps) {
  if (loading) {
    return (
      <div className="card">
        <div className="loading-bar" style={{ margin: 0, border: "none" }}>
          <IconLoader2 size={18} className="spin" />
          Building the game plan for {player1Name} with Claude…
        </div>
      </div>
    );
  }

  if (!insights?.gamePlan) {
    return (
      <div className="card">
        <div className="empty-state">
          <IconTargetArrow size={40} />
          <p>
            {error ??
              "The game plan is generated alongside the AI analysis — it needs the backend server with an Anthropic API key."}
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
      <div className="insight-block gameplan">
        <h3>
          <IconTargetArrow size={18} />
          How {player1Name} beats {player2Name}
        </h3>
        {insights.gamePlan.split("\n\n").map((para, i) => (
          <p key={i}>{para}</p>
        ))}
      </div>
    </div>
  );
}

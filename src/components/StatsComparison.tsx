import type { ChessPlayerStats, PlayerGameAnalysis } from "../lib/types";
import {
  getRatingForTimeClass,
  getRecordForTimeClass,
  formatRecord,
} from "../lib/chessApi";

interface StatsComparisonProps {
  player1Name: string;
  player2Name: string;
  stats1: ChessPlayerStats;
  stats2: ChessPlayerStats;
  analysis1: PlayerGameAnalysis;
  analysis2: PlayerGameAnalysis;
}

const TIME_CLASSES = ["bullet", "blitz", "rapid", "daily"] as const;

function highlightHigher(
  v1: number | null,
  v2: number | null
): "player1" | "player2" | "none" {
  if (v1 == null || v2 == null) return "none";
  if (v1 > v2) return "player1";
  if (v2 > v1) return "player2";
  return "none";
}

function StatLine({
  label,
  v1,
  v2,
  highlight,
}: {
  label: string;
  v1: string | number;
  v2: string | number;
  highlight?: "player1" | "player2" | "none";
}) {
  return (
    <>
      <span className="stat-label">{label}</span>
      <span
        className={`stat-value p1${highlight === "player1" ? " winner" : ""}`}
      >
        {v1}
      </span>
      <span className="stat-divider">vs</span>
      <span
        className={`stat-value p2${highlight === "player2" ? " winner" : ""}`}
      >
        {v2}
      </span>
    </>
  );
}

export function StatsComparison({
  player1Name,
  player2Name,
  stats1,
  stats2,
  analysis1,
  analysis2,
}: StatsComparisonProps) {
  return (
    <>
      {TIME_CLASSES.map((tc) => {
        const r1 = getRatingForTimeClass(stats1, tc);
        const r2 = getRatingForTimeClass(stats2, tc);
        const rec1 = getRecordForTimeClass(stats1, tc);
        const rec2 = getRecordForTimeClass(stats2, tc);

        if (r1 == null && r2 == null) return null;

        return (
          <div key={tc} className="stat-row">
            <StatLine
              label={`${tc.charAt(0).toUpperCase() + tc.slice(1)} rating`}
              v1={r1 ?? "—"}
              v2={r2 ?? "—"}
              highlight={highlightHigher(r1, r2)}
            />
            {(rec1 || rec2) && (
              <>
                <span className="stat-label">{tc} lifetime record</span>
                <span className="stat-value p1">
                  {rec1 ? formatRecord(rec1) : "—"}
                </span>
                <span className="stat-divider">vs</span>
                <span className="stat-value p2">
                  {rec2 ? formatRecord(rec2) : "—"}
                </span>
              </>
            )}
          </div>
        );
      })}

      <div className="stat-row">
        <StatLine
          label={`Recent win rate (${player1Name} vs ${player2Name})`}
          v1={`${analysis1.winRate}%`}
          v2={`${analysis2.winRate}%`}
          highlight={highlightHigher(analysis1.winRate, analysis2.winRate)}
        />
      </div>

      <div className="stat-row">
        <StatLine
          label="Avg game length (recent)"
          v1={`${analysis1.avgMoveCount} moves`}
          v2={`${analysis2.avgMoveCount} moves`}
          highlight="none"
        />
      </div>

      {stats1.tactics?.highest?.rating || stats2.tactics?.highest?.rating ? (
        <div className="stat-row">
          <StatLine
            label="Tactics rating (best)"
            v1={stats1.tactics?.highest?.rating ?? "—"}
            v2={stats2.tactics?.highest?.rating ?? "—"}
            highlight={highlightHigher(
              stats1.tactics?.highest?.rating ?? null,
              stats2.tactics?.highest?.rating ?? null
            )}
          />
        </div>
      ) : null}

      {stats1.puzzle_rush?.best || stats2.puzzle_rush?.best ? (
        <div className="stat-row">
          <StatLine
            label="Puzzle Rush (best score)"
            v1={stats1.puzzle_rush?.best?.score ?? "—"}
            v2={stats2.puzzle_rush?.best?.score ?? "—"}
            highlight={highlightHigher(
              stats1.puzzle_rush?.best?.score ?? null,
              stats2.puzzle_rush?.best?.score ?? null
            )}
          />
        </div>
      ) : null}
    </>
  );
}

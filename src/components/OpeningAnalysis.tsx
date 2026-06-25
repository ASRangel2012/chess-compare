import { useState } from "react";
import type { OpeningStats, PlayerGameAnalysis } from "../lib/types";

interface OpeningAnalysisProps {
  player1Name: string;
  player2Name: string;
  analysis1: PlayerGameAnalysis;
  analysis2: PlayerGameAnalysis;
  commonOpenings: { name: string; eco: string }[];
}

type Tab = "common" | "player1" | "player2" | "length";

function OpeningTable({ openings }: { openings: OpeningStats[] }) {
  if (openings.length === 0) {
    return <p className="empty-state">No opening data in recent games.</p>;
  }

  return (
    <table className="opening-table">
      <thead>
        <tr>
          <th>Opening</th>
          <th>Games</th>
          <th>Record</th>
          <th>Win %</th>
        </tr>
      </thead>
      <tbody>
        {openings.slice(0, 10).map((o) => (
          <tr key={`${o.eco}-${o.name}`}>
            <td>
              <span className="eco-badge">{o.eco}</span> {o.name}
            </td>
            <td>{o.games}</td>
            <td>
              {o.wins}W / {o.losses}L / {o.draws}D
            </td>
            <td>
              <span
                className={`win-rate ${o.winRate >= 50 ? "good" : o.winRate < 40 ? "bad" : ""}`}
              >
                {o.winRate}%
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LengthChart({
  buckets,
  variant,
}: {
  buckets: { label: string; count: number }[];
  variant: "p1" | "p2";
}) {
  const max = Math.max(...buckets.map((b) => b.count), 1);

  return (
    <div className="bar-chart">
      {buckets.map((b) => (
        <div key={b.label} className="bar-row">
          <span className="bar-label">{b.label}</span>
          <div className="bar-track">
            <div
              className={`bar-fill ${variant}`}
              style={{ width: `${(b.count / max) * 100}%` }}
            />
          </div>
          <span className="bar-count">{b.count}</span>
        </div>
      ))}
    </div>
  );
}

export function OpeningAnalysis({
  player1Name,
  player2Name,
  analysis1,
  analysis2,
  commonOpenings,
}: OpeningAnalysisProps) {
  const [tab, setTab] = useState<Tab>("common");

  return (
    <div className="card">
      <div className="tabs">
        <button
          type="button"
          className={`tab ${tab === "common" ? "active" : ""}`}
          onClick={() => setTab("common")}
        >
          Common openings
        </button>
        <button
          type="button"
          className={`tab ${tab === "player1" ? "active" : ""}`}
          onClick={() => setTab("player1")}
        >
          {player1Name}
        </button>
        <button
          type="button"
          className={`tab ${tab === "player2" ? "active" : ""}`}
          onClick={() => setTab("player2")}
        >
          {player2Name}
        </button>
        <button
          type="button"
          className={`tab ${tab === "length" ? "active" : ""}`}
          onClick={() => setTab("length")}
        >
          Game length
        </button>
      </div>

      {tab === "common" && (
        <>
          {commonOpenings.length > 0 ? (
            <div className="common-openings">
              {commonOpenings.map((o) => (
                <span key={`${o.eco}-${o.name}`} className="opening-chip">
                  <span className="eco-badge">{o.eco}</span>
                  {o.name}
                </span>
              ))}
            </div>
          ) : (
            <p className="empty-state">
              No shared openings in recent games — different repertoires.
            </p>
          )}
        </>
      )}

      {tab === "player1" && (
        <>
          <h4 style={{ margin: "0 0 12px", color: "var(--color-text-secondary)" }}>
            As White
          </h4>
          <OpeningTable openings={analysis1.openingsAsWhite} />
          <h4 style={{ margin: "24px 0 12px", color: "var(--color-text-secondary)" }}>
            As Black
          </h4>
          <OpeningTable openings={analysis1.openingsAsBlack} />
        </>
      )}

      {tab === "player2" && (
        <>
          <h4 style={{ margin: "0 0 12px", color: "var(--color-text-secondary)" }}>
            As White
          </h4>
          <OpeningTable openings={analysis2.openingsAsWhite} />
          <h4 style={{ margin: "24px 0 12px", color: "var(--color-text-secondary)" }}>
            As Black
          </h4>
          <OpeningTable openings={analysis2.openingsAsBlack} />
        </>
      )}

      {tab === "length" && (
        <div className="card-grid">
          <div>
            <h4 style={{ margin: "0 0 12px", color: "var(--color-player1)" }}>
              {player1Name}
            </h4>
            <LengthChart buckets={analysis1.gameLengthBuckets} variant="p1" />
          </div>
          <div>
            <h4 style={{ margin: "0 0 12px", color: "var(--color-player2)" }}>
              {player2Name}
            </h4>
            <LengthChart buckets={analysis2.gameLengthBuckets} variant="p2" />
          </div>
        </div>
      )}
    </div>
  );
}

import { useState } from "react";
import {
  IconUser,
  IconChartBar,
  IconSword,
  IconSparkles,
  IconLoader2,
  IconSun,
  IconMoon,
  IconSearch,
  IconHistory,
} from "@tabler/icons-react";
import { useChessCompare } from "../hooks/useChessCompare";
import { PlayerCard } from "./PlayerCard";
import { StatsComparison } from "./StatsComparison";
import { OpeningAnalysis } from "./OpeningAnalysis";
import { HeadToHeadHistory } from "./HeadToHeadHistory";
import { PlayStyleAnalysis } from "./PlayStyleAnalysis";
import * as React from "react";

export function ChessCompare() {
  const [player1, setPlayer1] = useState("");
  const [player2, setPlayer2] = useState("");
  const [theme, setTheme] = useState<"auto" | "light" | "dark">("auto");
  const { loading, loadingHeadToHead, analyzingStyle, error, result, compare, retryAiAnalysis } =
    useChessCompare();

  const handleSubmit = (e: React.ChangeEvent) => {
    e.preventDefault();
    compare(player1, player2);
  };

  const toggleTheme = () => {
    setTheme((t) => (t === "auto" ? "light" : t === "light" ? "dark" : "auto"));
  };

  const themeAttr = theme === "auto" ? undefined : theme;
  const themeLabel =
    theme === "auto" ? "Auto" : theme === "light" ? "Light" : "Dark";

  return (
    <div className="app" data-theme={themeAttr}>
      <header className="app-header">
        <div>
          <h1>Chess Compare</h1>
          <p>
            Compare Chess.com players — stats, openings, and AI play style
            insights
          </p>
        </div>
        <button
          type="button"
          className="theme-toggle"
          onClick={toggleTheme}
          aria-label="Toggle theme"
        >
          {theme === "dark" ? <IconMoon size={16} /> : <IconSun size={16} />}
          {themeLabel}
        </button>
      </header>

      <form className="search-form" onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="player1">
            <IconUser size={14} />
            Player 1
          </label>
          <input
            id="player1"
            type="text"
            placeholder="e.g. hikaru"
            value={player1}
            onChange={(e) => setPlayer1(e.target.value)}
            disabled={loading}
            autoComplete="off"
          />
        </div>
        <div className="field">
          <label htmlFor="player2">
            <IconUser size={14} />
            Player 2
          </label>
          <input
            id="player2"
            type="text"
            placeholder="e.g. magnuscarlsen"
            value={player2}
            onChange={(e) => setPlayer2(e.target.value)}
            disabled={loading}
            autoComplete="off"
          />
        </div>
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? (
            <IconLoader2 size={18} className="spin" />
          ) : (
            <IconSearch size={18} />
          )}
          Compare
        </button>
      </form>

      {error && <div className="alert alert-error">{error}</div>}

      {loading && (
        <div className="loading-bar">
          <IconLoader2 size={18} className="spin" />
          Fetching profiles, stats, and recent games from Chess.com…
        </div>
      )}

      {result && !loading && (
        <>
          <section className="section">
            <div className="section-header">
              <IconUser size={20} />
              <h2>Players</h2>
            </div>
            <div className="card-grid">
              <PlayerCard
                player={result.player1.profile}
                stats={result.player1.stats}
                analysis={result.player1.analysis}
                variant="player1"
              />
              <PlayerCard
                player={result.player2.profile}
                stats={result.player2.stats}
                analysis={result.player2.analysis}
                variant="player2"
              />
            </div>
          </section>

          <section className="section">
            <div className="section-header">
              <IconChartBar size={20} />
              <h2>Rating & Record Comparison</h2>
            </div>
            <div className="card">
              <StatsComparison
                player1Name={result.player1.username}
                player2Name={result.player2.username}
                stats1={result.player1.stats}
                stats2={result.player2.stats}
                analysis1={result.player1.analysis}
                analysis2={result.player2.analysis}
              />
            </div>
          </section>

          <section className="section">
            <div className="section-header">
              <IconSword size={20} />
              <h2>Openings & Game Patterns</h2>
            </div>
            <OpeningAnalysis
              player1Name={result.player1.username}
              player2Name={result.player2.username}
              analysis1={result.player1.analysis}
              analysis2={result.player2.analysis}
              commonOpenings={result.commonOpenings}
            />
          </section>

          <section className="section">
            <div className="section-header">
              <IconHistory size={20} />
              <h2>Head-to-Head History</h2>
            </div>
            <HeadToHeadHistory
              player1Name={result.player1.username}
              player2Name={result.player2.username}
              summary={result.headToHead}
              loading={loadingHeadToHead}
            />
          </section>

          <section className="section">
            <div className="section-header">
              <IconSparkles size={20} />
              <h2>AI Play Style Analysis</h2>
            </div>
            <PlayStyleAnalysis
              player1Name={result.player1.username}
              player2Name={result.player2.username}
              insights={result.insights}
              loading={analyzingStyle}
              onRetry={retryAiAnalysis}
            />
          </section>
        </>
      )}

      {!result && !loading && !error && (
        <div className="card empty-state">
          <IconSword size={48} />
          <p>Enter two Chess.com usernames to compare their stats and play styles.</p>
        </div>
      )}
    </div>
  );
}

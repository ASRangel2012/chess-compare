import { useEffect, useState } from "react";
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
  IconTargetArrow,
} from "@tabler/icons-react";
import { useChessCompare } from "../hooks/useChessCompare";
import { PlayerCard } from "./PlayerCard";
import { StatsComparison } from "./StatsComparison";
import { OpeningAnalysis } from "./OpeningAnalysis";
import { HeadToHeadHistory } from "./HeadToHeadHistory";
import { PlayStyleAnalysis } from "./PlayStyleAnalysis";
import { GamePlan } from "./GamePlan";

/** Anchor targets for the sticky section navigation over the results. */
const SECTIONS = [
  { id: "players", label: "Players" },
  { id: "ratings", label: "Ratings & Record" },
  { id: "openings", label: "Openings" },
  { id: "head-to-head", label: "Head-to-Head" },
  { id: "ai-analysis", label: "AI Analysis" },
  { id: "game-plan", label: "Game Plan" },
] as const;

export function ChessCompare() {
  const [player1, setPlayer1] = useState("");
  const [player2, setPlayer2] = useState("");
  const [theme, setTheme] = useState<"auto" | "light" | "dark">("auto");
  const {
    loading,
    loadingHeadToHead,
    analyzingStyle,
    error,
    aiError,
    result,
    compare,
    retryAiAnalysis,
  } = useChessCompare();

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "auto") {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", theme);
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme((t) => (t === "auto" ? "light" : t === "light" ? "dark" : "auto"));
  };

  const themeLabel =
    theme === "auto" ? "Auto" : theme === "light" ? "Light" : "Dark";

  return (
    <div className="app">
      {/* React 19 hoists document metadata rendered anywhere in the tree. */}
      <title>
        {result
          ? `Chess Compare — ${result.player1.username} vs ${result.player2.username}`
          : "Chess Compare"}
      </title>

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

      {/* React 19 form action: no manual preventDefault/submit plumbing. */}
      <form className="search-form" action={() => compare(player1, player2)}>
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
          <nav className="section-nav" aria-label="Page sections">
            {SECTIONS.map((s) => (
              <a key={s.id} href={`#${s.id}`}>
                {s.label}
              </a>
            ))}
          </nav>

          <section id="players" className="section">
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

          <section id="ratings" className="section">
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

          <section id="openings" className="section">
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

          <section id="head-to-head" className="section">
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

          <section id="ai-analysis" className="section">
            <div className="section-header">
              <IconSparkles size={20} />
              <h2>AI Play Style Analysis</h2>
            </div>
            <PlayStyleAnalysis
              player1Name={result.player1.username}
              player2Name={result.player2.username}
              insights={result.insights}
              loading={analyzingStyle}
              error={aiError}
              onRetry={retryAiAnalysis}
            />
          </section>

          <section id="game-plan" className="section">
            <div className="section-header">
              <IconTargetArrow size={20} />
              <h2>Game Plan</h2>
            </div>
            <GamePlan
              player1Name={result.player1.username}
              player2Name={result.player2.username}
              insights={result.insights}
              loading={analyzingStyle}
              error={aiError}
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

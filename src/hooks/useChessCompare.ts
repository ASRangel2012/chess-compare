import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchHeadToHeadGames,
  isAbortError,
  normalizeUsername,
} from "../lib/chessApi";
import { analyzeHeadToHead } from "../lib/headToHead";
import { fetchPlayStyleAnalysis } from "../lib/analyzeApi";
import { runComparison, validateUsernames, MAX_GAMES } from "../lib/compare";
import { logger } from "../lib/logger";
import { loadProgressive } from "./progressiveLoad";
import type {
  ChessPlayerProfile,
  ChessPlayerStats,
  PlayerGameAnalysis,
  PlayStyleInsight,
  HeadToHeadSummary,
} from "../lib/types";

export interface CompareResult {
  player1: {
    username: string;
    profile: ChessPlayerProfile;
    stats: ChessPlayerStats;
    analysis: PlayerGameAnalysis;
  };
  player2: {
    username: string;
    profile: ChessPlayerProfile;
    stats: ChessPlayerStats;
    analysis: PlayerGameAnalysis;
  };
  commonOpenings: { name: string; eco: string }[];
  headToHead: HeadToHeadSummary;
  insights: PlayStyleInsight | null;
}

const EMPTY_HEAD_TO_HEAD: HeadToHeadSummary = {
  totalGames: 0,
  player1Wins: 0,
  player1Losses: 0,
  player1Draws: 0,
  player2Wins: 0,
  player2Losses: 0,
  player2Draws: 0,
  games: [],
};

export function useChessCompare() {
  const [loading, setLoading] = useState(false);
  const [loadingHeadToHead, setLoadingHeadToHead] = useState(false);
  const [analyzingStyle, setAnalyzingStyle] = useState(false);
  /** Comparison failure — blocks the results view. */
  const [error, setError] = useState<string | null>(null);
  /** AI-analysis failure — shown inside the AI cards; the results stay up. */
  const [aiError, setAiError] = useState<string | null>(null);
  const [result, setResult] = useState<CompareResult | null>(null);
  // Monotonic run counter: each compare() stamps a run so a late-resolving H2H
  // or AI promise from a superseded run can be ignored instead of merging stale
  // data into a newer comparison.
  const runIdRef = useRef(0);
  // The active run's AbortController. A new run (or unmount) aborts it so the
  // superseded run's in-flight fetches — up to 48 archive requests — are
  // actually cancelled instead of racing the new run for bandwidth.
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const compare = useCallback(
    async (username1: string, username2: string, withAi = true) => {
      // Validate up front so an invalid pair never shows a spinner.
      const validationError = validateUsernames(
        normalizeUsername(username1),
        normalizeUsername(username2)
      );
      if (validationError) {
        setError(validationError);
        return;
      }

      const myRun = ++runIdRef.current;
      abortRef.current?.abort(); // cancel the superseded run's network work
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      setError(null);
      setAiError(null);
      setResult(null);

      let core;
      try {
        core = await runComparison(username1, username2, {
          maxGames: MAX_GAMES,
          signal: controller.signal,
        });
      } catch (err) {
        // Aborted = superseded by a newer run (or unmount) — never a user error.
        if (isAbortError(err)) return;
        if (runIdRef.current === myRun) {
          logger.warn("comparison failed", err);
          setError(err instanceof Error ? err.message : "Comparison failed");
          setLoading(false);
        }
        return;
      }

      // A newer run started while we were fetching — abandon this one.
      if (runIdRef.current !== myRun) return;

      const u1 = core.player1.username;
      const u2 = core.player2.username;

      setResult({ ...core, headToHead: EMPTY_HEAD_TO_HEAD, insights: null });
      setLoading(false);

      await loadProgressive(
        {
          u1,
          u2,
          analysis1: core.player1.analysis,
          analysis2: core.player2.analysis,
          withAi,
          signal: controller.signal,
        },
        {
          fetchHeadToHeadGames: (a, b, signal) =>
            fetchHeadToHeadGames(a, b, undefined, undefined, { signal }),
          analyzeHeadToHead,
          fetchPlayStyleAnalysis,
        },
        {
          isCurrent: () => runIdRef.current === myRun,
          applyHeadToHead: (headToHead) =>
            setResult((prev) => (prev ? { ...prev, headToHead } : prev)),
          setLoadingHeadToHead,
          applyInsights: (insights) =>
            setResult((prev) => (prev ? { ...prev, insights } : prev)),
          setAnalyzingStyle,
          reportAiError: (message) => setAiError(message),
          logWarn: (message, detail) => logger.warn(message, detail),
          logError: (message, detail) => logger.error(message, detail),
        }
      );
    },
    []
  );

  const retryAiAnalysis = useCallback(async () => {
    if (!result) return;
    // Tie the retry to the current run; a fresh compare() supersedes it.
    const myRun = runIdRef.current;
    const signal = abortRef.current?.signal;
    setAnalyzingStyle(true);
    setAiError(null);
    try {
      const insights = await fetchPlayStyleAnalysis(
        result.player1.analysis,
        result.player2.analysis,
        result.player1.username,
        result.player2.username,
        signal
      );
      if (runIdRef.current === myRun) {
        setResult((prev) => (prev ? { ...prev, insights } : prev));
      }
    } catch (err) {
      if (!isAbortError(err) && runIdRef.current === myRun) {
        logger.error("AI play style analysis retry failed", err);
        setAiError(err instanceof Error ? err.message : "AI analysis failed");
      }
    } finally {
      if (runIdRef.current === myRun) setAnalyzingStyle(false);
    }
  }, [result]);

  return {
    loading,
    loadingHeadToHead,
    analyzingStyle,
    error,
    aiError,
    result,
    compare,
    retryAiAnalysis,
  };
}

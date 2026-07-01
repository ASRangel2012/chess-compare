import { useCallback, useState } from "react";
import { fetchHeadToHeadGames, normalizeUsername } from "../lib/chessApi";
import { analyzeHeadToHead } from "../lib/headToHead";
import { fetchPlayStyleAnalysis } from "../lib/analyzeApi";
import { runComparison, validateUsernames, MAX_GAMES } from "../lib/compare";
import { logger } from "../lib/logger";
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
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CompareResult | null>(null);

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

      setLoading(true);
      setError(null);
      setResult(null);

      let core;
      try {
        core = await runComparison(username1, username2, { maxGames: MAX_GAMES });
      } catch (err) {
        logger.warn("comparison failed", err);
        setError(err instanceof Error ? err.message : "Comparison failed");
        setLoading(false);
        return;
      }

      const u1 = core.player1.username;
      const u2 = core.player2.username;

      setResult({ ...core, headToHead: EMPTY_HEAD_TO_HEAD, insights: null });
      setLoading(false);

      // Head-to-head is best-effort — a failed archive scan must not fail the
      // main comparison, but it should still be visible to a developer.
      setLoadingHeadToHead(true);
      fetchHeadToHeadGames(u1, u2)
        .then((h2hGames) => {
          const headToHead = analyzeHeadToHead(h2hGames, u1, u2);
          setResult((prev) => (prev ? { ...prev, headToHead } : prev));
        })
        .catch((h2hErr) => {
          logger.warn("head-to-head scan failed; showing comparison without it", h2hErr);
        })
        .finally(() => setLoadingHeadToHead(false));

      if (
        withAi &&
        core.player1.analysis.totalGames > 0 &&
        core.player2.analysis.totalGames > 0
      ) {
        setAnalyzingStyle(true);
        try {
          const insights = await fetchPlayStyleAnalysis(
            core.player1.analysis,
            core.player2.analysis,
            u1,
            u2
          );
          setResult((prev) => (prev ? { ...prev, insights } : prev));
        } catch (aiErr) {
          logger.error("AI play style analysis failed", aiErr);
          setError(
            aiErr instanceof Error
              ? `Stats loaded, but AI analysis failed: ${aiErr.message}`
              : "AI analysis failed"
          );
        } finally {
          setAnalyzingStyle(false);
        }
      }
    },
    []
  );

  const retryAiAnalysis = useCallback(async () => {
    if (!result) return;
    setAnalyzingStyle(true);
    setError(null);
    try {
      const insights = await fetchPlayStyleAnalysis(
        result.player1.analysis,
        result.player2.analysis,
        result.player1.username,
        result.player2.username
      );
      setResult((prev) => (prev ? { ...prev, insights } : prev));
    } catch (err) {
      logger.error("AI play style analysis retry failed", err);
      setError(err instanceof Error ? err.message : "AI analysis failed");
    } finally {
      setAnalyzingStyle(false);
    }
  }, [result]);

  return {
    loading,
    loadingHeadToHead,
    analyzingStyle,
    error,
    result,
    compare,
    retryAiAnalysis,
  };
}

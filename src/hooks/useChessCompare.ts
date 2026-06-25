import { useCallback, useState } from "react";
import {
  fetchPlayerProfile,
  fetchPlayerStats,
  fetchRecentGames,
  fetchHeadToHeadGames,
  normalizeUsername,
  findCommonOpenings,
} from "../lib/chessApi";
import { analyzeGames } from "../lib/pgnParser";
import { analyzeHeadToHead } from "../lib/headToHead";
import { fetchPlayStyleAnalysis } from "../lib/analyzeApi";
import type {
  ChessPlayerProfile,
  ChessPlayerStats,
  PlayerGameAnalysis,
  PlayStyleInsight,
  HeadToHeadSummary,
} from "../lib/types";

const MAX_GAMES = 50;

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
      const u1 = normalizeUsername(username1);
      const u2 = normalizeUsername(username2);

      if (!u1 || !u2) {
        setError("Please enter both usernames.");
        return;
      }

      if (u1 === u2) {
        setError("Enter two different players to compare.");
        return;
      }

      setLoading(true);
      setError(null);
      setResult(null);

      try {
        const [
          profile1,
          profile2,
          stats1,
          stats2,
          games1,
          games2,
        ] = await Promise.all([
          fetchPlayerProfile(u1),
          fetchPlayerProfile(u2),
          fetchPlayerStats(u1),
          fetchPlayerStats(u2),
          fetchRecentGames(u1, MAX_GAMES),
          fetchRecentGames(u2, MAX_GAMES),
        ]);

        const analysis1 = analyzeGames(games1, u1);
        const analysis2 = analyzeGames(games2, u2);

        const commonOpenings = findCommonOpenings(
          analysis1.commonOpenings.map((o) => ({ name: o.name, eco: o.eco })),
          analysis2.commonOpenings.map((o) => ({ name: o.name, eco: o.eco }))
        );

        const baseResult: CompareResult = {
          player1: {
            username: u1,
            profile: profile1,
            stats: stats1,
            analysis: analysis1,
          },
          player2: {
            username: u2,
            profile: profile2,
            stats: stats2,
            analysis: analysis2,
          },
          commonOpenings,
          headToHead: EMPTY_HEAD_TO_HEAD,
          insights: null,
        };

        setResult(baseResult);
        setLoading(false);

        setLoadingHeadToHead(true);
        fetchHeadToHeadGames(u1, u2)
          .then((h2hGames) => {
            const headToHead = analyzeHeadToHead(h2hGames, u1, u2);
            setResult((prev) => (prev ? { ...prev, headToHead } : prev));
          })
          .catch(() => {
            /* H2H is best-effort; main comparison still valid */
          })
          .finally(() => setLoadingHeadToHead(false));

        if (withAi && analysis1.totalGames > 0 && analysis2.totalGames > 0) {
          setAnalyzingStyle(true);
          try {
            const insights = await fetchPlayStyleAnalysis(
              analysis1,
              analysis2,
              u1,
              u2
            );
            setResult((prev) => (prev ? { ...prev, insights } : prev));
          } catch (aiErr) {
            setError(
              aiErr instanceof Error
                ? `Stats loaded, but AI analysis failed: ${aiErr.message}`
                : "AI analysis failed"
            );
          } finally {
            setAnalyzingStyle(false);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Comparison failed");
        setLoading(false);
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

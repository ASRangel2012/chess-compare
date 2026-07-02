import type {
  ChessGame,
  HeadToHeadSummary,
  PlayStyleInsight,
  PlayerGameAnalysis,
} from "../lib/types";

/**
 * The progressive, best-effort loading that runs *after* the core comparison:
 * the background head-to-head scan and the awaited AI play-style analysis.
 *
 * Extracted from the React hook (and made fully injectable) so the concurrency
 * behavior — specifically, ignoring results from a superseded run — can be unit
 * tested without a DOM. The hook supplies `isCurrent`, which returns false once
 * a newer compare() run has started; every state mutation is gated on it so a
 * late-resolving promise from an old run can't bleed stale data into the new one.
 * The hook also supplies an AbortSignal so a superseded run's in-flight network
 * requests are actually cancelled, not just ignored.
 */
export interface ProgressiveDeps {
  fetchHeadToHeadGames: (
    u1: string,
    u2: string,
    signal?: AbortSignal
  ) => Promise<ChessGame[]>;
  analyzeHeadToHead: (
    games: ChessGame[],
    u1: string,
    u2: string
  ) => HeadToHeadSummary;
  fetchPlayStyleAnalysis: (
    analysis1: PlayerGameAnalysis,
    analysis2: PlayerGameAnalysis,
    name1: string,
    name2: string,
    signal?: AbortSignal
  ) => Promise<PlayStyleInsight>;
}

export interface ProgressiveHandlers {
  /** False once a newer run has superseded this one. */
  isCurrent: () => boolean;
  applyHeadToHead: (summary: HeadToHeadSummary) => void;
  setLoadingHeadToHead: (loading: boolean) => void;
  applyInsights: (insights: PlayStyleInsight) => void;
  setAnalyzingStyle: (analyzing: boolean) => void;
  /** AI-analysis failures only — never comparison failures. */
  reportAiError: (message: string) => void;
  logWarn: (message: string, detail?: unknown) => void;
  logError: (message: string, detail?: unknown) => void;
}

export interface ProgressiveInput {
  u1: string;
  u2: string;
  analysis1: PlayerGameAnalysis;
  analysis2: PlayerGameAnalysis;
  withAi: boolean;
  /** Cancels this run's in-flight requests when a newer run supersedes it. */
  signal?: AbortSignal;
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

export async function loadProgressive(
  input: ProgressiveInput,
  deps: ProgressiveDeps,
  h: ProgressiveHandlers
): Promise<void> {
  const { u1, u2, analysis1, analysis2, withAi, signal } = input;

  // Head-to-head is best-effort and runs in the background: a failed archive
  // scan must not fail the main comparison, but should still be visible to a dev.
  h.setLoadingHeadToHead(true);
  void deps
    .fetchHeadToHeadGames(u1, u2, signal)
    .then((games) => {
      if (!h.isCurrent()) return; // superseded — drop it
      h.applyHeadToHead(deps.analyzeHeadToHead(games, u1, u2));
    })
    .catch((err) => {
      if (isAbort(err)) return; // superseded run cancelled its own fetches
      h.logWarn("head-to-head scan failed; showing comparison without it", err);
    })
    .finally(() => {
      if (h.isCurrent()) h.setLoadingHeadToHead(false);
    });

  if (withAi && analysis1.totalGames > 0 && analysis2.totalGames > 0) {
    h.setAnalyzingStyle(true);
    try {
      const insights = await deps.fetchPlayStyleAnalysis(
        analysis1,
        analysis2,
        u1,
        u2,
        signal
      );
      if (h.isCurrent()) h.applyInsights(insights);
    } catch (err) {
      // An abort means this run was superseded — never report it as an error.
      if (!isAbort(err)) {
        h.logError("AI play style analysis failed", err);
        if (h.isCurrent()) {
          h.reportAiError(
            err instanceof Error
              ? `Stats loaded, but AI analysis failed: ${err.message}`
              : "AI analysis failed"
          );
        }
      }
    } finally {
      if (h.isCurrent()) h.setAnalyzingStyle(false);
    }
  }
}

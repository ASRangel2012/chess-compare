import type { PlayStyleInsight, PlayerGameAnalysis } from "./types";

/**
 * Client-side backstop for the AI proxy. Must exceed the server's own upstream
 * deadline (ANTHROPIC_TIMEOUT_MS) so the server's clean success or error always
 * arrives first; this only fires if the connection is truly hung. Override with
 * VITE_ANALYZE_TIMEOUT_MS at build time.
 */
const ANALYZE_TIMEOUT_MS = Number(
  import.meta.env.VITE_ANALYZE_TIMEOUT_MS ?? 95_000
);

export async function fetchPlayStyleAnalysis(
  player1Analysis: PlayerGameAnalysis,
  player2Analysis: PlayerGameAnalysis,
  player1Name: string,
  player2Name: string,
  signal?: AbortSignal
): Promise<PlayStyleInsight> {
  // Either the caller's signal (a superseded run) or the timeout cancels the
  // request. AbortSignal.any is available in all browsers that run this app.
  const timeoutSignal = AbortSignal.timeout(ANALYZE_TIMEOUT_MS);
  const fetchSignal =
    signal && typeof AbortSignal.any === "function"
      ? AbortSignal.any([signal, timeoutSignal])
      : (signal ?? timeoutSignal);

  let res: Response;
  try {
    res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        player1: { name: player1Name, analysis: player1Analysis },
        player2: { name: player2Name, analysis: player2Analysis },
      }),
      signal: fetchSignal,
    });
  } catch (err) {
    // A caller-initiated abort is not an error — rethrow it untouched so the
    // hook can drop it silently.
    if (signal?.aborted && err instanceof DOMException && err.name === "AbortError") {
      throw err;
    }
    if (
      err instanceof DOMException &&
      (err.name === "TimeoutError" || err.name === "AbortError")
    ) {
      throw new Error("The AI analysis request timed out. Please retry.", {
        cause: err,
      });
    }
    throw err;
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ error: "Analysis failed" }));
    throw new Error(errBody.error ?? "Failed to generate play style analysis");
  }

  return res.json() as Promise<PlayStyleInsight>;
}

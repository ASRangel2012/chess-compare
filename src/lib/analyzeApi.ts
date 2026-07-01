import type { PlayStyleInsight, PlayerGameAnalysis } from "./types";

/**
 * Client-side deadline for the AI proxy. Slightly longer than the server's own
 * SDK timeout (30s) so the server's error surfaces first when it can; this is
 * the backstop that stops a hung connection from spinning the UI forever.
 */
const ANALYZE_TIMEOUT_MS = 35_000;

export async function fetchPlayStyleAnalysis(
  player1Analysis: PlayerGameAnalysis,
  player2Analysis: PlayerGameAnalysis,
  player1Name: string,
  player2Name: string
): Promise<PlayStyleInsight> {
  let res: Response;
  try {
    res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        player1: { name: player1Name, analysis: player1Analysis },
        player2: { name: player2Name, analysis: player2Analysis },
      }),
      signal: AbortSignal.timeout(ANALYZE_TIMEOUT_MS),
    });
  } catch (err) {
    if (
      err instanceof DOMException &&
      (err.name === "TimeoutError" || err.name === "AbortError")
    ) {
      throw new Error("The AI analysis request timed out. Please retry.");
    }
    throw err;
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ error: "Analysis failed" }));
    throw new Error(errBody.error ?? "Failed to generate play style analysis");
  }

  return res.json() as Promise<PlayStyleInsight>;
}

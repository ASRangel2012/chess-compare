import type { PlayStyleInsight, PlayerGameAnalysis } from "./types";

export async function fetchPlayStyleAnalysis(
  player1Analysis: PlayerGameAnalysis,
  player2Analysis: PlayerGameAnalysis,
  player1Name: string,
  player2Name: string
): Promise<PlayStyleInsight> {
  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      player1: { name: player1Name, analysis: player1Analysis },
      player2: { name: player2Name, analysis: player2Analysis },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Analysis failed" }));
    throw new Error(err.error ?? "Failed to generate play style analysis");
  }

  return res.json() as Promise<PlayStyleInsight>;
}

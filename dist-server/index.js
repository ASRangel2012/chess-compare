// server/index.ts
import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import Anthropic from "@anthropic-ai/sdk";
var __dirname = path.dirname(fileURLToPath(import.meta.url));
var app = express();
var PORT = process.env.PORT ?? 3001;
var isProduction = process.env.NODE_ENV === "production";
app.use(cors());
app.use(express.json({ limit: "1mb" }));
var anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;
function summarizeForPrompt(name, analysis) {
  const topWhite = analysis.openingsAsWhite.slice(0, 5).map((o) => `${o.name} (${o.eco}): ${o.games} games, ${o.winRate}% win rate`).join("\n  ");
  const topBlack = analysis.openingsAsBlack.slice(0, 5).map((o) => `${o.name} (${o.eco}): ${o.games} games, ${o.winRate}% win rate`).join("\n  ");
  const lengths = analysis.gameLengthBuckets.map((b) => `${b.label}: ${b.count}`).join(", ");
  return `
Player: ${name}
Recent games analyzed: ${analysis.totalGames}
Record: ${analysis.wins}W / ${analysis.losses}L / ${analysis.draws}D (${analysis.winRate}% win rate)
Average game length: ${analysis.avgMoveCount} moves
Game length distribution: ${lengths}
Time controls: ${JSON.stringify(analysis.timeClassBreakdown)}
Top openings as White:
  ${topWhite || "None"}
Top openings as Black:
  ${topBlack || "None"}
`.trim();
}
app.post("/api/analyze", async (req, res) => {
  if (!anthropic) {
    return res.status(503).json({
      error: "ANTHROPIC_API_KEY is not configured. Copy .env.example to .env and add your key."
    });
  }
  const body = req.body;
  if (!body?.player1?.analysis || !body?.player2?.analysis) {
    return res.status(400).json({ error: "Missing player analysis data" });
  }
  const prompt = `You are a chess coach analyzing two Chess.com players based on their recent game statistics.

${summarizeForPrompt(body.player1.name, body.player1.analysis)}

---

${summarizeForPrompt(body.player2.name, body.player2.analysis)}

Write concise, insightful chess personality profiles for each player and a brief head-to-head style matchup analysis.

Respond in JSON only with this exact shape:
{
  "player1": "2-3 paragraph profile for ${body.player1.name}",
  "player2": "2-3 paragraph profile for ${body.player2.name}",
  "matchup": "1-2 paragraph analysis of how these styles would clash, what to watch for, and strategic recommendations"
}

Focus on: opening preferences, tactical vs positional tendencies, game length patterns, aggression level, and time control habits. Be specific and reference the data. Avoid generic advice.`;
  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }]
    });
    const text = message.content[0]?.type === "text" ? message.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: "Failed to parse AI response" });
    }
    const parsed = JSON.parse(jsonMatch[0]);
    res.json(parsed);
  } catch (err) {
    console.error("Claude API error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Analysis request failed"
    });
  }
});
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, hasApiKey: Boolean(anthropic) });
});
if (isProduction) {
  const distPath = path.join(__dirname, "../dist");
  app.use(express.static(distPath));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}
app.listen(PORT, () => {
  console.log(
    `Server running on http://localhost:${PORT}${isProduction ? " (production)" : " (API only \u2014 use Vite on :5173 for frontend)"}`
  );
});

import type {
  ArchivesResponse,
  ChessGame,
  ChessPlayerProfile,
  ChessPlayerStats,
  GamesResponse,
} from "./types";

const BASE_URL = "https://api.chess.com/pub";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(`Player not found: ${url}`);
    }
    throw new Error(`Chess.com API error (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export async function fetchPlayerProfile(
  username: string
): Promise<ChessPlayerProfile> {
  return fetchJson<ChessPlayerProfile>(
    `${BASE_URL}/player/${encodeURIComponent(username)}`
  );
}

export async function fetchPlayerStats(
  username: string
): Promise<ChessPlayerStats> {
  return fetchJson<ChessPlayerStats>(
    `${BASE_URL}/player/${encodeURIComponent(username)}/stats`
  );
}

export async function fetchArchives(username: string): Promise<string[]> {
  const data = await fetchJson<ArchivesResponse>(
    `${BASE_URL}/player/${encodeURIComponent(username)}/games/archives`
  );
  return data.archives;
}

export async function fetchMonthlyGames(
  archiveUrl: string
): Promise<ChessGame[]> {
  const data = await fetchJson<GamesResponse>(archiveUrl);
  return data.games;
}

export async function fetchRecentGames(
  username: string,
  maxGames = 50
): Promise<ChessGame[]> {
  const archives = await fetchArchives(username);
  const recentArchives = [...archives].reverse();
  const games: ChessGame[] = [];

  for (const archiveUrl of recentArchives) {
    if (games.length >= maxGames) break;
    const monthly = await fetchMonthlyGames(archiveUrl);
    games.push(...monthly.reverse());
  }

  return games.slice(0, maxGames);
}

export function normalizeUsername(input: string): string {
  return input.trim().toLowerCase();
}

export function getRatingForTimeClass(
  stats: ChessPlayerStats,
  timeClass: string
): number | null {
  const key = `chess_${timeClass}` as keyof ChessPlayerStats;
  const entry = stats[key];
  if (entry && typeof entry === "object" && "last" in entry) {
    return entry.last?.rating ?? null;
  }
  return null;
}

export function getRecordForTimeClass(
  stats: ChessPlayerStats,
  timeClass: string
): { win: number; loss: number; draw: number } | null {
  const key = `chess_${timeClass}` as keyof ChessPlayerStats;
  const entry = stats[key];
  if (entry && typeof entry === "object" && "record" in entry) {
    return entry.record ?? null;
  }
  return null;
}

export function formatRecord(record: {
  win: number;
  loss: number;
  draw: number;
}): string {
  const total = record.win + record.loss + record.draw;
  if (total === 0) return "—";
  const winPct = Math.round((record.win / total) * 100);
  return `${record.win}W / ${record.loss}L / ${record.draw}D (${winPct}%)`;
}

export function findCommonOpenings(
  openings1: { name: string; eco: string }[],
  openings2: { name: string; eco: string }[]
): { name: string; eco: string }[] {
  const set2 = new Set(openings2.map((o) => `${o.eco}|${o.name}`));
  const common: { name: string; eco: string }[] = [];
  const seen = new Set<string>();

  for (const o of openings1) {
    const key = `${o.eco}|${o.name}`;
    if (set2.has(key) && !seen.has(key)) {
      seen.add(key);
      common.push(o);
    }
  }

  return common.sort((a, b) => a.name.localeCompare(b.name));
}

/** Scan monthly archives for games between two players (no dedicated Chess.com H2H endpoint). */
export async function fetchHeadToHeadGames(
  username1: string,
  username2: string,
  maxGames = 100,
  maxArchives = 48
): Promise<ChessGame[]> {
  const u1 = username1.toLowerCase();
  const u2 = username2.toLowerCase();
  const archives = await fetchArchives(u1);
  const recentArchives = [...archives].reverse().slice(0, maxArchives);
  const games: ChessGame[] = [];
  const seen = new Set<string>();

  for (const archiveUrl of recentArchives) {
    if (games.length >= maxGames) break;
    const monthly = await fetchMonthlyGames(archiveUrl);
    for (const game of monthly) {
      const white = game.white.username.toLowerCase();
      const black = game.black.username.toLowerCase();
      const isMatch =
        (white === u1 && black === u2) || (white === u2 && black === u1);
      if (isMatch && !seen.has(game.url)) {
        seen.add(game.url);
        games.push(game);
      }
    }
  }

  return games.sort((a, b) => b.end_time - a.end_time).slice(0, maxGames);
}

import type {
  ArchivesResponse,
  ChessGame,
  ChessPlayerProfile,
  ChessPlayerStats,
  GamesResponse,
} from "./types";

const BASE_URL = "https://api.chess.com/pub";

/** Per-request timeout so a hung Chess.com request can't hang the UI. */
const REQUEST_TIMEOUT_MS = 15_000;
/** How many monthly archives to fetch in parallel. Bounded to stay a good API citizen. */
const ARCHIVE_CONCURRENCY = 6;
/** Retry attempts when Chess.com rate-limits us (HTTP 429). */
const MAX_RATE_LIMIT_RETRIES = 3;
/** How many monthly archives the head-to-head scan looks back over. */
export const HEAD_TO_HEAD_MAX_ARCHIVES = 48;

interface FetchOptions {
  /**
   * Memoize the resolved JSON by URL. Safe for immutable resources — the
   * archives list and any *completed* monthly archive never change. The
   * current (in-progress) month is fetched with `cache: false` so new games
   * show up on a re-run.
   */
  cache?: boolean;
}

/**
 * In-memory response cache keyed by URL. We store the in-flight Promise (not
 * just the resolved value) so concurrent callers for the same URL share a
 * single network request. Failed requests are evicted so errors aren't sticky.
 *
 * Bounded with simple LRU eviction so a long session comparing many players
 * can't grow the map without limit. Map preserves insertion order, so the first
 * key is the least-recently-used; a cache hit refreshes recency by reinserting.
 */
export const JSON_CACHE_MAX = 500;
const jsonCache = new Map<string, Promise<unknown>>();

/** Current number of cached entries. Exposed for tests. */
export function jsonCacheSize(): number {
  return jsonCache.size;
}

function cacheGet(url: string): Promise<unknown> | undefined {
  const cached = jsonCache.get(url);
  if (cached !== undefined) {
    // Move to most-recently-used (delete + re-set puts it at the tail).
    jsonCache.delete(url);
    jsonCache.set(url, cached);
  }
  return cached;
}

function cacheSet(url: string, promise: Promise<unknown>): void {
  jsonCache.set(url, promise);
  if (jsonCache.size <= JSON_CACHE_MAX) return;
  // Evict least-recently-used entries (oldest insertion order) until in bounds.
  for (const lru of jsonCache.keys()) {
    jsonCache.delete(lru);
    if (jsonCache.size <= JSON_CACHE_MAX) break;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function requestJson<T>(url: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });

      // Honor Chess.com rate limiting with a bounded backoff before giving up.
      if (res.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
        const retryAfter = Number(res.headers.get("Retry-After"));
        const waitMs = Number.isFinite(retryAfter)
          ? retryAfter * 1000
          : 2 ** attempt * 500;
        await sleep(waitMs);
        continue;
      }

      if (!res.ok) {
        if (res.status === 404) throw new Error(`Player not found: ${url}`);
        if (res.status === 429) {
          throw new Error("Chess.com is rate limiting requests. Please retry shortly.");
        }
        throw new Error(`Chess.com API error (${res.status})`);
      }

      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new Error("Chess.com request timed out. Please try again.");
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

async function fetchJson<T>(url: string, opts: FetchOptions = {}): Promise<T> {
  if (!opts.cache) return requestJson<T>(url);

  const cached = cacheGet(url);
  if (cached) return cached as Promise<T>;

  const promise = requestJson<T>(url);
  cacheSet(url, promise);
  // Don't cache failures — let the next call retry.
  promise.catch(() => jsonCache.delete(url));
  return promise;
}

/**
 * Fetch monthly archives in ordered batches of at most `concurrency` requests,
 * handing each month's games to `onMonth` (in newest-first archive order).
 * Stops as soon as `onMonth` returns false — the caller signals it has enough.
 *
 * Why batches and not a greedy sliding-window pool? This backs an *early-stop*
 * scan: we only want the newest N games. A greedy pool grabs the next archive
 * the instant any worker frees up, so by the time enough games have arrived it
 * has already fired several more requests — over-fetching archives and being a
 * worse Chess.com citizen. Evaluating the stop condition at each batch boundary
 * caps the overshoot at a single bounded round while still fetching
 * `concurrency` archives in parallel. Months are consumed in input order, so
 * newest-first ordering is deterministic and never depends on which request
 * happens to resolve first.
 */
async function scanArchives(
  archiveUrls: string[],
  concurrency: number,
  onMonth: (games: ChessGame[], index: number) => boolean
): Promise<void> {
  for (let i = 0; i < archiveUrls.length; i += concurrency) {
    const batch = archiveUrls.slice(i, i + concurrency);
    // index 0 is the current, still-changing month — don't cache it.
    const months = await Promise.all(
      batch.map((url, j) => fetchMonthlyGames(url, { cache: i + j !== 0 }))
    );
    for (let j = 0; j < months.length; j++) {
      if (!onMonth(months[j], i + j)) return;
    }
  }
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
  // Archives list is effectively immutable within a session — cache it so the
  // duplicate lookup from the head-to-head scan is a free hit.
  const data = await fetchJson<ArchivesResponse>(
    `${BASE_URL}/player/${encodeURIComponent(username)}/games/archives`,
    { cache: true }
  );
  return data.archives;
}

export async function fetchMonthlyGames(
  archiveUrl: string,
  opts: FetchOptions = {}
): Promise<ChessGame[]> {
  const data = await fetchJson<GamesResponse>(archiveUrl, opts);
  return data.games;
}

export async function fetchRecentGames(
  username: string,
  maxGames = 50,
  concurrency = ARCHIVE_CONCURRENCY
): Promise<ChessGame[]> {
  const archives = await fetchArchives(username);
  const recentArchives = [...archives].reverse(); // most recent month first
  const games: ChessGame[] = [];

  await scanArchives(recentArchives, concurrency, (monthly) => {
    games.push(...[...monthly].reverse());
    return games.length < maxGames; // keep scanning until we have enough
  });

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
  maxArchives = HEAD_TO_HEAD_MAX_ARCHIVES
): Promise<ChessGame[]> {
  const u1 = username1.toLowerCase();
  const u2 = username2.toLowerCase();
  const archives = await fetchArchives(u1);
  const recentArchives = [...archives].reverse().slice(0, maxArchives);
  const games: ChessGame[] = [];
  const seen = new Set<string>();

  await scanArchives(recentArchives, ARCHIVE_CONCURRENCY, (monthly) => {
    for (const game of monthly) {
      // Only standard chess — exclude chess960 and other variants.
      if ((game.rules ?? "chess") !== "chess") continue;
      const white = game.white.username.toLowerCase();
      const black = game.black.username.toLowerCase();
      const isMatch =
        (white === u1 && black === u2) || (white === u2 && black === u1);
      if (isMatch && !seen.has(game.url)) {
        seen.add(game.url);
        games.push(game);
      }
    }
    return games.length < maxGames;
  });

  return games.sort((a, b) => b.end_time - a.end_time).slice(0, maxGames);
}

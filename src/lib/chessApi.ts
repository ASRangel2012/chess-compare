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
/**
 * Sanity ceiling on any single 429 backoff wait. A hostile or buggy
 * Retry-After (say, 3600) must not park a request — and, via the promise
 * cache, every caller sharing it — for an hour. Legitimate hints below the
 * ceiling are honored as-is; early retry against the server's wishes is worse
 * citizenship than giving up.
 */
const MAX_RETRY_WAIT_MS = 60_000;
/** Total backoff budget across all retries of one logical request. */
const RETRY_BUDGET_MS = 90_000;
/** How many monthly archives the head-to-head scan looks back over. */
export const HEAD_TO_HEAD_MAX_ARCHIVES = 48;

/** True when `err` is an abort (caller cancelled) rather than a real failure. */
export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

interface FetchOptions {
  /**
   * Memoize the resolved JSON by cache key. Safe for immutable resources —
   * any *completed* monthly archive never changes. The current calendar
   * month's archive is fetched with `cache: false` so new games show up on a
   * re-run.
   */
  cache?: boolean;
  /**
   * Cache under this key instead of the URL. Used to give the archives list a
   * key that embeds the current year-month, so a month rollover mid-session
   * naturally invalidates the stale list.
   */
  cacheKey?: string;
  /** Cancels the request. Aborts are propagated as-is (never mapped to a user-facing error here). */
  signal?: AbortSignal;
}

/** Injectable clock (ms since epoch) so month-boundary logic is testable. */
type Clock = () => number;

interface ScanOptions {
  signal?: AbortSignal;
  now?: Clock;
}

/**
 * In-memory response cache keyed by URL (or an explicit cacheKey). We store the
 * in-flight Promise (not just the resolved value) so concurrent callers for the
 * same URL share a single network request. Failed requests — including aborted
 * ones — are evicted so errors aren't sticky.
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

function cacheGet(key: string): Promise<unknown> | undefined {
  const cached = jsonCache.get(key);
  if (cached !== undefined) {
    // Move to most-recently-used (delete + re-set puts it at the tail).
    jsonCache.delete(key);
    jsonCache.set(key, cached);
  }
  return cached;
}

function cacheSet(key: string, promise: Promise<unknown>): void {
  jsonCache.set(key, promise);
  if (jsonCache.size <= JSON_CACHE_MAX) return;
  // Evict least-recently-used entries (oldest insertion order) until in bounds.
  for (const lru of jsonCache.keys()) {
    jsonCache.delete(lru);
    if (jsonCache.size <= JSON_CACHE_MAX) break;
  }
}

/**
 * Abort-aware sleep. A bare setTimeout promise is unreachable by every other
 * piece of abort machinery in this file: the caller's signal only governs the
 * fetch, and the per-request timeout aborts a controller whose fetch has
 * already settled by the time we back off. Without this, a hostile
 * Retry-After parked a cancelled run mid-backoff until the timer ran out.
 */
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(
        signal!.reason instanceof Error
          ? signal!.reason
          : new DOMException("The operation was aborted.", "AbortError")
      );
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });

/**
 * Parse a Retry-After header into milliseconds, or NaN when absent or
 * unusable. Careful: `Number(null) === 0`, so a *missing* header must be
 * rejected before coercion — the old code turned "no header" into a 0 ms
 * wait, which made the exponential-backoff fallback dead code and retried
 * with zero delay. (HTTP-date form coerces to NaN and falls back too.)
 */
function retryAfterMs(header: string | null): number {
  if (header === null || header.trim() === "") return NaN;
  const secs = Number(header);
  return Number.isFinite(secs) && secs >= 0 ? secs * 1000 : NaN;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("The operation was aborted.", "AbortError");
  }
}

async function requestJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let backoffSpentMs = 0;
  for (let attempt = 0; ; attempt++) {
    throwIfAborted(signal);
    // Combine the caller's signal with the per-request timeout: either one
    // aborts the fetch. Prefer AbortSignal.any; fall back to manual chaining.
    const controller = new AbortController();
    let fetchSignal = controller.signal;
    let unchain = () => {};
    if (signal) {
      if (typeof AbortSignal.any === "function") {
        fetchSignal = AbortSignal.any([signal, controller.signal]);
      } else {
        const onAbort = () => controller.abort(signal.reason);
        signal.addEventListener("abort", onAbort, { once: true });
        unchain = () => signal.removeEventListener("abort", onAbort);
      }
    }
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: fetchSignal });

      // Honor Chess.com rate limiting with a bounded backoff before giving up:
      // each wait is capped at MAX_RETRY_WAIT_MS, the total across attempts at
      // RETRY_BUDGET_MS, and the sleep itself is abort-aware so cancelling a
      // run interrupts a pending backoff instead of letting it run out.
      if (res.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
        const hinted = retryAfterMs(res.headers.get("Retry-After"));
        const waitMs = Math.min(
          Number.isNaN(hinted) ? 2 ** attempt * 500 : hinted,
          MAX_RETRY_WAIT_MS
        );
        if (backoffSpentMs + waitMs <= RETRY_BUDGET_MS) {
          backoffSpentMs += waitMs;
          await sleep(waitMs, signal);
          continue;
        }
        // Budget exhausted — fall through to the user-facing 429 error below.
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
        // Caller cancelled: propagate the abort untouched so upper layers can
        // recognize it and stay silent — it must never surface as a user error.
        if (signal?.aborted) throw err;
        // Otherwise it was our own timeout.
        throw new Error("Chess.com request timed out. Please try again.", {
          cause: err,
        });
      }
      throw err;
    } finally {
      clearTimeout(timer);
      unchain();
    }
  }
}

async function fetchJson<T>(url: string, opts: FetchOptions = {}): Promise<T> {
  if (!opts.cache) return requestJson<T>(url, opts.signal);

  const key = opts.cacheKey ?? url;
  const cached = cacheGet(key);
  if (cached) {
    try {
      return (await cached) as T;
    } catch (err) {
      // A shared in-flight promise settles once, for everyone — including
      // with the *originating* run's AbortError. That abort is foreign to
      // this caller, whose own signal may be perfectly live; inheriting it
      // would silently kill a run the user never cancelled. Treat a foreign
      // abort as a cache miss and fetch fresh under our own signal. Real
      // failures (and our own aborts) rethrow unchanged.
      if (!isAbortError(err) || opts.signal?.aborted) throw err;
    }
  }

  const promise = requestJson<T>(url, opts.signal);
  cacheSet(key, promise);
  // Don't cache failures — aborted or errored requests are evicted so the next
  // call retries instead of inheriting a poisoned promise.
  promise.catch(() => jsonCache.delete(key));
  return promise;
}

/** "…/games/YYYY/MM" -> "YYYY-MM", or null when the URL has no month suffix. */
export function archiveYearMonth(url: string): string | null {
  const m = url.match(/\/(\d{4})\/(\d{2})\/?$/);
  return m ? `${m[1]}-${m[2]}` : null;
}

/** The current calendar year-month ("YYYY-MM", UTC) per the injected clock. */
export function currentYearMonth(now: Clock = Date.now): string {
  const d = new Date(now());
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
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
  onMonth: (games: ChessGame[], index: number) => boolean,
  opts: ScanOptions = {}
): Promise<void> {
  const nowMonth = currentYearMonth(opts.now);
  for (let i = 0; i < archiveUrls.length; i += concurrency) {
    // Aborted between batches: stop before issuing any further requests.
    throwIfAborted(opts.signal);
    const batch = archiveUrls.slice(i, i + concurrency);
    // Only the current calendar month is still changing — don't cache it. Keyed
    // on the URL's /YYYY/MM suffix (not list position) so a stale archives list
    // after a month rollover can't freeze last month's partial data forever.
    const months = await Promise.all(
      batch.map((url) =>
        fetchMonthlyGames(url, {
          cache: archiveYearMonth(url) !== nowMonth,
          signal: opts.signal,
        })
      )
    );
    for (let j = 0; j < months.length; j++) {
      if (!onMonth(months[j], i + j)) return;
    }
  }
}

export async function fetchPlayerProfile(
  username: string,
  signal?: AbortSignal
): Promise<ChessPlayerProfile> {
  return fetchJson<ChessPlayerProfile>(
    `${BASE_URL}/player/${encodeURIComponent(username)}`,
    { signal }
  );
}

export async function fetchPlayerStats(
  username: string,
  signal?: AbortSignal
): Promise<ChessPlayerStats> {
  return fetchJson<ChessPlayerStats>(
    `${BASE_URL}/player/${encodeURIComponent(username)}/stats`,
    { signal }
  );
}

export async function fetchArchives(
  username: string,
  opts: ScanOptions = {}
): Promise<string[]> {
  // The archives list gains a new entry when a month rolls over, so it is only
  // immutable *within* a calendar month. Embedding the current year-month in
  // the cache key makes a rollover mid-session a natural cache miss (the stale
  // entry ages out of the LRU), while repeat lookups inside the month — e.g.
  // the duplicate lookup from the head-to-head scan — stay free.
  const url = `${BASE_URL}/player/${encodeURIComponent(username)}/games/archives`;
  const data = await fetchJson<ArchivesResponse>(url, {
    cache: true,
    cacheKey: `${url}#${currentYearMonth(opts.now)}`,
    signal: opts.signal,
  });
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
  concurrency = ARCHIVE_CONCURRENCY,
  opts: ScanOptions = {}
): Promise<ChessGame[]> {
  const archives = await fetchArchives(username, opts);
  const recentArchives = [...archives].reverse(); // most recent month first
  const games: ChessGame[] = [];

  await scanArchives(
    recentArchives,
    concurrency,
    (monthly) => {
      // Newest game first within the month. A loop (not push(...spread)) so a
      // huge month can't blow the engine's max-argument-count limit.
      for (let g = monthly.length - 1; g >= 0; g--) {
        games.push(monthly[g]);
      }
      return games.length < maxGames; // keep scanning until we have enough
    },
    opts
  );

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
  maxArchives = HEAD_TO_HEAD_MAX_ARCHIVES,
  opts: ScanOptions = {}
): Promise<ChessGame[]> {
  const u1 = username1.toLowerCase();
  const u2 = username2.toLowerCase();
  const archives = await fetchArchives(u1, opts);
  const recentArchives = [...archives].reverse().slice(0, maxArchives);
  const games: ChessGame[] = [];
  const seen = new Set<string>();

  await scanArchives(
    recentArchives,
    ARCHIVE_CONCURRENCY,
    (monthly) => {
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
    },
    opts
  );

  return games.sort((a, b) => b.end_time - a.end_time).slice(0, maxGames);
}

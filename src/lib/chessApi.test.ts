import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  normalizeUsername,
  formatRecord,
  findCommonOpenings,
  getRatingForTimeClass,
  getRecordForTimeClass,
  fetchRecentGames,
  fetchArchives,
  jsonCacheSize,
  JSON_CACHE_MAX,
} from "./chessApi";
import type { ChessPlayerStats } from "./types";

describe("normalizeUsername", () => {
  it("trims and lowercases", () => {
    expect(normalizeUsername("  Hikaru ")).toBe("hikaru");
    expect(normalizeUsername("MagnusCarlsen")).toBe("magnuscarlsen");
  });
});

describe("formatRecord", () => {
  it("formats a record with a win percentage", () => {
    expect(formatRecord({ win: 5, loss: 3, draw: 2 })).toBe("5W / 3L / 2D (50%)");
  });

  it("rounds the win percentage", () => {
    expect(formatRecord({ win: 1, loss: 2, draw: 0 })).toBe("1W / 2L / 0D (33%)");
  });

  it("returns an em dash when there are no games", () => {
    expect(formatRecord({ win: 0, loss: 0, draw: 0 })).toBe("—");
  });
});

describe("findCommonOpenings", () => {
  it("returns the intersection keyed by eco+name, sorted by name", () => {
    const a = [
      { name: "Sicilian Defense", eco: "B20" },
      { name: "Italian Game", eco: "C50" },
    ];
    const b = [
      { name: "Italian Game", eco: "C50" },
      { name: "French Defense", eco: "C00" },
    ];
    expect(findCommonOpenings(a, b)).toEqual([{ name: "Italian Game", eco: "C50" }]);
  });

  it("de-duplicates repeated openings", () => {
    const a = [
      { name: "Italian Game", eco: "C50" },
      { name: "Italian Game", eco: "C50" },
    ];
    const b = [{ name: "Italian Game", eco: "C50" }];
    expect(findCommonOpenings(a, b)).toHaveLength(1);
  });

  it("returns empty when repertoires don't overlap", () => {
    expect(
      findCommonOpenings([{ name: "A", eco: "1" }], [{ name: "B", eco: "2" }])
    ).toEqual([]);
  });
});

describe("getRatingForTimeClass / getRecordForTimeClass", () => {
  const stats: ChessPlayerStats = {
    chess_blitz: { last: { rating: 2100, date: 1 }, record: { win: 10, loss: 5, draw: 2 } },
  };

  it("reads a present rating", () => {
    expect(getRatingForTimeClass(stats, "blitz")).toBe(2100);
  });

  it("returns null for a missing time class", () => {
    expect(getRatingForTimeClass(stats, "bullet")).toBeNull();
    expect(getRecordForTimeClass(stats, "rapid")).toBeNull();
  });

  it("reads a present record", () => {
    expect(getRecordForTimeClass(stats, "blitz")).toEqual({ win: 10, loss: 5, draw: 2 });
  });
});

// ---------------------------------------------------------------------------
// Network layer: exercises the concurrency / caching / early-stop refactor
// against the real fetchRecentGames + fetchArchives using a mocked fetch.
// ---------------------------------------------------------------------------

const BASE = "https://api.chess.com/pub";

function jsonResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => data,
  } as unknown as Response;
}

/** Build N monthly archive URLs (oldest -> newest, as Chess.com returns them). */
function archiveUrls(user: string, months: number): string[] {
  return Array.from({ length: months }, (_, i) => {
    const m = String(i + 1).padStart(2, "0");
    return `${BASE}/player/${user}/games/2020/${m}`;
  });
}

describe("fetchRecentGames (network)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let maxInFlight: number;
  let inFlight: number;

  beforeEach(() => {
    maxInFlight = 0;
    inFlight = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function installFetch(user: string, months: number, gamesPerMonth: number) {
    const urls = archiveUrls(user, months);
    fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;

      if (url.endsWith("/games/archives")) {
        return jsonResponse({ archives: urls });
      }
      // Monthly archive: tag each game with its month so we can check ordering.
      const month = url.slice(url.lastIndexOf("/") + 1);
      const games = Array.from({ length: gamesPerMonth }, (_, g) => ({
        url: `${url}/game/${g}`,
        pgn: "",
        end_time: Number(month) * 100 + g,
        rated: true,
        white: { username: user, result: "win" },
        black: { username: "opp", result: "resigned" },
        time_class: "blitz",
        month,
      }));
      return jsonResponse({ games });
    });
    vi.stubGlobal("fetch", fetchMock);
    return urls;
  }

  it("returns at most maxGames, newest month first", async () => {
    installFetch("alice", 10, 10);
    const games = await fetchRecentGames("alice", 50);
    expect(games).toHaveLength(50);
    // newest month is 2020/10 -> its games should lead the list
    expect((games[0] as unknown as { month: string }).month).toBe("10");
  });

  it("never exceeds the concurrency limit of in-flight requests", async () => {
    installFetch("bob", 10, 10);
    await fetchRecentGames("bob", 50, 6);
    expect(maxInFlight).toBeLessThanOrEqual(6);
    expect(maxInFlight).toBeGreaterThan(1); // proves it actually parallelized
  });

  it("stops early instead of fetching every archive", async () => {
    const urls = installFetch("carol", 30, 10); // 30 months available
    await fetchRecentGames("carol", 50, 6);
    const monthlyFetches = fetchMock.mock.calls.filter(
      (c) => !String(c[0]).endsWith("/games/archives")
    ).length;
    // 50 games / 10 per month = 6 months; should fetch ~6, never all 30.
    expect(monthlyFetches).toBeLessThan(urls.length);
    expect(monthlyFetches).toBeLessThanOrEqual(6);
  });

  it("caches the archives list so repeat lookups don't refetch", async () => {
    installFetch("dave", 5, 10);
    await fetchArchives("dave");
    await fetchArchives("dave");
    const archiveCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).endsWith("/games/archives")
    ).length;
    expect(archiveCalls).toBe(1);
  });
});


// ---------------------------------------------------------------------------
// Network resilience: the 429-backoff retry and the timeout/abort branches in
// requestJson — the branches most likely to misbehave under real conditions.
// ---------------------------------------------------------------------------

describe("chessApi network resilience", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("retries once on HTTP 429 then succeeds (honoring Retry-After)", async () => {
    const payload = { archives: [`${BASE}/player/retryuser/games/2020/01`] };
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls++;
      if (calls === 1) {
        return {
          ok: false,
          status: 429,
          headers: { get: (h: string) => (h === "Retry-After" ? "0" : null) },
          json: async () => ({}),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => payload,
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchArchives("retryuser-429");
    expect(result).toEqual(payload.archives);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("maps a timed-out (aborted) request to a friendly error", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_url: string, opts: { signal: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          opts.signal.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError"))
          );
        })
    );
    vi.stubGlobal("fetch", fetchMock);

    const pending = fetchArchives("timeout-user");
    const assertion = expect(pending).rejects.toThrow(/timed out/i);
    // Fast-forward past the 15s per-request timeout so the AbortController fires.
    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
  });
});


describe("jsonCache eviction (LRU cap)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("bounds the cache to JSON_CACHE_MAX", async () => {
    const fetchMock = vi.fn(
      async (input: string | URL) =>
        ({
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ({ archives: [String(input)] }),
        }) as unknown as Response
    );
    vi.stubGlobal("fetch", fetchMock);
    for (let i = 0; i < JSON_CACHE_MAX + 25; i++) {
      await fetchArchives(`cap-user-${i}`);
    }
    expect(jsonCacheSize()).toBeLessThanOrEqual(JSON_CACHE_MAX);
    expect(jsonCacheSize()).toBe(JSON_CACHE_MAX);
  });
});

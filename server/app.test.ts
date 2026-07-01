import { describe, it, expect, afterEach } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp, type AppDeps } from "./app";
import { createRateLimiter, type RateLimiter } from "./rateLimit";
import type { Logger } from "./logger";
import type { PlayerGameAnalysis } from "./analyze";

// A no-op logger so tests don't spam stdout.
const noopLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return noopLogger;
  },
};

const insight = {
  player1: "profile one",
  player2: "profile two",
  matchup: "the matchup",
  gamePlan: "the plan",
};

function analysis(): PlayerGameAnalysis {
  return {
    totalGames: 10,
    wins: 5,
    losses: 3,
    draws: 2,
    winRate: 50,
    avgMoveCount: 35,
    openingsAsWhite: [],
    openingsAsBlack: [],
    gameLengthBuckets: [],
    timeClassBreakdown: {},
  };
}

function validBody() {
  return {
    player1: { name: "alice", analysis: analysis() },
    player2: { name: "bob", analysis: analysis() },
  };
}

let server: Server | undefined;

async function start(overrides: Partial<AppDeps>): Promise<string> {
  const app = createApp({
    createMessage: null,
    rateLimiter: createRateLimiter({ windowMs: 60_000, max: 10 }),
    logger: noopLogger,
    isProduction: false,
    trustProxy: false,
    distPath: "/tmp",
    ...overrides,
  });
  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const { port } = server!.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

function post(base: string, body: unknown) {
  return fetch(`${base}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
});

describe("POST /api/analyze", () => {
  it("503 when no API key is configured", async () => {
    const base = await start({ createMessage: null });
    const res = await post(base, validBody());
    expect(res.status).toBe(503);
  });

  it("400 when the body is missing analysis data", async () => {
    const base = await start({ createMessage: async () => JSON.stringify(insight) });
    const res = await post(base, {});
    expect(res.status).toBe(400);
  });

  it("rejects a present-but-malformed analysis body with 400 without hanging", async () => {
    // Regression: an empty `analysis` object used to pass validation, then throw
    // in buildPrompt outside any try/catch, leaving the request to hang forever.
    const base = await start({ createMessage: async () => JSON.stringify(insight) });
    const res = await Promise.race([
      post(base, {
        player1: { name: "a", analysis: {} },
        player2: { name: "b", analysis: {} },
      }),
      new Promise<Response>((_, reject) =>
        setTimeout(() => reject(new Error("request hung: no response")), 5000)
      ),
    ]);
    expect(res.status).toBe(400);
    const payload = (await res.json()) as { error: string };
    expect(payload.error).toMatch(/malformed/i);
  });

  it("200 with the parsed insight on the happy path", async () => {
    const base = await start({ createMessage: async () => JSON.stringify(insight) });
    const res = await post(base, validBody());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(insight);
  });

  it("502 when the model returns unusable output", async () => {
    const base = await start({ createMessage: async () => "sorry, no JSON today" });
    const res = await post(base, validBody());
    expect(res.status).toBe(502);
  });

  it("500 when the model call throws", async () => {
    const base = await start({
      createMessage: async () => {
        throw new Error("upstream boom");
      },
    });
    const res = await post(base, validBody());
    expect(res.status).toBe(500);
    const payload = (await res.json()) as { error: string };
    expect(payload.error).toBe("Analysis request failed. Please retry.");
    expect(payload.error).not.toContain("upstream boom");
  });

  it("routes an unexpected middleware throw to a generic 500 without leaking detail", async () => {
    // A synchronous throw from any middleware must reach the global error
    // handler and surface as a generic JSON 500 — never the raw message.
    const secret = "internal detail that must not leak";
    const throwingLimiter: RateLimiter = {
      middleware: () => {
        throw new Error(secret);
      },
      sweep: () => 0,
      size: 0,
    };
    const base = await start({
      createMessage: async () => JSON.stringify(insight),
      rateLimiter: throwingLimiter,
    });
    const res = await post(base, validBody());
    expect(res.status).toBe(500);
    const payload = (await res.json()) as { error: string };
    expect(payload.error).toBe("Internal error. Please retry.");
    expect(payload.error).not.toContain(secret);
  });

  it("429 once the per-IP rate limit is exceeded", async () => {
    const base = await start({
      createMessage: async () => JSON.stringify(insight),
      rateLimiter: createRateLimiter({ windowMs: 60_000, max: 1 }),
    });
    expect((await post(base, validBody())).status).toBe(200);
    const blocked = await post(base, validBody());
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
  });
});

describe("unknown /api routes", () => {
  it("returns a JSON 404 (not SPA HTML) for an unmatched /api route", async () => {
    const base = await start({ createMessage: null });
    const res = await fetch(`${base}/api/nope`);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as { error: string };
    expect(body.error).toBeTruthy();
  });
});

describe("GET /api/health", () => {
  it("reports hasApiKey=false without a key", async () => {
    const base = await start({ createMessage: null });
    const res = await fetch(`${base}/api/health`);
    expect(await res.json()).toEqual({ ok: true, hasApiKey: false });
  });

  it("reports hasApiKey=true with a key", async () => {
    const base = await start({ createMessage: async () => JSON.stringify(insight) });
    const res = await fetch(`${base}/api/health`);
    expect(await res.json()).toEqual({ ok: true, hasApiKey: true });
  });
});

describe("middleware", () => {
  it("stamps and echoes a request id, and honors an inbound one", async () => {
    const base = await start({ createMessage: null });

    const generated = await fetch(`${base}/api/health`);
    expect(generated.headers.get("x-request-id")).toBeTruthy();

    const echoed = await fetch(`${base}/api/health`, {
      headers: { "X-Request-Id": "abc-123" },
    });
    expect(echoed.headers.get("x-request-id")).toBe("abc-123");
  });

  it("sets baseline security headers", async () => {
    const base = await start({ createMessage: null });
    const res = await fetch(`${base}/api/health`);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    const csp = res.headers.get("content-security-policy");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("https://api.chess.com");
    expect(csp).toContain("https://*.chesscomfiles.com");
    expect(res.headers.get("strict-transport-security")).toContain("max-age=");
  });
});

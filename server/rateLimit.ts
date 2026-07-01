import type express from "express";

/**
 * Lightweight in-memory, per-IP fixed-window rate limiter for the AI endpoint,
 * so a public deployment can't be abused to burn the Anthropic budget.
 *
 * Kept as a factory (rather than module-level state) so it can be unit tested
 * deterministically by injecting `now`. For multi-instance deployments, swap
 * the in-memory map for a shared store (e.g. Redis).
 */

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  /** Injectable clock for tests. Defaults to Date.now. */
  now?: () => number;
  /** Message returned on the 429. */
  message?: string;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimiter {
  middleware: express.RequestHandler;
  /** Evict expired buckets so the map can't grow unbounded. Returns evicted count. */
  sweep(): number;
  /** Exposed for assertions in tests. */
  readonly size: number;
}

export function createRateLimiter(options: RateLimitOptions): RateLimiter {
  const now = options.now ?? Date.now;
  const message =
    options.message ??
    "Too many analysis requests. Please wait a minute and try again.";
  const buckets = new Map<string, Bucket>();

  const middleware: express.RequestHandler = (req, res, next) => {
    const t = now();
    const ip = req.ip ?? "unknown";
    const bucket = buckets.get(ip);

    if (!bucket || t > bucket.resetAt) {
      buckets.set(ip, { count: 1, resetAt: t + options.windowMs });
      return next();
    }

    if (bucket.count >= options.max) {
      res.setHeader("Retry-After", Math.ceil((bucket.resetAt - t) / 1000));
      res.status(429).json({ error: message });
      return;
    }

    bucket.count++;
    next();
  };

  const sweep = (): number => {
    const t = now();
    let evicted = 0;
    for (const [ip, bucket] of buckets) {
      if (t > bucket.resetAt) {
        buckets.delete(ip);
        evicted++;
      }
    }
    return evicted;
  };

  return {
    middleware,
    sweep,
    get size() {
      return buckets.size;
    },
  };
}

/**
 * Dependency-free counting semaphore bounding concurrent upstream Anthropic
 * calls. The per-IP rate limiter caps *spend per client*, but nothing else
 * bounds *global concurrency* — each in-flight analyze call holds an Express
 * socket for up to ANTHROPIC_TIMEOUT_MS, so a burst from many IPs could pin
 * every socket to slow upstream calls.
 *
 * Deliberately non-queueing: when saturated, `tryAcquire` returns false and the
 * route replies 503 + Retry-After immediately. Queueing would just hide the
 * same sockets in a longer line.
 *
 * A factory (not module state) so it can be injected into `createApp` and unit
 * tested in isolation, mirroring the rate limiter.
 */

export interface Semaphore {
  /** Take a slot if one is free. Returns false (without blocking) when saturated. */
  tryAcquire(): boolean;
  /** Return a previously acquired slot. Throws on release-without-acquire (a caller bug). */
  release(): void;
  /** Slots currently held. Exposed for tests and observability. */
  readonly inUse: number;
  /** Total slots. */
  readonly max: number;
}

export function createSemaphore(max: number): Semaphore {
  if (!Number.isFinite(max) || max < 1) {
    throw new Error(`Semaphore max must be a positive number, got: ${max}`);
  }
  const cap = Math.floor(max);
  let inUse = 0;

  return {
    tryAcquire() {
      if (inUse >= cap) return false;
      inUse++;
      return true;
    },
    release() {
      if (inUse === 0) {
        // An unbalanced release means a code path released twice (or without
        // acquiring). Failing loudly beats silently raising effective capacity.
        throw new Error("Semaphore.release() called without a matching acquire");
      }
      inUse--;
    },
    get inUse() {
      return inUse;
    },
    get max() {
      return cap;
    },
  };
}

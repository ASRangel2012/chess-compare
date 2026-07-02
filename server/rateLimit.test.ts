import { describe, it, expect } from "vitest";
import type express from "express";
import { createRateLimiter } from "./rateLimit";

/** Minimal Express req/res doubles — enough to exercise the middleware. */
function fakeReq(ip: string): express.Request {
  return { ip } as unknown as express.Request;
}

interface FakeRes {
  statusCode: number;
  headers: Record<string, string | number>;
  body: unknown;
  res: express.Response;
}

function fakeRes(): FakeRes {
  const state: FakeRes = {
    statusCode: 200,
    headers: {},
    body: undefined,
    res: undefined as unknown as express.Response,
  };
  const res = {
    setHeader(key: string, value: string | number) {
      state.headers[key] = value;
    },
    status(code: number) {
      state.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      state.body = payload;
      return res;
    },
  } as unknown as express.Response;
  state.res = res;
  return state;
}

describe("createRateLimiter", () => {
  it("allows up to `max` requests then returns 429 with Retry-After", () => {
    const clock = 0;
    const limiter = createRateLimiter({ windowMs: 1000, max: 3, now: () => clock });

    const hit = () => {
      const out = fakeRes();
      let passed = false;
      limiter.middleware(fakeReq("1.1.1.1"), out.res, () => {
        passed = true;
      });
      return { passed, out };
    };

    expect(hit().passed).toBe(true);
    expect(hit().passed).toBe(true);
    expect(hit().passed).toBe(true);

    const fourth = hit();
    expect(fourth.passed).toBe(false);
    expect(fourth.out.statusCode).toBe(429);
    expect(fourth.out.headers["Retry-After"]).toBe(1);
    expect(fourth.out.body).toMatchObject({ error: expect.stringContaining("Too many") });
  });

  it("tracks each IP independently", () => {
    const clock = 0;
    const limiter = createRateLimiter({ windowMs: 1000, max: 1, now: () => clock });

    const hit = (ip: string) => {
      let passed = false;
      limiter.middleware(fakeReq(ip), fakeRes().res, () => {
        passed = true;
      });
      return passed;
    };

    expect(hit("a")).toBe(true);
    expect(hit("a")).toBe(false); // a is now over budget
    expect(hit("b")).toBe(true); // b has its own bucket
  });

  it("resets the window once it elapses", () => {
    let clock = 0;
    const limiter = createRateLimiter({ windowMs: 1000, max: 1, now: () => clock });
    const hit = () => {
      let passed = false;
      limiter.middleware(fakeReq("1.1.1.1"), fakeRes().res, () => {
        passed = true;
      });
      return passed;
    };

    expect(hit()).toBe(true);
    expect(hit()).toBe(false);
    clock = 1001; // past resetAt
    expect(hit()).toBe(true);
  });

  it("sweep() evicts only expired buckets", () => {
    let clock = 0;
    const limiter = createRateLimiter({ windowMs: 1000, max: 5, now: () => clock });
    limiter.middleware(fakeReq("1.1.1.1"), fakeRes().res, () => {});
    expect(limiter.size).toBe(1);

    expect(limiter.sweep()).toBe(0); // not expired yet
    expect(limiter.size).toBe(1);

    clock = 1001;
    expect(limiter.sweep()).toBe(1);
    expect(limiter.size).toBe(0);
  });
});

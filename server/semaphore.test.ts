import { describe, it, expect } from "vitest";
import { createSemaphore } from "./semaphore";

describe("createSemaphore", () => {
  it("grants up to max slots, then refuses without blocking", () => {
    const sem = createSemaphore(2);
    expect(sem.tryAcquire()).toBe(true);
    expect(sem.tryAcquire()).toBe(true);
    expect(sem.tryAcquire()).toBe(false); // saturated — no queue
    expect(sem.inUse).toBe(2);
  });

  it("frees a slot on release", () => {
    const sem = createSemaphore(1);
    expect(sem.tryAcquire()).toBe(true);
    expect(sem.tryAcquire()).toBe(false);
    sem.release();
    expect(sem.inUse).toBe(0);
    expect(sem.tryAcquire()).toBe(true);
  });

  it("floors a fractional max", () => {
    const sem = createSemaphore(2.9);
    expect(sem.max).toBe(2);
  });

  it("throws on an unbalanced release", () => {
    const sem = createSemaphore(1);
    expect(() => sem.release()).toThrow(/without a matching acquire/);
    // ...and the failed release must not corrupt the count.
    expect(sem.inUse).toBe(0);
    expect(sem.tryAcquire()).toBe(true);
  });

  it.each([[0], [-1], [NaN], [Infinity]])("rejects invalid max %p", (bad) => {
    expect(() => createSemaphore(bad)).toThrow(/positive number/);
  });
});

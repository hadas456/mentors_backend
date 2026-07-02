import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkRateLimit, clearRateLimit } from "../src/rateLimiter";

describe("rateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearRateLimit("test-key");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests within the limit", () => {
    expect(checkRateLimit("test-key", 3, 60000)).toBe(true);
    expect(checkRateLimit("test-key", 3, 60000)).toBe(true);
    expect(checkRateLimit("test-key", 3, 60000)).toBe(true);
  });

  it("blocks requests exceeding the limit", () => {
    checkRateLimit("test-key", 2, 60000);
    checkRateLimit("test-key", 2, 60000);
    expect(checkRateLimit("test-key", 2, 60000)).toBe(false);
  });

  it("resets after the window expires", () => {
    checkRateLimit("test-key", 1, 60000);
    expect(checkRateLimit("test-key", 1, 60000)).toBe(false);

    vi.advanceTimersByTime(60001);

    expect(checkRateLimit("test-key", 1, 60000)).toBe(true);
  });

  it("tracks keys independently", () => {
    checkRateLimit("key-a", 1, 60000);
    expect(checkRateLimit("key-a", 1, 60000)).toBe(false);
    expect(checkRateLimit("key-b", 1, 60000)).toBe(true);
  });

  it("clearRateLimit resets the counter for a key", () => {
    checkRateLimit("test-key", 1, 60000);
    expect(checkRateLimit("test-key", 1, 60000)).toBe(false);

    clearRateLimit("test-key");

    expect(checkRateLimit("test-key", 1, 60000)).toBe(true);
  });

  it("uses default max=5 and windowMs=15min", () => {
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit("default-key")).toBe(true);
    }
    expect(checkRateLimit("default-key")).toBe(false);

    vi.advanceTimersByTime(15 * 60 * 1000 + 1);
    expect(checkRateLimit("default-key")).toBe(true);
  });
});

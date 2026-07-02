import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("firebase-admin", () => ({
  firestore: Object.assign(vi.fn(), {
    Timestamp: {
      fromDate: vi.fn((d: Date) => ({
        toDate: () => d,
        seconds: Math.floor(d.getTime() / 1000),
      })),
    },
  }),
}));

import { generateOTP, getOTPExpiry, parseAvailability, timingSafeEqual } from "../src/utils";

describe("generateOTP", () => {
  it("returns a 6-digit string", () => {
    const otp = generateOTP();
    expect(otp).toMatch(/^\d{6}$/);
  });

  it("returns different values on successive calls", () => {
    const otps = new Set(Array.from({ length: 20 }, () => generateOTP()));
    expect(otps.size).toBeGreaterThan(1);
  });
});

describe("getOTPExpiry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));
  });

  it("defaults to 15 minutes from now", () => {
    const ts = getOTPExpiry();
    const expected = new Date("2025-01-01T00:15:00Z");
    expect(ts.toDate().getTime()).toBe(expected.getTime());
  });

  it("accepts a custom minute offset", () => {
    const ts = getOTPExpiry(30);
    const expected = new Date("2025-01-01T00:30:00Z");
    expect(ts.toDate().getTime()).toBe(expected.getTime());
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});

describe("parseAvailability", () => {
  it('returns "unavailable" for the string "unavailable"', () => {
    expect(parseAvailability("unavailable")).toBe("unavailable");
  });

  it('returns "available" for the string "available"', () => {
    expect(parseAvailability("available")).toBe("available");
  });

  it('returns "available" for any other value', () => {
    expect(parseAvailability(undefined)).toBe("available");
    expect(parseAvailability(null)).toBe("available");
    expect(parseAvailability("")).toBe("available");
    expect(parseAvailability(42)).toBe("available");
  });
});

describe("timingSafeEqual", () => {
  it("returns true for identical strings", () => {
    expect(timingSafeEqual("123456", "123456")).toBe(true);
  });

  it("returns false for different strings", () => {
    expect(timingSafeEqual("123456", "654321")).toBe(false);
  });

  it("returns false for different-length strings", () => {
    expect(timingSafeEqual("123", "1234")).toBe(false);
  });

  it("returns true for empty strings", () => {
    expect(timingSafeEqual("", "")).toBe(true);
  });

  it("returns false when one is empty", () => {
    expect(timingSafeEqual("", "a")).toBe(false);
  });
});

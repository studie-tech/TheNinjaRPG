import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import {
  calcSensoryCooldown,
  calcSensoryDetectChance,
  calcStealthDuration,
  calcStealthKeepChance,
  getRemainingSensoryCooldown,
  getRemainingStealthCooldown,
  getRemainingStealthDuration,
  isSensoryReady,
  isStealthCooldownExpired,
  isStealthExpired,
} from "@/libs/stealth";

const now = 1_800_000_000_000;
const secondsAgo = (seconds: number) => new Date(now - seconds * 1000);

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(now);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("stealth and sensory scaling", () => {
  it.each([
    [0, 60, 5, 5, 120],
    [1000, 60, 5, 5, 120],
    [1999, 60, 5, 5, 120],
    [2000, 120, 7.75, 7.75, 115],
    [5500, 300, 16, 16, 100],
  ])(
    "scales stat %d in whole 1000-point steps",
    (stat, duration, keep, detect, cooldown) => {
      expect(calcStealthDuration(stat)).toBe(duration);
      expect(calcStealthKeepChance(stat)).toBeCloseTo(keep);
      expect(calcSensoryDetectChance(stat)).toBeCloseTo(detect);
      expect(calcSensoryCooldown(stat)).toBe(cooldown);
    },
  );

  it("caps every scale", () => {
    expect(calcStealthDuration(Number.MAX_SAFE_INTEGER)).toBeLessThanOrEqual(1200);
    expect(calcSensoryDetectChance(Number.MAX_SAFE_INTEGER)).toBeLessThanOrEqual(60);
    expect(calcSensoryCooldown(Number.MAX_SAFE_INTEGER)).toBeGreaterThanOrEqual(30);
  });
});

describe("stealth and sensory timers", () => {
  it("treats a missing timestamp as finished", () => {
    expect(isStealthExpired(null, 1000)).toBe(true);
    expect(getRemainingStealthDuration(null, 1000)).toBe(0);
    expect(isSensoryReady(null, 1000)).toBe(true);
    expect(getRemainingSensoryCooldown(null, 1000)).toBe(0);
    expect(isStealthCooldownExpired(null)).toBe(true);
    expect(getRemainingStealthCooldown(null)).toBe(0);
  });

  it.each([
    [59.5, false, 0.5],
    [60, true, 0],
    [75, true, 0],
  ])("expires stealth %d seconds after activation", (elapsed, expired, remaining) => {
    const activatedAt = secondsAgo(elapsed);
    expect(isStealthExpired(activatedAt, 1000)).toBe(expired);
    expect(getRemainingStealthDuration(activatedAt, 1000)).toBeCloseTo(remaining);
  });

  it.each([
    [119, false, 1],
    [120, true, 0],
    [500, true, 0],
  ])("readies sensory %d seconds after use", (elapsed, ready, remaining) => {
    const usedAt = secondsAgo(elapsed);
    expect(isSensoryReady(usedAt, 1000)).toBe(ready);
    expect(getRemainingSensoryCooldown(usedAt, 1000)).toBeCloseTo(remaining);
  });

  it.each([
    [2, false, 2],
    [0, true, 0],
    [-5, true, 0],
  ])("ends the combat cooldown with %d seconds to go", (left, expired, remaining) => {
    const endsAt = new Date(now + left * 1000);
    expect(isStealthCooldownExpired(endsAt)).toBe(expired);
    expect(getRemainingStealthCooldown(endsAt)).toBeCloseTo(remaining);
  });

  it("subtracts the client clock offset everywhere", () => {
    const offset = 10_000;
    expect(isStealthExpired(secondsAgo(65), 1000, offset)).toBe(false);
    expect(getRemainingStealthDuration(secondsAgo(65), 1000, offset)).toBeCloseTo(5);
    expect(isSensoryReady(secondsAgo(125), 1000, offset)).toBe(false);
    expect(getRemainingSensoryCooldown(secondsAgo(125), 1000, offset)).toBeCloseTo(5);
    expect(isStealthCooldownExpired(secondsAgo(5), offset)).toBe(false);
    expect(getRemainingStealthCooldown(secondsAgo(5), offset)).toBeCloseTo(5);
  });
});

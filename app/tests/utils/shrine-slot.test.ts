import { describe, expect, it } from "vitest";
import {
  getCurrentSlotBoundary,
  getSlotIndex,
  isNewSlotDue,
} from "@/utils/time";

describe("getSlotIndex", () => {
  it("maps hour 0 to slot 0", () => expect(getSlotIndex(0)).toBe(0));
  it("maps hour 1 to slot 0", () => expect(getSlotIndex(1)).toBe(0));
  it("maps hour 2 to slot 1", () => expect(getSlotIndex(2)).toBe(1));
  it("maps hour 3 to slot 1", () => expect(getSlotIndex(3)).toBe(1));
  it("maps hour 22 to slot 11", () => expect(getSlotIndex(22)).toBe(11));
  it("maps hour 23 to slot 11", () => expect(getSlotIndex(23)).toBe(11));
});

describe("getCurrentSlotBoundary", () => {
  it("returns start of current 2-hour slot", () => {
    const d = new Date("2026-04-16T05:30:00.000Z"); // 5:30 UTC = slot 2 boundary = 04:00
    const boundary = getCurrentSlotBoundary(d);
    expect(boundary.toISOString()).toBe("2026-04-16T04:00:00.000Z");
  });

  it("returns same time when called exactly at a slot boundary", () => {
    const d = new Date("2026-04-16T04:00:00.000Z");
    const boundary = getCurrentSlotBoundary(d);
    expect(boundary.toISOString()).toBe("2026-04-16T04:00:00.000Z");
  });

  it("handles midnight correctly (slot 0)", () => {
    const d = new Date("2026-04-16T00:45:00.000Z");
    const boundary = getCurrentSlotBoundary(d);
    expect(boundary.toISOString()).toBe("2026-04-16T00:00:00.000Z");
  });
});

describe("isNewSlotDue", () => {
  it("returns true when slot boundary falls within (prevTime, now]", () => {
    const now = new Date("2026-04-16T04:00:30.000Z");
    const prevTime = new Date("2026-04-16T03:59:00.000Z");
    expect(isNewSlotDue(now, prevTime)).toBe(true);
  });

  it("returns true when cron fires exactly on the boundary", () => {
    const now = new Date("2026-04-16T04:00:00.000Z");
    const prevTime = new Date("2026-04-16T03:59:00.000Z");
    expect(isNewSlotDue(now, prevTime)).toBe(true);
  });

  it("returns false mid-slot (boundary is before prevTime)", () => {
    const now = new Date("2026-04-16T04:30:00.000Z");
    const prevTime = new Date("2026-04-16T04:05:00.000Z");
    expect(isNewSlotDue(now, prevTime)).toBe(false);
  });

  it("returns false when prevTime equals boundary (exclusive lower bound)", () => {
    const now = new Date("2026-04-16T04:01:00.000Z");
    const prevTime = new Date("2026-04-16T04:00:00.000Z");
    expect(isNewSlotDue(now, prevTime)).toBe(false);
  });

  it("returns true for a late cron that crossed the boundary", () => {
    // Cron was supposed to run at 04:00 but ran at 04:02
    const now = new Date("2026-04-16T04:02:00.000Z");
    const prevTime = new Date("2026-04-16T03:59:00.000Z");
    expect(isNewSlotDue(now, prevTime)).toBe(true);
  });
});

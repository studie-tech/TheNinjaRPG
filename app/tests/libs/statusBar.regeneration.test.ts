import { afterEach, expect, it, vi } from "bun:test";
import { calcCurrent } from "@/layout/StatusBar";

afterEach(() => vi.restoreAllMocks());

it.each([
  [59, 10], [60, 30], [119, 30], [120, 50], [600, 100],
])("regenerates after %s seconds to %s", (seconds, expected) => {
  const regenAt = new Date("2026-01-01T00:00:00Z");
  vi.spyOn(Date, "now").mockReturnValue(regenAt.getTime() + seconds * 1000);
  expect(calcCurrent(10, 100, "AWAKE", 20, regenAt).current).toBe(expected);
});

it("uses server time for the tick boundary", () => {
  const regenAt = new Date("2026-01-01T00:00:00Z");
  vi.spyOn(Date, "now").mockReturnValue(regenAt.getTime() + 65000);
  expect(calcCurrent(10, 100, "ASLEEP", 20, regenAt, 10000).current).toBe(10);
});

it.each([
  [0, 60], [1, 59], [18, 42], [59.5, 1], [60, 60], [61, 59],
])("counts down to the next tick after %s seconds", (seconds, expected) => {
  const regenAt = new Date("2026-01-01T00:00:00Z");
  vi.spyOn(Date, "now").mockReturnValue(regenAt.getTime() + seconds * 1000);
  expect(calcCurrent(10, 100, "AWAKE", 20, regenAt).nextTickSeconds).toBe(expected);
});

it("omits the tick countdown when the pool cannot change", () => {
  const regenAt = new Date("2026-01-01T00:00:00Z");
  vi.spyOn(Date, "now").mockReturnValue(regenAt.getTime() + 30000);
  expect(calcCurrent(100, 100, "AWAKE", 20, regenAt).nextTickSeconds).toBeUndefined();
  expect(calcCurrent(10, 100, "AWAKE", 0, regenAt).nextTickSeconds).toBeUndefined();
  expect(calcCurrent(10, 100, "BATTLE", 20, regenAt).nextTickSeconds).toBeUndefined();
  expect(calcCurrent(10, 100, "HOSPITALIZED", 20, regenAt).nextTickSeconds).toBeUndefined();
});

it("keeps the stored balance when regeneration is paused", () => {
  const regenAt = new Date("2026-01-01T00:00:00Z");
  vi.spyOn(Date, "now").mockReturnValue(regenAt.getTime() + 120000);
  expect(calcCurrent(10, 100, "AWAKE", 0, regenAt).current).toBe(10);
});

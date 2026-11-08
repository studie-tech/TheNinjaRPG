import { afterEach, expect, it, vi } from "bun:test";
import { calcCurrent } from "@/layout/StatusBar";
import { IncreaseRegenerationTag } from "@/validators/combat";

afterEach(() => vi.restoreAllMocks());

it("projects combat Energy continuously and stops the meal bonus at expiry", () => {
  const regenAt = new Date("2026-01-01T00:00:00Z");
  const periods = [{ startsAt: regenAt.getTime(), endsAt: regenAt.getTime() + 30000, bonus: 10 }];
  vi.spyOn(Date, "now").mockReturnValue(regenAt.getTime() + 125000);
  expect(calcCurrent(10, 100, "AWAKE", 20, regenAt, 5000, periods).current).toBe(55);
  const buffs = [{ createdAt: regenAt, expiresAt: new Date(regenAt.getTime() + 300000), effects: [IncreaseRegenerationTag.parse({ power: 1000 })] }];
  expect(calcCurrent(10, 100, "AWAKE", 20, regenAt, 5000, periods, buffs).current).toBe(55);
  expect(calcCurrent(10, 100, "AWAKE", 20, regenAt, 5000, []).current).toBe(50);
});

it.each([
  [149999, 34], [150000, 34], [151001, 34], [180000, 44], [240000, 54],
])("preserves discrete meal recovery after %s milliseconds", (elapsed, expected) => {
  const regenAt = new Date("2026-01-01T00:00:00Z");
  const buffs = [{
    createdAt: regenAt,
    expiresAt: new Date(regenAt.getTime() + 150000),
    effects: [IncreaseRegenerationTag.parse({ power: 70 })],
  }];
  vi.spyOn(Date, "now").mockReturnValue(regenAt.getTime() + elapsed);
  expect(calcCurrent(0, 100, "AWAKE", 10, regenAt, 0, undefined, buffs).current).toBe(expected);
});

it("uses the strongest overlapping bonus on each discrete tick", () => {
  const regenAt = new Date("2026-01-01T00:00:00Z");
  const buffs = [
    { createdAt: regenAt, expiresAt: new Date(regenAt.getTime() + 150000), effects: [IncreaseRegenerationTag.parse({ power: 70 })] },
    { createdAt: new Date(regenAt.getTime() + 90000), expiresAt: new Date(regenAt.getTime() + 210000), effects: [IncreaseRegenerationTag.parse({ power: 30 })] },
  ];
  vi.spyOn(Date, "now").mockReturnValue(regenAt.getTime() + 240000);
  expect(calcCurrent(0, 100, "TRAVEL", 10, regenAt, 0, undefined, buffs).current).toBe(57);
});

it("keeps timed recovery capped and its next tick on the server clock", () => {
  const regenAt = new Date("2026-01-01T00:00:00Z");
  const buffs = [{
    createdAt: regenAt,
    expiresAt: new Date(regenAt.getTime() + 150000),
    effects: [IncreaseRegenerationTag.parse({ power: 70 })],
  }];
  vi.spyOn(Date, "now").mockReturnValue(regenAt.getTime() + 185000);
  const projected = calcCurrent(0, 100, "AWAKE", 10, regenAt, 66000, undefined, buffs);
  expect(projected.current).toBe(17);
  expect(projected.nextTickSeconds).toBe(1);
  const capped = calcCurrent(90, 100, "AWAKE", 10, regenAt, 66000, undefined, buffs);
  expect(capped.current).toBe(100);
  expect(capped.nextTickSeconds).toBeUndefined();
});

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

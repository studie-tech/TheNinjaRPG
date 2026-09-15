import { afterEach, describe, expect, it, vi } from "vitest";
import { HOSPITAL_BASE_HEAL_SECONDS } from "@/drizzle/constants";
import type { UserData } from "@/drizzle/schema";
import { calcHealFinish } from "@/libs/hospital";

const regenAt = new Date("2026-01-01T12:00:00.000Z");
const user = { regenAt } as UserData;

afterEach(() => vi.restoreAllMocks());

describe("calcHealFinish", () => {
  it.each([
    [undefined, 1],
    [-10, 1],
    [0, 1],
    [30, 0.7],
    [50, 0.5],
    [100, 0],
    [150, 0],
  ])("applies boost %s to the entire hospital stay", (boost, factor) => {
    expect(calcHealFinish({ user, boost }).getTime()).toBe(
      regenAt.getTime() + HOSPITAL_BASE_HEAL_SECONDS * factor * 1000,
    );
  });

  it("keeps the same deadline before, at and after recovery", () => {
    const clock = vi.spyOn(Date, "now");
    const deadline = regenAt.getTime() + HOSPITAL_BASE_HEAL_SECONDS * 500;
    for (const now of [regenAt.getTime(), deadline - 1, deadline, deadline + 60_000]) {
      clock.mockReturnValue(now);
      const finish = calcHealFinish({ user, boost: 50 }).getTime();
      expect(finish).toBe(deadline);
      expect(finish <= Date.now()).toBe(now >= deadline);
    }
  });

  it.each([-120_000, 120_000])("corrects a client clock offset of %s ms", (timeDiff) => {
    const serverDeadline = calcHealFinish({ user, boost: 30 }).getTime();
    expect(calcHealFinish({ user, boost: 30, timeDiff }).getTime()).toBe(
      serverDeadline + timeDiff,
    );
  });
});

import { describe, expect, it } from "vitest";
import { HOSPITAL_BASE_HEAL_SECONDS } from "@/drizzle/constants";
import type { UserData } from "@/drizzle/schema";
import { calcHealFinish, hospitalRecoveryAt } from "@/libs/hospital";

/** A stay that began `secondsAgo` seconds ago. */
const admitted = (secondsAgo: number) => {
  const regenAt = new Date(Date.now() - secondsAgo * 1000);
  return { user: { regenAt } as UserData, regenAt };
};

/** Seconds between the stay starting and the given instant. */
const offsetFromAdmission = (at: Date, regenAt: Date) =>
  Math.round((at.getTime() - regenAt.getTime()) / 1000);

describe("hospitalRecoveryAt", () => {
  it("depends only on when the stay began, not on when it is asked", () => {
    // What a Lock Screen countdown needs: one timestamp that stays put. Recomputing it
    // later in the same stay must land on the same instant, or the countdown finishes
    // before the player does.
    for (const elapsed of [0, HOSPITAL_BASE_HEAL_SECONDS / 4, HOSPITAL_BASE_HEAL_SECONDS / 2]) {
      const { user, regenAt } = admitted(elapsed);
      expect(offsetFromAdmission(hospitalRecoveryAt(user), regenAt)).toBe(
        HOSPITAL_BASE_HEAL_SECONDS,
      );
    }
  });

  it("has nothing left to wait for once the stay is served", () => {
    const { user } = admitted(HOSPITAL_BASE_HEAL_SECONDS + 60);
    expect(hospitalRecoveryAt(user).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("differs from the boosted estimate, which slides later as the stay goes on", () => {
    // calcHealFinish scales the time *still* remaining, so the instant it names depends on
    // when it was called. Fine for a screen that re-renders every second, wrong for a
    // target handed to the OS once.
    const boost = 50;
    const early = admitted(0);
    const late = admitted(HOSPITAL_BASE_HEAL_SECONDS / 2);
    const earlyTarget = offsetFromAdmission(
      calcHealFinish({ user: early.user, boost }),
      early.regenAt,
    );
    const lateTarget = offsetFromAdmission(
      calcHealFinish({ user: late.user, boost }),
      late.regenAt,
    );
    expect(lateTarget).toBeGreaterThan(earlyTarget);
    expect(earlyTarget).toBeLessThan(HOSPITAL_BASE_HEAL_SECONDS);
  });
});

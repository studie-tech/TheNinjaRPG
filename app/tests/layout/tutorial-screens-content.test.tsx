import { describe, expect, it } from "bun:test";
import type { RouterOutputs } from "@/app/_trpc/client";
import { streakDaysAhead } from "@/layout/TutorialScreens";

type Streaks = RouterOutputs["activityStreak"]["getUserStreaks"];

const day = (dayNumber: number) => ({
  dayNumber,
  rewards: { reward_money: dayNumber * 100 },
});
const rewards = [day(1), day(2), day(3), day(4)];
const withProgress = (progress: Record<string, unknown>) =>
  ({
    streaks: [{ streakType: "RECURRING", allRewards: rewards, ...progress }],
    activeRecurringConfig: null,
  }) as unknown as Streaks;

describe("streakDaysAhead", () => {
  it("offers day 1 now and day 2 tomorrow before the first claim", () => {
    const data = {
      streaks: [],
      activeRecurringConfig: { rewards: rewards.slice(0, 3) },
    } as unknown as Streaks;
    const { today, tomorrow } = streakDaysAhead(data);
    expect(today?.dayNumber).toBe(1);
    expect(tomorrow?.dayNumber).toBe(2);
  });

  it("follows a started streak that can still be claimed today", () => {
    const { today, tomorrow } = streakDaysAhead(
      withProgress({
        canClaimToday: true,
        alreadyClaimedToday: false,
        nextDayNumber: 3,
      }),
    );
    expect(today?.dayNumber).toBe(3);
    expect(tomorrow?.dayNumber).toBe(4);
  });

  it("promises only tomorrow's day once today's is claimed", () => {
    const { today, tomorrow } = streakDaysAhead(
      withProgress({
        canClaimToday: false,
        alreadyClaimedToday: true,
        nextDayNumber: 3,
      }),
    );
    expect(today).toBeUndefined();
    expect(tomorrow?.dayNumber).toBe(3);
  });

  it("promises nothing while the streaks are still loading", () => {
    expect(streakDaysAhead(undefined)).toEqual({
      today: undefined,
      tomorrow: undefined,
    });
  });
});

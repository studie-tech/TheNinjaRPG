import type { RouterOutputs } from "@/app/_trpc/client";
import type { TdDojoUpgrade } from "@/libs/towerDefense/content";
import type { UserDelta } from "@/validators/userCache";

/** The `towerDefense.getProgress` shape these patches apply to. */
export type TowerDefenseProgress = RouterOutputs["towerDefense"]["getProgress"];

/** Apply a confirmed Guard Hall purchase: the new level and the scrolls it cost. */
export const getDojoPurchaseUpdate =
  (upgradeId: TdDojoUpgrade, result: { level: number; pointsSpent: number }) =>
  (current: TowerDefenseProgress): TowerDefenseProgress => ({
    ...current,
    points: current.points - result.pointsSpent,
    dojo: { ...current.dojo, [upgradeId]: result.level },
  });

/** Apply a verified claim: scrolls earned and a best wave that only ever rises. */
export const getRunClaimUpdate =
  (result: { pointsEarned: number; wave: number }) =>
  (current: TowerDefenseProgress): TowerDefenseProgress => ({
    ...current,
    points: current.points + result.pointsEarned,
    bestWave: Math.max(current.bestWave, result.wave),
  });

/**
 * The profile changes of a verified claim: a run that fulfilled the daily Guard Hall
 * duty counts toward it and, the first time each day, pays the player and their village.
 * Any other claim leaves the profile as it was.
 */
export const getDailyDutyUserDelta = (duty: {
  fulfilsDuty: boolean;
  reward: { ryo: number; prestige: number; villageTokens: number } | null;
  villageId: string | null;
}): UserDelta =>
  duty.fulfilsDuty
    ? {
        dailyTowerDefenseRuns: 1,
        ...(duty.reward
          ? {
              money: duty.reward.ryo,
              villagePrestige: duty.reward.prestige,
              ...(duty.villageId
                ? { village: { id: duty.villageId, tokens: duty.reward.villageTokens } }
                : {}),
            }
          : {}),
      }
    : {};

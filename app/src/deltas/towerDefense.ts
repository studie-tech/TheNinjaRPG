import type { RouterOutputs } from "@/app/_trpc/client";
import type { DailyDutyReward } from "@/libs/dailyDutyExperience";
import type { TdDojoUpgrade } from "@/libs/towerDefense/content";
import type { UserCachePatch, UserDelta } from "@/validators/userCache";

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
 * The profile changes of a verified claim: the daily Guard Hall duty's reward for the
 * player and their village, and when it was paid, if this claim paid it. Any other claim
 * leaves the profile as it was.
 */
export const getDailyDutyUserUpdate = (duty: {
  reward: DailyDutyReward | null;
  villageId: string | null;
  paidAt: Date;
}): { userDelta: UserDelta; userPatch?: UserCachePatch } =>
  duty.reward
    ? {
        userDelta: {
          money: duty.reward.ryo,
          villagePrestige: duty.reward.prestige,
          ...(duty.reward.experience > 0
            ? { earnedExperience: duty.reward.experience }
            : {}),
          ...(duty.villageId
            ? { village: { id: duty.villageId, tokens: duty.reward.villageTokens } }
            : {}),
        },
        userPatch: { towerDefenseDutyAt: duty.paidAt },
      }
    : { userDelta: {} };

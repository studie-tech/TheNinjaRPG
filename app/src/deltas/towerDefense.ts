import type { RouterOutputs } from "@/app/_trpc/client";
import { getPublicQuestUser } from "@/libs/quest/projection";
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
  reward: { ryo: number; prestige: number; villageTokens: number } | null;
  villageId: string | null;
  paidAt: Date;
}): { userDelta: UserDelta; userPatch?: UserCachePatch } =>
  duty.reward
    ? {
        userDelta: {
          money: duty.reward.ryo,
          villagePrestige: duty.reward.prestige,
          ...(duty.villageId
            ? { village: { id: duty.villageId, tokens: duty.reward.villageTokens } }
            : {}),
        },
        userPatch: { towerDefenseDutyAt: duty.paidAt },
      }
    : { userDelta: {} };

/**
 * The profile change of a won quest challenge: the player's public quest trackers, now
 * with the challenge objective done. A challenge pays nothing else.
 */
export const getChallengeQuestUserUpdate = (
  questUser: Parameters<typeof getPublicQuestUser>[0],
): { userDelta: UserDelta; userPatch: UserCachePatch } => ({
  userDelta: {},
  userPatch: { questData: getPublicQuestUser(questUser).questData },
});

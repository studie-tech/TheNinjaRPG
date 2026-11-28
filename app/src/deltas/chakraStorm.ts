import type { CsStage, CsTraining } from "@/libs/chakraStorm/content";
import type { CsProgress, CsStageRecord } from "@/libs/chakraStorm/progress";
import type { DailyDutyReward } from "@/libs/dailyDutyExperience";
import type { UserCachePatch, UserDelta } from "@/validators/userCache";

/** Apply a confirmed Training Hall purchase: the new level and the intel it cost. */
export const getChakraStormTrainingUpdate =
  (id: CsTraining, result: { level: number; intelSpent: number }) =>
  (current: CsProgress): CsProgress => ({
    ...current,
    intel: current.intel - result.intelSpent,
    training: { ...current.training, [id]: result.level },
  });

/**
 * Apply a verified claim: the intel it brought home and, when it was the region's best
 * run, its record.
 */
export const getChakraStormClaimUpdate =
  (result: { intelEarned: number; stage: CsStage; record: CsStageRecord | null }) =>
  (current: CsProgress): CsProgress => ({
    ...current,
    intel: current.intel + result.intelEarned,
    stages: result.record
      ? { ...current.stages, [result.stage]: result.record }
      : current.stages,
  });

/**
 * The profile changes of a verified claim: the daily scouting report's reward for the
 * player and their village, and when it was paid, if this claim paid it. Any other claim
 * leaves the profile as it was.
 */
export const getScoutingReportUserUpdate = (duty: {
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
        userPatch: { chakraStormDutyAt: duty.paidAt },
      }
    : { userDelta: {} };

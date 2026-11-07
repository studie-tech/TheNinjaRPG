import { CombatStatNames, MasteryNames } from "@/drizzle/constants";
import type { GameSetting, UserData } from "@/drizzle/schema";
import { effectiveMasteries, type MasteryBuffUser } from "@/libs/mastery";
import { calcActiveUserRegen, calcMaxEnergy } from "@/libs/profile";
import { getPublicQuestUser } from "@/libs/quest/projection";
import { getTimedRegeneration } from "@/libs/timedBuffs";
import { regenerationBuffs } from "@/libs/titles";
import type { UserWithRelations } from "@/server/api/routers/profile";
import type { UserRecovery, UserRecoveryActivity } from "@/validators/base";
import type { UserCachePatch } from "@/validators/userCache";

/**
 * Capture committed recovery independently of later endpoint edits. The client applies
 * this baseline before the action's own patch/delta, preserving costs and final activity.
 * Hydration side effects and live companion XP eligibility retain authoritative reconciliation.
 */
export const getActionRecoveryUpdate = (
  initial: UserData,
  user: UserData,
  fields: (keyof UserData)[],
  settings: GameSetting[],
  now: Date,
): UserRecovery => {
  const recovery = {
    userId: initial.userId,
    activity: getActionRecoveryActivity(user),
  };
  const related = user as NonNullable<UserWithRelations> & MasteryBuffUser;
  if (
    related.regenerationWithoutTimedBuffs !== undefined &&
    related.baseRegeneration === undefined
  )
    return recovery;
  const regenerationWithoutTimedBuffs = calcActiveUserRegen(
    {
      ...related,
      status: "AWAKE",
      regeneration: related.baseRegeneration ?? initial.regeneration,
    },
    settings,
    false,
  );
  if (!related.userQuests) return recovery;
  // Hydrated endpoints may already have settled elapsed training before preparing recovery.
  const knownFields = new Set<keyof UserData>([
    ...fields.filter((field) => field !== "petExperience"),
    ...(!fields.includes("petExperience") && !related.requiresProgressionRefresh
      ? ["petExperience" as const]
      : []),
    ...CombatStatNames,
    ...MasteryNames,
    "experience",
    "earnedExperience",
    "curHealth",
    "curChakra",
    "curStamina",
    "curEnergy",
    "regenAt",
    "energyQueueHead",
    "energyQueueTail",
    "masteryQueueHead",
    "elementalQueueHead",
    "currentlyTrainingMastery",
    "masteryTrainingStartedAt",
    "trainingSpeed",
    "dailyTrainings",
    "dailyMissions",
    "dailyErrands",
    "dailyMedicalMissions",
    "dailyWarMissions",
    "dailyArenaFights",
    "dailyPvpMissions",
    "dailySageActivations",
    "dailyOverworldQuestRolls",
    "cookingExperience",
    "primaryElement",
    "secondaryElement",
    "currentlyTrainingElement",
    "elementalTrainingStartedAt",
    "elementalTrainingSpeed",
    "elementalMastery",
    "masteryRanks",
    "activeTrainedElement",
  ]);
  const userPatch = Object.fromEntries(
    [...knownFields].map((field) => [field, structuredClone(user[field])]),
  ) as UserCachePatch;
  userPatch.questData = getPublicQuestUser(related).questData;
  if (related.queue) userPatch.queue = structuredClone(related.queue);
  if (related.cookingJobs)
    userPatch.cookingJobs = structuredClone(related.cookingJobs).map((job) => ({
      ...job,
      userId: user.userId,
    }));
  return {
    ...recovery,
    ...(related.requiresProgressionRefresh ||
    (fields.includes("petExperience") &&
      initial.activePetId &&
      user.experience > initial.experience)
      ? { requiresUserRefresh: true }
      : {}),
    userPatch: {
      ...userPatch,
      regenerationWithoutTimedBuffs,
      regeneration: getTimedRegeneration(
        regenerationWithoutTimedBuffs,
        regenerationBuffs(related),
        now,
      ),
      effectiveMasteries: effectiveMasteries(related),
      maxEnergy: calcMaxEnergy(related),
    },
  };
};

/** Project the committed activity independently of withheld balances, inventory or quest effects. */
export const getActionRecoveryActivity = (
  user: Pick<UserData, "status" | "battleId" | "travelFinishAt">,
  patch?: UserCachePatch,
  activity?: UserRecoveryActivity,
): UserRecoveryActivity => ({
  status: user.status,
  battleId: user.battleId,
  travelFinishAt: user.travelFinishAt,
  ...(patch?.status !== undefined ? { status: patch.status } : {}),
  ...(patch?.battleId !== undefined ? { battleId: patch.battleId } : {}),
  ...(patch?.travelFinishAt !== undefined
    ? { travelFinishAt: patch.travelFinishAt }
    : {}),
  ...activity,
});

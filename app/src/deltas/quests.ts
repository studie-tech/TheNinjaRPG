import type { UserQueueState } from "@/deltas/profile";
import { getUserProgressionUpdate } from "@/deltas/profile";
import type { Quest } from "@/drizzle/schema";
import type { GetRewardResult, postProcessRewards } from "@/libs/quest";
import {
  getQuestTargetSectorsToCheck,
  isAvailableUserQuests,
  type QuestConsequence,
} from "@/libs/quest";
import { hasEnergyQueue } from "@/libs/queue";
import { getNextUserSnapshotAt } from "@/utils/time";

import type { PetTask } from "@/validators/petTasks";
import { MASTERY_EXPERIENCE_FIELDS } from "@/validators/rewards";
import type { UserCachePatch, UserDelta } from "@/validators/userCache";

/**
 * Scalar rewards compose with accepted cache updates; derived state needs reconciliation.
 * Pet XP needs a refresh because its committed amount depends on live SQL eligibility.
 */
export const getRewardUserDelta = (
  rewards: GetRewardResult,
  reputationCost = 0,
  hasQuestSnapshot = false,
): UserDelta | undefined => {
  if (
    // Integer columns round SQL payouts; fractional atomic increments need reconciliation.
    [
      rewards.reward_money,
      rewards.reward_seichi_silver,
      rewards.reward_exp,
      rewards.reward_skillpoints,
    ].some((amount) => !Number.isInteger(amount)) ||
    (!hasQuestSnapshot && rewards.reward_reputation !== 0) ||
    rewards.reward_prestige < 0 ||
    rewards.reward_rank !== "NONE" ||
    rewards.reward_village_membership !== "NONE" ||
    (!hasQuestSnapshot &&
      (rewards.reward_items.length > 0 ||
        rewards.reward_jutsus.length > 0 ||
        rewards.reward_badges.length > 0 ||
        rewards.reward_skillpoints !== 0)) ||
    rewards.reward_bloodlines.length > 0 ||
    rewards.reward_sage_modes.length > 0 ||
    (rewards.reward_titles?.length ?? 0) > 0 ||
    rewards.reward_hunter_items ||
    rewards.reward_gathering_items ||
    rewards.reward_clanpoints !== 0 ||
    rewards.reward_anbupoints !== 0 ||
    rewards.reward_tokens !== 0 ||
    rewards.reward_war_damage !== 0 ||
    rewards.reward_war_healing !== 0 ||
    rewards.reward_medical_experience !== 0 ||
    rewards.reward_hunting_experience !== 0 ||
    rewards.reward_crafting_experience !== 0 ||
    rewards.reward_gathering_experience !== 0 ||
    (rewards.reward_pet_experience ?? 0) !== 0 ||
    MASTERY_EXPERIENCE_FIELDS.some((field) => (rewards[field] ?? 0) > 0) ||
    (rewards.reward_mastery_rank && rewards.reward_mastery_rank !== "NONE") ||
    rewards.reward_sage_mastery_experience !== 0
  ) {
    // Content grants, profession milestones and shared relations change derived profile data.
    return undefined;
  }
  return {
    money: rewards.reward_money,
    seichiSilver: rewards.reward_seichi_silver,
    earnedExperience: rewards.reward_exp,
    reputationPoints: rewards.reward_reputation - reputationCost,
    reputationPointsTotal: rewards.reward_reputation,
    villagePrestige: rewards.reward_prestige,
  };
};

/** Combine the confirmed progression patch with the newly started pet task. */
export const getStartPetTaskUserUpdate = ({
  projectionUserPatch,
  task,
}: {
  projectionUserPatch: UserCachePatch | undefined;
  task: PetTask;
}) => ({
  userPatch: { ...projectionUserPatch, petTask: task },
});

/**
 * Clear the collected pet task while retaining the confirmed progression patch and reward
 * delta.
 */
export const getCollectPetTaskUserUpdate = ({
  projectionUserPatch,
  claimUserDelta,
}: {
  projectionUserPatch: UserCachePatch | undefined;
  claimUserDelta: UserDelta | undefined;
}) => ({
  userPatch: { ...projectionUserPatch, petTask: null },
  userDelta: claimUserDelta,
});

/**
 * Clear the pet task, advance the account revision and remove only its matching quest-history
 * instance.
 */
export const getCancelPetTaskUserUpdate = ({
  ownerUpdatedAt,
  now,
  taskQuestHistoryId,
  taskStartedAt,
}: {
  ownerUpdatedAt: Date;
  now: Date;
  taskQuestHistoryId: string;
  taskStartedAt: number;
}) => ({
  userPatch: {
    petTask: null,
    updatedAt: getNextUserSnapshotAt(ownerUpdatedAt, now),
  },
  userDelta: {
    userQuests: {
      remove: [{ id: taskQuestHistoryId, startedAt: taskStartedAt }],
    },
  },
});

/**
 * Confirm a reward-choice action with no balance changes unless queued energy work requires
 * reconciliation.
 */
export const getUnchangedRewardChoiceUserUpdate = ({
  user,
}: {
  user: UserQueueState;
}) => ({
  userDelta: hasEnergyQueue(user) ? undefined : {},
});

/**
 * Project supported claimed rewards only when no energy work is queued; unsupported effects
 * require reconciliation.
 */
export const getClaimedRewardChoiceUserUpdate = ({
  user,
  rewards,
}: {
  user: UserQueueState;
  rewards: NonNullable<Awaited<ReturnType<typeof postProcessRewards>>>;
}) => ({
  userDelta: hasEnergyQueue(user) ? undefined : getRewardUserDelta(rewards),
});

/**
 * Combine progression and committed battle admission fields, forwarding the battle delta only
 * when admission was attempted.
 */
export const getRetryBattleUserUpdate = ({
  projectionUserPatch,
  committedBattlePatch,
  battleAttempted,
  battleUserUpdateUserDelta,
}: {
  projectionUserPatch: UserCachePatch | undefined;
  committedBattlePatch: UserCachePatch | undefined;
  battleAttempted: boolean;
  battleUserUpdateUserDelta: UserDelta | undefined;
}) => ({
  userPatch: { ...projectionUserPatch, ...committedBattlePatch },
  userDelta: battleAttempted ? battleUserUpdateUserDelta : {},
});

/**
 * Return confirmed integer payouts. Conditional pet-bank grants and relation
 * changes reconcile through the canonical profile query.
 */
export const getRewardUserUpdate = (input: {
  rewards: GetRewardResult;
  requiresRelations?: boolean;
  progression?: () => ReturnType<typeof getUserProgressionUpdate>;
}) => {
  const { rewards } = input;
  const delta = getRewardUserDelta(rewards);
  const needsReconciliation =
    input.requiresRelations || delta === undefined || rewards.reward_exp > 0;
  const fallback = {
    userPatch: undefined,
    userDelta: undefined,
    achievementProgress: undefined,
    announcements: undefined,
  };
  if (needsReconciliation) return fallback;
  const progression = input.progression?.();
  return {
    announcements: undefined,
    userDelta: delta,
    achievementProgress: progression?.achievementProgress,
    userPatch: progression?.userPatch ?? {},
  };
};

/**
 * Combine a confirmed progression snapshot with outstanding balance deltas, excluding XP
 * already projected and the SQL-owned account revision. Omit the update when no safe
 * projection exists.
 */
export const getConfirmedRewardUserUpdate = (
  projection: ReturnType<typeof getUserProgressionUpdate> | undefined,
  delta: UserDelta | undefined,
) => {
  if (!projection) return {};
  const { earnedExperience: _earnedExperience, ...balanceDelta } = delta ?? {};
  const { updatedAt: _updatedAt, ...userPatch } = projection.userPatch;
  return { ...projection, userPatch, userDelta: balanceDelta };
};

/**
 * Project a confirmed quest reward only when loaded state contains all eligible achievements
 * and quest targets, with no unresolved consequences. Unsafe state omits the update for
 * canonical reconciliation.
 */
export const getQuestRewardProjectionUpdate = ({
  user,
  requiresProgressionRefresh,
  userCacheEligible,
  delta,
  consequences,
  progressionQuestCandidates,
  publishedAchievementIds,
}: {
  user: Parameters<typeof getUserProgressionUpdate>[0];
  requiresProgressionRefresh: boolean;
  userCacheEligible: boolean;
  delta: UserDelta | undefined;
  consequences: QuestConsequence[];
  progressionQuestCandidates: {
    questId: string;
    quest: Quest;
    completed?: number | null;
  }[];
  publishedAchievementIds: readonly string[];
}) => {
  const projectedIds = new Set(user.userQuests.map((entry) => entry.questId));
  const canProject =
    !requiresProgressionRefresh &&
    userCacheEligible &&
    delta !== undefined &&
    consequences.length === 0 &&
    !progressionQuestCandidates.some(
      (entry) =>
        entry.quest.questType === "achievement" &&
        !projectedIds.has(entry.questId) &&
        isAvailableUserQuests({ ...entry.quest, ...entry }, user, true).check,
    ) &&
    getQuestTargetSectorsToCheck(user, user.questData ?? []).length === 0;
  return getConfirmedRewardUserUpdate(
    canProject ? getUserProgressionUpdate(user, publishedAchievementIds) : undefined,
    delta,
  );
};

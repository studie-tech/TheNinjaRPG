import type { RouterOutputs } from "@/app/_trpc/client";
import { getInventoryQuantityChanges } from "@/deltas/item";
import type { UserQueueState } from "@/deltas/profile";
import { getUserProgressionUpdate } from "@/deltas/profile";
import type { Quest, QuestHistory, UserItem } from "@/drizzle/schema";
import { getQuestTargetSectorsToCheck, type QuestConsequence } from "@/libs/quest";
import { isAvailableUserQuests } from "@/libs/quest/availability";
import type { GetRewardResult, postProcessRewards } from "@/libs/quest/rewards";
import { hasEnergyQueue } from "@/libs/queue";
import { getNextUserSnapshotAt, periodStart } from "@/utils/time";
import type { InventoryQuantityChange } from "@/validators/inventory";
import type { PetTask } from "@/validators/petTasks";
import { hasPromotionRank, MASTERY_EXPERIENCE_FIELDS } from "@/validators/rewards";
import type { UserCachePatch, UserDelta } from "@/validators/userCache";

/** Project only confirmed quest deliveries; grants, nested starts and combat need recovery. */
export const getQuestConsequenceInventoryUpdate = (
  owned: Pick<UserItem, "id" | "itemId" | "quantity">[],
  deliveries: { id: string; take: number }[],
  consequences: QuestConsequence[],
  removed: boolean,
) => {
  const quantities = deliveries.map(({ id, take }) => ({
    id,
    quantity: (owned.find((row) => row.id === id)?.quantity ?? 0) - take,
  }));
  if (
    !removed ||
    quantities.some(
      ({ id, quantity }) =>
        !owned.some((row) => row.id === id && Number.isInteger(row.quantity)) ||
        quantity < 0,
    ) ||
    consequences.some((entry) => !["remove_item", "update_user"].includes(entry.type))
  )
    return;
  return getInventoryQuantityChanges(owned, quantities);
};

/** Project a quest start only after pending announcements were claimed for delivery by this response. */
export const getQuestStartUserUpdate = (
  user: Parameters<typeof getUserProgressionUpdate>[0],
  publishedAchievementIds: readonly string[],
  receipt: { announcements: { name: string }[]; claimedAt?: Date } | undefined,
  inventoryChanges: InventoryQuantityChange[] | undefined,
) => {
  if (!receipt) return {};
  const projection = getUserProgressionUpdate(user, publishedAchievementIds);
  return {
    ...projection,
    userPatch: {
      ...projection.userPatch,
      unreadNotifications: 0,
      unreadRecruitRewards: 0,
      ...(receipt.claimedAt ? { updatedAt: receipt.claimedAt } : {}),
    },
    announcements: receipt.announcements.map((entry) => entry.name),
    inventoryChanges,
  };
};

/**
 * Patch a loaded discovery listing after a confirmed quest start, from the settled profile.
 * With unchanged eligibility, listed attempt counters follow the profile's attempt rows,
 * entry stock follows the confirmed debits, and quests whose completed prerequisite was
 * reopened close. Return undefined when listed entry stock cannot be confirmed.
 */
export const getQuestStartDiscoveryUpdate = <T extends QuestStartDiscoveryRow>(
  rows: T[],
  attempts: readonly QuestAttemptCounters[],
  reopenedQuestIds: readonly string[],
  inventoryChanges: InventoryQuantityChange[] | undefined,
): T[] | undefined => {
  if (!inventoryChanges && rows.some((row) => row.entryRequirements?.length)) return;
  const debited = (itemId: string) =>
    (inventoryChanges ?? [])
      .filter((change) => change.itemId === itemId)
      .reduce((sum, change) => sum + change.beforeQuantity - change.quantity, 0);
  return rows.flatMap((row) => {
    if (row.prerequisiteQuestId && reopenedQuestIds.includes(row.prerequisiteQuestId))
      return [];
    const attempt = attempts.find((entry) => entry.questId === row.id);
    if (!attempt && !row.entryRequirements?.length) return [row];
    return [
      {
        ...row,
        ...(attempt
          ? {
              previousAttempts: attempt.previousAttempts,
              previousCompletes: attempt.previousCompletes,
              completed: attempt.completed,
              periodCompletes: attempt.periodCompletes,
              periodStartAt: attempt.periodStartAt,
            }
          : {}),
        ...(row.entryRequirements
          ? {
              entryRequirements: row.entryRequirements.map((required) => ({
                ...required,
                owned: required.owned - debited(required.itemId),
              })),
            }
          : {}),
      },
    ];
  });
};

/**
 * Keep upcoming quests when level and mastery eligibility is unchanged; reopening a completed
 * prerequisite can close them and needs reconciliation.
 */
export const getQuestStartUpcomingUpdate = <T>(
  rows: T[],
  reopenedQuestIds: readonly string[],
): T[] | undefined => (reopenedQuestIds.length ? undefined : rows);

/** Completed quests a start reopened, comparing the profile before and after the start. */
export const getReopenedQuestIds = (
  before: readonly CompletedQuestEntry[],
  after: readonly CompletedQuestEntry[],
) =>
  before
    .filter(
      (entry) =>
        entry.completed === 1 &&
        !after.some((next) => next.questId === entry.questId && next.completed === 1),
    )
    .map((entry) => entry.questId);

/** Describe ticket debits only after every guarded entry charge and its receipt committed. */
export const getQuestEntryInventoryChanges = (
  charges: { id: string; itemId: string; expectedQuantity: number; quantity: number }[],
): InventoryQuantityChange[] =>
  charges.map((charge) => ({
    id: charge.id,
    itemId: charge.itemId,
    beforeQuantity: charge.expectedQuantity,
    quantity: charge.expectedQuantity - charge.quantity,
  }));

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
    hasPromotionRank(rewards) ||
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

/**
 * Project the completion counters written by a successful claim. Nonterminal progress that
 * pays at most scalar balances leaves discovery and history unchanged: availability never
 * reads money, experience, reputation or prestige, and level-ups are explicit. Other lists
 * still refresh. Carry loaded counters as `before` and absolute claim counters as `after`.
 * Profile settlements and consequences require discovery refreshes even with zero rewards.
 */
export const getQuestRewardCacheUpdate = (
  entry: Pick<
    QuestHistory,
    | "questId"
    | "previousAttempts"
    | "previousCompletes"
    | "periodCompletes"
    | "periodStartAt"
  > & { quest: Pick<Quest, "retryDelay"> },
  completedAt: Date | null,
  rewards: GetRewardResult,
  requiresDiscoveryRefresh: boolean,
) => {
  const before = {
    previousCompletes: entry.previousCompletes ?? 0,
    periodCompletes: entry.periodCompletes ?? 0,
    periodStartAt: entry.periodStartAt ?? null,
  };
  const retryDelay = entry.quest.retryDelay ?? "none";
  const start =
    completedAt && retryDelay !== "none" ? periodStart(retryDelay, completedAt) : null;
  const delta = getRewardUserDelta(rewards);
  return {
    questId: entry.questId,
    before,
    after: completedAt
      ? {
          previousAttempts: entry.previousAttempts ?? 0,
          previousCompletes: before.previousCompletes + 1,
          periodCompletes: start
            ? !before.periodStartAt || before.periodStartAt < start
              ? 1
              : before.periodCompletes + 1
            : before.periodCompletes,
          periodStartAt: start ?? before.periodStartAt,
        }
      : { ...before, previousAttempts: entry.previousAttempts ?? 0 },
    discoveryUnchanged:
      !completedAt &&
      !requiresDiscoveryRefresh &&
      !rewards.reward_level &&
      !rewards.reward_stats &&
      delta !== undefined,
  };
};

/**
 * Patch loaded discovery counters against their confirmed baseline, preserving raid summaries.
 * Return undefined for changed counters or newer attempts so callers refetch.
 */
export const getQuestRewardDashboardUpdate = (
  current: RouterOutputs["profile"]["getDashboard"],
  update: ReturnType<typeof getQuestRewardCacheUpdate>,
): RouterOutputs["profile"]["getDashboard"] | undefined => {
  const candidate = current.candidates.find((entry) => entry.id === update.questId);
  // Achievements are not discovery candidates; an absent row has no counters to update.
  if (!candidate) return current;
  if (
    (candidate.previousAttempts ?? 0) > update.after.previousAttempts ||
    (candidate.previousCompletes ?? 0) !== update.before.previousCompletes ||
    (candidate.periodCompletes ?? 0) !== update.before.periodCompletes ||
    (candidate.periodStartAt?.getTime() ?? null) !==
      (update.before.periodStartAt?.getTime() ?? null)
  )
    return;
  return {
    ...current,
    candidates: current.candidates.map((entry) =>
      entry.id === update.questId ? { ...entry, ...update.after } : entry,
    ),
  };
};

/** Attempt counters a profile attempt row shares with discovery rows. */
type QuestAttemptCounters = Pick<
  QuestHistory,
  | "questId"
  | "previousAttempts"
  | "previousCompletes"
  | "completed"
  | "periodCompletes"
  | "periodStartAt"
>;

/** A discovery row's quest, prerequisite and optional entry stock. */
type QuestStartDiscoveryRow = {
  id: string;
  prerequisiteQuestId: string | null;
  entryRequirements?: { itemId: string; owned: number }[];
};

/** A profile completion entry. */
type CompletedQuestEntry = { questId: string; completed?: number };

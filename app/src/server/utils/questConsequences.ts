import * as Sentry from "@sentry/nextjs";
import { and, eq, gte, inArray, isNull, lte, ne, notExists, sql } from "drizzle-orm";
import {
  getQuestConsequenceInventoryUpdate,
  getQuestRewardCacheUpdate,
  getRewardUserDelta,
} from "@/deltas/quests";
import {
  ENERGY_QUEST_REWARDS,
  FARM_ACTIVITY_REWARD_TIME_REDUCTION_SECONDS,
  getUserCaps,
  PET_TASK_MAX_MINUTES,
  PET_TASK_QUEST_TYPES,
  SENSEI_STUDENT_RYO_PER_MISSION,
  type UserRole,
} from "@/drizzle/constants";
import { quest, questHistory, userData } from "@/drizzle/schema";
import {
  eliteJoninMilestoneBlockMessage,
  eliteJoninMilestoneUpdate,
} from "@/libs/eliteJonin";
import { qualifiesForFarmActivityReward } from "@/libs/farming";
import { isCarriedUserItem } from "@/libs/item";
import { isPetTaskAttempt } from "@/libs/pets/tasks";
import { eliteJoninExamBlockMessage } from "@/libs/profile";
import { boostPvpGain, getPvpBoost } from "@/libs/pvpExperience";
import {
  applyQuestResets,
  filterQuestTrackersForDbPersist,
  getActiveObjectives,
  getNewTrackers,
  getQuestCounterFieldName,
  type QuestConsequence,
  rollObjectiveAttackers,
} from "@/libs/quest";
import type { GetRewardResult, getReward } from "@/libs/quest/rewards";
import { isQuestPartyHelperAttempt } from "@/libs/questParty";
import {
  findManagedQuestAttempt,
  getIsolatedPyramid,
  isManagedQuestRun,
} from "@/libs/questRun";
import { villageMissionCompletionEvents } from "@/libs/villageMission";
import { nextSnapshotSql } from "@/queries/concurrency";
import { reduceActiveFarmPlotTimers } from "@/queries/farming";
import { incrementUserMoney } from "@/queries/profile";
import {
  deleteUserItemForDeliverQuestItems,
  executeResultForCommitQuestObjectiveRewards,
  fetchUserQuestByQuestId,
  findQuestRewardSkillPoints,
  findUserPvpRewardState,
  insertBankTransfersForCommitQuestObjectiveRewards,
  insertQuestHistoryForCommitQuestObjectiveRewards,
  listQuestsByIds,
  listUserItemForHandleQuestConsequences,
  revertQuestCompletionAfterFailedClaim,
  selectQuestHistoryForWhere2,
  updateQuestHistoryForCommitQuestObjectiveRewards,
  updateQuestHistoryForExecuteClaimedQuestConsequences,
  updateUserItemForDeliverQuestItems,
} from "@/queries/quests";
import { initiateBattle } from "@/routers/combat";
import type { UserWithRelations } from "@/routers/profile";
import { startQuestPartyEncounter } from "@/routers/questParty";
import type { DrizzleClient } from "@/server/db";
import type { ActionReadiness } from "@/server/utils/actionReadiness";
import { claimUserSnapshot } from "@/server/utils/concurrency";
import { grantUserItems } from "@/server/utils/itemGrants";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { fetchPvpExperienceAverage } from "@/server/utils/pvpExperience";
import {
  insertNextQuest,
  isRestrictedQuestType,
  upsertQuestEntry,
} from "@/server/utils/questAssignment";
import {
  publishQuestPartyProgress,
  resetQuestPartyProgress,
} from "@/server/utils/questParty";
import {
  nameGrantedRewards,
  removeQuestTrackerByQuestId,
  updateRewards,
} from "@/server/utils/questRewards";
import {
  getUserRegenerationGain,
  userRegenerationGainSql,
} from "@/server/utils/regeneration";
import { recordVillageMissionProgress } from "@/server/utils/villageMission";
import { canPlayHiddenQuests } from "@/utils/permissions";
import { getNextUserSnapshotAt, periodStart } from "@/utils/time";
import type { QueryCondition } from "@/utils/typeutils";
import type { UserRecoveryActivity } from "@/validators/base";
import type { InventoryQuantityChange } from "@/validators/inventory";
import { QuestCompletionTasks, type QuestTrackerType } from "@/validators/objectives";
import type { PetTask } from "@/validators/petTasks";
import {
  type PendingRewardChoice,
  PostProcessedRewardSchema,
} from "@/validators/rewards";
import type { UserDelta, UserDeltaResponse } from "@/validators/userCache";

/**
 * Shared post-`getReward` reward-claim sequence used by both `checkRewards` and the
 * overworld friendly objective-target path. Encapsulates, in order:
 *   1. The completion compare-and-swap (when `resolved`): insert history if needed, then
 *      claim its completion. Isolated runs combine this with the account snapshot claim.
 *   2. `handleQuestConsequences` with `alwaysClaimUserState`, reverting a separate completion
 *      CAS if its account snapshot claim loses.
 *   3. Restoring the full trackers, the sensei +ryo mission bonus, the tier-bootstrap /
 *      repeatable-achievement re-arm prep, and `updateRewards` (run together).
 * Milestone fields join the guarded account UPDATE so competing quests cannot grant the
 * same level. They are not delivered separately in the ordinary post-claim reward payout.
 * Returns a discriminated outcome; resolved reward names are mapped onto `rewards` so
 * callers can render them directly.
 */
export const commitQuestObjectiveRewards = async (info: {
  client: DrizzleClient;
  userId: string;
  user: NonNullable<UserWithRelations>;
  rewards: GetRewardResult;
  trackers: GetRewardTrackers;
  userQuest: UserQuestFromGetReward;
  resolved: boolean;
  notifications: string[];
  consequences: QuestConsequence[];
  /** Pre-fetched questHistory row for this quest, if the caller already loaded it. */
  existingHistory?: { completed: number } | null;
  /**
   * Offer of a resolved "choose" quest. It is written by the completion CAS itself, which also
   * refuses to overwrite an unpicked offer, so a completion and its offer land together.
   */
  rewardChoice?: PendingRewardChoice | null;
  /**
   * Extra userData columns for updateRewards to fold into its single UPDATE on the claim path.
   * Only applied when this commit actually reaches the reward payout (i.e. the completion CAS
   * won / a non-resolved advance was claimed), never on already_completed / not_found / state
   * changed, which return before updateRewards. Gate on `resolved` at the callsite if the patch
   * should only land on terminal completions.
   */
  postClaimUserDataPatch?: Record<string, unknown>;
  /** Delegated attempts claim the owner receipt and history together before normal final rewards. */
  petTask?: PetTask;
  /** Initial profile settlement can change discovery eligibility before the reward claim. */
  requiresDiscoveryRefresh?: boolean;
  /** Recovery shares the objective's account/history claim before irreversible rewards. */
  readiness?: ActionReadiness;
}): Promise<CommitQuestObjectiveRewardsResult> => {
  const {
    client,
    userId,
    user,
    rewards,
    trackers,
    userQuest,
    resolved,
    notifications,
    consequences,
  } = info;
  const petTask = info.petTask;
  const requiresDiscoveryRefresh =
    !!info.requiresDiscoveryRefresh || consequences.length > 0;
  const milestoneLevel = resolved ? rewards.reward_level : undefined;
  // Validate before claiming history or delivering any objective or completion rewards.
  if (
    (milestoneLevel &&
      (eliteJoninMilestoneBlockMessage(user, milestoneLevel) ||
        !(rewards.reward_stats && rewards.reward_stats > 0))) ||
    (rewards.reward_rank === "ELITE JONIN" && eliteJoninExamBlockMessage(user))
  )
    return { outcome: "state_changed" };
  const milestonePatch = milestoneLevel
    ? eliteJoninMilestoneUpdate(user, milestoneLevel, rewards.reward_stats ?? 0)
    : undefined;
  if (user.petTask && user.petTask.questId === userQuest?.questId && !petTask)
    return { outcome: "state_changed" };
  if (petTask && !isPetTaskAttempt(petTask, userQuest))
    return { outcome: "state_changed" };
  if (isQuestPartyHelperAttempt(userQuest, user.questPartyId)) {
    // Helpers keep their original completion receipt; this also covers bound NPC objectives.
    user.questData = trackers;
    const helperClaim = await handleQuestConsequences(
      client,
      user,
      consequences,
      notifications,
      { alwaysClaimUserState: true, partyTrackers: trackers },
    );
    return helperClaim.claimed
      ? {
          outcome: "claimed",
          postNotifications: helperClaim.notifications,
          rewards: PostProcessedRewardSchema.parse({}),
          badges: [],
          rewardChoicePending: false,
          userCacheEligible: false,
          userDelta: undefined,
          committedActivity: helperClaim.committedActivity,
        }
      : { outcome: "state_changed" };
  }
  // Collective tokens are paid only by villageMission.claim, never personal history.
  if (userQuest?.quest.questType === "village_mission") {
    return { outcome: "not_found" };
  }
  const rewardChoice = resolved ? (info.rewardChoice ?? null) : null;
  const isolatedRun = getIsolatedPyramid(user);
  // A loaded reward must still belong to playable content when its write claims.
  // Visibility-only saves keep history valid, but any in-flight claim retries on
  // their new version; authored edits require the versioned run to restart.
  const liveQuestCondition = userQuest
    ? petTask
      ? petTaskContentCondition(petTask, user.role)
      : sql`EXISTS (SELECT 1 FROM ${quest} WHERE ${and(
          eq(quest.id, userQuest.questId),
          ne(quest.questType, "village_mission"),
          canPlayHiddenQuests(user.role) ? undefined : eq(quest.hidden, false),
          userQuest.quest.questType === "battlepyramid" || userQuest.isolated
            ? eq(quest.updatedAt, userQuest.quest.updatedAt)
            : undefined,
        )})`
    : undefined;
  const senseiId =
    user.rank === "GENIN" && userQuest?.quest.questType === "mission"
      ? user.senseiId
      : null;
  const [sensei, pvpAverage] = await Promise.all([
    senseiId ? findUserPvpRewardState(client, senseiId) : undefined,
    senseiId ? fetchPvpExperienceAverage(client) : undefined,
  ]);
  const senseiReward = Math.floor(
    boostPvpGain(
      SENSEI_STUDENT_RYO_PER_MISSION,
      getPvpBoost(sensei ?? {}, pvpAverage ? [pvpAverage] : []).totalPercent,
    ),
  );
  if (milestonePatch) {
    // Evaluate level-driven trackers against pending progression, then commit them together.
    const progress = getNewTrackers(
      { ...user, ...milestonePatch, questData: trackers },
      [{ task: "user_level", value: milestonePatch.level }],
    );
    trackers.length = 0;
    trackers.push(...progress.trackers);
    consequences.push(...progress.consequences);
    notifications.push(...progress.notifications);
  }
  const userDelta = getRewardUserDelta(rewards, 0, true);
  // Consequences can start battles or change inventory/quest relations outside this snapshot.
  const userCacheEligible =
    // Progression changes pools/stats that ordinary reward deltas do not represent.
    !milestonePatch &&
    !rewards.reward_titles?.length &&
    consequences.every((entry) => entry.type === "update_user") &&
    // Terminal isolation release is conditional on the current run at payout time.
    !(resolved && isolatedRun) &&
    !(resolved && userQuest?.quest.questType === "achievement") &&
    // Completed teams change the Quest Teams and unclaimed-rewards navigation.
    !(resolved && userQuest?.quest.teamEnabled) &&
    !(resolved && info.existingHistory === null);

  const collectionObjectiveIds = new Set(
    userQuest?.quest.questType === "gathering"
      ? userQuest.quest.content.objectives
          .filter((objective) => objective.task === "collect_item")
          .map((objective) => objective.id)
      : [],
  );
  const collectionBonuses =
    trackers
      .find((tracker) => tracker.id === userQuest?.questId)
      ?.goals.filter((goal) => goal.done && collectionObjectiveIds.has(goal.id))
      .map((goal) => goal.gatheringBonusQuantity ?? 0) ?? [];
  // Read before completion removes the tracker. A payout spanning multiple
  // collections uses their lowest captured yield so every required collection earns it.
  const gatheringBonusQuantity = collectionBonuses.length
    ? Math.min(...collectionBonuses)
    : 0;
  user.questData = filterQuestTrackersForDbPersist(trackers, user);
  // Attached members retain terminal contributions and personal collected flags so a later
  // team sync can recover a failed publication. New assignments already clear old trackers.
  const shouldRetainPartyTracker =
    !!userQuest && user.questParty?.questId === userQuest.questId;
  if (resolved && userQuest && !shouldRetainPartyTracker) {
    user.questData = removeQuestTrackerByQuestId(user.questData, userQuest.questId);
  }

  // Isolated, delegated and achievement-counted completions publish history with the
  // account snapshot, keeping run receipts and completion credit behind the same claim.
  // Other completions retain their history CAS and revert it if the snapshot claim loses.
  let resolvedCompletionCommitted = false;
  let claimManagedCompletion: typeof claimUserSnapshot | undefined;
  // The exact endAt stamped by the completion CAS, reused to anchor the revert below.
  let completedEndAt: Date | null = null;
  // Whether the completion CAS wrote the period counter (only for retryDelay !== "none"); the
  // revert must mirror this so it doesn't roll back a counter that was never incremented.
  let periodCounterWritten = false;
  if (resolved) {
    // Achievements (and any quest shown only via mock rows) may have progress in questData
    // without a QuestHistory row yet — create one at claim time only.
    if (userQuest) {
      const existing =
        info.existingHistory !== undefined
          ? info.existingHistory
          : await fetchUserQuestByQuestId(client, userId, userQuest.questId);
      if (!existing) {
        // Must finish before the completion UPDATE below: that CAS requires an existing row with
        // completed=0. Running insert and update in parallel can let the UPDATE run first and
        // match zero rows.
        await insertQuestHistoryForCommitQuestObjectiveRewards(client, userId, {
          questId: userQuest.questId,
          quest: { questType: userQuest.quest.questType },
        });
      }
    }

    const retryDelay = userQuest?.quest?.retryDelay ?? "none";
    completedEndAt = getNextUserSnapshotAt(user.updatedAt);
    const cps =
      retryDelay === "none" ? undefined : periodStart(retryDelay, completedEndAt);
    periodCounterWritten = !!cps;

    const completionConditions = and(
      eq(questHistory.questId, userQuest?.questId ?? ""),
      eq(questHistory.userId, userId),
      eq(questHistory.completed, 0),
      isNull(questHistory.endAt),
      liveQuestCondition,
      ...(rewardChoice || petTask ? [isNull(questHistory.pendingRewardChoice)] : []),
    );
    // History-derived completion achievements must never observe a completion that
    // can still be reverted after a lost account snapshot claim.
    const countedCompletion =
      userQuest && Object.hasOwn(QuestCompletionTasks, userQuest.quest.questType);
    const managedRun = petTask || countedCompletion ? userQuest : isolatedRun;
    if (managedRun) {
      const completedAt = completedEndAt;
      // Joined UPDATE assignment order is unspecified, so decide period rollover from
      // the loaded history and guard those values instead of rereading a changed column.
      const startsNewPeriod =
        cps && (!managedRun.periodStartAt || managedRun.periodStartAt < cps);
      claimManagedCompletion = async ({ set, where = [], readiness }) => {
        // Drizzle has no joined UPDATE builder. This single guarded write closes the run
        // and removes its tracker atomically; no payout can precede a successful claim.
        const result = await retryOnDeadlock(() =>
          executeResultForCommitQuestObjectiveRewards(
            client,
            completedAt,
            set,
            petTask,
            rewardChoice,
            cps,
            startsNewPeriod,
            userId,
            user,
            managedRun,
            completionConditions,

            where,
            readiness,
          ),
        );
        return { success: result.rowsAffected > 0, claimedAt: completedAt };
      };
    } else {
      const questCompletionResult =
        await updateQuestHistoryForCommitQuestObjectiveRewards(
          client,
          completedEndAt,
          rewardChoice,
          cps,
          completionConditions,
        );

      if (questCompletionResult.rowsAffected === 0) {
        const historyRow = await fetchUserQuestByQuestId(
          client,
          userId,
          userQuest?.questId ?? "",
        );
        if (historyRow && historyRow.completed >= 1) {
          return { outcome: "already_completed" };
        }
        if (!historyRow) {
          return { outcome: "not_found" };
        }
        if (rewardChoice && historyRow.pendingRewardChoice) {
          return { outcome: "choice_pending" };
        }
        return { outcome: "state_changed" };
      }
      resolvedCompletionCommitted = true;
    }
  }

  const {
    notifications: postNotifications,
    claimed,
    committedActivity,
  } = await handleQuestConsequences(client, user, consequences, notifications, {
    alwaysClaimUserState: true,
    readiness: info.readiness,
    claimUserState: claimManagedCompletion,
    partyTrackers: trackers,
    progressionUpdate: milestonePatch,
    // Unresolved objectives have no completion CAS; guard their payout at the snapshot claim.
    claimConditions: [
      liveQuestCondition,
      // Recheck earned progression and exam caps at the guarded account write.
      ...(milestonePatch || rewards.reward_rank === "ELITE JONIN"
        ? [
            eq(userData.level, user.level),
            eq(userData.rank, user.rank),
            ...(rewards.reward_rank === "ELITE JONIN"
              ? [
                  gte(userData.offence, getUserCaps("JONIN").stats_cap),
                  gte(userData.defence, getUserCaps("JONIN").stats_cap),
                  ...(["strength", "speed", "intelligence", "willpower"] as const).map(
                    (stat) => gte(userData[stat], getUserCaps("JONIN").gens_cap),
                  ),
                ]
              : []),
          ]
        : []),
      ...(isolatedRun && !petTask
        ? [
            eq(userData.status, "BATTLE"),
            isNull(userData.battleId),
            isolatedRun.questId === userQuest?.questId ? undefined : sql`FALSE`,
          ]
        : []),
      ...(!resolved && userQuest && userQuest.quest.questType !== "achievement"
        ? [
            sql`EXISTS (SELECT 1 FROM ${questHistory} WHERE ${questHistory.questId} = ${userQuest.questId} AND ${questHistory.userId} = ${userId} AND ${questHistory.completed} = 0 AND ${questHistory.endAt} IS NULL)`,
          ]
        : []),
    ],
  });

  if (!claimed) {
    if (claimManagedCompletion && userQuest) {
      const history = await fetchUserQuestByQuestId(client, userId, userQuest.questId);
      if (!history) return { outcome: "not_found" };
      if (history.completed >= 1) return { outcome: "already_completed" };
      if (rewardChoice && history.pendingRewardChoice)
        return { outcome: "choice_pending" };
    }
    if (resolvedCompletionCommitted && userQuest && completedEndAt) {
      await revertQuestCompletionAfterFailedClaim(
        client,
        userId,
        userQuest.questId,
        completedEndAt,
        periodCounterWritten,
        !!rewardChoice,
      );
    }
    return { outcome: "state_changed" };
  }
  if (petTask) user.petTask = null;
  if (milestonePatch) {
    postNotifications.push(
      `Milestone complete: level ${milestonePatch.level}, +${rewards.reward_stats} to each combat stat (up to rank caps).`,
    );
  }

  const changedQuestAssignments = await runCheckRewardsPrepInParallel(
    client,
    user,
    resolved,
    userQuest,
  );

  // If the quest is finished, we update additional fields on the userData model
  const questCounterField =
    (resolved &&
      getQuestCounterFieldName(
        userQuest?.quest.questType,
        userQuest?.quest.questRank,
      )) ||
    undefined;

  // On terminal completion, atomically free the single "active NPC mission" slot when it still
  // points to THIS quest, folded into updateRewards' own userData UPDATE (no extra round-trip).
  // Centralized here so every completion path closes the stale-slot window at the true point the
  // quest finalizes: `checkRewards` (which finalizes overworld `defeat_opponents` quests won in
  // combat — combat only advances the tracker, never the completion) as well as the overworld
  // friendly objective path. The IF preserves questId-scoping, so completing a non-NPC quest — or
  // a concurrent interaction at a different NPC — never clears a slot it does not own. Clearing
  // at finalization, rather than leaving a stale slot for a later interaction to notice, keeps a
  // value-only clear from racing into an ABA double-grant of a repeatable quest.
  const slotClearPatch =
    resolved && userQuest
      ? {
          activeNpcQuestId: sql`IF(${userData.activeNpcQuestId} = ${userQuest.questId}, NULL, ${userData.activeNpcQuestId})`,
        }
      : undefined;
  const energyReward =
    resolved && userQuest ? (ENERGY_QUEST_REWARDS[userQuest.quest.questType] ?? 0) : 0;
  const releaseIsolation =
    resolved &&
    isolatedRun?.questId === userQuest?.questId &&
    !!info.postClaimUserDataPatch?.status;
  const releasedAt = new Date();
  const energyRecovery = releaseIsolation
    ? getUserRegenerationGain(user, releasedAt)
    : 0;
  const energyPatch =
    energyReward > 0 || releaseIsolation
      ? {
          maxEnergy: user.maxEnergy,
          curEnergy: sql`LEAST(${user.maxEnergy}, ${userData.curEnergy} + ${energyReward} + ${releaseIsolation ? userRegenerationGainSql(user, userData.regenAt, releasedAt) : sql`0`})`,
          ...(releaseIsolation ? { regenAt: releasedAt } : {}),
          // Invalidate passive-regeneration snapshots taken between the claim and payout.
          updatedAt: nextSnapshotSql(userData.updatedAt),
        }
      : undefined;
  const mergedUserDataPatch =
    slotClearPatch || energyPatch || info.postClaimUserDataPatch
      ? { ...slotClearPatch, ...energyPatch, ...info.postClaimUserDataPatch }
      : undefined;

  const farmRewardAt = new Date();
  const shouldReduceFarmTimers =
    resolved &&
    !!userQuest &&
    qualifiesForFarmActivityReward(
      userQuest.quest.questType,
      userQuest.quest.questRank,
    );
  const reduceFarmTimers = () =>
    reduceActiveFarmPlotTimers(
      client,
      userId,
      FARM_ACTIVITY_REWARD_TIME_REDUCTION_SECONDS,
      farmRewardAt,
    );

  const rewardPromise = updateRewards({
    pvpBoostApplied: true,
    client,
    user:
      petTask && userQuest
        ? {
            ...user,
            occupation:
              userQuest.quest.questType === "hunting" ? "HUNTER" : "GATHERING",
          }
        : user,
    rewards,
    questCounterField,
    questFinishedAt: farmRewardAt,
    reason: "QUEST",
    // Opt in to the herbs_gathered tracker: this is the gathering-claim path and `user`
    // here is the fully-hydrated row (with quest relations).
    questUser: user,
    gatheringBonusQuantity,
    postClaimUserDataPatch: mergedUserDataPatch,
    dropTrackerForQuestId:
      resolved && !shouldRetainPartyTracker ? userQuest?.questId : undefined,
  });

  // Update database. Chain the farm bonus after payout so a failed reward write cannot still
  // shorten crop timers and the established completion/snapshot/payout ordering is preserved.
  const needsConfirmedSkillPoints =
    userCacheEligible &&
    !changedQuestAssignments &&
    userDelta !== undefined &&
    rewards.reward_skillpoints !== 0;
  const [rewardResult, farmRewardResult, confirmedSkillPoints] = await Promise.all([
    rewardPromise,
    shouldReduceFarmTimers
      ? rewardPromise.then(reduceFarmTimers)
      : Promise.resolve(null),
    // The account claim precedes this atomic payout; another claim may have read its
    // advanced snapshot before either payout. Return the saved capped balance instead.
    needsConfirmedSkillPoints
      ? rewardPromise.then(() =>
          // A missing confirmation reconciles the profile without rejecting a paid claim.
          findQuestRewardSkillPoints(client, userId).catch(() => undefined),
        )
      : undefined,
    resolved && userQuest
      ? rewardPromise.then(() =>
          recordVillageMissionProgress(
            client,
            user.villageId,
            userId,
            villageMissionCompletionEvents(userQuest.quest),
          ),
        )
      : Promise.resolve(),
    // Credit the sensei their per-mission ryo bonus
    ...(senseiId
      ? [
          incrementUserMoney(client, senseiReward, senseiId),
          insertBankTransfersForCommitQuestObjectiveRewards(
            client,
            userId,
            senseiId,
            senseiReward,
          ),
        ]
      : []),
  ]);
  const { badges } = rewardResult;
  if (releaseIsolation) {
    user.status = "AWAKE";
    user.regenAt = releasedAt;
  }
  if (userDelta) {
    user.money += userDelta.money ?? 0;
    user.seichiSilver += userDelta.seichiSilver ?? 0;
    user.earnedExperience += userDelta.earnedExperience ?? 0;
    user.reputationPoints += userDelta.reputationPoints ?? 0;
    user.reputationPointsTotal += rewards.reward_reputation;
    user.villagePrestige += rewards.reward_prestige;
    if (confirmedSkillPoints) user.skillPoints = confirmedSkillPoints.skillPoints;
  }
  let questCacheUpdate =
    !resolved && userQuest
      ? getQuestRewardCacheUpdate(userQuest, null, rewards, requiresDiscoveryRefresh)
      : undefined;
  if (resolved && userQuest && completedEndAt) {
    const entry = user.userQuests.find((entry) => entry.questId === userQuest.questId);
    if (entry) {
      questCacheUpdate = getQuestRewardCacheUpdate(
        entry,
        completedEndAt,
        rewards,
        requiresDiscoveryRefresh,
      );
      entry.completed = 1;
      entry.endAt = completedEndAt;
      Object.assign(entry, questCacheUpdate.after);
      entry.pendingRewardChoice = rewardChoice;
    }
    user.completedQuests = [
      ...user.completedQuests.filter((entry) => entry.questId !== userQuest.questId),
      {
        id: entry?.id ?? userQuest.id,
        questId: userQuest.questId,
        completed: 1,
        questType: userQuest.quest.questType,
        previousCompletes:
          entry?.previousCompletes ?? (userQuest.previousCompletes ?? 0) + 1,
      },
    ];
    if (user.activeNpcQuestId === userQuest.questId) user.activeNpcQuestId = null;
  }
  // getUser's relation query keeps active attempts and achievement history only.
  // A repeatable finished mission must leave this projection before recomputing trackers.
  user.userQuests = user.userQuests.filter(
    (entry) =>
      entry.quest.questType === "achievement" ||
      (entry.completed === 0 && entry.endAt === null),
  );
  if (questCounterField) user[questCounterField] += 1;
  if (questCounterField) user.questFinishAt = farmRewardAt;
  if (energyReward > 0 || releaseIsolation)
    user.curEnergy = Math.min(
      user.maxEnergy,
      user.curEnergy + energyReward + energyRecovery,
    );

  if (energyReward > 0) {
    postNotifications.push(`Energy reward: ${energyReward} (restored up to capacity).`);
  }

  if (farmRewardResult && farmRewardResult.rowsAffected > 0) {
    postNotifications.push("Active crop growth times reduced by 1 minute.");
  }

  // Restore the full (response) trackers only AFTER the DB write: updateRewards persists
  // user.questData, so during it user.questData must hold the filtered set, not the
  // in-memory-only mock achievement trackers that filterQuestTrackersForDbPersist strips.
  user.questData = trackers;

  // Update rewards for readability
  nameGrantedRewards(rewards, rewardResult);

  return {
    outcome: "claimed",
    postNotifications,
    rewards,
    badges,
    rewardChoicePending: !!rewardChoice,
    questCacheUpdate,
    userDelta,
    committedActivity,
    userCacheEligible:
      userCacheEligible &&
      (!needsConfirmedSkillPoints || confirmedSkillPoints !== undefined) &&
      !changedQuestAssignments &&
      !(farmRewardResult && farmRewardResult.rowsAffected > 0),
  };
};

/**
 * Handles the consequences of a quest (items, battles, quest resets, etc.).
 *
 * With `alwaysClaimUserState` (used by `checkRewards`), always runs `claimUserSnapshot` so parallel
 * submissions serialize on `userData.updatedAt` before reward payout. With `rollObjectiveAttackers`
 * (used by `checkLocationQuest`), active objectives with attackers may start a random encounter.
 */
export const handleQuestConsequences = async (
  client: DrizzleClient,
  user: NonNullable<UserWithRelations>,
  consequences: QuestConsequence[],
  notifications: string[],
  options?: {
    alwaysClaimUserState?: boolean;
    /** Endpoint-local recovery joins the same account snapshot as these consequences. */
    readiness?: ActionReadiness;
    /** Isolated terminal runs claim history and the account in one joined statement. */
    claimUserState?: typeof claimUserSnapshot;
    partyTrackers?: QuestTrackerType[];
    /** Progression fields committed in the same CAS as the completed objectives. */
    progressionUpdate?: ReturnType<typeof eliteJoninMilestoneUpdate>;
    /** Conditions that must still hold when the reward/consequence snapshot is claimed. */
    claimConditions?: QueryCondition[];
    /** Roll the active objectives' ambush attackers; only the travel movement check sets it. */
    rollObjectiveAttackers?: boolean;
  },
): Promise<{
  notifications: string[];
  claimed: boolean;
  battleAttempted: boolean;
  inventoryChanges?: InventoryQuantityChange[];
  battleUserUpdate?: Pick<UserDeltaResponse, "userPatch" | "userDelta">;
  committedActivity?: UserRecoveryActivity;
}> => {
  // Quests reset
  const resetQuests = consequences.filter(
    (c) => c.type === "reset_quest" && c.ids.length > 0,
  );
  // Quests ended
  const endedQuestIds = consequences
    .filter((c) => c.type === "fail_quest")
    .flatMap((c) => c.ids);
  // Quests started
  const startedQuestIds = consequences
    .filter((c) => c.type === "start_quest")
    .flatMap((c) => c.ids);
  // Items collected
  const collected = consequences.filter((c) => c.type === "add_item");
  // Items removed
  const removed = consequences.filter((c) => c.type === "remove_item");
  // Each delivery takes one unit per distinct item ID, including missed receipts.
  const removedItemCounts = new Map<string, number>();
  for (const consequence of removed) {
    for (const id of new Set(consequence.ids)) {
      removedItemCounts.set(id, (removedItemCounts.get(id) ?? 0) + 1);
    }
  }
  // Profile snapshots carry equipped items only, so deliveries read the carried stacks of the
  // delivered items and take from the backpack first; an equipped copy goes only when the
  // backpack lacks enough. A snapshot row keeps the quantity the client was given.
  const additionalItems =
    removedItemCounts.size > 0
      ? await listUserItemForHandleQuestConsequences(client, user, [
          ...removedItemCounts.keys(),
        ])
      : [];
  const ownedItems = [
    ...new Map(
      [...additionalItems, ...user.items.filter((row) => isCarriedUserItem(row))].map(
        (row) => [row.id, row] as const,
      ),
    ).values(),
  ].sort((a, b) => Number(a.equipped !== "NONE") - Number(b.equipped !== "NONE"));
  const deliveries = [...removedItemCounts].flatMap(([id, count]) => {
    let remaining = count;
    return ownedItems.flatMap((row) => {
      const take =
        row.itemId === id ? Math.min(Math.max(0, row.quantity), remaining) : 0;
      remaining -= take;
      return take > 0 ? [{ id: row.id, quantity: row.quantity, take }] : [];
    });
  });
  // Opponents to attack
  let opponent = consequences.find((c) => c.type === "combat");
  // Objective attackers ambush a player who is out travelling, so they are rolled only for the
  // movement check (checkLocationQuest) of an awake player. Page loads (getUser), reward claims
  // and battle retries must never start a random encounter on their own.
  if (!opponent && options?.rollObjectiveAttackers && user.status === "AWAKE") {
    const partyObjectiveIds = new Set(
      user.questParty?.quest.content.objectives.map((objective) => objective.id) ?? [],
    );
    const objectives = getActiveObjectives(user).filter(
      (objective) =>
        !partyObjectiveIds.has(objective.id) ||
        user.questParty?.leaderId === user.userId,
    );
    opponent = rollObjectiveAttackers(
      objectives,
      user.sector,
      undefined,
      (objective) =>
        partyObjectiveIds.has(objective.id) ? user.questParty?.questId : undefined,
    );
    if (opponent) notifications.push("You have been attacked!");
  }
  // If quests were reset, update the user's quest data
  if (resetQuests.length > 0) {
    // Managed runs resume their authored checkpoint without waiting for a manual retry.
    // Isolated content resumes the same way, with or without an entry cost.
    user.questData = applyQuestResets(
      user.questData,
      resetQuests,
      (questId) =>
        !user.userQuests.some(
          (entry) =>
            entry.questId === questId &&
            !entry.endAt &&
            (isManagedQuestRun({
              questType: entry.questType,
              content: entry.quest.content,
            }) ||
              !!entry.quest.content.isolated),
        ),
    );
  }
  // Database updates
  const shouldClaimUserState =
    options?.readiness?.notice ||
    options?.alwaysClaimUserState ||
    notifications.length > 0 ||
    consequences.length > 0;

  if (shouldClaimUserState) {
    const claimResult = await (options?.claimUserState ?? claimUserSnapshot)({
      client,
      userId: user.userId,
      updatedAt: user.updatedAt,
      readiness: options?.readiness,
      where: [
        ...(options?.claimConditions ?? []),
        ...(user.questParty ? [eq(userData.questPartyId, user.questParty.id)] : []),
      ],
      set: {
        ...options?.progressionUpdate,
        questData: filterQuestTrackersForDbPersist(user.questData ?? [], user),
      },
    });

    if (claimResult.success) {
      // Consequences may unlock a quest or start combat that needs the committed level.
      if (options?.progressionUpdate) Object.assign(user, options.progressionUpdate);
      try {
        if (
          resetQuests.some((reset) =>
            reset.ids.includes(user.questParty?.questId ?? ""),
          )
        )
          await resetQuestPartyProgress(client, user);
        await publishQuestPartyProgress(
          client,
          user,
          options?.partyTrackers ?? user.questData ?? [],
        );
      } catch (error) {
        // Personal progress is already guarded; defer shared reset/publication failures
        // so they cannot interrupt this claim's consequences or reward payout.
        Sentry.captureException(error, {
          level: "warning",
          tags: { source: "publishQuestPartyProgress" },
        });
        notifications.push("Quest team progress will update on your next request.");
      }
      const { battleUserUpdate, itemsRemoved, committedActivity } =
        await executeClaimedQuestConsequences({
          client,
          user,
          claimedAt: claimResult.claimedAt,
          notifications,
          startedQuestIds,
          endedQuestIds,
          collected,
          deliveries,
          opponent,
        });

      return {
        notifications,
        claimed: true,
        inventoryChanges: getQuestConsequenceInventoryUpdate(
          ownedItems,
          deliveries,
          consequences,
          itemsRemoved,
        ),
        battleAttempted: !!opponent,
        ...(battleUserUpdate ? { battleUserUpdate } : {}),
        ...(committedActivity ? { committedActivity } : {}),
      };
    }
  }
  return { notifications, claimed: !shouldClaimUserState, battleAttempted: false };
};

/**
 * Apply consequences after handleQuestConsequences claims the user's snapshot.
 * Battle rejections join the existing notifications, leaving the claimed quest
 * state intact and exposing unavailable allies or insufficient spawn capacity.
 */
const executeClaimedQuestConsequences = async ({
  client,
  user,
  claimedAt,
  notifications,
  startedQuestIds,
  endedQuestIds,
  collected,
  deliveries,
  opponent,
}: {
  client: DrizzleClient;
  user: NonNullable<UserWithRelations>;
  claimedAt: Date;
  notifications: string[];
  startedQuestIds: string[];
  endedQuestIds: string[];
  collected: QuestConsequence[];
  deliveries: QuestItemDelivery[];
  opponent: QuestConsequence | undefined;
}) => {
  user.updatedAt = claimedAt;
  let battleUserUpdate: Pick<UserDeltaResponse, "userPatch" | "userDelta"> | undefined;
  let questActivity: UserRecoveryActivity | undefined;
  let battleActivity: UserRecoveryActivity | undefined;
  const collectedItems = collected.flatMap(({ ids }) => ids);
  // Combat preloads trackers without the live party relation; both carry receipt ownership.
  const partyQuestId =
    user.questParty?.questId ??
    user.questData?.find(
      (tracker) => tracker.party && tracker.party.id === user.questPartyId,
    )?.id;
  const closeQuests =
    endedQuestIds.length > 0
      ? updateQuestHistoryForExecuteClaimedQuestConsequences(
          client,
          endedQuestIds,
          user,
          partyQuestId,
        )
      : undefined;
  // Ending a run frees its Pyramid slot before a replacement can claim it. Completed
  // history may already be closed while the caller's quest projection is still open.
  if (startedQuestIds.length > 0) await closeQuests;
  // Start the delivery once so the mutation phase and the success check share one execution.
  const itemRemoval = deliverQuestItems(client, user.userId, deliveries);
  // A battle owns the delivered stacks once it starts, so deliveries finish first.
  if (opponent && deliveries.length > 0) await itemRemoval;
  await Promise.all([
    startedQuestIds.length === 0 ? closeQuests : undefined,
    ...(startedQuestIds.length > 0
      ? [
          (async () => {
            const quests = await listQuestsByIds(client, startedQuestIds);
            // Runs after the user snapshot is already committed, so a throw here would burn the
            // objective without starting the quest. Content edits or migrations can strand
            // edges to quests that cannot be personally assigned; skip those destinations.
            const startable = quests.filter(
              (q) =>
                // Managed runs must reach upsertQuestEntry's persisted recovery guards.
                (isManagedQuestRun(q) ||
                  !user.userQuests.some(
                    (entry) =>
                      entry.questId === q.id &&
                      !entry.endAt &&
                      !isQuestPartyHelperAttempt(entry, user.questPartyId),
                  )) &&
                q.questType !== "hunting" &&
                !isRestrictedQuestType(q.questType) &&
                q.questType !== "village_mission" &&
                !(q.questType === "mission" && q.questRank === "S"),
            );
            // Assignments share trackers. Isolated grants use their publication transaction
            // to claim the Pyramid slot before inserting history, even with a stale projection.
            for (const nextQuest of startable) {
              if (
                nextQuest.questType === "battlepyramid" &&
                nextQuest.content.isolated
              ) {
                const assigned = await retryOnDeadlock(() =>
                  client.transaction(async (database) => {
                    const claim = await claimUserSnapshot({
                      client: database,
                      userId: user.userId,
                      updatedAt: user.updatedAt,
                      where: [
                        inArray(userData.status, ["AWAKE", "BATTLE"]),
                        isNull(userData.battleId),
                        notExists(
                          selectQuestHistoryForWhere2(database, user, nextQuest),
                        ),
                      ],
                    });
                    if (!claim.success) return undefined;
                    const claimedUser = { ...user, updatedAt: claim.claimedAt };
                    await upsertQuestEntry(
                      database,
                      claimedUser,
                      nextQuest,
                      "quest_objective",
                      undefined,
                      true,
                    );
                    return claimedUser;
                  }),
                );
                if (!assigned) {
                  notifications.push(
                    `Could not start ${nextQuest.name}: your account changed or another Pyramid is active.`,
                  );
                  continue;
                }
                Object.assign(user, assigned);
                questActivity = {
                  status: assigned.status,
                  battleId: assigned.battleId,
                };
              } else {
                await upsertQuestEntry(client, user, nextQuest, "quest_objective");
              }
              notifications.push(`Started new quest: ${nextQuest.name}`);
            }
          })(),
        ]
      : []),
    ...(collectedItems.length > 0
      ? [
          grantUserItems(
            client,
            user.userId,
            collectedItems.map((itemId) => ({ itemId, quantity: 1 })),
            { excludeUserItemIds: deliveries.map(({ id }) => id) },
          ),
        ]
      : []),
    itemRemoval,
    opponent
      ? (async () => {
          if (user.questParty && opponent.questId === user.questParty.questId) {
            const result = await startQuestPartyEncounter({
              client,
              user,
              userId: user.userId,
              partyId: user.questParty.id,
              ambush: opponent,
            });
            if (!result.success) notifications.push(result.message);
            else if (result.battleId)
              battleActivity = { status: "BATTLE", battleId: result.battleId };
            return;
          }
          const result = await initiateBattle(
            {
              longitude: user.longitude,
              latitude: user.latitude,
              sector: user.sector,
              userIds: [user.userId],
              cacheUserId: user.userId,
              targetIds: opponent.ids,
              allyAiIds: opponent.allyAiIds,
              client: client,
              scaleTarget: !!opponent.scaleStats,
              biome: "default",
              forceKeepPools: opponent.forceKeepPools ?? false,
              questBattleSource:
                opponent.questId && opponent.objectiveId
                  ? { questId: opponent.questId, objectiveId: opponent.objectiveId }
                  : undefined,
              givePools: opponent.givePools,
              startingEffects: opponent.startingEffects,
              questAttempt: opponent.questId
                ? findManagedQuestAttempt(user.userQuests, opponent.questId)
                : undefined,
              // Honour the player's stored preference for quest fights and random
              // encounters (including hunting) alike; initiateBattle gates on
              // AutoCombatBattleTypes, which admits every non-PvP battle type.
              autoCombatUserIds: user.defaultAutoCombat ? [user.userId] : undefined,
            },
            opponent.type === "random_encounter" ? "RANDOM_ENCOUNTER" : "QUEST",
            opponent.scaleGains ?? 1,
          );
          if (!result.success) notifications.push(result.message);
          else {
            battleActivity = { status: "BATTLE", battleId: result.battleId };
            if (result.userPatch && !result.requiresUserRefresh)
              battleUserUpdate = {
                userPatch: result.userPatch,
                userDelta: result.userDelta,
              };
          }
        })()
      : Promise.resolve(),
  ]);
  return {
    battleUserUpdate,
    committedActivity: battleActivity ?? questActivity,
    itemsRemoved: await itemRemoval,
  };
};

/**
 * Take each delivery's units from its stack, from the quantity it was read at: a stack that
 * keeps units is decremented, one that runs out is deleted. A stack that changed since gives
 * the units from what it holds now, by a relative decrement that keeps units a concurrent
 * grant added or a deletion when exactly the delivered units remain. The guards skip rows held
 * by an active merge, listed, stored or owned by a battle. Resolves whether every delivery
 * matched its read, which the inventory projection assumes; otherwise the client refetches.
 */
const deliverQuestItems = async (
  client: DrizzleClient,
  userId: string,
  deliveries: QuestItemDelivery[],
) => {
  const results = await Promise.all(
    deliveries.map(async ({ id, quantity, take }) => {
      const removal = () =>
        deleteUserItemForDeliverQuestItems(client, userId, id, take);
      const exact =
        take < quantity
          ? await updateUserItemForDeliverQuestItems(client, userId, id, take, quantity)
          : await removal();
      if (exact.rowsAffected === 1) return true;
      const decremented = await updateUserItemForDeliverQuestItems(
        client,
        userId,
        id,
        take,
      );
      if (decremented.rowsAffected !== 1 && take < quantity) await removal();
      return false;
    }),
  );
  return results.every(Boolean);
};

/** Tier quest bootstrap plus achievement log; tasks are independent and run together. */
const runCheckRewardsPrepInParallel = async (
  client: DrizzleClient,
  user: NonNullable<UserWithRelations>,
  resolved: boolean,
  userQuest: UserQuestFromGetReward,
) => {
  const prepTasks: Promise<unknown>[] = [];
  const questTier = user.userQuests?.find((q) => q.quest.questType === "tier");
  if (!questTier) {
    prepTasks.push(insertNextQuest(client, user, "tier"));
  }
  if (resolved && userQuest?.quest.questType === "achievement") {
    if (!userQuest.quest.hidden || canPlayHiddenQuests(user.role)) {
      if (userQuest.quest.maxCompletes > 1) {
        prepTasks.push(upsertQuestEntry(client, user, userQuest.quest, "system"));
      }
    }
  }
  if (prepTasks.length > 0) {
    return (await Promise.all(prepTasks)).some(Boolean);
  }
  return false;
};

/** Content changes invalidate pending results; cancellation always remains available. */
export const petTaskContentCondition = (task: PetTask, role: UserRole) =>
  sql`EXISTS (SELECT 1 FROM ${quest} WHERE ${and(
    eq(quest.id, task.questId),
    eq(quest.updatedAt, new Date(task.questVersion)),
    inArray(quest.questType, PET_TASK_QUEST_TYPES),
    gte(quest.petTaskMinutes, 1),
    lte(quest.petTaskMinutes, PET_TASK_MAX_MINUTES),
    canPlayHiddenQuests(role) ? undefined : eq(quest.hidden, false),
  )})`;

/** Units a quest delivery takes from one stack, with the quantity it was read at. */
type QuestItemDelivery = { id: string; quantity: number; take: number };

type UserQuestFromGetReward = ReturnType<typeof getReward>["userQuest"];

type GetRewardTrackers = ReturnType<typeof getReward>["trackers"];

/**
 * Outcome of {@link commitQuestObjectiveRewards}. Side-effecting work (completion CAS,
 * snapshot claim, payout, sensei bonus, tier/achievement prep) lives in the helper; each
 * caller renders its own tRPC response from this discriminated result so the helper stays
 * a single source of truth for post-completion effects.
 */
type CommitQuestObjectiveRewardsResult =
  | {
      outcome: "claimed";
      /** Notifications produced by handleQuestConsequences (caller prepends its own prefix). */
      postNotifications: string[];
      /** Same GetRewardResult passed in, mutated with resolved reward names for display. */
      rewards: GetRewardResult;
      badges: { id: string; name: string; image: string }[];
      /** The completion stored a reward-choice offer the player still has to pick from. */
      rewardChoicePending: boolean;
      userDelta: UserDelta | undefined;
      userCacheEligible: boolean;
      committedActivity?: UserRecoveryActivity;
      questCacheUpdate?: ReturnType<typeof getQuestRewardCacheUpdate>;
    }
  /** Resolved completion lost the CAS and the row is already completed (idempotent re-claim). */
  | { outcome: "already_completed" }
  /** Resolved completion lost the CAS and no quest history row exists. */
  | { outcome: "not_found" }
  /** Completion CAS or snapshot claim failed; caller should ask the user to retry. */
  | { outcome: "state_changed" }
  /** An earlier completion's reward choice is still unpicked, so this one cannot store its own. */
  | { outcome: "choice_pending" };

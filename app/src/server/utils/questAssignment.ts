import * as Sentry from "@sentry/nextjs";
import { eq, notExists, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getQuestEntryInventoryChanges } from "@/deltas/quests";
import {
  NPC_ONLY_QUEST_TYPES,
  type QuestType,
  REGEN_SECONDS,
  RESTRICTED_QUEST_TYPES,
} from "@/drizzle/constants";
import { type Quest, questHistory, type UserData, userData } from "@/drizzle/schema";
import {
  getNewTrackers,
  getQuestTargetSectorsToCheck,
  snapQuestTargetsToReachable,
} from "@/libs/quest";
import { isAvailableUserQuests } from "@/libs/quest/availability";
import {
  isQuestRankAllowed,
  isWarMissionAvailable,
  questAlreadyActiveBlockMessage,
  questDailyLimitMessage,
  questDailyQuota,
  questTypeConcurrentBlockMessage,
  questUiAccessBlockMessage,
} from "@/libs/quest/missionHall";
import {
  formatQuestEntryCost,
  getIsolatedPyramid,
  getQuestEntryRequirements,
  isManagedQuestRun,
} from "@/libs/questRun";
import { availableQuestLetterRanks } from "@/libs/rank";
import {
  fetchQuestEntryInventory,
  type fetchUserQuestByQuestId,
  findOverworldAiPlacementQuestForAssignQuestToUser,
  findQuestHistoryForUpsertQuestEntry,
  insertQuestHistoryForUpsertQuestEntries,
  insertQuestHistoryForUpsertQuestEntry,
  listItemForAssignQuestToUser,
  selectQuestForFetchUncompletedQuests,
  selectQuestHistoryForWhere,
  selectUserDataForUpsertQuestEntries,
  updateQuestHistoryForUpsertQuestEntries,
  updateQuestHistoryForUpsertQuestEntry,
  updateUserDataForClaimDailyQuestSlot,
  updateUserDataForUpsertQuestEntries,
  updateUserDataForUpsertQuestEntry,
} from "@/queries/quests";
import type { fetchSectorVillage } from "@/queries/village";
import type { UserWithRelations } from "@/routers/profile";
import { fetchActiveWars } from "@/routers/war";
import { errorResponse, serverError } from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import type { ActionReadiness } from "@/server/utils/actionReadiness";
import { claimUserSnapshot } from "@/server/utils/concurrency";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { hydrateQuestCollections } from "@/server/utils/questCollections";
import { getQuestEntryCharges, payQuestEntryAtStart } from "@/server/utils/questEntry";
import { removeQuestTrackerByQuestId } from "@/server/utils/questRewards";
import {
  getUserRegenerationGain,
  regenTicksSql,
  userRegenerationGainSql,
} from "@/server/utils/regeneration";
import { fetchPublishedSectorMaps } from "@/server/utils/sectorMap";
import { chunkArray } from "@/utils/array";
import { canPlayHiddenQuests } from "@/utils/permissions";
import { hasEndDatePassed, regenTicksSince, secondsFromDate } from "@/utils/time";
import type { QueryCondition } from "@/utils/typeutils";
import type { InventoryQuantityChange } from "@/validators/inventory";

/**
 * Quest types that {@link assignQuestToUser} can start. Errand (and meta types like
 * achievement/tier) are intentionally excluded: errands are dispensed only via the
 * `startRandom` procedure, which enforces the daily errand cap this centralized path does
 * not. The overworld-NPC flow filters its pool to these so a mis-pooled type can never
 * reach assignQuestToUser, throw, and strand a player's NPC-quest claim.
 */
const ASSIGNABLE_QUEST_TYPES: QuestType[] = [
  "special",
  "mastery",
  "story",
  "hunting",
  "gathering",
  "anbu",
  "event",
  "battlepyramid",
  "starter",
  "mission",
  "crime",
  "medical",
  "pvp",
  "war",
  "overworld",
];

/**
 * Quest types excluded from overworld NPC pools. Special quests require item
 * consumption; the remaining types require occupation, squad or structure access
 * enforced by {@link questUiAccessBlockMessage} for UI and companion starts.
 * NPC starts cannot bypass those acquisition requirements.
 */
const OVERWORLD_GATED_QUEST_TYPES: QuestType[] = [
  "special",
  "story",
  "hunting",
  "gathering",
  "anbu",
  "event",
];

/** Quest types an overworld NPC pool may offer/grant: assignable minus the gated set above. */
export const OVERWORLD_ASSIGNABLE_QUEST_TYPES: QuestType[] =
  ASSIGNABLE_QUEST_TYPES.filter((type) => !OVERWORLD_GATED_QUEST_TYPES.includes(type));

/** Row locks the bulk quest reset may hold in one statement. */
const QUEST_RESET_BATCH_SIZE = 100;

/** Ceiling on the repeated tracker-removal passes per batch; a stuck-loop guard, not a bound. */
const QUEST_RESET_MAX_TRACKER_PASSES = 50;

/**
 * Start quests for UI, companion, NPC and item acquisition flows. Validate source,
 * rank, availability, dates, active attempts and applicable quotas before assignment;
 * UI and companion starts also enforce structure and occupation access.
 *
 * Item starts accept only Special quests and reuse the caller's receipt transaction,
 * which already owns the account and stack claim. The caller must roll back any
 * unsuccessful result so history, entry costs and the consumed item stay atomic.
 */
export const assignQuestToUser = async (args: {
  client: DrizzleClient;
  user: NonNullable<UserWithRelations>;
  quest: Quest;
  source: "ui" | "pet_task" | "overworld_npc" | "item";
  /** Reuse the item receipt's transaction; do not open another assignment transaction. */
  inTransaction?: boolean;
  /** Explicit actor recovery is composed into assignment's existing account write. */
  readiness?: ActionReadiness;
  /** Required for NPC-only quests so their placement assignment can be verified server-side. */
  overworldPlacementId?: string;
  sectorVillage?: Awaited<ReturnType<typeof fetchSectorVillage>>;
  // Feeds availability/period-cap guards and skips upsertQuestEntry's history query.
  // Callers resolve this row in their opening parallel preload.
  prevAttempt: Awaited<ReturnType<typeof fetchUserQuestByQuestId>>;
}): Promise<{
  success: boolean;
  message: string;
  userCacheEligible?: boolean;
  inventoryChanges?: InventoryQuantityChange[];
}> => {
  const {
    client,
    user,
    quest: questData,
    source,
    sectorVillage,
    overworldPlacementId,
    prevAttempt,
  } = args;

  if (questData.questType === "special" && source !== "item")
    return errorResponse("Special quests can only be started by consuming an item.");
  if (source === "item" && (questData.questType !== "special" || !args.inTransaction))
    return errorResponse("This item cannot start that quest.");

  if (user.petTask?.questId === questData.id)
    return errorResponse(
      "Your companion is completing this contract. Return it before restarting.",
    );

  if (questData.questType === "hunting" && source !== "pet_task")
    return errorResponse(
      "New hunts are available on the Hunter contract board. Existing hunting quests can still be completed.",
    );

  // NPC-only quests can never be acquired through the generic UI start endpoint.
  if (isNpcOnlyQuestType(questData.questType) && source !== "overworld_npc") {
    return errorResponse(
      "This quest can only be accepted from its assigned overworld NPC.",
    );
  }

  // Verify the concrete placement-to-quest relation instead of trusting a quest id supplied by
  // another internal caller. The overworld interaction route is the only caller that supplies a
  // placement id, and it has already validated that the player is standing at that active NPC.
  if (isNpcOnlyQuestType(questData.questType)) {
    if (!overworldPlacementId) {
      return errorResponse("This quest is not assigned to this overworld NPC.");
    }
    const placementQuest = await findOverworldAiPlacementQuestForAssignQuestToUser(
      client,
      overworldPlacementId,
      questData,
    );
    if (!placementQuest) {
      return errorResponse("This quest is not assigned to this overworld NPC.");
    }
  }

  // Rank guard
  if (!isQuestRankAllowed(questData, user)) {
    return errorResponse(`Rank ${user.rank} not allowed`);
  }

  // Availability checks (uses userQuests + completedQuests on user)
  const { check, message } = isAvailableUserQuests(
    { ...questData, ...prevAttempt, questType: questData.questType },
    user,
  );
  if (!check) {
    return errorResponse(`Quest is not available for you: ${message}`);
  }

  // Check start and end dates
  if (questData.startsAt && questData.startsAt > new Date().toISOString()) {
    return errorResponse(`Quest starts in the future`);
  }
  if (hasEndDatePassed(questData.endsAt)) {
    return errorResponse(`Quest has ended`);
  }

  // Check if user is already on this quest
  const activeBlock = questAlreadyActiveBlockMessage(questData, user);
  if (activeBlock) return errorResponse(activeBlock);

  // Companion assignments keep the same structure/occupation/rank guards as the UI.
  if (source === "ui" || source === "pet_task") {
    const guard = questUiAccessBlockMessage(questData, user, sectorVillage ?? null);
    if (guard) return errorResponse(guard);
  }

  // Overworld NPC grants skip the UI structure/occupation gate (the player is in the field, not at
  // the gating structure), so a gated type must never reach here. The overworld pool filter already
  // excludes these types; this is the authoritative backstop for any future caller.
  if (
    source === "overworld_npc" &&
    OVERWORLD_GATED_QUEST_TYPES.includes(questData.questType)
  ) {
    return errorResponse("This quest type cannot be granted by an overworld NPC.");
  }

  // Reject unknown quest types before reserving a slot or writing history.
  if (!ASSIGNABLE_QUEST_TYPES.includes(questData.questType)) {
    throw serverError(
      "PRECONDITION_FAILED",
      `Invalid quest type to start: ${questData.questType}`,
    );
  }

  if (isManagedQuestRun(questData) && user.status !== "AWAKE")
    return errorResponse("You must be awake and outside combat to start this run.");

  // Per-type concurrent-limit guard (pure, no DB)
  const block = questTypeConcurrentBlockMessage(questData, user);
  if (block) return errorResponse(block);

  const quota = questDailyQuota(questData.questType, user);
  const dailyLimitMessage = quota
    ? questDailyLimitMessage(questData.questType, quota.limit)
    : "";
  const dailyClaimMessage = args.readiness?.where
    ? "Your activity or daily quest quota changed. Please try again."
    : dailyLimitMessage;
  if (quota && quota.current >= quota.limit) return errorResponse(dailyLimitMessage);

  // Entry items are checked and paid when the run starts, not at its first battle, so a
  // player without the items never holds a run they cannot fight. Re-entering an attempt
  // that is still open keeps its receipt; a fresh or restarted attempt pays again.
  let entryCharges: NonNullable<ReturnType<typeof getQuestEntryCharges>> = [];
  const entryRequirements = getQuestEntryRequirements(questData.content);
  if (entryRequirements.length > 0) {
    const reopensPaidAttempt =
      !!prevAttempt &&
      prevAttempt.completed === 0 &&
      prevAttempt.endAt === null &&
      prevAttempt.entryPaid;
    const charges = getQuestEntryCharges(
      { entryPaid: reopensPaidAttempt, quest: questData },
      await fetchQuestEntryInventory(client, user.userId),
    );
    if (!charges) {
      const names = await listItemForAssignQuestToUser(client, entryRequirements);
      const cost = formatQuestEntryCost(
        entryRequirements.map((required) => ({
          quantity: required.quantity,
          name: names.find((row) => row.id === required.itemId)?.name ?? "unknown item",
        })),
      );
      return errorResponse(`You need ${cost} in your inventory to enter.`);
    }
    entryCharges = charges;
  }

  // War: fetch active wars (expensive; only after all cheap guards pass)
  if (questData.questType === "war") {
    if (!user.villageId) {
      return errorResponse("You must be in a village for war missions");
    }
    const warList = await fetchActiveWars(client, user.villageId, user.userId);
    if (
      !isWarMissionAvailable({
        questType: "war",
        villageId: user.villageId,
        dailyWarMissions: user.dailyWarMissions,
        activeWars: warList,
      })
    ) {
      return errorResponse("Your village is not in an active war");
    }
  }

  // Reserve daily slots before delivering quests with a guarded counter update.
  // CAS runs first so that a user at the daily limit is rejected before any quest entry
  // is written. This deliberately nontransactional flow means a crash between
  // the CAS success and the upsert burns one daily slot without delivering the quest
  // (acceptable), whereas the reverse order would deliver a quest when the limit is reached
  // (unacceptable — creates orphaned quest entries the user cannot access). The
  // warParticipantUntil stamp rides on the same guarded CAS update so it costs no extra
  // roundtrip; a crash before upsertQuestEntry then leaves a bounded (~2h) cross-bracket
  // stamp without a quest — the same fail-safe leak the equivalent merge in initiateBattle
  // accepts, and harmless since it only makes the user more attackable.
  let assignment: Awaited<ReturnType<typeof upsertQuestEntry>>;
  const entryChangedMessage = "Your entry items changed. Please try again.";
  // Rolls back the claim, history and any debited stack when a ticket stack changed.
  const entryRejected = new Error("Quest entry rejected");
  const dailyLimitReached = new Error("Daily quest limit reached");
  if (source === "item") {
    // Reuse the receipt session rather than the entry-payment transactions below.
    // The caller rolls back the entire consumption if payment or assignment fails.
    assignment = await upsertQuestEntry(
      client,
      user,
      questData,
      source,
      prevAttempt ?? null,
      true,
    );
    if (
      entryCharges.length > 0 &&
      !(await payEntryAndMarkReceipt(client, user, questData, entryCharges, assignment))
    )
      return errorResponse(entryChangedMessage);
  } else if (questData.questType === "war" && entryCharges.length > 0) {
    // With entry items the slot, history row and item debit must commit together, so a
    // changed ticket stack refunds the daily slot instead of burning it.
    const paid = await retryOnDeadlock(() =>
      client.transaction(async (database) => {
        // A rolled-back attempt must not leave its tracker changes on the caller's user.
        const warUser = { ...user };
        if (
          !(await claimDailyQuestSlot(
            database,
            warUser,
            questData.questType,
            args.readiness,
          ))
        )
          throw dailyLimitReached;
        const result = await upsertQuestEntry(
          database,
          warUser,
          questData,
          source,
          prevAttempt ?? null,
          true,
        );
        if (
          !(await payEntryAndMarkReceipt(
            database,
            warUser,
            questData,
            entryCharges,
            result,
          ))
        )
          throw entryRejected;
        return { result, user: warUser };
      }),
    ).catch((error: unknown) => {
      if (error === dailyLimitReached) return errorResponse(dailyClaimMessage);
      if (error === entryRejected) return errorResponse(entryChangedMessage);
      throw error;
    });
    if ("success" in paid) return paid;
    Object.assign(user, paid.user);
    assignment = paid.result;
  } else if (questData.questType === "war") {
    if (
      !(await claimDailyQuestSlot(client, user, questData.questType, args.readiness))
    ) {
      return errorResponse(dailyClaimMessage);
    }
    assignment = await upsertQuestEntry(
      client,
      user,
      questData,
      source,
      prevAttempt ?? null,
      false,
    );
  } else if (isManagedQuestRun(questData)) {
    // Publish the account claim and new history together: another request must not see
    // a fresh account stamp before the active Pyramid row. A joined UPDATE cannot insert
    // missing history or commit its tracker and initial recovery with that insertion.
    const assigned = await retryOnDeadlock(() =>
      client.transaction(async (database) => {
        const claim = await claimUserSnapshot({
          client: database,
          userId: user.userId,
          updatedAt: user.updatedAt,
          readiness: args.readiness,
          where: [
            args.readiness ? undefined : eq(userData.status, "AWAKE"),
            ...(questData.questType === "battlepyramid"
              ? [notExists(selectQuestHistoryForWhere(database, user))]
              : []),
          ],
        });
        if (!claim.success)
          return errorResponse(
            "Your account changed or another Pyramid started. Refresh and try again.",
          );
        const claimedUser = { ...user, updatedAt: claim.claimedAt };
        if (!(await claimDailyQuestSlot(database, claimedUser, questData.questType)))
          throw dailyLimitReached;
        const result = await upsertQuestEntry(
          database,
          claimedUser,
          questData,
          source,
          prevAttempt ?? null,
          true,
        );
        if (
          entryCharges.length > 0 &&
          !(await payEntryAndMarkReceipt(
            database,
            claimedUser,
            questData,
            entryCharges,
            result,
          ))
        )
          throw entryRejected;
        return { result, user: claimedUser };
      }),
    ).catch((error: unknown) => {
      if (error === entryRejected) return errorResponse(entryChangedMessage);
      if (error === dailyLimitReached) return errorResponse(dailyLimitMessage);
      throw error;
    });
    if ("success" in assigned) return assigned;
    Object.assign(user, assigned.user);
    assignment = assigned.result;
  } else {
    if (!(await claimDailyQuestSlot(client, user, questData.questType, args.readiness)))
      return errorResponse(dailyClaimMessage);
    assignment = await upsertQuestEntry(
      client,
      user,
      questData,
      source,
      prevAttempt ?? null,
      false,
      quota ? undefined : args.readiness,
    );
  }
  if (!assignment.recoveryCommitted)
    return errorResponse("Your activity changed. Please try again.");
  return {
    success: true,
    message: `Quest started: ${questData.name}`,
    userCacheEligible: assignment.userCacheEligible,
    inventoryChanges: assignment.userCacheEligible
      ? getQuestEntryInventoryChanges(entryCharges ?? [])
      : undefined,
  };
};

/**
 * Upsert quest entry for a single user.
 *
 * `prevEntry` lets a caller that already loaded this user's `questHistory` row (e.g. via
 * {@link fetchUserQuestByQuestId} in its opening `Promise.all`) hand it in so the initial
 * `findFirst` round-trip is skipped: `undefined` = not provided (fetch it here), a row or
 * `null` = already resolved (use as-is). Mirrors the `existingHistory` sentinel that
 * `commitQuestObjectiveRewards` uses. The insert branch is idempotent on the
 * `(userId, questId)` unique key, so a stale `null` that races a concurrent insert restarts
 * the existing row rather than throwing.
 *
 * @param inTransaction - The caller owns a PlanetScale session and awaits statements in order;
 * fresh isolated story grants open their own transaction when this is false.
 */
export const upsertQuestEntry = async (
  client: DrizzleClient,
  user: NonNullable<UserWithRelations>,
  quest: Quest,
  source: QuestAcquisitionSource,
  prevEntry?: Awaited<ReturnType<typeof fetchUserQuestByQuestId>> | null,
  inTransaction = false,
  readiness?: ActionReadiness,
): Promise<{
  recoveryCommitted: boolean;
  entry: NonNullable<Awaited<ReturnType<typeof fetchUserQuestByQuestId>>>;
  userCacheEligible: boolean;
}> => {
  if (quest.questType === "special" && source !== "item") {
    throw serverError(
      "PRECONDITION_FAILED",
      "Special quests can only be started by consuming an item.",
    );
  }
  if (isNpcOnlyQuestType(quest.questType) && source !== "overworld_npc") {
    throw serverError(
      "PRECONDITION_FAILED",
      "Overworld quests can only be accepted from their assigned NPC.",
    );
  }
  if (
    quest.questType === "village_mission" ||
    (quest.questType === "mission" && quest.questRank === "S")
  ) {
    throw serverError(
      "PRECONDITION_FAILED",
      "Village Missions can only be selected by the Kage in the Town Hall",
    );
  }
  // Reuse the caller's pre-fetched history row when supplied; otherwise load it here.
  let entry =
    prevEntry !== undefined
      ? prevEntry
      : await findQuestHistoryForUpsertQuestEntry(client, quest, user);
  // Promises to be executed
  const promises: Promise<unknown>[] = [];
  const professionContract =
    quest.questType === "hunting" || quest.questType === "gathering";
  // A stale ordinary start can arrive after dispatch. Keep its tracker and reused
  // history row untouched while the live account receipt owns this contract.
  const noDelegatedAttempt = sql`NOT EXISTS (SELECT 1 FROM ${userData} WHERE ${userData.userId} = ${user.userId} AND JSON_UNQUOTE(JSON_EXTRACT(${userData.petTask}, '$.questId')) = ${quest.id})`;
  // Restarting a quest must discard any stale tracker from prior attempts before recomputing.
  // An attempt that is still open is being re-entered, not restarted — a `start_quest`
  // objective consequence can name a quest the player is part way through — so keep its tracker.
  // A genuine restart always arrives with the row closed: completed, or ended by the daily reset
  // or abandon.
  const isOpenAttempt = !!entry && entry.completed === 0 && entry.endAt === null;
  const settleRecovery =
    !isOpenAttempt && quest.content.isolated && !getIsolatedPyramid(user);
  // Story grants also enter through this helper. History may need insertion, so a joined
  // UPDATE cannot publish isolation and earned recovery together. Keep this transaction short;
  // the UI/NPC assignment already supplies a transaction and its claimed account snapshot.
  if (settleRecovery && !inTransaction) {
    const assigned = await retryOnDeadlock(() =>
      client.transaction(async (tx) => {
        const claimedUser = { ...user };
        const result = await upsertQuestEntry(
          tx,
          claimedUser,
          quest,
          source,
          entry ?? null,
          true,
          readiness,
        );
        return { result, user: claimedUser };
      }),
    );
    Object.assign(user, assigned.user);
    return assigned.result;
  }
  const ticks = settleRecovery ? regenTicksSince(user.regenAt) : 0;
  const recoveredAt = new Date();
  const regen = settleRecovery ? getUserRegenerationGain(user, recoveredAt) : 0;
  // Energy shares regenAt, so preserve its earned recovery before advancing that clock too.
  const recovery = settleRecovery
    ? {
        curHealth: Math.round(Math.min(user.curHealth + regen, user.maxHealth)),
        curChakra: Math.round(Math.min(user.curChakra + regen, user.maxChakra)),
        curStamina: Math.round(Math.min(user.curStamina + regen, user.maxStamina)),
        curEnergy: Math.min(user.curEnergy + regen, user.maxEnergy),
        regenAt: secondsFromDate(ticks * REGEN_SECONDS, user.regenAt),
      }
    : {};
  // Use the persisted pools/clock: a competing account write must not replay recovery
  // or overwrite the pools after the story's quest tracker has already been claimed.
  const recoveryTicks = regenTicksSql(userData.regenAt, recoveredAt);
  const poolRecovery = userRegenerationGainSql(user, userData.regenAt, recoveredAt);
  const recoveryUpdate = settleRecovery
    ? {
        curHealth: sql`ROUND(LEAST(${userData.curHealth} + ${poolRecovery}, ${userData.maxHealth}))`,
        curChakra: sql`ROUND(LEAST(${userData.curChakra} + ${poolRecovery}, ${userData.maxChakra}))`,
        curStamina: sql`ROUND(LEAST(${userData.curStamina} + ${poolRecovery}, ${userData.maxStamina}))`,
        curEnergy: sql`LEAST(${userData.curEnergy} + ${poolRecovery}, ${user.maxEnergy})`,
        regenAt: sql`TIMESTAMPADD(SECOND, ${recoveryTicks} * ${REGEN_SECONDS}, ${userData.regenAt})`,
      }
    : {};
  if (!isOpenAttempt) {
    user.questData = removeQuestTrackerByQuestId(user.questData, quest.id);
  }
  const restart = { startedAt: new Date(), endAt: null, completed: 0 };
  const versionReset = {
    entryPaid: false,
    isolated: quest.content.isolated ?? false,
    questVersion: quest.updatedAt,
  };
  // Check if the quest has already been started
  if (entry) {
    const reopened = { ...restart, ...(!isOpenAttempt ? versionReset : {}) };
    promises.push(
      updateQuestHistoryForUpsertQuestEntry(
        client,
        reopened,
        entry,
        professionContract,
        noDelegatedAttempt,
      ),
    );
    entry = {
      ...entry,
      ...reopened,
      previousAttempts: entry.previousAttempts + 1,
    };
  } else {
    entry = {
      id: nanoid(),
      userId: user.userId,
      questId: quest.id,
      questType: quest.questType,
      ...restart,
      previousCompletes: 0,
      previousAttempts: 1,
      periodCompletes: 0,
      periodStartAt: null,
      pendingRewardChoice: null,
      ...versionReset,
    };
    // Idempotent on the (userId, questId) unique key: if a concurrent start (double-tap, or a
    // UI + overworld race, possibly past a stale `prevEntry`) already inserted the row, restart
    // it in place with the same mutation the update branch applies instead of throwing a
    // duplicate-key error. On the overworld path that throw would skip the caller's
    // clearActiveNpcQuest cleanup and strand the just-claimed NPC-mission slot.
    const duplicateUpdates = {
      ...restart,
      previousAttempts: sql`${questHistory.previousAttempts} + 1`,
      ...versionReset,
    };
    promises.push(
      insertQuestHistoryForUpsertQuestEntry(
        client,
        entry,
        duplicateUpdates,
        professionContract,
        noDelegatedAttempt,
      ),
    );
  }
  // Get updated trackers and update user
  user.userQuests = [
    ...user.userQuests.filter((row) => row.questId !== quest.id),
    { ...entry, quest },
  ];
  if (entry.isolated) user.status = "BATTLE";
  const trackerUser = await hydrateQuestCollections(client, user, inTransaction);
  const { trackers, consequences, notifications } = getNewTrackers(trackerUser, [
    { task: "any" },
  ]);
  // Target sectors depend on the rolled trackers, so their cached map read follows
  // tracker creation and precedes the same write that publishes the quest attempt.
  // The map loader runs independent reads; transaction starts reconcile through the profile.
  const targetSectors = getQuestTargetSectorsToCheck(user, trackers, true);
  if (targetSectors.length > 0 && !inTransaction) {
    const maps = await fetchPublishedSectorMaps(client, targetSectors).catch(
      (error: unknown) => {
        Sentry.captureException(error, {
          level: "warning",
          tags: { source: "questAssignmentTargets" },
        });
        return null;
      },
    );
    if (maps) snapQuestTargetsToReachable(user, trackers, maps);
  }
  const accountWrite = updateUserDataForUpsertQuestEntry(
    client,
    trackers,
    user,
    recoveryUpdate,
    entry,
    professionContract,
    quest,
    readiness,
  );
  promises.push(accountWrite);
  let accountResult: { rowsAffected: number } | undefined;
  // Drizzle builders are lazy; await them in order on PlanetScale's shared transaction session.
  if (inTransaction) {
    for (const promise of promises) {
      const result = await promise;
      if (promise === accountWrite) accountResult = result as { rowsAffected: number };
    }
  } else {
    const results = await Promise.all(promises);
    accountResult = results[results.length - 1] as { rowsAffected: number };
  }
  Object.assign(user, recovery);
  user.questData = trackers;
  user.completedQuests = user.completedQuests.filter((row) => row.questId !== quest.id);
  // A concurrent delegation may preserve a different tracker/attempt. Immediate
  // effects also require reconciliation beyond the tracker-only assignment write.
  // Team assignments change navigation derived by the profile query.
  let userCacheEligible =
    !(inTransaction && targetSectors.length > 0) &&
    !quest.teamEnabled &&
    !professionContract &&
    consequences.every((entry) => entry.type === "update_user") &&
    notifications.length === 0;
  if (userCacheEligible) {
    // Consecutive goals can unlock effects only after the initial tracker pass.
    // Probe a copy so completion flags cannot consume effects before their handler runs.
    const reconciled = getNewTrackers(structuredClone({ ...trackerUser, ...user }), [
      { task: "any" },
    ]);
    userCacheEligible =
      reconciled.consequences.every((entry) => entry.type === "update_user") &&
      reconciled.notifications.length === 0 &&
      JSON.stringify(reconciled.trackers) === JSON.stringify(trackers);
  }
  return {
    recoveryCommitted: !readiness || (accountResult?.rowsAffected ?? 0) > 0,
    entry,
    userCacheEligible,
  };
};

/**
 * Upsert quest entries for all users by selector. NOTE: selector determined which users get
 * updated/inserted entries.
 *
 * @param deadline - Optional epoch-ms cutoff checked before each batch. Once it has passed the
 *   remaining batches are left untouched so the caller can stop inside its time budget.
 * @returns `false` when the deadline stopped the reset before every batch ran, else `true`.
 */
export const upsertQuestEntries = async (
  client: DrizzleClient,
  quest: Quest,
  updateSelector: QueryCondition,
  deadline?: number,
) => {
  if (isRestrictedQuestType(quest.questType)) {
    throw serverError(
      "PRECONDITION_FAILED",
      quest.questType === "special"
        ? "Special quests can only be started by consuming an item."
        : "Overworld quests cannot be assigned to users in bulk.",
    );
  }
  // One pass over the selector for both branches: the LEFT JOIN already tells us who lacks a
  // QuestHistory row, so splitting the rows in JS costs one extra column instead of a second
  // round-trip that re-scans the same users.
  const candidates = await selectUserDataForUpsertQuestEntries(
    client,
    quest,
    updateSelector,
  );
  const missingHistory = candidates.filter((row) => row.historyId === null);
  if (missingHistory.length > 0) {
    // Idempotent through the unique (userId, questId) key, so a deadlock victim can rerun.
    await retryOnDeadlock(() =>
      insertQuestHistoryForUpsertQuestEntries(client, missingHistory, quest),
    );
  }
  // Users to update for (including those we just inserted for)
  if (candidates.length > 0) {
    // Bounded batches cap the QuestHistory row locks one statement holds while ordinary
    // quest traffic writes the same table through its unique key, shrinking the lock
    // cycles the reset can form with it. Batches run sequentially so the reset never
    // contends with itself, and share one timestamp so a retried batch stamps the same
    // time as the rest of the reset.
    const startedAt = new Date();
    // Bound as a parameter, never interpolated: `quest` here is the row argument, not the table.
    const questId = quest.id;
    // Path of this quest's tracker inside the questData array, e.g. `$[2].id`. JSON_SEARCH
    // matches with LIKE semantics, so the id must be escaped first — nanoid ids contain `_`,
    // which would otherwise match any single character and drop the wrong tracker.
    const trackerPath = sql`JSON_UNQUOTE(JSON_SEARCH(
      ${userData.questData},
      'one',
      REPLACE(REPLACE(REPLACE(${questId}, '#', '##'), '%', '#%'), '_', '#_'),
      '#',
      '$[*].id'
    ))`;
    // A user with several QuestHistory rows for this quest fans the LEFT JOIN out; dedupe so a
    // batch still covers QUEST_RESET_BATCH_SIZE distinct users.
    const batches = chunkArray(
      [...new Set(candidates.map((row) => row.userId))],
      QUEST_RESET_BATCH_SIZE,
    );
    for (const batchUserIds of batches) {
      if (deadline !== undefined && Date.now() >= deadline) return false;
      // Drop the tracker before reopening the history row, never in parallel with it: between
      // the two the quest would be active carrying last run's fully-done tracker, which
      // getReward reads as resolved and pays out again. Removing it in SQL rather than
      // read-modify-write also preserves progress a concurrent request recorded for another
      // quest. JSON_SEARCH 'one' drops a single tracker and questData is not guaranteed to hold
      // only one per quest, so repeat until a pass changes nothing; each pass shrinks the
      // array, making the cap a guard against a wedged cron rather than a real bound.
      // Each statement runs alone and is guarded by its WHERE, so a deadlock victim (the
      // reset shares midnight with other crons writing every UserData row) simply reruns.
      let cleared = false;
      for (let pass = 0; pass < QUEST_RESET_MAX_TRACKER_PASSES; pass++) {
        const removed = await retryOnDeadlock(() =>
          updateUserDataForUpsertQuestEntries(client, trackerPath, batchUserIds),
        );
        if (removed.rowsAffected === 0) {
          cleared = true;
          break;
        }
      }

      // Only a pass that found nothing left proves every tracker is gone. Reopening on an
      // exhausted cap would hand this batch the state the removal exists to prevent: an active
      // quest still carrying last run's completed goals. Leave them shut instead; each pass has
      // shortened the arrays, so the next run finishes the job.
      if (!cleared) continue;

      await retryOnDeadlock(() =>
        updateQuestHistoryForUpsertQuestEntries(
          client,
          startedAt,
          batchUserIds,
          questId,
        ),
      );
    }
  }
  return true;
};

/** Reserve a daily assignment and its recovery before publishing quest history. */
export const claimDailyQuestSlot = async (
  client: DrizzleClient,
  user: UserData,
  questType: string,
  readiness?: ActionReadiness,
) => {
  const quota = questDailyQuota(questType, user);
  if (!quota) return true;
  const { field } = quota;
  const counter = userData[field];
  const result = await updateUserDataForClaimDailyQuestSlot(
    client,
    field,
    counter,
    questType,
    user,
    quota,
    readiness,
  );
  if (result.rowsAffected === 0) return false;
  user[field] += 1;
  return true;
};

/**
 * Fetch uncompleted quests for a user
 * @param client - The database client
 * @param user - The user
 * @param type - The type of quest
 * @returns The uncompleted quests
 */
export const fetchUncompletedQuests = async (
  client: DrizzleClient,
  user: UserData,
  type: BootstrapQuestType,
) => {
  const availableLetters = availableQuestLetterRanks(user.rank);
  const now = new Date().toISOString();
  const history = await selectQuestForFetchUncompletedQuests(
    client,
    user,
    type,
    now,
    availableLetters,
  );
  return history
    .map((quest) => quest.Quest)
    .filter((q) => !q.hidden || canPlayHiddenQuests(user.role));
};

/** Assign the next unfinished bootstrap quest and return its history with the loaded quest, if any. */
export const insertNextQuest = async (
  client: DrizzleClient,
  user: NonNullable<UserWithRelations>,
  type: BootstrapQuestType,
) => {
  const history = await fetchUncompletedQuests(client, user, type);
  const nextQuest = history[0];
  if (nextQuest) {
    const logEntry = await upsertQuestEntry(client, user, nextQuest, "system");
    return { ...logEntry.entry, quest: nextQuest };
  }
  return undefined;
};

/**
 * Debit entry items and mark the new attempt paid. False leaves the receipt unmarked so
 * the caller can reject or roll back the start.
 */
const payEntryAndMarkReceipt = async (
  client: DrizzleClient,
  user: NonNullable<UserWithRelations>,
  questData: Quest,
  charges: NonNullable<ReturnType<typeof getQuestEntryCharges>>,
  assignment: Awaited<ReturnType<typeof upsertQuestEntry>>,
) => {
  const paid = await payQuestEntryAtStart({
    client,
    userId: user.userId,
    questId: questData.id,
    charges,
  });
  if (!paid) return false;
  assignment.entry = { ...assignment.entry, entryPaid: true };
  user.userQuests = user.userQuests.map((row) =>
    row.questId === questData.id ? { ...row, entryPaid: true } : row,
  );
  return true;
};

/** True when a quest type can only ever be acquired from its assigned overworld NPC. */
export const isNpcOnlyQuestType = (questType: QuestType) =>
  (NPC_ONLY_QUEST_TYPES as readonly QuestType[]).includes(questType);

/** These quests require their dedicated acquisition flow, including when linked by content. */
export const isRestrictedQuestType = (questType: QuestType) =>
  (RESTRICTED_QUEST_TYPES as readonly QuestType[]).includes(questType);

/** Every path that creates or restarts a quest history row must declare its origin. */
type QuestAcquisitionSource =
  | "item"
  | "ui"
  | "pet_task"
  | "overworld_npc"
  | "random_assignment"
  | "system"
  | "quest_objective";

/** Quest types the user fetch bootstraps automatically. */
type BootstrapQuestType = Extract<QuestType, "tier" | "exam">;

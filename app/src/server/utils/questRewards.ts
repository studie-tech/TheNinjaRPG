import { sql } from "drizzle-orm";
import { RECRUIT_PRESTIGE_SHARE, VILLAGE_WAR_TYPES } from "@/drizzle/constants";
import { type UserData, userData } from "@/drizzle/schema";
import { getGatheringItemDrops } from "@/libs/gathering";
import { getHuntingItemDrops } from "@/libs/hunting";
import { getEffectiveStackSize, splitIntoStacks } from "@/libs/item";
import { getWarSide } from "@/libs/objectiveWar";
import { boostPvpGain, boostPvpRewards, getPvpBoost } from "@/libs/pvpExperience";
import {
  filterQuestTrackersForDbPersist,
  getNewTrackers,
  type QuestCounterFieldName,
} from "@/libs/quest";
import type { GetRewardResult } from "@/libs/quest/rewards";
import { incrementAnbuPoints } from "@/queries/anbu";
import { incrementUserVillagePrestige } from "@/queries/profile";
import {
  findUserPvpRewardState,
  insertBloodlineRollsForUpdateRewards,
  insertRecruitmentRewardsForUpdateRewards,
  insertSageModeRollsForUpdateRewards,
  insertUserBadgeForUpdateRewards,
  insertUserItemForUpdateRewards,
  insertUserJutsuForUpdateRewards,
  insertUserRewardsForUpdateRewards,
  selectBadgeForUpdateRewards,
  selectBloodlineForUpdateRewards,
  selectItemForUpdateRewards,
  selectItemForUpdateRewards2,
  selectItemForUpdateRewards3,
  selectJutsuForUpdateRewards,
  selectSageModeForUpdateRewards,
  selectTitleForUpdateRewards,
  selectVillageForUpdateRewards,
  updateClanForUpdateRewards,
  updateUserDataForUpdateRewards,
  updateWarDamageForUpdateRewards,
  updateWarHealingForUpdateRewards,
  userRewardDataUpdate,
} from "@/queries/quests";
import { deleteRequests } from "@/queries/sparring";
import { incrementVillageTokens } from "@/queries/village";
import type { UserWithRelations } from "@/routers/profile";
import { fetchActiveWars } from "@/routers/war";
import type { DrizzleClient } from "@/server/db";
import { runRewardTasks } from "@/server/utils/concurrency";
import { fetchPvpExperienceAverage } from "@/server/utils/pvpExperience";
import { awardRecruitRankMilestonesSafely } from "@/server/utils/recruitment";
import { grantTitles } from "@/server/utils/titleGrants";
import { getRandomElement } from "@/utils/array";
import type { QuestTrackerType } from "@/validators/objectives";

/**
 * Callers must win an endpoint-specific idempotency / CAS claim before invoking
 * this helper. `updateRewards` itself does not provide replay protection.
 *
 * Money/XP-style scalars use SQL increments on `userData` columns so parallel grants compose.
 *
 * Pet XP combines positive player XP and dedicated pet rewards in this same account update;
 * the shared SQL helper checks live pet eligibility without another database round trip.
 *
 * Sage: `reward_sage_modes` rolls and records a not-yet-owned mode only when the
 * player has no equipped `sageModeId`. Already-equipped players skip the grant so
 * a mode is not burned into history they can never wear.
 *
 * Titles retain their first acquisition snapshot and advance the account version to fence recovery.
 */
export const updateRewards = async (info: {
  /** Transaction sessions execute one statement at a time; ordinary callers keep parallel phases. */
  inTransaction?: boolean;
  client: DrizzleClient;
  user: UserData;
  reason: string;
  rewards: GetRewardResult;
  /** Skip for existing treasury transfers or rewards with their boost already applied. */
  pvpBoostApplied?: boolean;
  questCounterField?: QuestCounterFieldName;
  questFinishedAt?: Date;
  // Fully-hydrated user (with quest relations) passed ONLY by callers whose gathering drops
  // advance the herbs_gathered tracker; an explicit opt-in so other callers never increment it.
  questUser?: NonNullable<UserWithRelations>;
  /** Captured by the completed collection; ordinary rewards without a snapshot use base yield. */
  gatheringBonusQuantity?: number;
  // Extra userData columns folded into the single UPDATE below, so a caller that must also patch
  // this user's row on the reward-claim path (e.g. release an NPC-mission slot) does it in the
  // same round-trip instead of a trailing sequential write. Values may be raw scalars or `sql`
  // expressions and win over the reward keys on any name clash.
  postClaimUserDataPatch?: Record<string, unknown>;
  // Quest this payout terminally completes, if any. The herbs fold below recomputes trackers
  // from `questUser`, whose in-memory history row still reads active (the completion CAS only
  // touched the DB), so without this it would rebuild a tracker the caller just dropped.
  dropTrackerForQuestId?: string;
  // Write `user.questData` back (default). A caller that did not claim the user snapshot passes
  // false so its possibly stale read cannot overwrite trackers another request committed.
  persistQuestData?: boolean;
}) => {
  // Destructure
  const {
    inTransaction = false,
    client,
    user,
    rewards,
    questCounterField,
    questFinishedAt,
    reason,
    questUser,
    postClaimUserDataPatch,
    dropTrackerForQuestId,
    persistQuestData = true,
    pvpBoostApplied = false,
  } = info;
  // Check if we need to fetch war data
  const hasWarRewards =
    (rewards.reward_war_damage > 0 || rewards.reward_war_healing > 0) && user.villageId;

  // Count item occurrences before the query (rewards.reward_items may contain duplicates for quantity)
  const itemIdCounts = new Map<string, number>();
  for (const id of rewards.reward_items ?? []) {
    itemIdCounts.set(id, (itemIdCounts.get(id) ?? 0) + 1);
  }
  const uniqueItemIds = [...itemIdCounts.keys()];
  const hasRecruiterPrestige = !!user.recruiterId && rewards.reward_prestige > 0;

  // Fetch names from the database
  const [
    pvpAverage,
    recruiter,
    villageData,
    hunterItems,
    gatheringItems,
    items,
    jutsus,
    bloodlines,
    badges,
    titles,
    activeWars,
    sageModes,
  ] = await runRewardTasks(inTransaction)([
    () =>
      hasRecruiterPrestige || (!pvpBoostApplied && (user.pvpExperience ?? 0) > 0)
        ? fetchPvpExperienceAverage(client)
        : undefined,
    () =>
      hasRecruiterPrestige && user.recruiterId
        ? findUserPvpRewardState(client, user.recruiterId)
        : undefined,
    () =>
      rewards.reward_village_membership !== "NONE"
        ? selectVillageForUpdateRewards(client, {
            reward_village_membership: rewards.reward_village_membership,
          }).then((v) => v[0])
        : undefined,
    () =>
      rewards.reward_hunter_items && user.occupation === "HUNTER"
        ? selectItemForUpdateRewards(client)
        : undefined,
    () =>
      rewards.reward_gathering_items && user.occupation === "GATHERING"
        ? selectItemForUpdateRewards2(client)
        : undefined,
    () =>
      uniqueItemIds.length > 0
        ? selectItemForUpdateRewards3(client, uniqueItemIds)
        : [],
    () =>
      (rewards.reward_jutsus?.length ?? 0) > 0
        ? selectJutsuForUpdateRewards(client, user, rewards)
        : [],
    () =>
      (rewards.reward_bloodlines?.length ?? 0) > 0
        ? selectBloodlineForUpdateRewards(client, user, rewards)
        : [],
    () =>
      (rewards.reward_badges?.length ?? 0) > 0
        ? selectBadgeForUpdateRewards(client, user, rewards)
        : [],
    () =>
      (rewards.reward_titles?.length ?? 0) > 0
        ? selectTitleForUpdateRewards(client, user, rewards)
        : [],
    () =>
      hasWarRewards && user.villageId
        ? fetchActiveWars(client, user.villageId, user.userId)
        : undefined,
    () =>
      (rewards.reward_sage_modes?.length ?? 0) > 0
        ? selectSageModeForUpdateRewards(client, user, rewards)
        : [],
  ]);

  if (!pvpBoostApplied) {
    // Keep the caller's payout object aligned with the amounts displayed in its response.
    boostPvpRewards(
      rewards,
      getPvpBoost(user, pvpAverage ? [pvpAverage] : []).totalPercent,
      true,
    );
  }

  // If we are rewarding hunter items, only select based on hunter rank
  const droppedHunterItems = getHuntingItemDrops(
    user.huntingExperience,
    hunterItems || [],
    rewards.reward_hunter_items_ids,
  );
  const droppedGatheringItems = getGatheringItemDrops(
    user.gatheringExperience,
    gatheringItems || [],
    rewards.reward_gathering_items_ids,
    info.gatheringBonusQuantity ?? 0,
  );

  // Expand reward items based on quantities, respecting stack sizes
  const expandedRewardItems: { id: string; name: string; quantity: number }[] = [];
  for (const itemData of items) {
    const count = itemIdCounts.get(itemData.id) ?? 1;
    for (const quantity of splitIntoStacks(count, getEffectiveStackSize(itemData))) {
      expandedRewardItems.push({ id: itemData.id, name: itemData.name, quantity });
    }
  }

  // Material drops are expanded per unit, preserving inventory stack limits.
  const itemsToInsert = [
    ...expandedRewardItems,
    ...(droppedHunterItems || []).map((i) => ({ id: i.id, name: i.name, quantity: 1 })),
    ...(droppedGatheringItems || []).map((i) => ({
      id: i.id,
      name: i.name,
      quantity: 1,
    })),
  ];

  // Fold the herbs-gathered tracker into this single questData write (avoids a second UPDATE in
  // the caller). Only the gathering-claim path drops gatherer items AND opts in via `questUser`.
  // Tracker computation starts from `user.questData` (the
  // authoritative snapshot this function writes) so it stays correct even if `questUser` carries
  // a staler questData than the row being updated.
  if (droppedGatheringItems.length > 0 && questUser) {
    const { trackers } = getNewTrackers({ ...questUser, questData: user.questData }, [
      { task: "herbs_gathered", increment: droppedGatheringItems.length },
    ]);
    const persisted = filterQuestTrackersForDbPersist(trackers, questUser);
    user.questData = dropTrackerForQuestId
      ? removeQuestTrackerByQuestId(persisted, dropTrackerForQuestId)
      : persisted;
  }

  // Update userdata
  const getNewRank = rewards.reward_rank !== "NONE";
  const getNewVillage = rewards.reward_village_membership !== "NONE";

  // Roll ONE not-yet-owned candidate only when the player has no equipped mode.
  // Recording history without equipping would permanently burn that id (no swap path).
  // COALESCE still protects an empty-slot race from double-equipping.
  const rolledSageMode =
    !user.sageModeId && sageModes.length > 0 ? getRandomElement(sageModes) : undefined;

  const updatedUserData: Record<string, unknown> = {
    ...userRewardDataUpdate(rewards),
    ...(persistQuestData ? { questData: user.questData } : {}),
    // Only write membership grants; echoing a snapshot would undo a concurrent village change.
    ...(getNewVillage && villageData ? { villageId: villageData.id } : {}),
    ...(rolledSageMode
      ? { sageModeId: sql`COALESCE(${userData.sageModeId}, ${rolledSageMode.id})` }
      : {}),
  };
  if (questCounterField) {
    updatedUserData.questFinishAt = questFinishedAt ?? new Date();
    updatedUserData[questCounterField] = sql`${userData[questCounterField]} + 1`;
  }
  // Fold any caller-supplied column patch into the same UPDATE (independent per-column, so it
  // does not disturb the atomic reward increments above).
  if (postClaimUserDataPatch) {
    Object.assign(updatedUserData, postClaimUserDataPatch);
  }

  // Recruitment logic
  const prestigeReward = Math.floor(
    boostPvpGain(
      Math.ceil(rewards.reward_prestige * RECRUIT_PRESTIGE_SHARE),
      getPvpBoost(recruiter ?? {}, pvpAverage ? [pvpAverage] : []).totalPercent,
    ),
  );

  // Update database
  await runRewardTasks(inTransaction)([
    () => updateUserDataForUpdateRewards(client, updatedUserData, user),
    ...(user.recruiterId && prestigeReward > 0
      ? [
          incrementUserVillagePrestige(client, prestigeReward, user.recruiterId),
          insertRecruitmentRewardsForUpdateRewards(
            client,
            { recruiterId: user.recruiterId, userId: user.userId },
            prestigeReward,
          ),
        ]
      : []
    ).map((task) => () => task),
    () => (getNewRank ? deleteRequests(client, user.userId) : undefined),
    () =>
      rewards.reward_reputation > 0 &&
      insertUserRewardsForUpdateRewards(client, user, rewards, reason),
    () =>
      rewards.reward_tokens > 0 && user.villageId
        ? incrementVillageTokens(client, rewards.reward_tokens, user.villageId)
        : undefined,
    () =>
      rewards.reward_clanpoints > 0 && user.clanId
        ? updateClanForUpdateRewards(client, rewards, { clanId: user.clanId })
        : undefined,
    () =>
      rewards.reward_anbupoints > 0 && user.anbuId
        ? incrementAnbuPoints(client, rewards.reward_anbupoints, user.anbuId)
        : undefined,
    () => jutsus.length > 0 && insertUserJutsuForUpdateRewards(client, jutsus, user),
    () =>
      bloodlines.length > 0 &&
      insertBloodlineRollsForUpdateRewards(client, bloodlines, user),
    () =>
      rolledSageMode
        ? insertSageModeRollsForUpdateRewards(client, user, rolledSageMode)
        : undefined,
    () =>
      itemsToInsert.length > 0 &&
      insertUserItemForUpdateRewards(client, itemsToInsert, user),
    () => badges.length > 0 && insertUserBadgeForUpdateRewards(client, badges, user),
    () =>
      grantTitles(
        client,
        user.userId,
        titles.map((entry) => entry.id),
        inTransaction,
      ),
    ...(() => {
      if (!activeWars || activeWars.length === 0) return [];
      const warUpdates: Promise<unknown>[] = [];

      // Process each war the user is involved in (VILLAGE_WAR or WAR_RAID)
      for (const activeWar of activeWars) {
        const warSide = getWarSide(activeWar, user.villageId, user.userId);
        if (!warSide || !VILLAGE_WAR_TYPES.includes(activeWar.type)) continue;
        const onAttackerSide = warSide === activeWar.attackerVillageId;

        // War damage hits the opponent's war health
        if (rewards.reward_war_damage > 0) {
          warUpdates.push(
            updateWarDamageForUpdateRewards(
              client,
              activeWar.id,
              onAttackerSide ? "defender" : "attacker",
              rewards.reward_war_damage,
            ),
          );
        }

        // War healing restores the player's own side, under its own raid guard check
        if (rewards.reward_war_healing > 0) {
          warUpdates.push(
            updateWarHealingForUpdateRewards(
              client,
              activeWar.id,
              onAttackerSide ? "attacker" : "defender",
              rewards.reward_war_healing,
            ),
          );
        }
      }

      return warUpdates;
    })().map((task) => () => task),
  ]);
  // A rank reward is a promotion: record the recruiter's rank milestones once it has landed.
  if (getNewRank && user.recruiterId) {
    await awardRecruitRankMilestonesSafely({
      client,
      recruitUserId: user.userId,
      recruiterId: user.recruiterId,
      rank: rewards.reward_rank,
    });
  }
  // Update rewards for readability
  return {
    items: itemsToInsert,
    titles,
    jutsus,
    bloodlines,
    badges,
    sageModes: rolledSageMode ? [rolledSageMode] : [],
  };
};

/** Replace a reward's ids with the names of what `updateRewards` actually granted. */
export const nameGrantedRewards = (
  rewards: GetRewardResult,
  granted: Pick<
    Awaited<ReturnType<typeof updateRewards>>,
    "items" | "jutsus" | "bloodlines" | "sageModes" | "badges" | "titles"
  >,
) => {
  rewards.reward_items = granted.items.map((i) => i.name);
  rewards.reward_jutsus = granted.jutsus.map((i) => i.name);
  rewards.reward_bloodlines = granted.bloodlines.map((i) => i.name);
  rewards.reward_sage_modes = granted.sageModes.map((i) => i.name);
  rewards.reward_badges = granted.badges.map((i) => i.name);
  rewards.reward_titles = granted.titles.map((i) => i.name);
};

/** Drop one quest's tracker so a restarted/reassigned quest always starts fresh. */
export const removeQuestTrackerByQuestId = (
  trackers: QuestTrackerType[] | null | undefined,
  questId: string,
) => (trackers ?? []).filter((tracker) => tracker.id !== questId);

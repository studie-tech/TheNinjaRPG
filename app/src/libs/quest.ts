import { nanoid } from "nanoid";
import {
  ADDITIONAL_MISSION_REWARD_MULTIPLIER,
  ERRANDS_PER_DAY,
  type GATHERING_RANK,
  GATHERING_RANKS,
  type HUNTING_RANK,
  HUNTING_RANKS,
  IMG_MISSION_A,
  IMG_MISSION_B,
  IMG_MISSION_C,
  IMG_MISSION_D,
  IMG_MISSION_E,
  IMG_MISSION_M,
  IMG_MISSION_PVP,
  IMG_MISSION_S,
  type LetterRank,
  type MasteryType,
  MEDICAL_MISSIONS_PER_DAY,
  type MEDNIN_RANK,
  MEDNIN_RANKS,
  MISSIONS_FULL_REWARD_COUNT,
  MISSIONS_PER_DAY,
  PVP_MISSIONS_PER_DAY,
  QUESTS_CONCURRENT_LIMIT,
  type QuestType,
  QuestTypesWithMaxAttempts,
  type RetryQuestDelay,
  type SAGE_MASTERY_RANK,
  SECTOR_HEIGHT,
  SECTOR_WIDTH,
  SENSEI_MAX_STUDENT_LEVEL,
  SENSEI_STUDENT_MISSION_EXP_BOOST_PERC,
  TERMINAL_DIALOG_PREFIX,
  VILLAGE_SYNDICATE_ID,
  WAR_MISSIONS_PER_DAY,
} from "@/drizzle/constants";
import type { GameSetting, Quest, UserData, UserItem } from "@/drizzle/schema";
import type { BloodlineCollectionProgress } from "@/libs/bloodline";
import { getFarmingLevel } from "@/libs/farming";
import { getGatheringRank } from "@/libs/gathering";
import { calcMedninRank } from "@/libs/hospital";
import { getHuntingRank } from "@/libs/hunting";
import {
  MASTERY_REQUIREMENT_FIELDS,
  type MasteryRequirementFields,
} from "@/libs/mastery";
import { canPromoteMastery } from "@/libs/masteryProgression";
import {
  findCompletedPredecessor,
  isQuestComplete,
  isQuestObjectiveAvailable,
} from "@/libs/objectives";
import {
  earlierBoundObjectivesComplete,
  isSupportedOverworldBindingTask,
  pickPlaceableSector,
} from "@/libs/overworldAi";
import {
  buildRewardChoiceCards,
  getFixedChoiceRewards,
  getRewardPickCount,
  isRewardChoiceQuest,
} from "@/libs/rewardChoice";
import { getSageMasteryDisplayRank, isSageRankAtLeast } from "@/libs/sageMode";
import type { NormalizedSectorMap } from "@/libs/sector-map/types";
import { findNearestReachableCoordinate } from "@/libs/sector-map/validation";
import { availableQuestLetterRanks } from "@/libs/train";
import type { UserWithRelations } from "@/routers/profile";
import { getUnique } from "@/utils/grouping";
import { canChangeContent, canPlayHiddenQuests } from "@/utils/permissions";
import { capitalizeFirstLetter } from "@/utils/string";
import { periodStart, secondsPassed } from "@/utils/time";
import {
  canAccessStructure,
  getShrineBoost,
  getStrucBoost,
  type SectorVillage,
} from "@/utils/village";
import type {
  AllObjectivesType,
  AllObjectiveTask,
  ObjectiveTrackerType,
  QuestContentType,
  QuestTrackerType,
} from "@/validators/objectives";
import { ObjectiveTracker, QuestTracker } from "@/validators/objectives";
import type { ObjectiveRewardType, PendingRewardChoice } from "@/validators/rewards";
import {
  MASTERY_EXPERIENCE_FIELDS,
  ObjectiveReward,
  type PostProcessedRewards,
} from "@/validators/rewards";
import { getQuestCounterFieldName } from "@/validators/user";

/**
 * Get currently active quests for a user
 */
export const getUserQuests = (user: NonNullable<UserWithRelations>) => {
  const userQuests =
    user?.userQuests
      .filter((uq) => !!uq.quest)
      .filter((uq) => isAvailableUserQuests({ ...uq.quest, ...uq }, user, true).check)
      .map((uq) => ({ ...uq, ...uq.quest })) ?? [];
  return userQuests;
};

/**
 * Project a user's active quests into the `{ questId, objectives }` shape consumed by
 * {@link findActionableBoundObjective}. Shared by the server overworld-interaction path
 * (`interactWithOverworldAi`) and the client arrival-prompt CTA so both resolve the same bound
 * sub-path (`defeat_opponents` / `dialog` / `deliver_item`) for a placement.
 *
 * `available` gates reachability so a bound objective can't fire out of sequence, combining two
 * independent conditions:
 *  1. Consecutive-chain reachability (`isQuestObjectiveAvailable`) — a no-op `true` for
 *     non-consecutive quests and for the fresh-quest first interaction (no tracker yet).
 *  2. Objective-order reachability (`earlierBoundObjectivesComplete`), applied only to
 *     non-consecutive quests (consecutive quests already order via the tracker chain): every
 *     EARLIER placement-bound objective on the quest must be done first.
 */
export const getBoundObjectiveCandidates = (user: NonNullable<UserWithRelations>) =>
  getUserQuests(user).map((q) => {
    const tracker = (user.questData ?? []).find((t) => t.id === q.id);
    const objectives = q.content.objectives;
    // Placement + done per objective, precomputed so the ordering gate is a plain array scan.
    const meta = objectives.map((objective) => ({
      task: objective.task,
      overworldPlacementId: objective.overworldPlacementId,
      done: !!tracker?.goals.find((g) => g.id === objective.id)?.done,
    }));
    return {
      questId: q.id,
      objectives: objectives.map((objective, i) => ({
        id: objective.id,
        task: objective.task,
        overworldPlacementId: objective.overworldPlacementId,
        done: meta[i]?.done ?? false,
        deliverItemIds:
          "deliverItemIds" in objective ? objective.deliverItemIds : undefined,
        available: tracker
          ? isQuestObjectiveAvailable(q.quest, tracker, i) &&
            (q.quest.consecutiveObjectives || earlierBoundObjectivesComplete(meta, i))
          : true,
        // Carry the un-projected objective through: the bound sub-paths read task-specific fields
        // the projection drops, and would otherwise re-scan every quest's objectives to find it.
        source: objective,
      })),
    };
  });

/**
 * A `QuestHistory`-shaped row is an in-memory-only mock from {@link mockAchievementHistoryEntries}
 * (an achievement with no backing `QuestHistory` yet) when its `id` equals its `questId`; real rows
 * carry a nanoid `id` distinct from `questId`. Use this to skip mocks wherever a real, persisted row
 * is required — e.g. before a completion CAS that needs an existing row to update.
 */
export const isMockQuestHistoryRow = (row: { id: string; questId: string }): boolean =>
  row.id === row.questId;

/**
 * Strip in-memory-only achievement trackers before persisting `UserData.questData`, except
 * completed collection goals whose catalogue snapshot must survive until reward claim.
 * Mock rows from `mockAchievementHistoryEntries` use `id === questId`; real `QuestHistory.id` is a nanoid.
 */
export const filterQuestTrackersForDbPersist = (
  trackers: QuestTrackerType[],
  user: NonNullable<UserWithRelations>,
) => {
  const inMemoryOnlyAchievements = new Map(
    user.userQuests
      // `uq.quest` is null for an orphaned QuestHistory row (its quest was deleted). Most callers
      // pass userQuests from fetchUpdatedUser, which already strips these, but item.ts's buy path
      // uses a bespoke fetch that does not — so guard the deref here as a defensive backstop for
      // every caller. An orphan is not an in-memory achievement, so skipping it is correct;
      // getNewTrackers already drops orphans, so no tracker is emitted for them anyway.
      .filter(
        (uq) => uq.quest?.questType === "achievement" && isMockQuestHistoryRow(uq),
      )
      .map((uq) => [uq.questId, uq.quest]),
  );
  return trackers.filter((tracker) => {
    const achievement = inMemoryOnlyAchievements.get(tracker.id);
    return (
      !achievement ||
      achievement.content?.objectives.some(
        (objective) =>
          objective.task === "bloodline_collection" &&
          tracker.goals.some((goal) => goal.id === objective.id && goal.done),
      )
    );
  });
};

/** Hidden active targets need server projection after changing sectors, even if currently revealed. */
export const hasActiveHiddenQuestObjectives = (
  user: NonNullable<UserWithRelations>,
) => {
  if (canChangeContent(user.role)) return false;
  return user.userQuests.some((entry) => {
    if (entry.completed || entry.endAt) return false;
    const tracker = user.questData?.find((q) => q.id === entry.questId);
    return entry.quest.content.objectives.some((objective, index) => {
      if (!("hideLocation" in objective) || !objective.hideLocation) return false;
      const goal = tracker?.goals.find((g) => g.id === objective.id);
      return (
        !goal?.done &&
        (!tracker || isQuestObjectiveAvailable(entry.quest, tracker, index))
      );
    });
  });
};

/**
 * Get active objectives for a user
 */
export const getActiveObjectives = (user: NonNullable<UserWithRelations>) => {
  const activeQuests = user.userQuests.map((uq) => uq.quest);
  const activeObjectives: AllObjectivesType[] = [];
  activeQuests.forEach((quest) => {
    const tracker = user.questData?.find((q) => q.id === quest.id);
    quest?.content.objectives.forEach((objective, i) => {
      if (tracker && !isQuestObjectiveAvailable(quest, tracker, i)) {
        return;
      }
      const goal = tracker?.goals.find((g) => g.id === objective.id);
      if (goal && goal.done === false) {
        if (goal.sector !== objective.sector) {
          objective.sector = goal.sector;
        }
        if (goal.longitude !== objective.longitude) {
          objective.longitude = goal.longitude;
        }
        if (goal.latitude !== objective.latitude) {
          objective.latitude = goal.latitude;
        }
        activeObjectives.push(objective);
      }
    });
  });
  return activeObjectives;
};

/**
 * Roll the ambush attackers of the given active objectives. Each attacker set joins with its
 * `number` percent chance, capped at `attackers_max_per_battle`; a `win_encounter_at_location`
 * objective only ambushes inside its own sector. The first objective that produces attackers
 * decides the encounter.
 *
 * @returns the random encounter to start, or undefined when nobody attacks.
 */
export const rollObjectiveAttackers = (
  objectives: AllObjectivesType[],
  sector: number,
  random: () => number = Math.random,
): QuestConsequence | undefined => {
  for (const objective of objectives) {
    if (!("attackers" in objective) || objective.attackers.length === 0) continue;
    if (objective.task === "win_encounter_at_location" && sector !== objective.sector) {
      continue;
    }
    let opponents = objective.attackers
      .filter((ai) => random() * 100 < ai.number)
      .flatMap((ai) => ai.ids);
    if (
      "attackers_max_per_battle" in objective &&
      objective.attackers_max_per_battle > 0 &&
      opponents.length > objective.attackers_max_per_battle
    ) {
      opponents = opponents
        .sort(() => random() - 0.5)
        .slice(0, objective.attackers_max_per_battle);
    }
    if (opponents.length > 0) {
      return {
        type: "random_encounter",
        ids: opponents,
        scaleStats: objective.attackers_scaled_to_user,
        scaleGains: objective.attackers_scale_gains,
      };
    }
  }
  return undefined;
};

/**
 * Check if this is a location objective and user is at the location
 */
export const isLocationObjective = (
  location: { latitude: number; longitude: number; sector: number },
  objective: AllObjectivesType,
) => {
  if ("sector" in objective) {
    if (
      location.sector === Number(objective.sector) &&
      location.latitude === Number(objective.latitude) &&
      location.longitude === Number(objective.longitude)
    ) {
      return true;
    }
  }
  return false;
};

/**
 * Whether an objective's location requirement is satisfied for the user. An
 * objective bound to an overworld NPC placement is location-satisfied when the
 * player is interacting with that placement (its id is in `atPlacementIds`),
 * since the placement — not the objective's stored coordinates — is the
 * authoritative location. Those stored coordinates drift from a roaming NPC's
 * daily reposition (and default to 0/0/0 for fixed NPCs), so for a bound objective
 * the coordinates are ignored entirely — it resolves only when the player is
 * interacting with the bound placement. An unbound objective uses plain coordinate
 * matching.
 */
export const isObjectiveLocationSatisfied = (
  location: { latitude: number; longitude: number; sector: number },
  objective: AllObjectivesType,
  atPlacementIds?: ReadonlySet<string>,
) => {
  // A placement-bound objective resolves off the placement, never its stored coordinates
  // (which could otherwise coincidentally match a tile and auto-complete on travel).
  if (
    "overworldPlacementId" in objective &&
    objective.overworldPlacementId &&
    isSupportedOverworldBindingTask(objective.task)
  ) {
    return !!atPlacementIds && atPlacementIds.has(objective.overworldPlacementId);
  }
  return isLocationObjective(location, objective);
};

/**
 * Whether the current daily-mission count pays the reduced reward multiplier.
 * `pre-start` is the Mission Hall picker (counter not yet incremented).
 * `in-progress` is claim / Logbook (counter already incremented at start).
 */
export const isReducedMissionReward = (
  dailyMissions: number,
  { phase }: { phase: "pre-start" | "in-progress" },
) =>
  phase === "pre-start"
    ? dailyMissions >= MISSIONS_FULL_REWARD_COUNT
    : dailyMissions > MISSIONS_FULL_REWARD_COUNT;

/**
 * Go through current user quests, and return updated list of questData &
 * list of rewards to award the user
 * @param user - User with questData
 * @param questId - Quest ID
 * @param dialogNextObjectiveId - Requested next objective ID.
 * @param settings - Game settings used while calculating quest rewards.
 * @param atPlacementIds - Overworld placement ids the user is interacting with now.
 * @returns Rewards, trackers, userQuest, resolved, successDescriptions
 */
export const getReward = (
  user: NonNullable<UserWithRelations>,
  questId: string,
  dialogNextObjectiveId?: string,
  settings?: GameSetting[],
  atPlacementIds?: ReadonlySet<string>,
) => {
  // Derived
  let rawRewards = ObjectiveReward.parse({});
  // Completion reward of a "choose" quest, offered as cards instead of granted outright.
  let choiceRewards: ObjectiveRewardType | null = null;
  let rewardChoice: PendingRewardChoice | null = null;
  const { trackers, notifications, consequences } = getNewTrackers(
    user,
    [
      { task: "any" },
      { task: "collect_item" },
      { task: "dialog", contentId: dialogNextObjectiveId },
    ],
    undefined, // combatContext
    undefined, // boundPlacementStatus (getReward binds via atPlacementIds instead)
    atPlacementIds,
  );
  const userQuest = user.userQuests.find((uq) => uq.questId === questId);
  let resolved = false;
  // Start mutating
  if (userQuest && !userQuest.completed && userQuest?.quest) {
    // See if we have a shrine boost
    const sectors = user.village?.sectors?.length || 0;
    const errandsBoost = getShrineBoost(sectors, "Errands", user.village);
    const missionBoost = getShrineBoost(sectors, "Mission", user.village);
    // Village mission hall boost (percentage as decimal), applies to missions and errands
    const villageMissionBoost =
      getStrucBoost("missionRewardPerLvl", user.village?.structures) / 100;
    // Get clan mission reward boost (percentage as decimal)
    // Only apply for real clans, not outlaw factions/towns
    const clanMissionBoost = user.isOutlaw
      ? 0
      : (user.clan?.missionRewardBoost ?? 0) / 100;
    let boostFactor = 1;
    if (userQuest?.quest.questType) {
      if (["mission", "crime", "medical"].includes(userQuest.quest.questType)) {
        boostFactor = 1 + missionBoost + clanMissionBoost + villageMissionBoost;
      } else if (userQuest.quest.questType === "errand") {
        // clanMissionBoost intentionally excluded from errands; only shrine + village hall apply
        boostFactor = 1 + errandsBoost + villageMissionBoost;
      }
    }
    // Get rewards
    const tracker = trackers.find((q) => q.id === userQuest.quest.id);
    const goals = tracker?.goals ?? [];
    resolved = !tracker || isQuestComplete(userQuest.quest, tracker);
    if (resolved) {
      const questReward = ObjectiveReward.parse(userQuest.quest.content.reward);
      if (isRewardChoiceQuest(userQuest.quest.content)) {
        // Only the structural part pays now; the rest becomes a frozen pick offer below.
        rawRewards = getFixedChoiceRewards(questReward);
        choiceRewards = questReward;
      } else {
        rawRewards = questReward;
      }
    }
    userQuest.quest.content.objectives.forEach((objective) => {
      const status = goals.find((g) => g.id === objective.id);
      if (status?.done && !status.collected) {
        status.collected = true;
        if (objective.successDescription) {
          notifications.push(objective.successDescription);
        }
        if (objective.reward_money) {
          rawRewards.reward_money += objective.reward_money;
        }
        if (objective.reward_seichi_silver) {
          rawRewards.reward_seichi_silver += objective.reward_seichi_silver;
        }
        if (objective.reward_clanpoints) {
          rawRewards.reward_clanpoints += objective.reward_clanpoints;
        }
        if (objective.reward_anbupoints) {
          rawRewards.reward_anbupoints += objective.reward_anbupoints;
        }
        if (objective.reward_exp) {
          rawRewards.reward_exp += objective.reward_exp;
        }
        if (objective.reward_tokens) {
          rawRewards.reward_tokens += objective.reward_tokens;
        }
        if (objective.reward_prestige) {
          rawRewards.reward_prestige += objective.reward_prestige;
        }
        if (objective.reward_reputation) {
          rawRewards.reward_reputation += objective.reward_reputation;
        }
        if (objective.reward_skillpoints) {
          rawRewards.reward_skillpoints += objective.reward_skillpoints;
        }
        if (objective.reward_medical_experience) {
          rawRewards.reward_medical_experience += objective.reward_medical_experience;
        }
        if (objective.reward_hunting_experience) {
          rawRewards.reward_hunting_experience += objective.reward_hunting_experience;
        }
        if (objective.reward_crafting_experience) {
          rawRewards.reward_crafting_experience += objective.reward_crafting_experience;
        }
        if (objective.reward_gathering_experience) {
          rawRewards.reward_gathering_experience +=
            objective.reward_gathering_experience;
        }
        for (const field of MASTERY_EXPERIENCE_FIELDS)
          if (objective[field])
            rawRewards[field] = (rawRewards[field] ?? 0) + (objective[field] ?? 0);
        if (objective.reward_sage_mastery_experience) {
          rawRewards.reward_sage_mastery_experience +=
            objective.reward_sage_mastery_experience;
        }
        if (objective.reward_war_damage) {
          rawRewards.reward_war_damage += objective.reward_war_damage;
        }
        if (objective.reward_war_healing) {
          rawRewards.reward_war_healing += objective.reward_war_healing;
        }
        if (objective.reward_jutsus) {
          rawRewards.reward_jutsus.push(...objective.reward_jutsus);
        }
        if (objective.reward_badges) {
          rawRewards.reward_badges.push(...objective.reward_badges);
        }
        if (objective.reward_items) {
          rawRewards.reward_items.push(...objective.reward_items);
        }
        if (objective.reward_bloodlines) {
          rawRewards.reward_bloodlines.push(...objective.reward_bloodlines);
        }
        if (objective.reward_sage_modes) {
          rawRewards.reward_sage_modes.push(...objective.reward_sage_modes);
        }
        if (objective.reward_rank !== "NONE") {
          rawRewards.reward_rank = objective.reward_rank;
        }
        if (objective.reward_village_membership !== "NONE") {
          rawRewards.reward_village_membership = objective.reward_village_membership;
        }
      }
    });
    // Scale rewards
    const missionLike = ["mission", "crime"].includes(userQuest.quest.questType);
    let factor = boostFactor; // Start with shrine boost factor

    // Apply daily mission limit penalty if applicable, but keep shrine boost
    if (
      missionLike &&
      isReducedMissionReward(user.dailyMissions, { phase: "in-progress" })
    ) {
      factor = ADDITIONAL_MISSION_REWARD_MULTIPLIER * boostFactor;
    }

    // Boosts, penalties and multipliers; applied identically to a reward-choice offer.
    const scaleRewards = (target: ObjectiveRewardType) => {
      target.reward_money = Math.floor(target.reward_money * factor);
      target.reward_clanpoints = Math.floor(target.reward_clanpoints * factor);
      target.reward_anbupoints = Math.floor(target.reward_anbupoints * factor);
      target.reward_exp = Math.floor(target.reward_exp * factor);
      target.reward_tokens = Math.floor(target.reward_tokens * factor);
      target.reward_prestige = Math.floor(target.reward_prestige * factor);
      target.reward_reputation = Math.floor(target.reward_reputation * factor);
      target.reward_medical_experience = Math.floor(
        target.reward_medical_experience * factor,
      );
      target.reward_hunting_experience = Math.floor(
        target.reward_hunting_experience * factor,
      );
      target.reward_crafting_experience = Math.floor(
        target.reward_crafting_experience * factor,
      );
      target.reward_gathering_experience = Math.floor(
        target.reward_gathering_experience * factor,
      );
      for (const field of MASTERY_EXPERIENCE_FIELDS)
        if (target[field] !== undefined)
          target[field] = Math.floor((target[field] ?? 0) * factor);
      target.reward_sage_mastery_experience = Math.floor(
        target.reward_sage_mastery_experience * factor,
      );
      target.reward_seichi_silver = Math.floor(target.reward_seichi_silver * factor);

      // Apply clan experience boosts (percentages stored in clan object)
      // Only apply for real clans, not outlaw factions/towns
      const clanHunterExpBoost = user.isOutlaw
        ? 0
        : (user.clan?.hunterExpBoost ?? 0) / 100;
      const clanGathererExpBoost = user.isOutlaw
        ? 0
        : (user.clan?.gathererExpBoost ?? 0) / 100;
      const clanCraftingExpBoost = user.isOutlaw
        ? 0
        : (user.clan?.craftingExpBoost ?? 0) / 100;
      if (clanHunterExpBoost > 0 && target.reward_hunting_experience > 0) {
        target.reward_hunting_experience = Math.floor(
          target.reward_hunting_experience * (1 + clanHunterExpBoost),
        );
      }
      if (clanGathererExpBoost > 0 && target.reward_gathering_experience > 0) {
        target.reward_gathering_experience = Math.floor(
          target.reward_gathering_experience * (1 + clanGathererExpBoost),
        );
      }
      if (clanCraftingExpBoost > 0 && target.reward_crafting_experience > 0) {
        target.reward_crafting_experience = Math.floor(
          target.reward_crafting_experience * (1 + clanCraftingExpBoost),
        );
      }

      // Chunin mission experience bonus (≤ level 40)
      if (
        user.senseiId &&
        user.level <= SENSEI_MAX_STUDENT_LEVEL &&
        userQuest.quest.questType === "mission"
      ) {
        target.reward_exp = Math.floor(
          target.reward_exp * (1 + SENSEI_STUDENT_MISSION_EXP_BOOST_PERC / 100),
        );
      }

      // Apply mission experience multiplier if available (for missions, crimes, and medical missions)
      if (settings && (missionLike || userQuest.quest.questType === "medical")) {
        const missionSetting = settings.find((s) => s.name === "missionExpMultiplier");
        if (missionSetting) {
          const secondsLeft = -secondsPassed(missionSetting.time);
          if (secondsLeft > 0 && missionSetting.value > 0) {
            target.reward_exp = Math.floor(target.reward_exp * missionSetting.value);
          }
        }
      }
    };
    scaleRewards(rawRewards);
    if (choiceRewards) {
      scaleRewards(choiceRewards);
      const cards = buildRewardChoiceCards(choiceRewards);
      if (cards.length > 0) {
        rewardChoice = {
          id: nanoid(),
          pickCount: getRewardPickCount(userQuest.quest.content),
          cards,
        };
      }
    }
  }
  // Final rewards (some need a bit pose-processing)
  const rewards = postProcessRewards(rawRewards);

  // Update trackers for experience gained from quest rewards
  const experienceTrackerTasks = getExperienceTrackerTasks(rewards);
  // Fold follow-up trackers onto the already-updated questData so progress from the
  // first getNewTrackers call is preserved (single authoritative questData write).
  // complete_specific_quest fires once on the active -> completed transition: `resolved`
  // is only true the moment this quest resolves and false once it is already completed,
  // so other quests that list this questId are credited exactly once. Single-level only
  // — a chained A -> B -> C will not fully resolve in one request (B's own completion
  // emits on its next checkRewards).
  const followupTrackerTasks: Parameters<typeof getNewTrackers>[1] = [
    ...experienceTrackerTasks,
  ];
  if (resolved && userQuest) {
    followupTrackerTasks.push({
      task: "complete_specific_quest",
      increment: 1,
      contentId: userQuest.questId,
    });
  }
  if (followupTrackerTasks.length > 0) {
    const { trackers: updatedTrackers } = getNewTrackers(
      { ...user, questData: trackers },
      followupTrackerTasks,
    );
    // Replace in-place to keep the original `trackers` array reference.
    trackers.length = 0;
    trackers.push(...updatedTrackers);
  }

  // Return results
  return {
    rewards,
    trackers,
    userQuest,
    resolved,
    notifications,
    consequences,
    rewardChoice,
  };
};

/**
 * `*_experience_gained` tracker increments for the profession experience in a reward. Emitted
 * when a completion pays out, and again when a reward-choice pick grants experience later.
 */
export const getExperienceTrackerTasks = (
  rewards: Pick<
    ObjectiveRewardType,
    | "reward_medical_experience"
    | "reward_crafting_experience"
    | "reward_hunting_experience"
    | "reward_gathering_experience"
  >,
) => {
  const tasks: {
    task:
      | "medical_experience_gained"
      | "crafting_experience_gained"
      | "hunting_experience_gained"
      | "gathering_experience_gained";
    increment: number;
  }[] = [];
  if (rewards.reward_medical_experience > 0) {
    tasks.push({
      task: "medical_experience_gained",
      increment: rewards.reward_medical_experience,
    });
  }
  if (rewards.reward_crafting_experience > 0) {
    tasks.push({
      task: "crafting_experience_gained",
      increment: rewards.reward_crafting_experience,
    });
  }
  if (rewards.reward_hunting_experience > 0) {
    tasks.push({
      task: "hunting_experience_gained",
      increment: rewards.reward_hunting_experience,
    });
  }
  if (rewards.reward_gathering_experience > 0) {
    tasks.push({
      task: "gathering_experience_gained",
      increment: rewards.reward_gathering_experience,
    });
  }
  return tasks;
};

export type GetRewardResult = ReturnType<typeof getReward>["rewards"];

/**
 * Post-process rewards to ensure that the rewards are valid
 * @param rewards - Rewards to post-process
 * @returns Post-processed rewards with item IDs as flat string array
 *
 * NOTE: Return type is explicitly annotated with PostProcessedRewards from
 * @/validators/rewards to ensure type safety. If this function's return value
 * changes, TypeScript will error, alerting us to update the schema.
 */
export const postProcessRewards = (
  rewards: ObjectiveRewardType,
): PostProcessedRewards => {
  // Defensive check: ensure reward_items is an array (handles malformed DB data)
  const rewardItems = Array.isArray(rewards?.reward_items) ? rewards.reward_items : [];
  return {
    ...rewards,
    reward_items: rewardItems
      .filter((reward) => {
        // Use 'number' as drop chance (default 100 = guaranteed)
        const dropChance = reward.number ?? 100;
        return Math.random() * 100 < dropChance;
      })
      .flatMap((reward) => {
        // Use 'quantity' to repeat each item ID
        const qty = Math.max(1, Math.floor(reward.quantity ?? 1));
        // Defensive: handle malformed data where ids might be undefined
        const ids = Array.isArray(reward.ids) ? reward.ids : [];
        return ids.flatMap((id) => Array(qty).fill(id) as string[]);
      }),
  };
};

/**
 * Collapse multiple rewards into a single reward
 * @param rewards - Rewards to collapse
 * @returns Collapsed reward
 */
export const collapseRewards = (
  rewards: ObjectiveRewardType[],
): ObjectiveRewardType => {
  const collapsed: ObjectiveRewardType = {
    reward_money: 0,
    reward_seichi_silver: 0,
    reward_clanpoints: 0,
    reward_anbupoints: 0,
    reward_exp: 0,
    reward_tokens: 0,
    reward_prestige: 0,
    reward_reputation: 0,
    reward_skillpoints: 0,
    reward_medical_experience: 0,
    reward_hunting_experience: 0,
    reward_crafting_experience: 0,
    reward_gathering_experience: 0,
    reward_sage_mastery_experience: 0,
    reward_items: [],
    reward_jutsus: [],
    reward_bloodlines: [],
    reward_sage_modes: [],
    reward_badges: [],
    reward_rank: "NONE",
    reward_village_membership: "NONE",
    reward_hunter_items: false,
    reward_gathering_items: false,
    reward_hunter_items_ids: [],
    reward_gathering_items_ids: [],
    reward_war_damage: 0,
    reward_war_healing: 0,
  };

  rewards.forEach((reward) => {
    // Sum numeric rewards
    if (reward.reward_money) {
      collapsed.reward_money += reward.reward_money;
    }
    if (reward.reward_seichi_silver) {
      collapsed.reward_seichi_silver += reward.reward_seichi_silver;
    }
    if (reward.reward_clanpoints) {
      collapsed.reward_clanpoints += reward.reward_clanpoints;
    }
    if (reward.reward_anbupoints) {
      collapsed.reward_anbupoints += reward.reward_anbupoints;
    }
    if (reward.reward_exp) {
      collapsed.reward_exp += reward.reward_exp;
    }
    if (reward.reward_tokens) {
      collapsed.reward_tokens += reward.reward_tokens;
    }
    if (reward.reward_prestige) {
      collapsed.reward_prestige += reward.reward_prestige;
    }
    if (reward.reward_reputation) {
      collapsed.reward_reputation += reward.reward_reputation;
    }
    if (reward.reward_skillpoints) {
      collapsed.reward_skillpoints += reward.reward_skillpoints;
    }
    if (reward.reward_medical_experience) {
      collapsed.reward_medical_experience += reward.reward_medical_experience;
    }
    if (reward.reward_hunting_experience) {
      collapsed.reward_hunting_experience += reward.reward_hunting_experience;
    }
    if (reward.reward_crafting_experience) {
      collapsed.reward_crafting_experience += reward.reward_crafting_experience;
    }
    if (reward.reward_gathering_experience) {
      collapsed.reward_gathering_experience += reward.reward_gathering_experience;
    }
    for (const field of MASTERY_EXPERIENCE_FIELDS)
      if (reward[field])
        collapsed[field] = (collapsed[field] ?? 0) + (reward[field] ?? 0);
    if (
      reward.reward_mastery_stat &&
      reward.reward_mastery_stat !== "None" &&
      reward.reward_mastery_rank
    ) {
      collapsed.reward_mastery_stat = reward.reward_mastery_stat;
      collapsed.reward_mastery_rank = reward.reward_mastery_rank;
    }
    if (reward.reward_sage_mastery_experience) {
      collapsed.reward_sage_mastery_experience += reward.reward_sage_mastery_experience;
    }
    if (reward.reward_war_damage) {
      collapsed.reward_war_damage += reward.reward_war_damage;
    }
    if (reward.reward_war_healing) {
      collapsed.reward_war_healing += reward.reward_war_healing;
    }

    // Only set reward hunter items to true if any of the rewards have it
    if (reward.reward_hunter_items) {
      collapsed.reward_hunter_items = true;
    }

    // Only set reward gathering items to true if any of the rewards have it
    if (reward.reward_gathering_items) {
      collapsed.reward_gathering_items = true;
    }

    // Concatenate valid ids
    if (reward.reward_hunter_items_ids) {
      collapsed.reward_hunter_items_ids.push(...reward.reward_hunter_items_ids);
    }
    if (reward.reward_gathering_items_ids) {
      collapsed.reward_gathering_items_ids.push(...reward.reward_gathering_items_ids);
    }

    // Concatenate array rewards (nullish-guarded: legacy JSON rows from callers that
    // skip Zod normalization may predate a field, leaving it undefined)
    collapsed.reward_items.push(...(reward.reward_items ?? []));
    collapsed.reward_jutsus.push(...(reward.reward_jutsus ?? []));
    collapsed.reward_bloodlines.push(...(reward.reward_bloodlines ?? []));
    collapsed.reward_sage_modes.push(...(reward.reward_sage_modes ?? []));
    collapsed.reward_badges.push(...(reward.reward_badges ?? []));

    // Handle rank reward (take the highest rank)
    if (reward.reward_rank !== "NONE") {
      if (collapsed.reward_rank === "NONE") {
        collapsed.reward_rank = reward.reward_rank;
      } else {
        // Compare ranks and keep the higher one
        const rankOrder = ["NONE", "GENIN", "CHUNIN", "JONIN", "SANNIN", "KAGE"];
        const currentIndex = rankOrder.indexOf(collapsed.reward_rank);
        const newIndex = rankOrder.indexOf(reward.reward_rank);
        if (newIndex > currentIndex) {
          collapsed.reward_rank = reward.reward_rank;
        }
      }
    }

    // Handle village membership reward
    if (reward.reward_village_membership !== "NONE") {
      collapsed.reward_village_membership = reward.reward_village_membership;
    }
  });

  return collapsed;
};

export const GATHERING_CANCEL_PREFIX = "Gathering cancelled";

export type QuestConsequence = {
  type:
    | "add_item"
    | "remove_item"
    | "combat"
    | "random_encounter"
    | "fail_quest"
    | "start_quest"
    | "reset_quest"
    | "update_user";
  ids: string[];
  info?: string;
  scaleStats?: boolean;
  scaleGains?: number;
  forceKeepPools?: boolean;
};

/**
 * Battle context for gating "war-context" kill objectives. Supplied only from the combat path.
 */
export type CombatQuestContext = {
  inWarTornSector: boolean;
  isWarParticipant: boolean;
};

/**
 * Decide whether a war-context kill objective (`pvp_kills` / `defeat_opponents`) should advance
 * for a given quest type and battle context:
 * - `pvp` quests count only inside the war-torn sector.
 * - `war` quests count only active-war kills: a per-opponent `warFoe` flag when available (e.g.
 *   `defeat_opponents`), otherwise the battle-global war-participant flag (e.g. the `pvp_kills`
 *   counter, which is only emitted on a win).
 * - every other quest type counts anywhere.
 * Context is only passed from combat, so an absent context conservatively denies pvp/war
 * counting; non-combat callers never emit kill progress for these tasks.
 */
export const killObjectiveCountsForQuest = (
  questType: QuestType | undefined,
  context: CombatQuestContext | undefined,
  warFoe: boolean | undefined,
): boolean => {
  if (questType === "pvp") return context?.inWarTornSector === true;
  if (questType === "war") {
    return warFoe !== undefined ? warFoe : context?.isWarParticipant === true;
  }
  return true;
};

/**
 * True when a retryDelay != none quest already hit `maxCompletes` completions in the
 * current calendar period. retryDelay "none" is never capped. Invalid persisted content with a
 * real retry delay and maxCompletes <= 0 fails closed so it cannot silently become unlimited.
 */
export const periodCapReached = (
  args: {
    retryDelay: RetryQuestDelay;
    maxCompletes: number;
    periodCompletes?: number | null;
    periodStartAt?: Date | string | null;
  },
  now: Date = new Date(),
): boolean => {
  if (args.retryDelay === "none") return false;
  if (args.maxCompletes <= 0) return true;
  const cps = periodStart(args.retryDelay, now);
  const startedAt = args.periodStartAt ? new Date(args.periodStartAt) : null;
  // Counts from a prior period don't count toward this period.
  const effective = startedAt && startedAt >= cps ? (args.periodCompletes ?? 0) : 0;
  return effective >= args.maxCompletes;
};

/**
 * True when this quest was already attempted within the current attemptDelay period. attemptDelay
 * "none" or no prior attempt is never capped. Sibling of periodCapReached, but keyed off attempts
 * (every overworld roll) rather than completions.
 */
export const attemptCapReached = (
  args: { attemptDelay: RetryQuestDelay; lastAttemptAt?: Date | string | null },
  now: Date = new Date(),
): boolean => {
  if (args.attemptDelay === "none" || !args.lastAttemptAt) return false;
  return new Date(args.lastAttemptAt) >= periodStart(args.attemptDelay, now);
};

/**
 * For each content-gated task, the objective field holding its id-list (or, for
 * tag_usage_win, the single tagType value). The `satisfies` clause ties every entry to a
 * real key of that task's objective schema, so renaming a schema field without updating
 * this map is a compile error rather than a silently un-completable objective.
 */
const CONTENT_ID_FIELD = {
  craft_specific_item: "craftItemIds",
  train_specific_jutsu: "trainJutsuIds",
  complete_specific_quest: "completeQuestIds",
  buy_item: "buyItemIds",
  use_specific_item_combat: "useItemIds",
  use_specific_jutsu_combat: "useJutsuIds",
  tag_usage_win: "tagType",
} as const satisfies {
  [K in AllObjectiveTask]?: keyof Extract<AllObjectivesType, { task: K }>;
};

/**
 * Tasks whose progress is gated by a contentId that must match one of the objective's own
 * configured ids. Derived from CONTENT_ID_FIELD so the guard in getNewTrackers and the
 * matcher below can never disagree on which tasks are content-gated.
 */
const CONTENT_GATED_TASKS: Set<AllObjectiveTask> = new Set(
  Object.keys(CONTENT_ID_FIELD) as (keyof typeof CONTENT_ID_FIELD)[],
);

/**
 * Returns the content ids an objective matches against. For id-list tasks this is the array
 * field; for tag_usage_win it is the single tagType wrapped in an array.
 */
export const objectiveContentIds = (objective: AllObjectivesType): string[] => {
  const field = (CONTENT_ID_FIELD as Partial<Record<AllObjectiveTask, string>>)[
    objective.task
  ];
  if (!field) return [];
  const raw = (objective as Record<string, unknown>)[field];
  if (Array.isArray(raw)) {
    return raw.filter((v): v is string => typeof v === "string");
  }
  return typeof raw === "string" ? [raw] : [];
};

export type ObjectiveTrackerTaskInput = {
  task: AllObjectiveTask | "any";
  increment?: number;
  value?: number;
  text?: string;
  contentId?: string;
  /** Distinct jutsu disciplines captured when training starts or an action is performed. */
  masteryTypes?: MasteryType[];
  /** Opponent classification for combat-use filters, independent of the battle outcome. */
  combatType?: "PVP" | "PVE";
  warFoe?: boolean;
};

/**
 * Updates active quest trackers for emitted objective tasks and returns any resulting
 * notifications, consequences, and changed quest ids.
 *
 * @param user - Fully hydrated user whose active quest trackers are evaluated.
 * @param tasks - Objective events to apply; `any` re-evaluates passive objective state.
 * @param combatContext - Optional battle context used to gate PvP and war kill objectives.
 * @param boundPlacementStatus - Optional placement state keyed by id (`true` active, `false`
 * deactivated, absent deleted). Deleted bindings fail while deactivated bindings stay frozen.
 * @param atPlacementIds - Placement ids the user is authoritatively interacting with now.
 */
export const getNewTrackers = (
  user: NonNullable<UserWithRelations> & {
    useritems?: UserItem[];
    farmingCollectionCount?: number;
    bloodlineCollectionProgress?: BloodlineCollectionProgress;
  },
  tasks: ObjectiveTrackerTaskInput[],
  combatContext?: CombatQuestContext,
  boundPlacementStatus?: ReadonlyMap<string, boolean>,
  atPlacementIds?: ReadonlySet<string>,
) => {
  const questData = user.questData ?? [];
  const activeQuests = getUserQuests(user);
  const notifications: string[] = [];
  const questIdsUpdated: string[] = [];
  const consequences: QuestConsequence[] = [];
  const trackers = activeQuests
    .map((quest) => {
      if (quest) {
        const isInMemoryOnlyAchievement =
          quest.questType === "achievement" &&
          user.userQuests.some(
            (entry) => entry.questId === quest.id && isMockQuestHistoryRow(entry),
          ) &&
          !questData.some((tracker) => tracker.id === quest.id);
        // Get the quest tracker for this quest, or create it
        let questTracker = questData.find((q) => q.id === quest.id);
        if (!questTracker) {
          questTracker = QuestTracker.parse({ id: quest.id });
        }
        // Update the goals of the quest
        questTracker.goals = quest.content.objectives.map((objective, i) => {
          // Get the current goal, or create it
          let status = questTracker?.goals.find((goal) => goal.id === objective.id);
          if (!status) {
            status = ObjectiveTracker.parse({ id: objective.id });
          }

          // Self-healing: if a selectedNextObjectiveId is set, but this ID does not exist anymore, reset the objective
          if (
            status.selectedNextObjectiveId &&
            !quest.content.objectives.find(
              (o) => o.id === status.selectedNextObjectiveId,
            )
          ) {
            status.selectedNextObjectiveId = undefined;
            status.done = false;
          }

          // Older masked snapshots could persist the public placeholder as a real target.
          // Recover only those fields; valid rolls and completion/progress stay authoritative.
          const hasMaskedLocation =
            status.sector === 1337 ||
            status.longitude === 1337 ||
            status.latitude === 1337;
          if (hasMaskedLocation) {
            if (status.sector === 1337) {
              delete status.sector;
              if (!("sectorType" in objective) && "sector" in objective) {
                status.sector = objective.sector;
              }
            }
            if (status.longitude === 1337) {
              delete status.longitude;
              if (!("locationType" in objective) && "longitude" in objective) {
                status.longitude = objective.longitude;
              }
            }
            if (status.latitude === 1337) {
              delete status.latitude;
              if (!("locationType" in objective) && "latitude" in objective) {
                status.latitude = objective.latitude;
              }
            }
            delete status.locationChecked;
            consequences.push({ type: "update_user", ids: ["location_update"] });
          }

          if ("sectorType" in objective && status.sector === undefined) {
            if (objective.sectorType === "specific") {
              status.sector = objective.sector;
            } else if (objective.sectorType === "random") {
              status.sector = pickPlaceableSector();
            } else if (objective.sectorType === "from_list") {
              if (objective.sectorList.length === 0) {
                status.sector = pickPlaceableSector();
              } else {
                const idx = Math.floor(Math.random() * objective.sectorList.length);
                status.sector = Number(objective.sectorList?.[idx]);
              }
            } else if (objective.sectorType === "user_village") {
              status.sector = user?.village?.sector || user.sector;
            } else if (objective.sectorType === "current_sector") {
              status.sector = user.sector;
            } else if (objective.sectorType === "enemy_village") {
              // Find enemy village from active wars
              const userVillageId = user.villageId;
              const activeWars = user.activeWars ?? [];

              // Find an active war and get the enemy village sector
              for (const w of activeWars) {
                // Check if user is direct participant
                if (w.attackerVillageId === userVillageId) {
                  status.sector = w.defenderVillage.sector;
                  break;
                } else if (w.defenderVillageId === userVillageId) {
                  status.sector = w.attackerVillage.sector;
                  break;
                }

                // Check if user is an ally - find which side they support
                const allyEntry = w.warAllies?.find(
                  (a) => a.villageId === userVillageId,
                );
                if (allyEntry) {
                  // supportVillageId is the village the user's village is supporting
                  // If supporting attacker, enemy is defender. If supporting defender, enemy is attacker.
                  if (allyEntry.supportVillageId === w.attackerVillageId) {
                    status.sector = w.defenderVillage.sector;
                  } else {
                    status.sector = w.attackerVillage.sector;
                  }
                  break;
                }
              }

              // Fallback to random sector if no war found
              if (status.sector === undefined) {
                status.sector = pickPlaceableSector();
              }
            }
            if (status.sector !== undefined) {
              consequences.push({ type: "update_user", ids: ["location_update"] });
            }
          }

          // If locationType is not specific, update the location accordingly
          if (
            "locationType" in objective &&
            (status.longitude === undefined || status.latitude === undefined)
          ) {
            if (objective.locationType === "specific") {
              status.longitude = objective.longitude;
              status.latitude = objective.latitude;
            } else if (objective.locationType === "random") {
              status.longitude = Math.ceil(Math.random() * (SECTOR_WIDTH - 1));
              status.latitude = Math.ceil(Math.random() * (SECTOR_HEIGHT - 1));
            }
            if (status.longitude !== undefined && status.latitude !== undefined) {
              consequences.push({ type: "update_user", ids: ["location_update"] });
            }
          }

          // If a dialog, find any previous objective pointing to this one, and set the location to the same location
          const previousObjective = findCompletedPredecessor(
            quest.content.objectives,
            objective.id,
            questTracker,
          );

          if (previousObjective) {
            if (status.sector === undefined && "sector" in previousObjective) {
              status.sector = previousObjective.sector;
              consequences.push({ type: "update_user", ids: [`sector_update`] });
            }
            if (status.longitude === undefined && "longitude" in previousObjective) {
              status.longitude = previousObjective.longitude;
              consequences.push({ type: "update_user", ids: [`longitude_update`] });
            }
            if (status.latitude === undefined && "latitude" in previousObjective) {
              status.latitude = previousObjective.latitude;
              consequences.push({ type: "update_user", ids: [`latitude_update`] });
            }
          }

          // If we have a location on the status (i.e. instantiated for the user, overwrite objective)
          if ("sector" in objective) {
            if (status.longitude !== undefined) objective.longitude = status.longitude;
            if (status.latitude !== undefined) objective.latitude = status.latitude;
            if (status.sector !== undefined) objective.sector = status.sector;
            if ("locationType" in objective) {
              objective.locationType = "specific";
            }
          }

          // If done, return status
          if (status.done) {
            return status;
          }

          // If not available yet, just skip. This must run before the bound-placement
          // check below: for a consecutiveObjectives quest, an objective the player has
          // not reached yet must not fail (or freeze) the quest just because an admin
          // deleted or deactivated its bound placement — the player never got there.
          if (questTracker && !isQuestObjectiveAvailable(quest, questTracker, i)) {
            return status;
          }

          // Missing map entry means deleted; false means present but deactivated; true means active.
          // Omitting the map preserves the pre-overworld behavior for callers that do not load it.
          const boundPlacementId = objective.overworldPlacementId;
          if (
            boundPlacementStatus &&
            boundPlacementId &&
            isSupportedOverworldBindingTask(objective.task)
          ) {
            if (!boundPlacementStatus.has(boundPlacementId)) {
              // Placement was hard-deleted → auto-fail the objective.
              if ("failObjectiveId" in objective && objective.failObjectiveId) {
                status.selectedNextObjectiveId = objective.failObjectiveId;
              } else {
                consequences.push({ type: "fail_quest", ids: [quest.id] });
              }
              status.done = true;
              notifications.push(
                `An objective for "${quest.name}" could not be completed because its destination was removed.`,
              );
              questIdsUpdated.push(quest.id);
              return status;
            }
            if (!boundPlacementStatus.get(boundPlacementId)) {
              // Placement exists but is deactivated → freeze: skip without failing.
              return status;
            }
            // else: placement is active → fall through to normal matching.
          }

          // Convenience
          const task = objective.task;
          // Kill objectives whose counting is gated by battle context per quest type
          const isWarContextKillTask =
            task === "pvp_kills" || task === "defeat_opponents";
          const isKage = user.village?.kageId === user.userId;

          // General updates we want to apply every time
          if (objective.task === "bloodline_collection") {
            const progress = user.bloodlineCollectionProgress?.find(
              (entry) => entry.rank === objective.bloodlineRank,
            );
            if (progress) {
              const isComplete =
                progress.total > 0 && progress.collected === progress.total;
              if (
                (isComplete || !isInMemoryOnlyAchievement) &&
                (status.value !== progress.collected ||
                  status.target !== progress.total ||
                  status.done !== isComplete)
              ) {
                consequences.push({
                  type: "update_user",
                  ids: ["bloodline_collection_update"],
                });
              }
              status.value = progress.collected;
              status.target = progress.total;
              // An empty catalogue cannot award a collection achievement. Done goals are
              // retained above, so catalogue growth never revokes a recorded completion.
              status.done = isComplete;
            }
          } else if (task === "user_level") {
            // Use originalLevel if available (for combat-scaled users), otherwise use current level
            const userLevel =
              "originalLevel" in user && typeof user.originalLevel === "number"
                ? user.originalLevel
                : (user.level ?? 1);
            status.value = userLevel;
          } else if (task === "farming_level") {
            status.value = getFarmingLevel(user.farmingExperience);
          } else if (
            task === "farming_collection_log" &&
            typeof user.farmingCollectionCount === "number"
          ) {
            status.value = user.farmingCollectionCount;
          } else if (task === "days_in_village") {
            const days = Math.floor(secondsPassed(user.joinedVillageAt) / 60 / 60 / 24);
            status.value = days;
          } else if (task === "days_as_kage" && isKage && user.village) {
            const seconds = secondsPassed(user.village.leaderUpdatedAt);
            const days = Math.floor(seconds / 60 / 60 / 24);
            status.value = days;
          } else if (task === "reputation_points") {
            status.value = user.reputationPointsTotal;
          } else if (task === "minutes_passed" && questTracker) {
            const minutes = Math.floor(
              secondsPassed(new Date(questTracker.startAt)) / 60,
            );
            status.value = minutes;
          } else if (task.includes("missions_total") || task.includes("crimes_total")) {
            const type = task.includes("missions") ? "mission" : "crime";
            const rank = task.split("_")[0]?.toUpperCase() as LetterRank;
            const field = getQuestCounterFieldName(type, rank);
            if (field) status.value = user[field];
          } else if (task === "errands_total") {
            const field = getQuestCounterFieldName("errand", "D");
            if (field) status.value = user[field];
          } else if (task === "medical_experience") {
            status.value = user.medicalExperience;
          } else if (task === "crafting_experience") {
            status.value = user.craftingExperience;
          } else if (task === "hunting_experience") {
            status.value = user.huntingExperience;
          } else if (task === "gathering_experience") {
            status.value = user.gatheringExperience;
          }

          // If opponentAIs is in objective, get the ids
          let opponentIds: string[] = [];
          if ("opponentAIs" in objective) {
            opponentIds = objective.opponentAIs
              .flatMap((o) => Array(o.number).fill(o.ids).flat() as string[])
              .filter((id): id is string => id !== undefined);
          }

          /** Helper function to put the user in combat */
          const putInCombat = () => {
            if (
              opponentIds.length > 0 &&
              "opponentAIs" in objective &&
              user.status === "AWAKE"
            ) {
              notifications.push(
                `Attacking ${opponentIds.length} target${opponentIds.length > 1 ? "s" : ""} for ${quest.name}.`,
              );
              consequences.push({
                type: "combat",
                ids: opponentIds,
                scaleStats: objective.opponent_scaled_to_user,
                scaleGains: objective.scaleGains,
                forceKeepPools: objective.keepOriginalPools ?? false,
              });
            }
          };

          // Instant objectives
          if (task === "win_quest") {
            status.done = true;
          } else if (task === "reset_quest") {
            consequences.push({
              type: "reset_quest",
              ids: [quest.id],
              info: objective.resetObjectiveId,
            });
          } else if (task === "fail_quest") {
            consequences.push({ type: "fail_quest", ids: [quest.id] });
            notifications.push(objective.description || `Failed: ${quest.name}`);
          } else if (task === "new_quest" && "newQuestIds" in objective) {
            status.done = true;
            consequences.push({ type: "start_quest", ids: objective.newQuestIds });
          } else if (task === "start_battle") {
            if (!status.recentlyDied) {
              putInCombat();
            }
          }

          // Specific updates requested by the caller
          tasks
            .filter(
              (taskUpdate) => taskUpdate.task === task || taskUpdate.task === "any",
            )
            .forEach((taskUpdate) => {
              // War-context kill objectives only advance in their required context (pvp →
              // war-torn sector; war → active-war kill). All other tasks always count.
              // `defeat_opponents` is per-opponent, so a missing `warFoe` must deny rather than
              // fall back to the battle-global flag (which would credit a non-war target in a
              // mixed war battle); `pvp_kills` keeps the battle-global fallback by design.
              const taskWarFoe =
                task === "defeat_opponents"
                  ? (taskUpdate.warFoe ?? false)
                  : taskUpdate.warFoe;
              const killCounts =
                !isWarContextKillTask ||
                killObjectiveCountsForQuest(quest.questType, combatContext, taskWarFoe);
              // Generic counter objectives: increment/set on task-name match. Requires an exact
              // `taskUpdate.task === task` (not the `"any"` re-evaluation trigger, which carries
              // no increment/value) so a future `"any"` update can't inflate counters. Content-
              // gated (specific-X + tag_usage_win) and damage_dealt tasks own the gated branches
              // below and must NOT also run this path, or they would double-count.
              if (
                status &&
                "value" in objective &&
                taskUpdate.task === task &&
                !CONTENT_GATED_TASKS.has(task) &&
                task !== "damage_dealt"
              ) {
                if (taskUpdate.increment && killCounts) {
                  status.value += taskUpdate.increment;
                }
                if (taskUpdate.value !== undefined && killCounts) {
                  status.value = taskUpdate.value;
                }
              }
              // Content objectives use their ID filter and, for jutsu, optional discipline
              // and combat filters. The matcher rejects unconfigured and "any" events.
              if (
                status &&
                "value" in objective &&
                CONTENT_GATED_TASKS.has(task) &&
                matchesContentObjective(objective, taskUpdate) &&
                // A quest can never satisfy its own complete_specific_quest objective: the
                // resolving quest is still active in getUserQuests when getReward emits this
                // (its `completed` flag flips later in checkRewards), so guard the self-tick.
                !(
                  task === "complete_specific_quest" &&
                  quest.id === taskUpdate.contentId
                )
              ) {
                status.value += taskUpdate.increment ?? 1;
              }
              // Damage dealt: cumulative across the quest, or single-battle max when toggled.
              // Requires an exact `taskUpdate.task === "damage_dealt"` (not the `"any"` re-
              // evaluation trigger) so a future `"any"` update carrying an increment can't
              // inflate progress toward the damage threshold. The stored counter is not reset
              // when a designer flips singleBattle on a live quest, so an accumulated sum would
              // be re-read as a single-battle max (and vice versa) — content edits that flip the
              // flag must ship with a user-tracker reset.
              if (
                status &&
                task === "damage_dealt" &&
                taskUpdate.task === "damage_dealt" &&
                "value" in objective
              ) {
                const dealt = taskUpdate.increment ?? 0;
                if ("singleBattle" in objective && objective.singleBattle) {
                  status.value = Math.max(status.value, dealt);
                } else {
                  status.value += dealt;
                }
              }
              // Dialog objective
              if (
                task === "dialog" &&
                taskUpdate.contentId &&
                // A placement-bound dialog can only advance through the authoritative NPC
                // interaction path. This blocks direct Logbook/API completion from anywhere.
                (!objective.overworldPlacementId ||
                  isObjectiveLocationSatisfied(user, objective, atPlacementIds))
              ) {
                // A terminal branch carries no follow-up objective, so the client sends an
                // objective-scoped sentinel (prefix + this objective's id) instead of a next id.
                // Complete this objective without routing onward — but only if it genuinely owns
                // a terminal branch, so a spoofed sentinel can't finish an arbitrary dialog
                // objective (parity with the routing branch, which requires a matching branch id).
                const isTerminalForThis =
                  taskUpdate.contentId === `${TERMINAL_DIALOG_PREFIX}${objective.id}` &&
                  objective.nextObjectiveId?.some(
                    (next) => next.nextObjectiveId === undefined,
                  );
                if (isTerminalForThis) {
                  status.done = true;
                } else {
                  const objectiveHasNext = objective.nextObjectiveId?.find(
                    (next) => next.nextObjectiveId === taskUpdate.contentId,
                  );
                  if (objectiveHasNext) {
                    status.done = true;
                    status.selectedNextObjectiveId = taskUpdate.contentId;
                  }
                }
              } else if (
                quest.consecutiveObjectives &&
                "nextObjectiveId" in objective &&
                typeof objective.nextObjectiveId === "string" &&
                !status.selectedNextObjectiveId
              ) {
                status.selectedNextObjectiveId = objective.nextObjectiveId;
              }

              // If objective has a location (sector & longitude/latitude), set to completed.
              // A placement-bound objective is also satisfied when the player is interacting
              // with that placement (atPlacementIds), since the placement is authoritative
              // over the objective's stored coordinates.
              if (
                status &&
                isObjectiveLocationSatisfied(user, objective, atPlacementIds)
              ) {
                if (task === "move_to_location") {
                  notifications.push(`You arrived at destination for ${quest.name}.`);
                  status.done = true;
                } else if (
                  task === "collect_item" &&
                  "item_name" in objective &&
                  "collectItemIds" in objective &&
                  objective.collectItemIds
                ) {
                  let doCollect = true;
                  if (
                    "collect_time_minutes" in objective &&
                    objective.collect_time_minutes
                  ) {
                    if ("timestamp" in status && status.timestamp) {
                      // Unfloored so the guard is exactly `elapsed >= deadline`, the same
                      // moment the client Countdown fires onFinish and calls checkRewards.
                      const minutesPassed =
                        secondsPassed(new Date(status.timestamp), undefined, false) /
                        60;
                      if (minutesPassed < objective.collect_time_minutes) {
                        doCollect = false;
                      }
                    } else {
                      notifications.push(
                        `You started collecting. This will take ${objective.collect_time_minutes} minutes.`,
                      );
                      status.timestamp = new Date().toISOString();
                      doCollect = false;
                    }
                  }
                  if (doCollect) {
                    consequences.push({
                      type: "add_item",
                      ids: objective.collectItemIds,
                    });
                    status.done = true;
                  } else {
                    questIdsUpdated.push(quest.id);
                  }
                } else if (
                  task === "deliver_item" &&
                  "item_name" in objective &&
                  "deliverItemIds" in objective &&
                  objective.deliverItemIds
                ) {
                  // Verify user has these items
                  const check = objective.deliverItemIds.every((id) =>
                    user.useritems?.some((ui) => ui.itemId === id),
                  );
                  if (!check) {
                    notifications.push(
                      `You don't have ${objective.item_name} to deliver for ${quest.name}.`,
                    );
                    return;
                  }
                  // Remove items & complete objective
                  notifications.push(
                    `Delivered ${objective.item_name} for ${quest.name}.`,
                  );
                  consequences.push({
                    type: "remove_item",
                    ids: objective.deliverItemIds,
                  });
                  status.done = true;
                } else if (task === "defeat_opponents" && opponentIds.length > 0) {
                  if (!opponentIds.includes(taskUpdate.contentId || "1337")) {
                    putInCombat();
                  }
                }
              }

              // If user has a pending collect timer but left the location, reset the timer
              else if (
                task === "collect_item" &&
                "collect_time_minutes" in objective &&
                objective.collect_time_minutes &&
                status?.timestamp &&
                !status.done
              ) {
                status.timestamp = undefined;
                notifications.push(
                  `${GATHERING_CANCEL_PREFIX} for ${quest.name}: you left the collection area.`,
                );
              }

              // If we're at a win_encounter_at_location objective, set to completed if we won
              else if (task === "win_encounter_at_location") {
                if (taskUpdate.text === "Won" && user.sector === objective.sector) {
                  status.done = true;
                }
              }

              // Defeating specific opponents
              if (
                status &&
                ["start_battle", "defeat_opponents"].includes(task) &&
                "opponentAIs" in objective &&
                opponentIds.length > 0
              ) {
                if (
                  killCounts &&
                  taskUpdate.text &&
                  opponentIds.includes(taskUpdate.contentId || "1337")
                ) {
                  const completionOutcome = objective.completionOutcome || "Win";
                  if (completionOutcome === "Any") {
                    status.done = true;
                  }
                  if (taskUpdate.text === "Won") {
                    if (objective.successDescription) {
                      notifications.push(objective.successDescription);
                    }
                    if (completionOutcome === "Win") {
                      status.done = true;
                    }
                  } else if (taskUpdate.text === "Lost") {
                    if (objective.failDescription) {
                      notifications.push(objective.failDescription);
                    }
                    if (completionOutcome === "Lose") {
                      status.done = true;
                    }
                    if (task === "start_battle") {
                      status.recentlyDied = true;
                    }
                  } else if (taskUpdate.text === "Draw") {
                    if (objective.drawDescription) {
                      notifications.push(objective.drawDescription);
                    }
                    if (completionOutcome === "Draw") {
                      status.done = true;
                    }
                  } else if (taskUpdate.text === "Fled") {
                    if (objective.fleeDescription) {
                      notifications.push(objective.fleeDescription);
                    }
                    if (completionOutcome === "Flee") {
                      status.done = true;
                    }
                  }
                  if (
                    !status.done &&
                    "failObjectiveId" in objective &&
                    objective.failObjectiveId
                  ) {
                    status.selectedNextObjectiveId = objective.failObjectiveId;
                    status.done = true;
                  }
                }
              }

              // Handle manual retriggering of start_battle objectives
              if (task === "start_battle" && taskUpdate.text === "retry") {
                status.recentlyDied = false;
                putInCombat();
                return;
              }
            });
          if ("value" in objective && status.value >= objective.value) {
            status.done = true;
          }

          // If status is now done, then add quest id to list of updated quests
          if (status.done) {
            questIdsUpdated.push(quest.id);
          }
          return status;
        });
        return questTracker;
      }
      return undefined;
    })
    .filter((q): q is QuestTrackerType => !!q);

  return {
    trackers: getUnique(trackers, "id"),
    notifications,
    consequences,
    questIdsUpdated,
  };
};

// Type returned by getNewTrackers
export type GetNewTrackersResult = Awaited<ReturnType<typeof getNewTrackers>>;

/**
 * Unfinished goals of active quests that carry a concrete map location which has not yet been
 * checked against the published sector map. Placement-bound objectives are skipped because the
 * overworld placement, not the stored coordinate, decides where they resolve.
 */
const getUncheckedLocatedGoals = (
  user: NonNullable<UserWithRelations>,
  trackers: QuestTrackerType[],
) => {
  const located: { goal: ObjectiveTrackerType; objective: AllObjectivesType }[] = [];
  for (const quest of getUserQuests(user)) {
    const tracker = trackers.find((t) => t.id === quest.id);
    if (!tracker) continue;
    for (const goal of tracker.goals) {
      if (goal.done || goal.locationChecked) continue;
      if (
        goal.sector === undefined ||
        goal.longitude === undefined ||
        goal.latitude === undefined
      ) {
        continue;
      }
      const objective = quest.content.objectives.find((o) => o.id === goal.id);
      if (!objective) continue;
      if (
        "overworldPlacementId" in objective &&
        objective.overworldPlacementId &&
        isSupportedOverworldBindingTask(objective.task)
      ) {
        continue;
      }
      located.push({ goal, objective });
    }
  }
  return located;
};

/** Sectors whose published maps are needed by {@link snapQuestTargetsToReachable}. */
export const getUncheckedQuestTargetSectors = (
  user: NonNullable<UserWithRelations>,
  trackers: QuestTrackerType[],
) => [
  ...new Set(
    getUncheckedLocatedGoals(user, trackers).map(({ goal }) => goal.sector as number),
  ),
];

/**
 * Moves every unchecked quest target onto the nearest tile a player can walk to in its sector
 * and marks it checked, so random rolls, village-relative coordinates and admin-placed points
 * that land on water or obstacles stay completable. Mutates the trackers and the active
 * quests' objectives in place, mirroring how getNewTrackers instantiates locations.
 *
 * @returns whether any tracker changed and must be persisted.
 */
export const snapQuestTargetsToReachable = (
  user: NonNullable<UserWithRelations>,
  trackers: QuestTrackerType[],
  maps: ReadonlyMap<
    number,
    Pick<NormalizedSectorMap, "width" | "height" | "tiles" | "anchors">
  >,
) => {
  let changed = false;
  for (const { goal, objective } of getUncheckedLocatedGoals(user, trackers)) {
    // Without a published map (or any walkable tile) the goal stays unchecked so it is
    // re-evaluated once the sector has a usable map.
    const map = maps.get(goal.sector as number);
    const reachable = map
      ? findNearestReachableCoordinate(map, {
          x: goal.longitude as number,
          y: goal.latitude as number,
        })
      : null;
    if (!reachable) continue;
    goal.longitude = reachable.x;
    goal.latitude = reachable.y;
    if ("sector" in objective) {
      objective.longitude = reachable.x;
      objective.latitude = reachable.y;
    }
    goal.locationChecked = true;
    changed = true;
  }
  return changed;
};

// Combine two tracker results into one
export const combineTrackerResults = (
  a: GetNewTrackersResult,
  b?: GetNewTrackersResult | null,
) => {
  return {
    trackers: [...a.trackers, ...(b?.trackers ?? [])],
    notifications: [...a.notifications, ...(b?.notifications ?? [])],
    consequences: [...a.consequences, ...(b?.consequences ?? [])],
    questIdsUpdated: [...a.questIdsUpdated, ...(b?.questIdsUpdated ?? [])],
  };
};

export const getMissionHallSettings = (isOutlaw: boolean) => {
  const type = isOutlaw ? "crime" : "mission";
  return [
    {
      type: "errand",
      rank: "D",
      name: "Errand",
      image: IMG_MISSION_E,
      delayMinutes: 1,
      description: `Errands typically involve simple tasks such as fetching an item somewhere in the village, delivering groceries, etc.`,
    },
    {
      type: type,
      rank: "D",
      name: "D-rank",
      image: IMG_MISSION_D,
      delayMinutes: 5,
      description: `D-rank ${type}s are the lowest rank of ${type}s. They are usually simple ${type}s that have a low chance of danger, finding & retrieving items, doing manual labor, or fetching a lost cat`,
    },
    {
      type: type,
      rank: "C",
      name: "C-rank",
      image: IMG_MISSION_C,
      delayMinutes: 10,
      description: `C-rank ${type}s are the second lowest rank of ${type}s. They are usually ${type}s that have a chance of danger, e.g. escorting a client through friendly territory, etc.`,
    },
    {
      type: type,
      rank: "B",
      name: "B-rank",
      image: IMG_MISSION_B,
      delayMinutes: 15,
      description: `B-rank ${type}s are the third highest rank of ${type}s. They are usually ${type}s that have a decent chance of danger, e.g. escorting a client through neutral or enemy territory.`,
    },
    {
      type: type,
      rank: "A",
      name: "A-rank",
      image: IMG_MISSION_A,
      delayMinutes: 20,
      description: `A-rank ${type}s are the second highest rank of ${type}s. They usually have a high chance of danger and are considered to be very difficult, e.g. assassinating a target, etc.`,
    },
    {
      type: type,
      rank: "S",
      name: "S-rank",
      image: IMG_MISSION_S,
      delayMinutes: 25,
      description: `S-rank ${type}s are the highest rank of ${type}s. They are usually extremely dangerous and difficult and reserved for kage-level shinobi.`,
    },
    {
      type: "medical",
      rank: "D",
      name: "Medical",
      image: IMG_MISSION_M,
      delayMinutes: 5,
      description: `Medical quests are specialized missions for medical ninja. These quests focus on healing, medical research, and providing medical assistance to the village.`,
    },
    {
      type: "pvp",
      rank: "S",
      name: "PvP",
      image: IMG_MISSION_PVP,
      delayMinutes: 0,
      description: `PvP missions involve combat against other players. Test your skills in player versus player battles.`,
    },
  ] as const;
};

export const mockAchievementHistoryEntries = (
  achievements: Quest[],
  user: NonNullable<UserWithRelations>,
) => {
  return achievements
    .filter((q) => q !== null)
    .filter((q) => !q.hidden || canChangeContent(user.role))
    .filter((q) => !user.userQuests?.find((uq) => uq.questId === q.id))
    .map((a) => ({
      id: a.id,
      userId: user.userId,
      questId: a.id,
      questType: a.questType,
      completed: 0,
      previousCompletes: 0,
      previousAttempts: 0,
      periodCompletes: 0,
      periodStartAt: null,
      pendingRewardChoice: null,
      quest: a,
      endAt: null,
      startedAt: new Date(),
      /** `id` is the quest id here (placeholder); real `QuestHistory.id` is a nanoid ≠ `questId`. */
    }));
};

/**
 * Whether any of a quest's objectives is something the overworld has to draw or act on: a map
 * location, an ambush, a bound NPC placement, or a dialog. The sector view, the world map and
 * `getActiveObjectives` scan `userQuests[].quest.content.objectives` for exactly these.
 *
 * Achievements are lifetime counters and normally carry none of it, which is what lets
 * `quests.getAchievementCatalogue` publish them for the client to cache instead of `getUser`
 * re-sending them. An authored exception is withheld from the catalogue and keeps travelling on
 * the user object, so the overworld still sees it.
 *
 * A stored coordinate counts even when it is zero. Sector 0 is a real sector
 * (`MAP_SECTOR_ID_MIN`) and (0, 0) is a real tile, so the test is whether the objective carries
 * the field at all - a counter objective has no coordinate keys whatsoever. `attackers` and
 * `opponentAIs` are the other way round: nearly every objective serialises them as empty arrays,
 * so only a populated one means anything.
 */
export const questHasOverworldObjectives = (quest: Quest) =>
  quest.content.objectives.some(
    (objective) =>
      "sector" in objective ||
      "longitude" in objective ||
      "latitude" in objective ||
      "hideLocation" in objective ||
      ("overworldPlacementId" in objective && !!objective.overworldPlacementId) ||
      ("attackers" in objective && (objective.attackers?.length ?? 0) > 0) ||
      ("opponentAIs" in objective && (objective.opponentAIs?.length ?? 0) > 0) ||
      objective.task === "dialog",
  );

/** Projects private quest state for client responses without changing server-owned trackers. */
export const getPublicQuestUser = <T extends NonNullable<UserWithRelations>>(
  user: T,
): T => {
  const responseUser = {
    ...user,
    userQuests: structuredClone(user.userQuests),
    questData: structuredClone(user.questData),
  };
  responseUser.userQuests.forEach((entry) => {
    controlShownQuestLocationInformation(entry.quest, responseUser);
  });
  return responseUser;
};

/**
 * Hides the location information of quest objectives if certain conditions are met.
 *
 * @param quest - The quest object containing objectives.
 * @param user - Optional user data to check against objective sectors.
 *
 * This function iterates over each objective in the quest's content. If an objective has the
 * `hideLocation` property set to true and the user's sector does not match the objective's sector,
 * it will obfuscate the objective's location by setting its latitude, longitude, and sector to 1337.
 */
export const controlShownQuestLocationInformation = (
  quest?: Quest,
  user?: UserData,
) => {
  const tracker = user?.questData?.find((q) => q.id === quest?.id);
  quest?.content.objectives.forEach((objective) => {
    // If we have a tracker which specifies the location, use that (e.g. from random sectors etc)
    const status = tracker?.goals.find((goal) => goal.id === objective.id);
    if (tracker && status) {
      if ("sector" in status) {
        objective.sector = status.sector;
      }
      if ("longitude" in status && status.longitude !== undefined) {
        objective.longitude = status.longitude;
      }
      if ("latitude" in status && status.latitude !== undefined) {
        objective.latitude = status.latitude;
      }
    }

    // If we should hide the location, hide it when the user is not in the sector
    if (
      "hideLocation" in objective &&
      objective.hideLocation &&
      user?.sector !== objective.sector &&
      !canChangeContent(user?.role || "USER")
    ) {
      if (status) {
        delete status.sector;
        delete status.longitude;
        delete status.latitude;
      }
      objective.latitude = 1337;
      objective.longitude = 1337;
      objective.sector = 1337;
      objective.sectorType = "specific";
      objective.sectorList = ["1337"];
      objective.locationType = "specific";
    }
  });
};

/**
 * Checks whether a quest is currently available to a user, including sage mode
 * (`requiredSageModeId`) and minimum sage mastery rank (`requiredSageRank`).
 *
 * @param questAndUserQuestInfo - The quest object to be checked.
 * @param user - User whose permissions, progression, and completed prerequisites are checked.
 * @param ignorePreviousAttempts - Whether to ignore the lifetime attempt cap.
 * @returns The combined availability decision and user-facing reasons for failed checks.
 */
export const isAvailableUserQuests = (
  questAndUserQuestInfo: MasteryRequirementFields & {
    content?: Pick<QuestContentType, "reward">;
    hidden: boolean;
    maxAttempts: number;
    maxCompletes: number;
    questType: QuestType;
    startsAt?: string | null;
    endsAt?: string | null;
    requiredVillage: string | null;
    requiredBloodlineId?: string | null;
    requiredSageModeId?: string | null;
    requiredSageRank?: SAGE_MASTERY_RANK | null;
    prerequisiteQuestId?: string | null;
    previousAttempts?: number | null;
    previousCompletes?: number | null;
    completed?: number | null;
    retryDelay: RetryQuestDelay;
    periodCompletes?: number | null;
    periodStartAt?: Date | string | null;
    medicalRank?: MEDNIN_RANK | null;
    huntingRank?: HUNTING_RANK | null;
    gatheringRank?: GATHERING_RANK | null;
    requiredLevel?: number | null;
    requiredFarmingLevel?: number | null;
    maxLevel?: number | null;
  },
  user: UserData & {
    completedQuests: { id: string; questId: string; completed?: number }[];
  },
  ignorePreviousAttempts = false,
) => {
  // Derived Data
  const maxAttempts = questAndUserQuestInfo.maxAttempts;
  const maxCompletes = questAndUserQuestInfo.maxCompletes;
  const questMedRank = questAndUserQuestInfo.medicalRank;
  const userMedRank = calcMedninRank({
    medicalExperience: user.medicalExperience,
    rank: user.rank,
  });
  const reqMedRankIdx = questMedRank ? MEDNIN_RANKS.indexOf(questMedRank) : null;
  const userMedRankIdx = MEDNIN_RANKS.indexOf(userMedRank);
  const questHuntRank = questAndUserQuestInfo.huntingRank;
  const userHuntRank = getHuntingRank(user.huntingExperience);
  const reqHuntRankIdx = questHuntRank ? HUNTING_RANKS.indexOf(questHuntRank) : null;
  const userHuntRankIdx = HUNTING_RANKS.indexOf(userHuntRank);
  const questGatherRank = questAndUserQuestInfo.gatheringRank;
  const userGatherRank = getGatheringRank(user.gatheringExperience);
  const reqGatherRankIdx = questGatherRank
    ? GATHERING_RANKS.indexOf(questGatherRank)
    : null;
  const userGatherRankIdx = GATHERING_RANKS.indexOf(userGatherRank);

  // Exams read stored mastery only; temporary combat and equipment modifiers cannot qualify.
  const baseMasteries = {
    ...user,
    ...("baseStatsForModifiers" in user
      ? (user.baseStatsForModifiers as Partial<UserData>)
      : {}),
  };
  const masteryCheck = MASTERY_REQUIREMENT_FIELDS.every(
    ([field, stat]) =>
      !questAndUserQuestInfo[field] ||
      (baseMasteries[stat] ?? 0) >= (questAndUserQuestInfo[field] ?? 0),
  );
  const promotion = questAndUserQuestInfo.content?.reward;
  const promotionCheck =
    !promotion?.reward_mastery_stat ||
    promotion.reward_mastery_stat === "None" ||
    !promotion.reward_mastery_rank ||
    promotion.reward_mastery_rank === "NONE" ||
    canPromoteMastery(
      baseMasteries,
      promotion.reward_mastery_stat,
      promotion.reward_mastery_rank,
    );
  // Checks
  const now = new Date();
  const hideCheck = !questAndUserQuestInfo.hidden || canPlayHiddenQuests(user.role);
  const startsCheck =
    !questAndUserQuestInfo.startsAt || new Date(questAndUserQuestInfo.startsAt) <= now;
  const expiresCheck =
    !questAndUserQuestInfo.endsAt || new Date(questAndUserQuestInfo.endsAt) > now;
  const villageCheck =
    !questAndUserQuestInfo.requiredVillage ||
    questAndUserQuestInfo.requiredVillage === user.villageId ||
    (questAndUserQuestInfo.requiredVillage === VILLAGE_SYNDICATE_ID && user.isOutlaw);
  const bloodlineCheck =
    !questAndUserQuestInfo.requiredBloodlineId ||
    questAndUserQuestInfo.requiredBloodlineId === user.bloodlineId;
  const sageModeCheck =
    !questAndUserQuestInfo.requiredSageModeId ||
    questAndUserQuestInfo.requiredSageModeId === user.sageModeId;
  const sageRankCheck =
    !questAndUserQuestInfo.requiredSageRank ||
    isSageRankAtLeast(
      getSageMasteryDisplayRank(user.sageMasteryExperience, !!user.sageModeId),
      questAndUserQuestInfo.requiredSageRank,
    );

  // Medical rank check for quests that require it
  const medicalRankCheck = !reqMedRankIdx || userMedRankIdx >= reqMedRankIdx;
  const huntingRankCheck = !reqHuntRankIdx || userHuntRankIdx >= reqHuntRankIdx;
  const gatheringRankCheck = !reqGatherRankIdx || userGatherRankIdx >= reqGatherRankIdx;
  const farmingLevelCheck =
    questAndUserQuestInfo.questType === "daily" ||
    !questAndUserQuestInfo.requiredFarmingLevel ||
    getFarmingLevel(user.farmingExperience) >=
      questAndUserQuestInfo.requiredFarmingLevel;

  // Level check - user must be >= requiredLevel and <= maxLevel
  // Use originalLevel if available (for combat-scaled users), otherwise use current level
  const userLevel =
    "originalLevel" in user && typeof user.originalLevel === "number"
      ? user.originalLevel
      : (user.level ?? 1);
  const levelCheck =
    (!questAndUserQuestInfo.requiredLevel ||
      userLevel >= questAndUserQuestInfo.requiredLevel) &&
    (!questAndUserQuestInfo.maxLevel || userLevel <= questAndUserQuestInfo.maxLevel);

  // Lifetime completion cap. Period-capped quests (retryDelay != "none") are gated solely by
  // periodCapCheck below; applying the lifetime cap to them as well would permanently block a
  // repeatable quest once its lifetime completions reached maxCompletes.
  const eventCompletedCheck =
    !QuestTypesWithMaxAttempts.includes(questAndUserQuestInfo.questType) ||
    questAndUserQuestInfo.retryDelay !== "none" ||
    !questAndUserQuestInfo.previousCompletes ||
    questAndUserQuestInfo.previousCompletes < maxCompletes;
  const eventAttemptsCheck =
    ignorePreviousAttempts ||
    !QuestTypesWithMaxAttempts.includes(questAndUserQuestInfo.questType) ||
    !questAndUserQuestInfo.previousAttempts ||
    questAndUserQuestInfo.previousAttempts < maxAttempts;

  // Per-period completion cap (only meaningful when retryDelay != none).
  const periodCapCheck = !periodCapReached({
    retryDelay: questAndUserQuestInfo.retryDelay,
    maxCompletes,
    periodCompletes: questAndUserQuestInfo.periodCompletes,
    periodStartAt: questAndUserQuestInfo.periodStartAt,
  });

  // Check if prerequisite quest is completed
  const prerequisiteCheck =
    !questAndUserQuestInfo.prerequisiteQuestId ||
    user.completedQuests?.some((q) => {
      return (
        q.questId === questAndUserQuestInfo.prerequisiteQuestId && q.completed === 1
      );
    });

  // Check if quest is available
  const check =
    hideCheck &&
    startsCheck &&
    expiresCheck &&
    eventCompletedCheck &&
    eventAttemptsCheck &&
    periodCapCheck &&
    villageCheck &&
    bloodlineCheck &&
    sageModeCheck &&
    sageRankCheck &&
    masteryCheck &&
    promotionCheck &&
    prerequisiteCheck &&
    medicalRankCheck &&
    huntingRankCheck &&
    gatheringRankCheck &&
    farmingLevelCheck &&
    levelCheck;

  // If quest is not available, return the reason
  let message = "";
  if (!hideCheck) message += "Quest is hidden\n";
  if (!startsCheck) message += "Quest starts in the future\n";
  if (!expiresCheck) message += "Quest has expired\n";
  if (!eventCompletedCheck) message += "Quest has been completed too many times\n";
  if (!eventAttemptsCheck) message += "Quest has been attempted too many times\n";
  if (!periodCapCheck) message += "Quest limit for this period reached\n";
  if (!villageCheck) message += "Quest is not available in your village\n";
  if (!bloodlineCheck) message += "Quest requires a specific bloodline\n";
  if (!sageModeCheck) message += "Quest requires a specific sage mode\n";
  if (!sageRankCheck) message += "Quest requires a higher sage mode rank\n";
  if (!masteryCheck)
    message +=
      "Quest requires more earned mastery (equipment and bloodline bonuses do not count)\n";
  if (!promotionCheck) message += "Quest requires the previous mastery rank\n";
  if (!prerequisiteCheck) message += "You must complete the prerequisite quest first\n";
  if (!medicalRankCheck)
    message += `Quest requires medical rank ${capitalizeFirstLetter(questMedRank ?? "NONE")}\n`;
  if (!huntingRankCheck)
    message += `Quest requires hunting rank ${capitalizeFirstLetter(questHuntRank ?? "NONE")}\n`;
  if (!gatheringRankCheck)
    message += `Quest requires gathering rank ${capitalizeFirstLetter(questGatherRank ?? "NONE")}\n`;
  if (!farmingLevelCheck)
    message += `Quest requires farming level ${questAndUserQuestInfo.requiredFarmingLevel}\n`;
  if (!levelCheck) {
    if (
      questAndUserQuestInfo.requiredLevel &&
      userLevel < questAndUserQuestInfo.requiredLevel
    ) {
      message += `Quest requires level ${questAndUserQuestInfo.requiredLevel}\n`;
    }
    if (questAndUserQuestInfo.maxLevel && userLevel > questAndUserQuestInfo.maxLevel) {
      message += `Quest is only available up to level ${questAndUserQuestInfo.maxLevel}\n`;
    }
  }
  // Returned detailed info on all the checks
  return { check, message };
};

/**
 * Validates that every newly authored dialog option routes to an existing objective. Legacy
 * terminal branches still complete through the runtime sentinel, but new content must express
 * its flow explicitly. This rule applies to every quest, independent of `consecutiveObjectives`.
 */
export const verifyDialogBranches = (
  objectives: AllObjectivesType[],
): { check: boolean; message: string } => {
  const objectiveIds = new Set(objectives.map((o) => o.id));
  for (const obj of objectives) {
    if (obj.task !== "dialog") continue;
    const nextRef = (obj as { nextObjectiveId?: unknown }).nextObjectiveId;
    if (!Array.isArray(nextRef) || nextRef.length === 0) {
      return {
        check: false,
        message: `Dialog objective '${obj.id}' must have at least one option`,
      };
    }
    for (const branch of nextRef) {
      const branchNext = (branch as { nextObjectiveId?: unknown })?.nextObjectiveId;
      if (typeof branchNext !== "string" || branchNext.length === 0) {
        return {
          check: false,
          message: `Dialog objective '${obj.id}' has an option with no nextObjectiveId`,
        };
      }
      if (!objectiveIds.has(branchNext)) {
        return {
          check: false,
          message: `Dialog objective '${obj.id}' has an option pointing to unknown objective '${branchNext}'`,
        };
      }
    }
  }
  return { check: true, message: "" };
};

/**
 * Verifies that the objective flow is valid according to the following rules:
 * - There can only be one starting objective, i.e. an objective where no other objectives point to it
 * - All objectives must be connected to the starting objective via a chain of nextObjectiveId
 * - All defined nextObjectiveId must be valid, i.e. point to an existing objective
 *
 * @param objectives - The objectives to verify.
 * @returns A boolean indicating whether the objective flow is valid.
 */
export const verifyQuestObjectiveFlow = (
  objectives: AllObjectivesType[],
): { check: boolean; message: string } => {
  // Helper which normalises the various `nextObjectiveId` shapes into a flat list of ids
  const collectNextIds = (obj: AllObjectivesType): string[] => {
    const result: string[] = [];
    const ref: unknown = (obj as { nextObjectiveId?: unknown }).nextObjectiveId;

    if (typeof ref === "string") {
      result.push(ref);
    } else if (Array.isArray(ref)) {
      for (const branch of ref) {
        if (branch && typeof branch === "object") {
          const id = (branch as { nextObjectiveId?: string }).nextObjectiveId;
          if (typeof id === "string") result.push(id);
        }
      }
    }

    // Also collect failObjectiveId if present
    const failRef: unknown = (obj as { failObjectiveId?: unknown }).failObjectiveId;
    if (typeof failRef === "string") {
      result.push(failRef);
    }

    return result;
  };

  try {
    // ------------------------------------------------------------------
    // 0. Basic presence check
    // ------------------------------------------------------------------
    if (!objectives || objectives.length === 0) {
      throw new Error("No objectives provided");
    }

    // Newly authored dialog branches must each route to a next objective.
    const dialogCheck = verifyDialogBranches(objectives);
    if (!dialogCheck.check) {
      throw new Error(dialogCheck.message);
    }

    // ------------------------------------------------------------------
    // 1. Build quick lookup map & guard against duplicate ids
    // ------------------------------------------------------------------
    const idToObj = new Map<string, AllObjectivesType>();
    for (const obj of objectives) {
      if (idToObj.has(obj.id)) {
        throw new Error(`Duplicate objective id '${obj.id}'`);
      }
      idToObj.set(obj.id, obj);
    }

    // ------------------------------------------------------------------
    // 2. Build adjacency list while validating references & special rules
    // ------------------------------------------------------------------
    const adjacency = new Map<string, string[]>();
    const referencedIds = new Set<string>();

    for (const obj of objectives) {
      const neighbours = collectNextIds(obj);
      if (neighbours.length === 0) {
        adjacency.set(obj.id, adjacency.get(obj.id) ?? []);
      }

      for (const raw of neighbours) {
        if (!raw) continue; // Safeguard against undefined values
        const nextId = raw;
        // Self-reference
        if (nextId === obj.id) {
          throw new Error(
            `Objective '${obj.id}' has a self-referencing nextObjectiveId`,
          );
        }
        // Unknown reference
        if (!idToObj.has(nextId)) {
          throw new Error(
            `Objective '${obj.id}' references unknown nextObjectiveId '${nextId}'`,
          );
        }
        referencedIds.add(nextId);
        const list = adjacency.get(obj.id) ?? [];
        list.push(nextId);
        adjacency.set(obj.id, list);
      }
    }

    // ------------------------------------------------------------------
    // 3. Determine unique starting objective (never referenced by others)
    // ------------------------------------------------------------------
    const startingIds = objectives
      .map((o) => o.id)
      .filter((id) => !referencedIds.has(id));

    if (startingIds.length === 0) {
      throw new Error("No starting objective found");
    }
    if (startingIds.length > 1) {
      throw new Error(`Multiple starting objectives found: ${startingIds.join(", ")}`);
    }
    const startId = startingIds[0];
    if (!startId) {
      throw new Error("No starting objective found");
    }

    // ------------------------------------------------------------------
    // 4. DFS to detect cycles & ensure reachability
    // ------------------------------------------------------------------
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const dfs = (currentId: string): void => {
      if (recursionStack.has(currentId)) {
        throw new Error("Cycle detected in objective chain");
      }
      if (visited.has(currentId)) return;

      visited.add(currentId);
      recursionStack.add(currentId);

      const neighbours = adjacency.get(currentId) ?? [];
      for (const next of neighbours) dfs(next);

      recursionStack.delete(currentId);
    };

    dfs(startId);

    // All objectives must be reachable from the start
    if (visited.size !== objectives.length) {
      const unreachable = objectives.filter((o) => !visited.has(o.id)).map((o) => o.id);
      throw new Error(`Unreachable objectives detected: ${unreachable.join(", ")}`);
    }

    return { check: true, message: "" };
  } catch (err) {
    return { check: false, message: (err as Error).message };
  }
};

/**
 * Validation a quest's objective content must pass before it is persisted (used by both
 * the `update` and `clone` quest mutations). Dialog branches are always validated; the full
 * chain/reachability flow is validated only for consecutive quests, since a
 * non-consecutive quest legitimately has multiple independent objectives that
 * {@link verifyQuestObjectiveFlow} would otherwise reject.
 *
 * Guardrail for overworld-bound objectives: a placement-bound objective completes the moment the
 * player stands on its NPC, so a non-consecutive quest binding two objectives to different NPCs can
 * be completed out of narrative order (the runtime overworld gate blocks the interaction, but the
 * intended ordering still can't be expressed). Ordering intent lives in the `nextObjectiveId` chain,
 * which only consecutive quests carry, so reject the save and let the author make the quest
 * consecutive rather than silently coercing the flag onto a chainless quest (which
 * {@link verifyQuestObjectiveFlow} would then reject anyway).
 */
export const verifyQuestContentForSave = (
  objectives: AllObjectivesType[],
  consecutiveObjectives: boolean,
): { check: boolean; message: string } => {
  const unsupportedBinding = objectives.find(
    (objective) =>
      !!objective.overworldPlacementId &&
      !isSupportedOverworldBindingTask(objective.task),
  );
  if (unsupportedBinding) {
    return {
      check: false,
      message: `Objective task ${unsupportedBinding.task} cannot bind to an overworld placement. Only defeat_opponents, deliver_item, and dialog are supported.`,
    };
  }
  // Consecutive quests run the full flow check, whose first step is the same dialog-branch scan —
  // so only the non-consecutive branch needs the standalone dialog check here (avoids scanning twice).
  if (consecutiveObjectives) return verifyQuestObjectiveFlow(objectives);
  const dialogCheck = verifyDialogBranches(objectives);
  if (!dialogCheck.check) return dialogCheck;
  const boundObjectiveCount = objectives.filter((o) => !!o.overworldPlacementId).length;
  if (boundObjectiveCount >= 2) {
    return {
      check: false,
      message:
        "A quest with more than one overworld NPC-bound objective must use consecutive objectives so they complete in a defined order.",
    };
  }
  return { check: true, message: "" };
};

/**
 * Filters out medical quests that are not available to the user.
 *
 * @param quests - The quests to filter.
 * @param user - The user to filter for.
 * @returns The filtered quests and the medical rank that was used.
 */
export const fallbackQuestsFilter = (
  quests: Quest[],
  user: NonNullable<UserWithRelations>,
  questType: QuestType,
) => {
  // Calculate user's medical rank
  const userMedicalRank = calcMedninRank({
    medicalExperience: user.medicalExperience,
    rank: user.rank,
  });
  let filtered: Quest[] = [];
  let rankInfo = "";

  if (questType === "medical") {
    const userMedicalRankIndex = MEDNIN_RANKS.indexOf(userMedicalRank);
    // Collect all missions from user's rank down to NONE (dedup by id)
    const allQualifyingMissions: Quest[] = [];
    const seen = new Set<string>();
    for (let i = userMedicalRankIndex; i >= 0; i--) {
      const currentRank = MEDNIN_RANKS[i];
      if (!currentRank) continue;

      // Filter for available quests at this rank
      const availableMissions = quests.filter(
        (e) =>
          e.questType === questType &&
          (!e.medicalRank || e.medicalRank === currentRank) &&
          isAvailableUserQuests(e, user).check,
      );

      for (const q of availableMissions) {
        if (!seen.has(q.id)) {
          seen.add(q.id);
          allQualifyingMissions.push(q);
        }
      }
    }

    filtered = allQualifyingMissions;
    // Set rank info if we're showing missions from lower ranks
    if (filtered.length > 0) {
      const highestRankShown = filtered.reduce((highest, mission) => {
        if (!mission.medicalRank) return highest;
        const missionRankIndex = MEDNIN_RANKS.indexOf(mission.medicalRank);
        const highestIndex = MEDNIN_RANKS.indexOf(highest);
        return missionRankIndex > highestIndex ? mission.medicalRank : highest;
      }, "NONE" as MEDNIN_RANK);

      if (highestRankShown !== userMedicalRank) {
        rankInfo = ` (showing missions up to ${capitalizeFirstLetter(highestRankShown)} rank)`;
      }
    }
  } else {
    filtered = quests;
  }
  return { filtered, rankInfo };
};

/** A player can have multiple events, but cannot start the same quest twice. */
export const questAlreadyActiveBlockMessage = (
  quest: Pick<Quest, "id" | "name">,
  user: Pick<NonNullable<UserWithRelations>, "userQuests">,
): string | null =>
  user.userQuests?.some((active) => active.questId === quest.id && !active.endAt)
    ? `You are already on this quest: ${quest.name}`
    : null;

/** Returns a rejection message when the quest's concurrency slot is occupied. */
export const questTypeConcurrentBlockMessage = (
  quest: Pick<Quest, "questType" | "name">,
  user: NonNullable<UserWithRelations>,
): string | null => {
  /** Returns the user's unfinished quests for a specific quest type. */
  const activeOfType = (type: string) =>
    user.userQuests?.filter((q) => q.quest.questType === type && !q.endAt) ?? [];
  switch (quest.questType) {
    case "story":
    case "hunting":
    case "gathering":
    case "anbu":
    case "event": {
      const cur = activeOfType(quest.questType);
      if (cur.length >= QUESTS_CONCURRENT_LIMIT) {
        return `Already ${QUESTS_CONCURRENT_LIMIT} active ${quest.questType} quests; ${cur
          .map((c) => c.quest.name)
          .join(", ")}. Abandon one to start this quest.`;
      }
      return null;
    }
    case "battlepyramid": {
      if (activeOfType("battlepyramid").length >= 1) {
        return `Already in active battle pyramid. Abandon if you want to restart.`;
      }
      return null;
    }
    case "starter": {
      if (activeOfType("starter").length >= 1) {
        return `Already in active starter quest. Abandon if you want to restart.`;
      }
      return null;
    }
    case "war": {
      const blockers = ["mission", "crime", "errand", "medical", "pvp", "war"];
      const found = user.userQuests?.find(
        (q) => blockers.includes(q.quest.questType) && !q.endAt,
      );
      return found ? `Already have an active ${found.quest.questType}` : null;
    }
    case "mission":
    case "crime":
    case "medical":
    case "pvp":
    case "errand": {
      const blockers = ["mission", "crime", "errand", "medical", "pvp"];
      const found = user.userQuests?.find(
        (q) => blockers.includes(q.quest.questType) && !q.endAt,
      );
      return found ? `Already active ${found.quest.questType}` : null;
    }
    default:
      return null;
  }
};

/**
 * Structure and occupation guards that only apply when a player starts a quest
 * through the UI (Mission Hall, Anbu page, etc.). NPC-initiated quests skip these.
 * Returns a rejection message, or null to allow proceeding.
 */
export const questUiAccessBlockMessage = (
  quest: Pick<Quest, "questType" | "questRank">,
  user: NonNullable<UserWithRelations>,
  sectorVillage: SectorVillage | null,
): string | null => {
  const hasStructureAccess = canAccessStructure(
    user,
    questStructureRoute(quest.questType),
    sectorVillage,
  );
  if (quest.questType === "story") {
    if (!hasStructureAccess) {
      return "Must be in the Global Anbu HQ to start story quests";
    }
  } else if (quest.questType === "hunting") {
    if (user.occupation !== "HUNTER") {
      return "You are not a hunter";
    }
  } else if (quest.questType === "gathering") {
    if (user.occupation !== "GATHERING") {
      return "You are not a gatherer";
    }
  } else if (quest.questType === "anbu") {
    if (!hasStructureAccess) {
      return "Must be in the Anbu page to start anbu quests";
    }
    if (!user.anbuId) {
      return "You are not in an anbu squad";
    }
  } else if (quest.questType === "event") {
    if (!hasStructureAccess) {
      return "Must be in your allied village to start quest";
    }
  } else if (quest.questType === "war") {
    if (!user.villageId) {
      return "You must be in a village to accept war missions";
    }
    if (!user.isOutlaw && !hasStructureAccess) {
      return "Must be in your allied village to start quest";
    }
    if (user.dailyWarMissions >= WAR_MISSIONS_PER_DAY) {
      return `You have reached your daily war mission limit of ${WAR_MISSIONS_PER_DAY}`;
    }
  } else if (["mission", "crime", "medical", "pvp"].includes(quest.questType)) {
    if (["mission", "crime"].includes(quest.questType) && quest.questRank !== "A") {
      return `Only A rank missions/crimes are allowed`;
    }
    if (!user.isOutlaw && !hasStructureAccess) {
      return "Must be in your allied village to start quest";
    }
  }
  return null;
};

/** Daily assignment counters used by the mission hall, discovery and acquisition guards. */
export const questDailyQuota = (
  questType: string,
  user: Pick<
    UserData,
    | "dailyMissions"
    | "dailyErrands"
    | "dailyMedicalMissions"
    | "dailyPvpMissions"
    | "dailyWarMissions"
  >,
) => {
  switch (questType) {
    case "mission":
    case "crime":
      return { current: user.dailyMissions, limit: MISSIONS_PER_DAY };
    case "errand":
      return { current: user.dailyErrands, limit: ERRANDS_PER_DAY };
    case "medical":
      return { current: user.dailyMedicalMissions, limit: MEDICAL_MISSIONS_PER_DAY };
    case "pvp":
      return { current: user.dailyPvpMissions, limit: PVP_MISSIONS_PER_DAY };
    case "war":
      return { current: user.dailyWarMissions, limit: WAR_MISSIONS_PER_DAY };
    default:
      return null;
  }
};

/** Structure used by the quest's normal UI entry point. */
export const questStructureRoute = (questType: string) => {
  switch (questType) {
    case "mastery":
      return "/traininggrounds" as const;
    case "event":
      return "/adminbuilding" as const;
    case "story":
      return "/globalanbuhq" as const;
    case "battlepyramid":
      return "/battlearena" as const;
    case "anbu":
      return "/anbu" as const;
    default:
      return "/missionhall" as const;
  }
};

export const questRequiresTravel = (
  questType: string,
  user: NonNullable<UserWithRelations>,
  sectorVillage?: SectorVillage | null,
) => {
  if (user.isOutlaw && !["event", "story", "anbu"].includes(questType)) return false;
  return !canAccessStructure(user, questStructureRoute(questType), sectorVillage);
};

interface QuestWarSummary {
  attackerVillageId: string;
  defenderVillageId: string;
  warAllies: { villageId: string }[];
}

/** War missions follow the mission hall: an involved village, including allies, and the daily cap. */
export const isWarMissionAvailable = ({
  questType,
  villageId,
  dailyWarMissions,
  activeWars,
}: {
  questType: string;
  villageId: string | null;
  dailyWarMissions: number;
  activeWars: QuestWarSummary[];
}) => {
  if (questType !== "war") return true;
  if (!villageId || dailyWarMissions >= WAR_MISSIONS_PER_DAY) return false;
  return activeWars.some(
    (activeWar) =>
      activeWar.attackerVillageId === villageId ||
      activeWar.defenderVillageId === villageId ||
      activeWar.warAllies.some((ally) => ally.villageId === villageId),
  );
};

export const isQuestRankAllowed = (
  quest: Pick<Quest, "questType" | "questRank">,
  user: Pick<UserData, "rank">,
  source: "ui" | "random_assignment" = "ui",
) =>
  source === "random_assignment" && quest.questType !== "mission"
    ? true
    : availableQuestLetterRanks(user.rank).includes(quest.questRank);

/**
 * Match one content event against an objective's configured filters.
 * Jutsu IDs and mastery filters intersect when both are set; a mastery-only objective
 * permits an empty ID list, but leaving both unset cannot credit arbitrary content.
 * Combat-type restrictions require matching event metadata. Exact task and content ID
 * checks keep passive "any" re-evaluation events from incrementing content counters.
 */
const matchesContentObjective = (
  objective: AllObjectivesType,
  event: ObjectiveTrackerTaskInput,
): boolean => {
  if (event.task !== objective.task || event.contentId === undefined) return false;
  const contentIds = objectiveContentIds(objective);
  if (!("masteryType" in objective)) return contentIds.includes(event.contentId);

  const hasMasteryFilter = !!objective.masteryType && objective.masteryType !== "None";
  if (contentIds.length === 0 && !hasMasteryFilter) return false;
  if (contentIds.length > 0 && !contentIds.includes(event.contentId)) return false;
  if (
    objective.masteryType &&
    objective.masteryType !== "None" &&
    !event.masteryTypes?.includes(objective.masteryType)
  )
    return false;

  return (
    !("combatType" in objective) ||
    !objective.combatType ||
    objective.combatType === "Any" ||
    objective.combatType === event.combatType
  );
};

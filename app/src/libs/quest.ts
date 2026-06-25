import {
  ADDITIONAL_MISSION_REWARD_MULTIPLIER,
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
  MAP_SECTOR_ID_MAX,
  MAP_SECTOR_ID_MIN,
  type MEDNIN_RANK,
  MEDNIN_RANKS,
  type QuestType,
  QuestTypesWithMaxAttempts,
  type RetryQuestDelay,
  SECTOR_HEIGHT,
  SECTOR_WIDTH,
  SENSEI_MAX_STUDENT_LEVEL,
  SENSEI_STUDENT_MISSION_EXP_BOOST_PERC,
  VILLAGE_SYNDICATE_ID,
} from "@/drizzle/constants";
import type { GameSetting, Quest, UserData, UserItem } from "@/drizzle/schema";
import { getGatheringRank } from "@/libs/gathering";
import { calcMedninRank } from "@/libs/hospital";
import { getHuntingRank } from "@/libs/hunting";
import {
  findCompletedPredecessor,
  isQuestComplete,
  isQuestObjectiveAvailable,
} from "@/libs/objectives";
import type { UserWithRelations } from "@/routers/profile";
import { getUnique } from "@/utils/grouping";
import { randomInt } from "@/utils/math";
import { canChangeContent, canPlayHiddenQuests } from "@/utils/permissions";
import { capitalizeFirstLetter } from "@/utils/sanitize";
import { periodStart, secondsPassed } from "@/utils/time";
import { getShrineBoost, getStrucBoost } from "@/utils/village";
import type {
  AllObjectivesType,
  AllObjectiveTask,
  QuestTrackerType,
} from "@/validators/objectives";
import { ObjectiveTracker, QuestTracker } from "@/validators/objectives";
import type { ObjectiveRewardType } from "@/validators/rewards";
import { ObjectiveReward, type PostProcessedRewards } from "@/validators/rewards";
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
 * Strip in-memory-only achievement trackers before persisting `UserData.questData`.
 * Mock rows from `mockAchievementHistoryEntries` use `id === questId`; real `QuestHistory.id` is a nanoid.
 */
export const filterQuestTrackersForDbPersist = (
  trackers: QuestTrackerType[],
  user: NonNullable<UserWithRelations>,
) => {
  const inMemoryOnlyAchievementQuestIds = new Set(
    user.userQuests
      // `uq.quest` is null for an orphaned QuestHistory row (its quest was deleted). Most callers
      // pass userQuests from fetchUpdatedUser, which already strips these, but item.ts's buy path
      // uses a bespoke fetch that does not — so guard the deref here as a defensive backstop for
      // every caller. An orphan is not an in-memory achievement, so skipping it is correct;
      // getNewTrackers already drops orphans, so no tracker is emitted for them anyway.
      .filter((uq) => uq.quest?.questType === "achievement" && uq.id === uq.questId)
      .map((uq) => uq.questId),
  );
  return trackers.filter((t) => !inMemoryOnlyAchievementQuestIds.has(t.id));
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
  if ("overworldPlacementId" in objective && objective.overworldPlacementId) {
    return !!atPlacementIds && atPlacementIds.has(objective.overworldPlacementId);
  }
  return isLocationObjective(location, objective);
};

/**
 * Go through current user quests, and return updated list of questData &
 * list of rewards to award the user
 * @param user - User with questData
 * @param questId - Quest ID
 * @param dialogNextObjectiveId - Requested next objective ID,
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
  const { trackers, notifications, consequences } = getNewTrackers(
    user,
    [
      { task: "any" },
      { task: "collect_item" },
      { task: "dialog", contentId: dialogNextObjectiveId },
    ],
    undefined,
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
      rawRewards = ObjectiveReward.parse(userQuest.quest.content.reward);
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
          rawRewards.reward_bloodlines = objective.reward_bloodlines;
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

    // Apply daily mission limit penalty if applicable (after 9 missions), but keep shrine boost
    if (missionLike && user.dailyMissions > 9) {
      factor = ADDITIONAL_MISSION_REWARD_MULTIPLIER * boostFactor;
    }

    rawRewards.reward_money = Math.floor(rawRewards.reward_money * factor);
    rawRewards.reward_clanpoints = Math.floor(rawRewards.reward_clanpoints * factor);
    rawRewards.reward_anbupoints = Math.floor(rawRewards.reward_anbupoints * factor);
    rawRewards.reward_exp = Math.floor(rawRewards.reward_exp * factor);
    rawRewards.reward_tokens = Math.floor(rawRewards.reward_tokens * factor);
    rawRewards.reward_prestige = Math.floor(rawRewards.reward_prestige * factor);
    rawRewards.reward_reputation = Math.floor(rawRewards.reward_reputation * factor);
    rawRewards.reward_medical_experience = Math.floor(
      rawRewards.reward_medical_experience * factor,
    );
    rawRewards.reward_hunting_experience = Math.floor(
      rawRewards.reward_hunting_experience * factor,
    );
    rawRewards.reward_crafting_experience = Math.floor(
      rawRewards.reward_crafting_experience * factor,
    );
    rawRewards.reward_gathering_experience = Math.floor(
      rawRewards.reward_gathering_experience * factor,
    );
    rawRewards.reward_seichi_silver = Math.floor(
      rawRewards.reward_seichi_silver * factor,
    );

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
    if (clanHunterExpBoost > 0 && rawRewards.reward_hunting_experience > 0) {
      rawRewards.reward_hunting_experience = Math.floor(
        rawRewards.reward_hunting_experience * (1 + clanHunterExpBoost),
      );
    }
    if (clanGathererExpBoost > 0 && rawRewards.reward_gathering_experience > 0) {
      rawRewards.reward_gathering_experience = Math.floor(
        rawRewards.reward_gathering_experience * (1 + clanGathererExpBoost),
      );
    }
    if (clanCraftingExpBoost > 0 && rawRewards.reward_crafting_experience > 0) {
      rawRewards.reward_crafting_experience = Math.floor(
        rawRewards.reward_crafting_experience * (1 + clanCraftingExpBoost),
      );
    }

    // Chunin mission experience bonus (≤ level 40)
    if (
      user.senseiId &&
      user.level <= SENSEI_MAX_STUDENT_LEVEL &&
      userQuest.quest.questType === "mission"
    ) {
      rawRewards.reward_exp = Math.floor(
        rawRewards.reward_exp * (1 + SENSEI_STUDENT_MISSION_EXP_BOOST_PERC / 100),
      );
    }

    // Apply mission experience multiplier if available (for missions, crimes, and medical missions)
    if (settings && (missionLike || userQuest.quest.questType === "medical")) {
      const missionSetting = settings.find((s) => s.name === "missionExpMultiplier");
      if (missionSetting) {
        const secondsLeft = -secondsPassed(missionSetting.time);
        if (secondsLeft > 0 && missionSetting.value > 0) {
          rawRewards.reward_exp = Math.floor(
            rawRewards.reward_exp * missionSetting.value,
          );
        }
      }
    }
  }
  // Final rewards (some need a bit pose-processing)
  const rewards = postProcessRewards(rawRewards);

  // Update trackers for experience gained from quest rewards
  const experienceTrackerTasks = [];
  if (rewards.reward_medical_experience > 0) {
    experienceTrackerTasks.push({
      task: "medical_experience_gained" as const,
      increment: rewards.reward_medical_experience,
    });
  }
  if (rewards.reward_crafting_experience > 0) {
    experienceTrackerTasks.push({
      task: "crafting_experience_gained" as const,
      increment: rewards.reward_crafting_experience,
    });
  }
  if (rewards.reward_hunting_experience > 0) {
    experienceTrackerTasks.push({
      task: "hunting_experience_gained" as const,
      increment: rewards.reward_hunting_experience,
    });
  }
  if (rewards.reward_gathering_experience > 0) {
    experienceTrackerTasks.push({
      task: "gathering_experience_gained" as const,
      increment: rewards.reward_gathering_experience,
    });
  }
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
  return { rewards, trackers, userQuest, resolved, notifications, consequences };
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
    reward_items: [],
    reward_jutsus: [],
    reward_bloodlines: [],
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

    // Concatenate array rewards
    collapsed.reward_items.push(...reward.reward_items);
    collapsed.reward_jutsus.push(...reward.reward_jutsus);
    collapsed.reward_bloodlines.push(...reward.reward_bloodlines);
    collapsed.reward_badges.push(...reward.reward_badges);

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
 * Returns true when an objective is bound to a placement that no longer exists
 * in the database (i.e. the row was hard-deleted). The `existing` set contains
 * every placement id that was returned by the DB query (regardless of isActive).
 */
export const isBoundPlacementDeleted = (
  objective: { overworldPlacementId?: string },
  existing: Set<string>,
): boolean =>
  !!objective.overworldPlacementId && !existing.has(objective.overworldPlacementId);

/**
 * Returns true when an objective is bound to a placement that still exists in
 * the database but is currently deactivated (isActive=false). The objective
 * should be frozen — neither failed nor progressed — until the placement is
 * re-activated.
 */
export const isBoundPlacementFrozen = (
  objective: { overworldPlacementId?: string },
  existing: Set<string>,
  active: Set<string>,
): boolean =>
  !!objective.overworldPlacementId &&
  existing.has(objective.overworldPlacementId) &&
  !active.has(objective.overworldPlacementId);

/**
 * True when a retryDelay != none quest already hit `maxCompletes` completions in the
 * current calendar period. retryDelay "none" and maxCompletes <= 0 are never capped.
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
  if (args.retryDelay === "none" || args.maxCompletes <= 0) return false;
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

/** Period-start for a completion, or {} for retryDelay "none". */
export const periodCompletionSet = (
  retryDelay: RetryQuestDelay,
  now: Date = new Date(),
): { cps?: Date } =>
  retryDelay === "none" ? {} : { cps: periodStart(retryDelay, now) };

/**
 * Used to update the quest tracking data for a user. Takes in the user with his questData
 * information, as well as a task to update. The value is the value to update the task with,
 * e.g. if task is 'pvp_kills' and value is 1, then the user has killed 1 player. This function
 * also ensure to remove all questData which is no longer needed, i.e. data relating to quests no longer
 * active for the user
 * @param user  - User with questData
 * @param task - Task to update
 * @param value - Value to update task with
 * @param contentId - If provided, refers to ID of content, e.g. opponentID defeated
 * @param notifications - If provided, is used to set notifications
 * @param boundPlacementStatus - When supplied, objectives bound to a deleted placement
 *   are auto-failed, and objectives bound to a deactivated (frozen) placement are
 *   skipped without failing. Omit to preserve existing behaviour exactly.
 */
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
  warFoe?: boolean;
};

export const getNewTrackers = (
  user: NonNullable<UserWithRelations> & { useritems?: UserItem[] },
  tasks: ObjectiveTrackerTaskInput[],
  combatContext?: CombatQuestContext,
  boundPlacementStatus?: { existing: Set<string>; active: Set<string> },
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

          if ("sectorType" in objective && status.sector === undefined) {
            if (objective.sectorType === "specific") {
              status.sector = objective.sector;
            } else if (objective.sectorType === "random") {
              status.sector = randomInt(MAP_SECTOR_ID_MIN, MAP_SECTOR_ID_MAX);
            } else if (objective.sectorType === "from_list") {
              if (objective.sectorList.length === 0) {
                status.sector = randomInt(MAP_SECTOR_ID_MIN, MAP_SECTOR_ID_MAX);
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
                status.sector = randomInt(MAP_SECTOR_ID_MIN, MAP_SECTOR_ID_MAX);
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

          // Three-way bound-placement check — only runs when the caller supplies
          // boundPlacementStatus; omitting it preserves existing behaviour exactly.
          if (boundPlacementStatus) {
            const { existing, active } = boundPlacementStatus;
            if (isBoundPlacementDeleted(objective, existing)) {
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
            } else if (isBoundPlacementFrozen(objective, existing, active)) {
              // Placement exists but is deactivated → freeze: skip without failing.
              return status;
            }
            // else: placement is active → fall through to normal matching.
          }

          // If not available yet, just skip
          if (questTracker && !isQuestObjectiveAvailable(quest, questTracker, i)) {
            return status;
          }

          // Convenience
          const task = objective.task;
          // Kill objectives whose counting is gated by battle context per quest type
          const isWarContextKillTask =
            task === "pvp_kills" || task === "defeat_opponents";
          const isKage = user.village?.kageId === user.userId;

          // General updates we want to apply every time
          if (task === "user_level") {
            // Use originalLevel if available (for combat-scaled users), otherwise use current level
            const userLevel =
              "originalLevel" in user && typeof user.originalLevel === "number"
                ? user.originalLevel
                : (user.level ?? 1);
            status.value = userLevel;
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
                if (taskUpdate.value && killCounts) {
                  status.value = taskUpdate.value;
                }
              }
              // Content-gated objectives: credit only when the emitted contentId belongs to
              // this objective's own id-list. One shared matcher across all content-gated tasks.
              if (
                status &&
                "value" in objective &&
                CONTENT_GATED_TASKS.has(task) &&
                taskUpdate.contentId !== undefined &&
                objectiveContentIds(objective).includes(taskUpdate.contentId) &&
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
              if (task === "dialog" && taskUpdate.contentId) {
                const objectiveHasNext = objective.nextObjectiveId?.find(
                  (next) => next.nextObjectiveId === taskUpdate.contentId,
                );
                if (objectiveHasNext) {
                  status.done = true;
                  status.selectedNextObjectiveId = taskUpdate.contentId;
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
                      const minutesPassed =
                        secondsPassed(new Date(status.timestamp)) / 60;
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
      quest: a,
      endAt: null,
      startedAt: new Date(),
      /** `id` is the quest id here (placeholder); real `QuestHistory.id` is a nanoid ≠ `questId`. */
    }));
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
 * Filters out hidden and expired quests based on the user's role.
 *
 * @param questAndUserQuestInfo - The quest object to be checked.
 * @param role - The role of the user.
 * @returns A boolean indicating whether the quest is either hidden and the user can play hidden quests, or the quest is not expired.
 */
export const isAvailableUserQuests = (
  questAndUserQuestInfo: {
    hidden: boolean;
    maxAttempts: number;
    maxCompletes: number;
    questType: QuestType;
    endsAt?: string | null;
    requiredVillage: string | null;
    requiredBloodlineId?: string | null;
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

  // Checks
  const hideCheck = !questAndUserQuestInfo.hidden || canPlayHiddenQuests(user.role);
  const expiresCheck =
    !questAndUserQuestInfo.endsAt ||
    new Date(questAndUserQuestInfo.endsAt) > new Date();
  const villageCheck =
    !questAndUserQuestInfo.requiredVillage ||
    questAndUserQuestInfo.requiredVillage === user.villageId ||
    (questAndUserQuestInfo.requiredVillage === VILLAGE_SYNDICATE_ID && user.isOutlaw);
  const bloodlineCheck =
    !questAndUserQuestInfo.requiredBloodlineId ||
    questAndUserQuestInfo.requiredBloodlineId === user.bloodlineId;

  // Medical rank check for quests that require it
  const medicalRankCheck = !reqMedRankIdx || userMedRankIdx >= reqMedRankIdx;
  const huntingRankCheck = !reqHuntRankIdx || userHuntRankIdx >= reqHuntRankIdx;
  const gatheringRankCheck = !reqGatherRankIdx || userGatherRankIdx >= reqGatherRankIdx;

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
    expiresCheck &&
    eventCompletedCheck &&
    eventAttemptsCheck &&
    periodCapCheck &&
    villageCheck &&
    bloodlineCheck &&
    prerequisiteCheck &&
    medicalRankCheck &&
    huntingRankCheck &&
    gatheringRankCheck &&
    levelCheck;

  // If quest is not available, return the reason
  let message = "";
  if (!hideCheck) message += "Quest is hidden\n";
  if (!expiresCheck) message += "Quest has expired\n";
  if (!eventCompletedCheck) message += "Quest has been completed too many times\n";
  if (!eventAttemptsCheck) message += "Quest has been attempted too many times\n";
  if (!periodCapCheck) message += "Quest limit for this period reached\n";
  if (!villageCheck) message += "Quest is not available in your village\n";
  if (!bloodlineCheck) message += "Quest requires a specific bloodline\n";
  if (!prerequisiteCheck) message += "You must complete the prerequisite quest first\n";
  if (!medicalRankCheck)
    message += `Quest requires medical rank ${capitalizeFirstLetter(questMedRank ?? "NONE")}\n`;
  if (!huntingRankCheck)
    message += `Quest requires hunting rank ${capitalizeFirstLetter(questHuntRank ?? "NONE")}\n`;
  if (!gatheringRankCheck)
    message += `Quest requires gathering rank ${capitalizeFirstLetter(questGatherRank ?? "NONE")}\n`;
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
 * Validates that every dialog objective routes somewhere valid. A dialog branch with no
 * `nextObjectiveId`, or one pointing to an objective that does not exist, can never advance
 * the objective — `getNewTrackers` only completes a dialog when the chosen branch's
 * `nextObjectiveId` matches a real objective — so it soft-locks the player. This rule
 * applies to ALL quests, independent of `consecutiveObjectives`.
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

    // Dialog branches must each route to a next objective (a terminal branch soft-locks).
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
 * the `update` and `clone` quest mutations). Dialog branches are always validated (a
 * terminal branch soft-locks the player regardless of quest shape); the full
 * chain/reachability flow is validated only for consecutive quests, since a
 * non-consecutive quest legitimately has multiple independent objectives that
 * {@link verifyQuestObjectiveFlow} would otherwise reject.
 */
export const verifyQuestContentForSave = (
  objectives: AllObjectivesType[],
  consecutiveObjectives: boolean,
): { check: boolean; message: string } => {
  const dialogCheck = verifyDialogBranches(objectives);
  if (!dialogCheck.check) return dialogCheck;
  if (consecutiveObjectives) return verifyQuestObjectiveFlow(objectives);
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

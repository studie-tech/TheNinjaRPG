import { nanoid } from "nanoid";
import {
  ADDITIONAL_MISSION_REWARD_MULTIPLIER,
  MISSIONS_FULL_REWARD_COUNT,
  SENSEI_MAX_STUDENT_LEVEL,
  SENSEI_STUDENT_MISSION_EXP_BOOST_PERC,
} from "@/drizzle/constants";
import type { GameSetting } from "@/drizzle/schema";
import { getClanBoost } from "@/libs/clanBoost";
import { getGameSettingBoost } from "@/libs/gameSettingBoost";
import { isQuestComplete } from "@/libs/objectives";
import { boostPvpGain, boostPvpRewards, getPvpBoost } from "@/libs/pvpExperience";
import { getNewTrackers, type QuestConsequence } from "@/libs/quest";
import { isQuestPartyHelperAttempt } from "@/libs/questParty";
import {
  buildRewardChoiceCards,
  getFixedChoiceRewards,
  getRewardPickCount,
  isRewardChoiceQuest,
} from "@/libs/rewardChoice";
import { collapseRewards, mergeMaterialDrops } from "@/libs/rewards";
import { getTerritoryWarBoost } from "@/libs/territoryWar";
import { getVillageLoyaltyBonuses } from "@/libs/villageLoyalty";
import type { UserWithRelations } from "@/routers/profile";
import { countBoostingShrines, getShrineBoost, getStrucBoost } from "@/utils/village";
import { QuestCompletionTasks } from "@/validators/objectives";
import {
  QuestReward,
  type QuestRewardType,
  rewardPayloads,
} from "@/validators/rewardPackages";
import {
  MASTERY_EXPERIENCE_FIELDS,
  type ObjectiveRewardType,
  type PendingRewardChoice,
  type PostProcessedRewards,
  REWARD_CHOICE_AMOUNT_FIELDS,
} from "@/validators/rewards";

/**
 * Go through current user quests, and return updated list of questData &
 * list of rewards to award the user
 * @param user - User with questData
 * @param questId - Quest ID
 * @param dialogNextObjectiveId - Requested next objective ID.
 * @param settings - Game settings used while calculating quest rewards.
 * @param atPlacementIds - Overworld placement ids the user is interacting with now.
 * @param completionOnly - A validated companion task pays the final reward without running objectives.
 * @returns Rewards, trackers, userQuest, resolved, successDescriptions
 */
export const getReward = (
  user: NonNullable<UserWithRelations>,
  questId: string,
  dialogNextObjectiveId?: string,
  settings?: GameSetting[],
  atPlacementIds?: ReadonlySet<string>,
  completionOnly = false,
) => {
  // Derived
  let rawRewards: QuestRewardType = QuestReward.parse({});
  // Completion reward of a "choose" quest, offered as cards instead of granted outright.
  let choiceRewards: QuestRewardType | null = null;
  let rewardChoice: PendingRewardChoice | null = null;
  const { trackers, notifications, consequences } = completionOnly
    ? {
        trackers: structuredClone(user.questData ?? []),
        notifications: [] as string[],
        consequences: [] as QuestConsequence[],
      }
    : getNewTrackers(
        user,
        [
          { task: "any" },
          { task: "collect_item" },
          { task: "dialog", contentId: dialogNextObjectiveId },
        ],
        undefined, // combatContext
        undefined, // boundPlacementStatus (getReward binds via atPlacementIds instead)
        atPlacementIds,
        true,
      );
  const userQuest = user.userQuests.find((uq) => uq.questId === questId);
  const isCompletedHelper = isQuestPartyHelperAttempt(userQuest, user.questPartyId);
  let resolved = false;
  // Start mutating
  if (isCompletedHelper && userQuest) {
    const tracker = trackers.find((entry) => entry.id === questId);
    resolved =
      !!tracker && !tracker.failed && isQuestComplete(userQuest.quest, tracker);
    tracker?.goals.forEach((goal) => {
      if (goal.done) goal.collected = true;
    });
  }
  if (userQuest && !userQuest.completed && userQuest?.quest && !isCompletedHelper) {
    // See if we have a shrine boost
    const sectors = countBoostingShrines(user.village?.sectors);
    const errandsBoost = getShrineBoost(sectors, "Errands", user.village);
    const missionBoost = getShrineBoost(sectors, "Mission", user.village);
    // Village mission hall boost (percentage as decimal), applies to missions and errands
    const villageMissionBoost =
      getStrucBoost("missionRewardPerLvl", user.village?.structures) / 100;
    const clanMissionBoost = getClanBoost(user, "missionRewardBoost");
    const loyalty = getVillageLoyaltyBonuses(user);
    let boostFactor = 1;
    if (userQuest?.quest.questType) {
      if (["mission", "crime", "medical"].includes(userQuest.quest.questType)) {
        boostFactor = 1 + missionBoost + clanMissionBoost + villageMissionBoost;
      } else if (userQuest.quest.questType === "errand") {
        // clanMissionBoost intentionally excluded from errands; only shrine + village hall apply
        boostFactor = 1 + errandsBoost + villageMissionBoost;
      }
    }
    const missionLoyalty = ["mission", "errand"].includes(userQuest.quest.questType)
      ? loyalty.missionRewards
      : 0;
    // Get rewards
    const tracker = trackers.find((q) => q.id === userQuest.quest.id);
    const goals = tracker?.goals ?? [];
    resolved =
      completionOnly ||
      !tracker ||
      (!tracker.failed && isQuestComplete(userQuest.quest, tracker));
    if (resolved) {
      const questReward = QuestReward.parse(userQuest.quest.content.reward);
      if (isRewardChoiceQuest(userQuest.quest.content)) {
        // Only the structural part pays now; the rest becomes a frozen pick offer below.
        rawRewards = getFixedChoiceRewards(questReward);
        choiceRewards = questReward;
      } else {
        rawRewards = collapseRewards(rewardPayloads(questReward));
      }
    }
    (completionOnly ? [] : userQuest.quest.content.objectives).forEach((objective) => {
      const status = goals.find((g) => g.id === objective.id);
      if (status?.done && !status.collected) {
        status.collected = true;
        if (objective.successDescription) {
          notifications.push(objective.successDescription);
        }
        // Compose packages with their objective's direct rewards before merging the payout.
        if (objective.reward_packages?.length) {
          const objectiveReward = collapseRewards(rewardPayloads(objective));
          rawRewards = collapseRewards([rawRewards, objectiveReward]);
          return;
        }
        // Direct-only objectives retain their ordered structural overrides below.
        for (const field of REWARD_CHOICE_AMOUNT_FIELDS)
          if (objective[field])
            rawRewards[field] = (rawRewards[field] ?? 0) + (objective[field] ?? 0);
        if (objective.reward_jutsus) {
          rawRewards.reward_jutsus.push(...objective.reward_jutsus);
        }
        rawRewards.reward_titles.push(...(objective.reward_titles ?? []));
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
        mergeMaterialDrops(rawRewards, objective);
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
    const reducedRewardFactor =
      missionLike &&
      isReducedMissionReward(user.dailyMissions, { phase: "in-progress" })
        ? ADDITIONAL_MISSION_REWARD_MULTIPLIER
        : 1;
    const factor = boostFactor * reducedRewardFactor;
    /** Preserve the floored base reward; only positive gains receive rounded additive loyalty. */
    const scaleReward = (value: number, loyaltyPercent = 0) =>
      Math.floor(value * factor) +
      (value > 0
        ? Math.round((value * loyaltyPercent * reducedRewardFactor) / 100)
        : 0);

    /** Apply the same scaling once to immediate rewards, packages and frozen choice offers. */
    const scaleRewards = (target: ObjectiveRewardType) => {
      // Apply only the listed gain categories, including frozen reward-choice offers.
      const pvpPercent = getPvpBoost(user, settings).totalPercent;
      boostPvpRewards(target, pvpPercent);
      target.reward_money = scaleReward(target.reward_money, missionLoyalty);
      target.reward_clanpoints = Math.floor(target.reward_clanpoints * factor);
      target.reward_anbupoints = Math.floor(target.reward_anbupoints * factor);
      target.reward_exp = scaleReward(target.reward_exp, missionLoyalty);
      if (target.reward_pet_experience !== undefined)
        target.reward_pet_experience = scaleReward(
          target.reward_pet_experience,
          missionLoyalty,
        );
      target.reward_tokens = scaleReward(
        target.reward_tokens,
        missionLoyalty + loyalty.villageRewards,
      );
      target.reward_prestige = scaleReward(
        target.reward_prestige,
        missionLoyalty + loyalty.villageRewards,
      );
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
          target[field] = scaleReward(target[field] ?? 0, missionLoyalty);
      target.reward_sage_mastery_experience = scaleReward(
        target.reward_sage_mastery_experience,
        missionLoyalty,
      );
      target.reward_seichi_silver = Math.floor(target.reward_seichi_silver * factor);

      // Apply clan experience boosts
      const territoryBoost = getTerritoryWarBoost(user);
      target.reward_medical_experience = Math.floor(
        target.reward_medical_experience * (1 + territoryBoost),
      );
      const clanHunterExpBoost = getClanBoost(user, "hunterExpBoost") + territoryBoost;
      const clanGathererExpBoost =
        getClanBoost(user, "gathererExpBoost") + territoryBoost;
      const clanCraftingExpBoost =
        getClanBoost(user, "craftingExpBoost") + territoryBoost;
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
        const boost = getGameSettingBoost("missionExpMultiplier", settings);
        if (boost) target.reward_exp = Math.floor(target.reward_exp * boost.value);
      }
    };
    scaleRewards(rawRewards);
    if (choiceRewards) {
      scaleRewards(choiceRewards);
      for (const pack of choiceRewards.reward_packages ?? [])
        scaleRewards(pack.rewards);
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
  // Milestone fields are completion-only and must survive ordinary package aggregation.
  if (resolved && userQuest && !isCompletedHelper) {
    rawRewards = {
      ...rawRewards,
      reward_level: userQuest.quest.content.reward.reward_level,
      reward_stats: userQuest.quest.content.reward.reward_stats,
    };
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
  if (resolved && userQuest && !isCompletedHelper) {
    followupTrackerTasks.push({
      task: "complete_specific_quest",
      increment: 1,
      contentId: userQuest.questId,
    });
    // Credit this claim before its completion history has been persisted.
    const completionTask =
      QuestCompletionTasks[
        userQuest.quest.questType as keyof typeof QuestCompletionTasks
      ];
    if (completionTask)
      followupTrackerTasks.push({ task: completionTask, increment: 1 });
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
  const gains = [
    ["medical_experience_gained", rewards.reward_medical_experience],
    ["crafting_experience_gained", rewards.reward_crafting_experience],
    ["hunting_experience_gained", rewards.reward_hunting_experience],
    ["gathering_experience_gained", rewards.reward_gathering_experience],
  ] as const;
  return gains.flatMap(([task, increment]) =>
    increment > 0 ? [{ task, increment }] : [],
  );
};

/**
 * Post-process rewards to ensure that the rewards are valid
 * @param rewards - Rewards to post-process
 * @param user - Recipient of an unscaled configured payout; omit for getReward outputs
 * @returns Post-processed rewards with item IDs as flat string array
 *
 * NOTE: Return type is explicitly annotated with PostProcessedRewards from
 * @/validators/rewards to ensure type safety. If this function's return value
 * changes, TypeScript will error, alerting us to update the schema.
 */
export const postProcessRewards = (
  rewards: ObjectiveRewardType,
  user?: Parameters<typeof getVillageLoyaltyBonuses>[0],
): PostProcessedRewards => {
  // Defensive check: ensure reward_items is an array (handles malformed DB data)
  const rewardItems = Array.isArray(rewards?.reward_items) ? rewards.reward_items : [];
  // Pass user for unscaled configured payouts; getReward already applies its quest factors.
  const villageRewardBonus = user ? getVillageLoyaltyBonuses(user).villageRewards : 0;
  return {
    ...rewards,
    ...(villageRewardBonus > 0
      ? {
          reward_tokens:
            rewards.reward_tokens > 0
              ? Math.round(boostPvpGain(rewards.reward_tokens, villageRewardBonus))
              : rewards.reward_tokens,
          reward_prestige:
            rewards.reward_prestige > 0
              ? Math.round(boostPvpGain(rewards.reward_prestige, villageRewardBonus))
              : rewards.reward_prestige,
        }
      : {}),
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

export type GetRewardResult = ReturnType<typeof getReward>["rewards"];

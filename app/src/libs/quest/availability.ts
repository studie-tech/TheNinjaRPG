import {
  type GATHERING_RANK,
  GATHERING_RANKS,
  type HUNTING_RANK,
  HUNTING_RANKS,
  MAX_EXPERIENCE_LEVEL,
  MAX_PLAYER_LEVEL,
  type MEDNIN_RANK,
  MEDNIN_RANKS,
  type QuestType,
  QuestTypesWithMaxAttempts,
  type RetryQuestDelay,
  type SAGE_MASTERY_RANK,
  VILLAGE_SYNDICATE_ID,
  WAR_MISSION_REQUIRED_RANK,
} from "@/drizzle/constants";
import type { UserData } from "@/drizzle/schema";
import { eliteJoninMilestoneBlockMessage } from "@/libs/eliteJonin";
import { getFarmingLevel } from "@/libs/farming";
import { getGatheringRank } from "@/libs/gathering";
import { calcMedninRank } from "@/libs/hospital";
import { getHuntingRank } from "@/libs/hunting";
import {
  MASTERY_REQUIREMENT_FIELDS,
  type MasteryRequirementFields,
  missingMasteryRequirement,
} from "@/libs/mastery";
import { canPromoteMastery } from "@/libs/masteryProgression";
import { eliteJoninExamBlockMessage } from "@/libs/profile";
import { isOpenPyramidRun } from "@/libs/questRun";
import { hasRequiredRank } from "@/libs/rank";
import { isRewardChoiceQuest } from "@/libs/rewardChoice";
import { collapseRewards } from "@/libs/rewards";
import { getSageMasteryDisplayRank, isSageRankAtLeast } from "@/libs/sageMode";
import { canPlayHiddenQuests } from "@/utils/permissions";
import { capitalizeFirstLetter } from "@/utils/string";
import { hasEndDatePassed, periodStart } from "@/utils/time";
import type { QuestContentType } from "@/validators/objectives";
import { rewardPayloads } from "@/validators/rewardPackages";
import { hasMasteryPromotion } from "@/validators/rewards";

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
    content?: Pick<QuestContentType, "reward" | "rewardMode"> & {
      objectives?: readonly AvailabilityObjective[];
    };
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
    endAt?: Date | string | null;
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
  isConcurrentWarMission = false,
) => {
  if (
    questAndUserQuestInfo.questType === "war" &&
    !hasRequiredRank(user.rank, WAR_MISSION_REQUIRED_RANK)
  )
    return {
      check: false,
      message: `War missions require ${capitalizeFirstLetter(WAR_MISSION_REQUIRED_RANK)} rank or higher`,
    };
  if (
    !isConcurrentWarMission &&
    questAndUserQuestInfo.content?.objectives?.some(
      (o) => o.task === "espionage" || o.task === "sabotage",
    )
  )
    return {
      check: false,
      message: "Start this concurrent war mission from the townhall war objectives",
    };
  // Derived Data
  const maxAttempts = questAndUserQuestInfo.maxAttempts;
  const maxCompletes = questAndUserQuestInfo.maxCompletes;
  const questMedRank = questAndUserQuestInfo.medicalRank;
  const questHuntRank = questAndUserQuestInfo.huntingRank;
  const questGatherRank = questAndUserQuestInfo.gatheringRank;

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
  const completionReward = questAndUserQuestInfo.content?.reward;
  // Choice packages promote only when picked; the direct promotion pays at completion.
  const promotion =
    !isRewardChoiceQuest(questAndUserQuestInfo.content) &&
    completionReward?.reward_packages?.length
      ? collapseRewards(rewardPayloads(completionReward))
      : completionReward;
  const promotionCheck =
    !promotion ||
    !hasMasteryPromotion(promotion) ||
    canPromoteMastery(
      baseMasteries,
      promotion.reward_mastery_stat,
      promotion.reward_mastery_rank,
    );
  // Any possible promotion path must satisfy the exam, including objectives and choices.
  const hasEliteExamReward =
    promotion?.reward_rank === "ELITE JONIN" ||
    completionReward?.reward_packages?.some(
      (pack) => pack.rewards.reward_rank === "ELITE JONIN",
    ) ||
    questAndUserQuestInfo.content?.objectives?.some(
      (objective) =>
        objective.reward_rank === "ELITE JONIN" ||
        objective.reward_packages?.some(
          (pack) => pack.rewards.reward_rank === "ELITE JONIN",
        ),
    );
  const examBlock = hasEliteExamReward
    ? eliteJoninExamBlockMessage(baseMasteries)
    : null;
  const milestoneBlock = completionReward?.reward_level
    ? eliteJoninMilestoneBlockMessage(user, completionReward.reward_level)
    : null;
  // Checks
  const now = new Date();
  const hideCheck = !questAndUserQuestInfo.hidden || canPlayHiddenQuests(user.role);
  const startsCheck =
    !questAndUserQuestInfo.startsAt || new Date(questAndUserQuestInfo.startsAt) <= now;
  const expiresCheck = !hasEndDatePassed(questAndUserQuestInfo.endsAt, now);
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
  const medicalRankCheck = meetsRank(
    MEDNIN_RANKS,
    questMedRank,
    calcMedninRank({ medicalExperience: user.medicalExperience, rank: user.rank }),
  );
  const huntingRankCheck = meetsRank(
    HUNTING_RANKS,
    questHuntRank,
    getHuntingRank(user.huntingExperience),
  );
  const gatheringRankCheck = meetsRank(
    GATHERING_RANKS,
    questGatherRank,
    getGatheringRank(user.gatheringExperience),
  );
  const farmingLevelCheck =
    questAndUserQuestInfo.questType === "daily" ||
    !questAndUserQuestInfo.requiredFarmingLevel ||
    getFarmingLevel(user.farmingExperience) >=
      questAndUserQuestInfo.requiredFarmingLevel;

  // Level check - user must be >= requiredLevel and <= maxLevel
  const userLevel = getUnscaledLevel(user);
  // The cap gates entering a Pyramid; a run's own fights can carry the player past it.
  const maxLevel = isOpenPyramidRun(questAndUserQuestInfo)
    ? null
    : questAndUserQuestInfo.maxLevel;
  const levelCheck =
    (!questAndUserQuestInfo.requiredLevel ||
      userLevel >= questAndUserQuestInfo.requiredLevel) &&
    (!maxLevel ||
      userLevel <=
        getQuestMaxLevel({
          maxLevel,
          content: questAndUserQuestInfo.content,
        }));

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

  // Per-period completion cap (only meaningful when retryDelay != none). Special
  // quests consume another item for each attempt, so completion caps do not apply.
  const periodCapCheck =
    questAndUserQuestInfo.questType === "special" ||
    !periodCapReached({
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

  // Every failed rule is unavailable and contributes its reason
  const failures: string[] = [];
  if (!hideCheck) failures.push("Quest is hidden");
  if (!startsCheck) failures.push("Quest starts in the future");
  if (!expiresCheck) failures.push("Quest has expired");
  if (!eventCompletedCheck) failures.push("Quest has been completed too many times");
  if (!eventAttemptsCheck) failures.push("Quest has been attempted too many times");
  if (!periodCapCheck) failures.push("Quest limit for this period reached");
  if (!villageCheck) failures.push("Quest is not available in your village");
  if (!bloodlineCheck) failures.push("Quest requires a specific bloodline");
  if (!sageModeCheck) failures.push("Quest requires a specific sage mode");
  if (!sageRankCheck) failures.push("Quest requires a higher sage mode rank");
  if (!masteryCheck)
    failures.push(
      "Quest requires more earned mastery (equipment and bloodline bonuses do not count)",
    );
  if (!promotionCheck) failures.push("Quest requires the previous mastery rank");
  if (examBlock) failures.push(examBlock);
  if (milestoneBlock) failures.push(milestoneBlock);
  if (!prerequisiteCheck)
    failures.push("You must complete the prerequisite quest first");
  if (!medicalRankCheck)
    failures.push(
      `Quest requires medical rank ${capitalizeFirstLetter(questMedRank ?? "NONE")}`,
    );
  if (!huntingRankCheck)
    failures.push(
      `Quest requires hunting rank ${capitalizeFirstLetter(questHuntRank ?? "NONE")}`,
    );
  if (!gatheringRankCheck)
    failures.push(
      `Quest requires gathering rank ${capitalizeFirstLetter(questGatherRank ?? "NONE")}`,
    );
  if (!farmingLevelCheck)
    failures.push(
      `Quest requires farming level ${questAndUserQuestInfo.requiredFarmingLevel}`,
    );
  if (!levelCheck) {
    if (
      questAndUserQuestInfo.requiredLevel &&
      userLevel < questAndUserQuestInfo.requiredLevel
    ) {
      failures.push(`Quest requires level ${questAndUserQuestInfo.requiredLevel}`);
    }
    if (maxLevel && userLevel > maxLevel) {
      failures.push(`Quest is only available up to level ${maxLevel}`);
    }
  }
  // Returned detailed info on all the checks
  return {
    check: failures.length === 0,
    message: failures.map((failure) => `${failure}\n`).join(""),
  };
};

/** An unset rank and the zero-index "NONE" rank both mean no requirement. */
const meetsRank = <Rank extends string>(
  ranks: readonly Rank[],
  required: Rank | null | undefined,
  current: Rank,
) => {
  const requiredIndex = required ? ranks.indexOf(required) : null;
  return !requiredIndex || ranks.indexOf(current) >= requiredIndex;
};

/** The level a combat-scaled user carried into battle, otherwise the current level. */
export const getUnscaledLevel = (user: Pick<UserData, "level">) =>
  "originalLevel" in user && typeof user.originalLevel === "number"
    ? user.originalLevel
    : (user.level ?? 1);

/**
 * Extend only legacy quests capped at the XP ceiling; milestone and other explicit caps
 * retain their authored level bounds.
 */
export const getQuestMaxLevel = (quest: {
  maxLevel: number;
  content?: { reward?: { reward_level?: number } } | null;
}) =>
  quest.maxLevel === MAX_EXPERIENCE_LEVEL && !quest.content?.reward?.reward_level
    ? MAX_PLAYER_LEVEL
    : quest.maxLevel;

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
 * The level or mastery a quest still needs, or null when it is open now, hidden, or blocked by
 * any other rule. Re-runs `isAvailableUserQuests` with those requirements met, so every other
 * availability rule stays in one place.
 */
export const getUpcomingQuestBlock = (
  questInfo: Parameters<typeof isAvailableUserQuests>[0] & MasteryRequirementFields,
  user: Parameters<typeof isAvailableUserQuests>[1],
): UpcomingBlock | null => {
  if (questInfo.hidden) return null;
  if (isAvailableUserQuests(questInfo, user, true).check) return null;
  const requiredLevel = questInfo.requiredLevel ?? 1;
  const relaxed = { ...user, level: Math.max(user.level, requiredLevel) };
  for (const [field, stat] of MASTERY_REQUIREMENT_FIELDS) {
    const required = questInfo[field];
    if (required) relaxed[stat] = Math.max(user[stat] ?? 0, required);
  }
  if (!isAvailableUserQuests(questInfo, relaxed, true).check) return null;
  if (user.level < requiredLevel) {
    return { kind: "level", required: requiredLevel, current: user.level };
  }
  const mastery = missingMasteryRequirement(user, questInfo);
  return mastery ? { kind: "mastery", ...mastery } : null;
};

/**
 * Quests a player is close to unlocking, with the requirement each still needs, sorted by
 * required level and then name.
 */
export const listUpcomingQuests = <
  T extends Parameters<typeof getUpcomingQuestBlock>[0] & {
    id: string;
    name: string;
    image: string | null;
    description: string | null;
    requiredLevel: number;
    maxLevel: number;
  },
>(
  quests: T[],
  user: Parameters<typeof isAvailableUserQuests>[1],
) =>
  quests
    .flatMap((entry) => {
      const block = getUpcomingQuestBlock(entry, user);
      return block
        ? [
            {
              id: entry.id,
              name: entry.name,
              image: entry.image,
              description: entry.description,
              requiredLevel: entry.requiredLevel,
              maxLevel: entry.maxLevel,
              block,
            },
          ]
        : [];
    })
    .sort((a, b) => a.requiredLevel - b.requiredLevel || a.name.localeCompare(b.name));

/**
 * The objective facts availability reads, for listings that omit objective content: a
 * concurrent war task, and an Elite Jonin promotion in any objective or its reward choices.
 */
export const summarizeAvailabilityObjectives = (facts: {
  concurrentWarTask: boolean;
  eliteJoninReward: boolean;
}): AvailabilityObjective[] => [
  ...(facts.concurrentWarTask ? [{ task: "espionage" as const }] : []),
  ...(facts.eliteJoninReward ? [{ reward_rank: "ELITE JONIN" as const }] : []),
];

/** Objective fields that decide quest availability. */
type AvailabilityObjective = Partial<
  Pick<
    QuestContentType["objectives"][number],
    "task" | "reward_rank" | "reward_packages"
  >
>;

/** Why a quest is not open yet, when the player can work towards it. */
export type UpcomingBlock =
  | { kind: "level"; required: number; current: number }
  | { kind: "mastery"; label: string; required: number; current: number };

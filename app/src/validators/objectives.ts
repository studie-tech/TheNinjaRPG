import { z } from "zod";
import { DateTimeRegExp } from "@/utils/regex";
import {
  UserRanks,
  LetterRanks,
  QuestTypes,
  RetryQuestDelays,
} from "@/drizzle/constants";

export const SimpleTasks = [
  "pvp_kills",
  "arena_kills",
  "minutes_passed",
  // "anbu_kills",
  // "tournaments_won",
  // "village_funds_earned",
  // "any_missions_completed",
  // "any_crimes_completed",
  "days_as_kage",
  "errands_total",
  "a_missions_total",
  "b_missions_total",
  "c_missions_total",
  "d_missions_total",
  "a_crimes_total",
  "b_crimes_total",
  "c_crimes_total",
  "d_crimes_total",
  "minutes_training",
  "stats_trained",
  "days_in_village",
  "jutsus_mastered",
  "user_level",
  "reputation_points",
  "random_encounter_wins",
  //"students_trained",
] as const;

export const InstantTasks = [
  "fail_quest",
  "win_quest",
  "reset_quest",
  "new_quest",
  "start_battle",
] as const;
export type InstantTasksType = (typeof InstantTasks)[number];

export const LocationTasks = [
  "move_to_location",
  "collect_item",
  "deliver_item",
  "defeat_opponents",
] as const;
export type LocationTasksType = (typeof LocationTasks)[number];

export const allObjectiveTasks = [
  ...SimpleTasks,
  ...LocationTasks,
  ...InstantTasks,
  "dialog",
] as const;
export type AllObjectiveTask = (typeof allObjectiveTasks)[number];

export const idsWithNumberField = z
  .array(
    z.object({
      ids: z.array(z.string()).default([]),
      number: z.number(),
    }),
  )
  .default([]);

export const rewardFields = {
  reward_seichi_silver: z.coerce.number().default(0),
  reward_money: z.coerce.number().default(0),
  reward_clanpoints: z.coerce.number().default(0),
  reward_exp: z.coerce.number().default(0),
  reward_tokens: z.coerce.number().default(0),
  reward_prestige: z.coerce.number().default(0),
  reward_reputation: z.coerce.number().default(0),
  reward_rank: z.enum(UserRanks).default("NONE"),
  reward_items: idsWithNumberField,
  reward_jutsus: z.array(z.string()).default([]),
  reward_bloodlines: z.array(z.string()).default([]),
  reward_badges: z.array(z.string()).default([]),
};

export const ObjectiveReward = z.object(rewardFields);
export type ObjectiveRewardType = z.infer<typeof ObjectiveReward>;

export const hasReward = (reward: ObjectiveRewardType) => {
  const parsedReward = ObjectiveReward.parse(reward);
  return (
    parsedReward.reward_money > 0 ||
    parsedReward.reward_seichi_silver > 0 ||
    parsedReward.reward_clanpoints > 0 ||
    parsedReward.reward_exp > 0 ||
    parsedReward.reward_prestige > 0 ||
    parsedReward.reward_reputation > 0 ||
    parsedReward.reward_rank !== "NONE" ||
    parsedReward.reward_items.length > 0 ||
    parsedReward.reward_jutsus.length > 0 ||
    parsedReward.reward_bloodlines.length > 0 ||
    parsedReward.reward_badges.length > 0
  );
};

export const attackerFields = {
  attackers: idsWithNumberField,
  attackers_scaled_to_user: z.coerce.boolean().default(false),
  attackers_scale_gains: z.coerce.number().min(0).max(1).default(1),
};

export const baseObjectiveFields = {
  id: z.string(),
  description: z.string().default(""),
  successDescription: z.string().default(""),
  nextObjectiveId: z.string().optional(),
  sceneBackground: z.string().default(""),
  sceneCharacters: z.array(z.string()).default([]),
  // Default not set, but used for e.g. dialog objectives
  sector: z.coerce.number().optional(),
  longitude: z.coerce.number().optional(),
  latitude: z.coerce.number().optional(),
};

export const SimpleObjective = z.object({
  ...baseObjectiveFields,
  task: z.enum(SimpleTasks),
  value: z.coerce.number().min(0).default(3),
  ...rewardFields,
  ...attackerFields,
});

export const InstantWinLoseObjective = z.object({
  ...baseObjectiveFields,
  task: z.enum(["reset_quest", "fail_quest", "win_quest"]),
  ...rewardFields,
});

export const InstantNewQuestObjective = z.object({
  ...baseObjectiveFields,
  task: z.literal("new_quest").default("new_quest"),
  newQuestIds: z.array(z.string()).default([]),
  ...rewardFields,
});

export const InstantStartBattleObjective = z.object({
  ...baseObjectiveFields,
  failObjectiveId: z.string().optional(),
  task: z.literal("start_battle").default("start_battle"),
  opponentAIs: idsWithNumberField,
  opponent_scaled_to_user: z.coerce.boolean().default(false),
  completionOutcome: z.enum(["Win", "Lose", "Flee", "Draw", "Any"]).default("Win"),
  failDescription: z.string().default("You failed to defeat the opponent"),
  fleeDescription: z.string().default("You fled from the opponent"),
  drawDescription: z.string().default("The battle ended in a draw"),
  scaleGains: z.coerce.number().min(0).max(1).default(1),
  ...rewardFields,
});

const SECTOR_TYPES = [
  "specific",
  "random",
  "from_list",
  "user_village",
  "current_sector",
] as const;
export type SectorType = (typeof SECTOR_TYPES)[number];
export const LOCATION_TYPES = ["specific", "random"] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];

const complexObjectiveFields = {
  // Location type fields
  sectorType: z.enum(SECTOR_TYPES).default("specific"),
  locationType: z.enum(LOCATION_TYPES).default("specific"),
  // Specific locations (also used once objective is instantiated from e.g. random, from_list, village, etc.)
  sector: z.coerce.number().min(0).default(0),
  longitude: z.coerce.number().min(0).default(0),
  latitude: z.coerce.number().min(0).default(0),
  // Sector list
  sectorList: z.array(z.string()).default([]),
  // Generic fields
  hideLocation: z.coerce.boolean().default(false),
  completed: z.coerce.number().min(0).max(1).default(0),
  image: z.string().default(""),
  ...rewardFields,
  ...attackerFields,
};
export const baseComplexObjective = z.object(complexObjectiveFields);
export type ComplexObjectiveFields = z.infer<typeof baseComplexObjective>;

// Dialog objective schema
export const DialogObjective = z.object({
  ...baseObjectiveFields,
  ...rewardFields,
  ...attackerFields,
  task: z.literal("dialog").default("dialog"),
  image: z.string().default(""),
  nextObjectiveId: z
    .array(
      z.object({
        text: z.string(),
        nextObjectiveId: z.string().optional(),
      }),
    )
    .default([]),
});

export const MoveToObjective = z.object({
  ...baseObjectiveFields,
  ...complexObjectiveFields,
  task: z.literal("move_to_location").default("move_to_location"),
});

export const CollectItem = z.object({
  ...baseObjectiveFields,
  task: z.literal("collect_item").default("collect_item"),
  item_name: z.string().min(3).default("Secret scroll"),
  collectItemIds: z.array(z.string()).default([]),
  delete_on_complete: z.coerce.boolean().default(false),
  ...complexObjectiveFields,
});
export type CollectItemType = z.infer<typeof CollectItem>;

export const DeliverItem = z.object({
  ...baseObjectiveFields,
  task: z.literal("deliver_item").default("deliver_item"),
  item_name: z.string().min(3).default("Secret scroll"),
  deliverItemIds: z.array(z.string()).default([]),
  delete_on_complete: z.coerce.boolean().default(true),
  ...complexObjectiveFields,
});
export type DeliverItemType = z.infer<typeof DeliverItem>;

export const DefeatOpponents = z.object({
  ...baseObjectiveFields,
  failObjectiveId: z.string().optional(),
  task: z.literal("defeat_opponents").default("defeat_opponents"),
  opponentAIs: idsWithNumberField,
  opponent_scaled_to_user: z.coerce.boolean().default(false),
  completionOutcome: z.enum(["Win", "Lose", "Flee", "Draw", "Any"]).default("Win"),
  failDescription: z.string().default("You failed to defeat the opponent"),
  fleeDescription: z.string().default("You fled from the opponent"),
  drawDescription: z.string().default("The battle ended in a draw"),
  scaleGains: z.coerce.number().min(0).max(1).default(1),
  ...complexObjectiveFields,
});

export const AllObjectives = z.union([
  SimpleObjective,
  InstantWinLoseObjective,
  InstantNewQuestObjective,
  InstantStartBattleObjective,
  MoveToObjective,
  CollectItem,
  DeliverItem,
  DefeatOpponents,
  DialogObjective,
]);
export type AllObjectivesType = z.infer<typeof AllObjectives>;

export const ObjectiveTracker = z.object({
  id: z.string(),
  done: z.boolean().default(false),
  value: z.coerce.number().default(0),
  collected: z.boolean().default(false),
  sector: z.coerce.number().min(0).optional(),
  longitude: z.coerce.number().min(0).optional(),
  latitude: z.coerce.number().min(0).optional(),
  selectedNextObjectiveId: z.string().optional(),
  recentlyDied: z.boolean().default(false),
});
export type ObjectiveTrackerType = z.infer<typeof ObjectiveTracker>;

export type QuestContentType = {
  reward: ObjectiveRewardType;
  objectives: AllObjectivesType[];
  sceneBackground: string;
  sceneCharacters: string[];
};

export const QuestTracker = z.object({
  id: z.string(),
  startAt: z.string().datetime().default(new Date().toISOString()),
  goals: z.array(ObjectiveTracker).default([]),
});
export type QuestTrackerType = z.infer<typeof QuestTracker>;

export const QuestValidatorRawSchema = z.object({
  name: z.string().min(1).max(191),
  image: z.string().url().optional().nullish(),
  description: z.string().min(1).max(5000).nullable(),
  successDescription: z.string().min(1).max(5000).nullable(),
  questRank: z.enum(LetterRanks).optional(),
  requiredLevel: z.coerce.number().min(0).max(100).optional(),
  maxLevel: z.coerce.number().min(0).max(100).optional(),
  maxAttempts: z.coerce.number().min(0).max(100).default(1),
  maxCompletes: z.coerce.number().min(0).max(100).default(1),
  requiredVillage: z.string().min(0).max(30).optional().nullish(),
  prerequisiteQuestId: z.string().min(0).max(191).optional().nullish(),
  tierLevel: z.coerce.number().min(0).max(100).nullable(),
  questType: z.enum(QuestTypes),
  content: z.object({
    objectives: z.array(AllObjectives),
    reward: ObjectiveReward,
    sceneBackground: z.string().default(""),
    sceneCharacters: z.array(z.string()).default([]),
  }),
  hidden: z.coerce.boolean(),
  retryDelay: z.enum(RetryQuestDelays).optional(),
  consecutiveObjectives: z.coerce.boolean(),
  endsAt: z.string().regex(DateTimeRegExp, "Must be of format YYYY-MM-DD").nullable(),
  startsAt: z.string().regex(DateTimeRegExp, "Must be of format YYYY-MM-DD").nullable(),
});
export const QuestValidator = QuestValidatorRawSchema.superRefine((val, ctx) => {
  if (["daily", "tier"].includes(val.questType)) {
    if (val.content.objectives.length < 3 || val.content.objectives.length > 7) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Daily & Tier quests must have between 3 and 7 objectives",
      });
    }
  }
});
export type ZodQuestType = z.infer<typeof QuestValidator>;

export const getObjectiveSchema = (type: string) => {
  if (SimpleTasks.includes(type as (typeof SimpleTasks)[number])) {
    return SimpleObjective;
  } else if (["fail_quest", "reset_quest", "win_quest"].includes(type)) {
    return InstantWinLoseObjective;
  } else if (type === "new_quest") {
    return InstantNewQuestObjective;
  } else if (type === "start_battle") {
    return InstantStartBattleObjective;
  } else if (type === "move_to_location") {
    return MoveToObjective;
  } else if (type === "collect_item") {
    return CollectItem;
  } else if (type === "deliver_item") {
    return DeliverItem;
  } else if (type === "defeat_opponents") {
    return DefeatOpponents;
  } else if (type === "dialog") {
    return DialogObjective;
  }
  throw new Error(`Unknown objective task ${type}`);
};

export const allObjectiveSchema = z.union([
  SimpleObjective,
  MoveToObjective,
  CollectItem,
  DeliverItem,
  DefeatOpponents,
]);

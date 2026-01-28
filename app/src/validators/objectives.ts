import { z } from "zod";
import { DateTimeRegExp } from "@/utils/regex";
import {
  LetterRanks,
  QuestTypes,
  RetryQuestDelays,
  MEDNIN_RANKS,
  HUNTING_RANKS,
  GATHERING_RANKS,
} from "@/drizzle/constants";
import { AllTags } from "@/validators/combat";
import { idsWithNumberField } from "@/validators/base";
import {
  rewardFields,
  ObjectiveReward,
  type ObjectiveRewardType,
} from "@/validators/rewards";

// Re-export idsWithNumberField so consumers can import from objectives
export { idsWithNumberField };

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
  "spars_won",
  "medical_experience",
  "medical_experience_gained",
  "crafting_experience",
  "crafting_experience_gained",
  "hunting_experience",
  "hunting_experience_gained",
  "gathering_experience",
  "gathering_experience_gained",
  //"students_trained",
] as const;

export const InstantTasks = [
  "fail_quest",
  "win_quest",
  "new_quest",
  "start_battle",
] as const;
export type InstantTasksType = (typeof InstantTasks)[number];

export const RaidTasks = ["open_raid", "exclusive_raid"] as const;
export type RaidTasksType = (typeof RaidTasks)[number];

export const LocationTasks = [
  "move_to_location",
  "win_encounter_at_location",
  "collect_item",
  "deliver_item",
  "defeat_opponents",
] as const;
export type LocationTasksType = (typeof LocationTasks)[number];

export const allObjectiveTasks = [
  ...SimpleTasks,
  ...LocationTasks,
  ...InstantTasks,
  ...RaidTasks,
  "reset_quest",
  "dialog",
] as const;
export type AllObjectiveTask = (typeof allObjectiveTasks)[number];

export const attackerFields = {
  attackers: idsWithNumberField,
  attackers_scaled_to_user: z.coerce.boolean().default(false),
  attackers_scale_gains: z.coerce.number().min(0).max(1).default(1),
  attackers_max_per_battle: z.coerce.number().min(0).max(100).default(1),
};

// Shared fields for battle objectives (start_battle, raids, defeat_opponents)
export const battleObjectiveFields = {
  failObjectiveId: z.string().optional(),
  opponent_scaled_to_user: z.coerce.boolean().default(false),
  completionOutcome: z.enum(["Win", "Lose", "Flee", "Draw", "Any"]).default("Win"),
  failDescription: z.string().default("You failed to defeat the opponent"),
  fleeDescription: z.string().default("You fled from the opponent"),
  drawDescription: z.string().default("The battle ended in a draw"),
  scaleGains: z.coerce.number().min(0).max(1).default(1),
  keepOriginalPools: z.coerce.boolean().default(false),
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
  task: z.enum(["fail_quest", "win_quest"]),
  ...rewardFields,
});

export const ResetQuestObjective = z.object({
  ...baseObjectiveFields,
  task: z.literal("reset_quest").default("reset_quest"),
  resetObjectiveId: z.string().optional(),
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
  ...battleObjectiveFields,
  task: z.literal("start_battle").default("start_battle"),
  opponentAIs: idsWithNumberField.refine((data) => data.length > 0, {
    message: "At least one opponent AI is required",
  }),
  ...rewardFields,
});

const SECTOR_TYPES = [
  "specific",
  "random",
  "from_list",
  "user_village",
  "current_sector",
  "enemy_village",
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

export const EncountersAtLocation = z.object({
  ...baseObjectiveFields,
  ...complexObjectiveFields,
  locationType: z.enum(LOCATION_TYPES).default("random"),
  task: z.literal("win_encounter_at_location").default("win_encounter_at_location"),
});

export const CollectItem = z.object({
  ...baseObjectiveFields,
  task: z.literal("collect_item").default("collect_item"),
  item_name: z.string().min(3).default("Secret scroll"),
  collectItemIds: z.array(z.string()).default([]),
  delete_on_complete: z.coerce.boolean().default(false),
  collect_time_minutes: z.coerce.number().min(0).max(60).default(0),
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
  ...battleObjectiveFields,
  task: z.literal("defeat_opponents").default("defeat_opponents"),
  opponentAIs: idsWithNumberField,
  ...complexObjectiveFields,
});

export const RaidObjective = z.object({
  ...baseObjectiveFields,
  ...battleObjectiveFields,
  task: z.enum(["open_raid", "exclusive_raid"]),
  image: z.string().default(""),
  // Override sector from baseObjectiveFields to be required for raids
  sector: z.coerce.number().min(0),
  opponentAIs: idsWithNumberField.refine((data) => data.length > 0, {
    message: "At least one raid boss AI is required",
  }),
  // Override default descriptions for raid context
  failDescription: z.string().default("You failed to defeat the raid boss"),
  fleeDescription: z.string().default("You fled from the raid boss"),
  ...rewardFields,
});
export type RaidObjectiveType = z.infer<typeof RaidObjective>;

export const AllObjectives = z.union([
  SimpleObjective,
  InstantWinLoseObjective,
  ResetQuestObjective,
  InstantNewQuestObjective,
  InstantStartBattleObjective,
  MoveToObjective,
  CollectItem,
  DeliverItem,
  DefeatOpponents,
  DialogObjective,
  EncountersAtLocation,
  RaidObjective,
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
  timestamp: z.string().datetime().optional(),
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
  medicalRank: z.enum(MEDNIN_RANKS).optional().nullish(),
  huntingRank: z.enum(HUNTING_RANKS).optional().nullish(),
  gatheringRank: z.enum(GATHERING_RANKS).optional().nullish(),
  requiredLevel: z.coerce.number().min(0).max(100).optional(),
  maxLevel: z.coerce.number().min(0).max(100).optional(),
  maxAttempts: z.coerce.number().min(0).max(100).default(1),
  maxCompletes: z.coerce.number().min(0).max(100).default(1),
  requiredVillage: z.string().min(0).max(30).optional().nullish(),
  requiredBloodlineId: z.string().min(0).max(191).optional().nullish(),
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
  // Raid-specific fields (only persisted data, AI and sector come from objective)
  raidBossMaxHealth: z.coerce.number().min(1).optional().nullish(),
  raidBossCurrentHealth: z.coerce.number().min(0).optional().nullish(),
});
// Shared superRefine logic for quest validation
const questSuperRefine = (
  val: z.infer<typeof QuestValidatorRawSchema>,
  ctx: z.RefinementCtx,
) => {
  if (["daily"].includes(val.questType)) {
    if (val.content.objectives.length < 3 || val.content.objectives.length > 7) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Daily quests must have between 3 and 7 objectives",
      });
    }
  }
  if (val.questType === "raid") {
    if (val.content.objectives.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Raid quests must have exactly one objective",
      });
    }
    const objective = val.content.objectives[0];
    const objectiveTask = objective?.task;
    if (objectiveTask && !["open_raid", "exclusive_raid"].includes(objectiveTask)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Raid quest objective must be 'open_raid' or 'exclusive_raid'",
      });
    }
    // Validate opponentAIs is present in objective (handled by schema refinement, but validate here too)
    const opponentAIs = (objective as { opponentAIs?: { ids: string[] }[] })
      ?.opponentAIs;
    if (!opponentAIs || opponentAIs.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Raid quest objective must have at least one boss AI (configure opponentAIs in the objective)",
        path: ["content", "objectives", 0, "opponentAIs"],
      });
    }

    // Both raid types require a sector number in the objective
    const sector = (objective as { sector?: number })?.sector;
    if (sector === null || sector === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Raids require a sector number in the objective (sector field)",
        path: ["content", "objectives", 0, "sector"],
      });
    }

    // Validate raid-specific fields (persisted in quest table)
    if (!val.raidBossMaxHealth || val.raidBossMaxHealth < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Raid quests require a boss max health > 0",
        path: ["raidBossMaxHealth"],
      });
    }
    if (val.raidBossCurrentHealth === null || val.raidBossCurrentHealth === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Raid quests require current boss health",
        path: ["raidBossCurrentHealth"],
      });
    }
    // Validate that raidBossCurrentHealth doesn't exceed raidBossMaxHealth
    if (
      val.raidBossCurrentHealth !== undefined &&
      val.raidBossCurrentHealth !== null &&
      val.raidBossMaxHealth !== undefined &&
      val.raidBossMaxHealth !== null &&
      val.raidBossCurrentHealth > val.raidBossMaxHealth
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Raid boss current health cannot exceed max health",
        path: ["raidBossCurrentHealth"],
      });
    }
  }
};

export const QuestValidator = QuestValidatorRawSchema.superRefine(questSuperRefine);
export type ZodQuestType = z.infer<typeof QuestValidator>;

// Combined schema for the quest edit form that includes:
// - All quest fields from QuestValidatorRawSchema
// - Reward fields at top level (for easy form binding)
// - Scene fields at top level (for easy form binding)
// - The superRefine validations
export const QuestFormRawSchema = QuestValidatorRawSchema.merge(ObjectiveReward).merge(
  z.object({
    sceneBackground: z.string().default(""),
    sceneCharacters: z.array(z.string()).default([]),
  }),
);
export const QuestFormSchema = QuestFormRawSchema.superRefine(questSuperRefine);
export type ZodQuestFormType = z.infer<typeof QuestFormSchema>;

export const getObjectiveSchema = (type: string) => {
  if (SimpleTasks.includes(type as (typeof SimpleTasks)[number])) {
    return SimpleObjective;
  } else if (["fail_quest", "win_quest"].includes(type)) {
    return InstantWinLoseObjective;
  } else if (type === "reset_quest") {
    return ResetQuestObjective;
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
  } else if (type === "win_encounter_at_location") {
    return EncountersAtLocation;
  } else if (type === "open_raid" || type === "exclusive_raid") {
    return RaidObjective;
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

/**
 * Validator schema for Raid Damage Threshold configuration.
 * Used for creating/updating threshold records via the admin UI.
 */
export const RaidDamageThresholdValidator = z.object({
  id: z.string().optional(), // Optional for creates
  questId: z.string(),
  damageRequired: z.coerce.number().min(1, "Damage must be at least 1"),
  sortOrder: z.coerce.number().min(0).max(255).default(0),
  rewards: ObjectiveReward,
  effects: z.array(AllTags).default([]),
  effectDurationMinutes: z.coerce.number().min(1).max(10080).default(60),
});
export type RaidDamageThresholdType = z.infer<typeof RaidDamageThresholdValidator>;

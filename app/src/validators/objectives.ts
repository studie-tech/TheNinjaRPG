import { z } from "zod";
import {
  FARMING_MAX_LEVEL,
  GATHERING_RANKS,
  HUNTING_RANKS,
  IMG_BADGE_A_CRIME_TOTAL,
  IMG_BADGE_A_MISSION_TOTAL,
  IMG_BADGE_ARENAKILLS,
  IMG_BADGE_B_CRIME_TOTAL,
  IMG_BADGE_B_MISSION_TOTAL,
  IMG_BADGE_BATTLE_PYRAMIDS_COMPLETED,
  IMG_BADGE_BLOODLINE_COLLECTION,
  IMG_BADGE_BUY_ITEM,
  IMG_BADGE_C_CRIME_TOTAL,
  IMG_BADGE_C_MISSION_TOTAL,
  IMG_BADGE_COLLECT_ITEM,
  IMG_BADGE_COMPLETE_SPECIFIC_QUEST,
  IMG_BADGE_CRAFT_SPECIFIC_ITEM,
  IMG_BADGE_CRAFTING_EXPERIENCE,
  IMG_BADGE_CREATURES_HUNTED,
  IMG_BADGE_D_CRIME_TOTAL,
  IMG_BADGE_D_MISSION_TOTAL,
  IMG_BADGE_DAMAGE_DEALT,
  IMG_BADGE_DAYS_IN_VILLAGE,
  IMG_BADGE_DEFEAT_OPPONENTS,
  IMG_BADGE_DIALOG,
  IMG_BADGE_DUNGEONS_COMPLETED,
  IMG_BADGE_ERRANDS_TOTAL,
  IMG_BADGE_ESPIONAGE,
  IMG_BADGE_EVENTS_COMPLETED,
  IMG_BADGE_EXCLUSIVE_RAID,
  IMG_BADGE_FAIL_QUEST,
  IMG_BADGE_FARMING_COLLECTION_LOG,
  IMG_BADGE_FARMING_LEVEL,
  IMG_BADGE_GATHERING_EXPERIENCE,
  IMG_BADGE_HERBS_GATHERED,
  IMG_BADGE_HUNTING_EXPERIENCE,
  IMG_BADGE_ITEMS_CRAFTED,
  IMG_BADGE_JUTSUS_MASTERED,
  IMG_BADGE_MEDICAL_EXPERIENCE,
  IMG_BADGE_MINUTES_PASSED,
  IMG_BADGE_MINUTES_TRAINING,
  IMG_BADGE_MOVE_TO_LOCATION,
  IMG_BADGE_NEW_QUEST,
  IMG_BADGE_OPEN_RAID,
  IMG_BADGE_OVERWORLD_AI_FOUGHT,
  IMG_BADGE_OVERWORLD_QUESTS_COMPLETED,
  IMG_BADGE_PLANTS_FERTILIZED,
  IMG_BADGE_PLANTS_HARVESTED,
  IMG_BADGE_PLANTS_WATERED,
  IMG_BADGE_PVP_PARTICIPATED,
  IMG_BADGE_PVPKILLS,
  IMG_BADGE_RAIDS_COMPLETED,
  IMG_BADGE_RANDOM_ENCOUNTER_WINS,
  IMG_BADGE_RANKED_PARTICIPATED,
  IMG_BADGE_RANKED_WINS,
  IMG_BADGE_REPUTATION_POINTS,
  IMG_BADGE_RESET_QUEST,
  IMG_BADGE_SABOTAGE,
  IMG_BADGE_SEEDS_PLANTED,
  IMG_BADGE_SPARS_PARTICIPATED,
  IMG_BADGE_SPARS_WON,
  IMG_BADGE_START_BATTLE,
  IMG_BADGE_STATS_TRAINED,
  IMG_BADGE_STORIES_COMPLETED,
  IMG_BADGE_TAG_USAGE_WIN,
  IMG_BADGE_TRAIN_SPECIFIC_JUTSU,
  IMG_BADGE_USE_ITEM_COMBAT,
  IMG_BADGE_USE_JUTSU_COMBAT,
  IMG_BADGE_USER_LEVEL,
  IMG_BADGE_WIN_QUEST,
  isPetTaskQuestType,
  isSharedRunQuestType,
  LetterRanks,
  MAX_PLAYER_LEVEL,
  MasteryTypes,
  MEDNIN_RANKS,
  QUEST_PARTY_TYPES,
  type QuestRewardMode,
  QuestTypes,
  RetryQuestDelays,
  SAGE_MASTERY_RANKS,
  SECTOR_MAP_MAX_DIMENSION,
  VILLAGE_MISSION_ONLY_TASKS,
} from "@/drizzle/constants";
import { isValidSectorId } from "@/libs/sector-map/sector-ids";
import { DateTimeRegExp } from "@/utils/regex";
import { idsWithNumberField } from "@/validators/base";
import {
  questBuffTypes,
  questDebuffTypes,
  questStartingEffectsSchema,
} from "@/validators/combat";
import { mapLocationFields, supportsMapStructure } from "@/validators/mapLocation";
import { masteryRequirementFields } from "@/validators/mastery";
import { petTaskMinutesSchema } from "@/validators/petTasks";
import {
  QuestReward,
  type QuestRewardType,
  questRewardFields,
  rewardPayloads,
} from "@/validators/rewardPackages";
import {
  hasPromotionRank,
  hasUnpairedMasteryPromotion,
  MASTERY_PROMOTION_PAIR_MESSAGE,
  questRewardModeFields,
} from "@/validators/rewards";
import { villageMissionContentError } from "@/validators/villageMission";

/** Event counters retain progress before an achievement's first reward claim. */
export const CombatActivityTasks = [
  "pvp_participated",
  "spars_participated",
  "ranked_wins",
  "ranked_participated",
  "overworld_ai_fought",
] as const;

/** Quest claims that contribute to lifetime completion objectives. */
export const QuestCompletionTasks = {
  battlepyramid: "battle_pyramids_completed",
  story: "stories_completed",
  event: "events_completed",
  overworld: "overworld_quests_completed",
} as const;

/** Derived completion goals whose earned snapshot survives until the achievement is claimed. */
export const CompletionTasks = [
  ...Object.values(QuestCompletionTasks),
  "dungeons_completed",
  "raids_completed",
] as const;

/** Tasks overwritten from the user's state, which team progress merges by maximum. */
export const PassiveSnapshotTasks = [
  ...CompletionTasks,
  "user_level",
  "farming_level",
  "farming_collection_log",
  "bloodline_collection",
  "days_in_village",
  "days_as_kage",
  "minutes_passed",
  "reputation_points",
  "errands_total",
  "a_missions_total",
  "b_missions_total",
  "c_missions_total",
  "d_missions_total",
  "a_crimes_total",
  "b_crimes_total",
  "c_crimes_total",
  "d_crimes_total",
  "medical_experience",
  "crafting_experience",
  "hunting_experience",
  "gathering_experience",
] as const;

export const SimpleTasks = [
  ...CombatActivityTasks,
  ...CompletionTasks,
  "espionage",
  "sabotage",
  "siege_operation",
  "combined_mission_effort",
  "pvp_kills",
  "arena_kills",
  "minutes_passed",
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
  "items_crafted",
  "creatures_hunted",
  "herbs_gathered",
  "seeds_planted",
  "plants_watered",
  "plants_fertilized",
  "plants_harvested",
  "farming_collection_log",
  "farming_level",
] as const;
export type SimpleTask = (typeof SimpleTasks)[number];

export const InstantTasks = [
  "fail_quest",
  "win_quest",
  "new_quest",
  "start_battle",
] as const;

export const RaidTasks = ["open_raid", "exclusive_raid"] as const;
export type RaidTask = (typeof RaidTasks)[number];

// Curated subset of combat effect types (`tagTypes` in @/validators/combat) that can
// be applied during a winnable battle, used by the tag_usage_win objective picker + schema.
// tests/validators/objective_tag_types.test.ts lists every excluded type and fails when a
// new effect type is added to neither list.
export const OBJECTIVE_TAG_TYPES = [
  "absorb",
  "activatesagemode",
  "afterburn",
  "buffprevent",
  "cleanse",
  "cleanseprevent",
  "clear",
  "clearprevent",
  "consume",
  "siphon",
  "copy",
  "damage",
  "debuffprevent",
  "decreaseaggro",
  "decreasecooldown",
  "decreasedamagegiven",
  "decreasedamagetaken",
  "decreaseheal",
  "decreasemaxpools",
  "decreasepoolcost",
  "decreasepotency",
  "decreasestat",
  "decreasemastery",
  "diffuse",
  "disarm",
  "drain",
  "elementalseal",
  "finalstand",
  "flee",
  "fleeprevent",
  "heal",
  "healprevent",
  "immunity",
  "increaseaggro",
  "increasecooldown",
  "increasedamagegiven",
  "increasedamagetaken",
  "increaseheal",
  "increasemaxpools",
  "increasepoolcost",
  "increasepotency",
  "increaserange",
  "increasestat",
  "increasemastery",
  "injectjutsus",
  "lifesteal",
  "mirror",
  "moveprevent",
  "onehitkill",
  "onehitkillprevent",
  "pierce",
  "poison",
  "recoil",
  "redirection",
  "reflect",
  "parry",
  "curse",
  "removebloodline",
  "rob",
  "robprevent",
  "seal",
  "sealprevent",
  "shield",
  "stealth",
  "stun",
  "stunprevent",
  "summonprevent",
  "timecompression",
  "timedilation",
  "vamp",
  "visual",
  "weakness",
  "wound",
] as const;

export const LocationTasks = [
  "move_to_location",
  "win_encounter_at_location",
  "collect_item",
  "deliver_item",
  "defeat_opponents",
] as const;

export const TrackerObjectiveTasks = [
  "craft_specific_item",
  "train_specific_jutsu",
  "complete_specific_quest",
  "buy_item",
  "use_specific_item_combat",
  "use_specific_jutsu_combat",
  "tag_usage_win",
  "damage_dealt",
] as const;

export const allObjectiveTasks = [
  ...SimpleTasks,
  ...LocationTasks,
  ...InstantTasks,
  ...RaidTasks,
  ...TrackerObjectiveTasks,
  "bloodline_collection",
  "reset_quest",
  "dialog",
] as const;
export type AllObjectiveTask = (typeof allObjectiveTasks)[number];

/**
 * Badge image + human-readable title for every objective task. Keyed by the
 * canonical task union, so adding a task to `allObjectiveTasks` without supplying
 * metadata here is a compile error rather than a silent "???" icon at runtime.
 */
export const objectiveImageMap: Record<
  AllObjectiveTask,
  { image: string; title: string }
> = {
  espionage: { image: IMG_BADGE_ESPIONAGE, title: "Espionage" },
  sabotage: { image: IMG_BADGE_SABOTAGE, title: "Sabotage" },
  siege_operation: { image: IMG_BADGE_SABOTAGE, title: "Siege Operation" },
  combined_mission_effort: {
    image: IMG_BADGE_A_MISSION_TOTAL,
    title: "Combined Mission Effort",
  },
  pvp_kills: { image: IMG_BADGE_PVPKILLS, title: "PVP kills" },
  arena_kills: { image: IMG_BADGE_ARENAKILLS, title: "Arena kills" },
  minutes_passed: { image: IMG_BADGE_MINUTES_PASSED, title: "Minutes passed" },
  days_as_kage: { image: IMG_BADGE_DAYS_IN_VILLAGE, title: "Days as Kage" },
  errands_total: { image: IMG_BADGE_ERRANDS_TOTAL, title: "Errands" },
  a_missions_total: { image: IMG_BADGE_A_MISSION_TOTAL, title: "A-rank Missions" },
  b_missions_total: { image: IMG_BADGE_B_MISSION_TOTAL, title: "B-rank Missions" },
  c_missions_total: { image: IMG_BADGE_C_MISSION_TOTAL, title: "C-rank Missions" },
  d_missions_total: { image: IMG_BADGE_D_MISSION_TOTAL, title: "D-rank Missions" },
  a_crimes_total: { image: IMG_BADGE_A_CRIME_TOTAL, title: "A-rank crimes" },
  b_crimes_total: { image: IMG_BADGE_B_CRIME_TOTAL, title: "B-rank crimes" },
  c_crimes_total: { image: IMG_BADGE_C_CRIME_TOTAL, title: "C-rank crimes" },
  d_crimes_total: { image: IMG_BADGE_D_CRIME_TOTAL, title: "D-rank crimes" },
  minutes_training: { image: IMG_BADGE_MINUTES_TRAINING, title: "Minutes Training" },
  stats_trained: { image: IMG_BADGE_STATS_TRAINED, title: "Stats Trained" },
  days_in_village: { image: IMG_BADGE_DAYS_IN_VILLAGE, title: "Days in Village" },
  jutsus_mastered: { image: IMG_BADGE_JUTSUS_MASTERED, title: "Jutsus Mastered" },
  user_level: { image: IMG_BADGE_USER_LEVEL, title: "User Level" },
  reputation_points: {
    image: IMG_BADGE_REPUTATION_POINTS,
    title: "Reputation Bought",
  },
  random_encounter_wins: {
    image: IMG_BADGE_RANDOM_ENCOUNTER_WINS,
    title: "Encounter Wins",
  },
  spars_won: { image: IMG_BADGE_SPARS_WON, title: "Spars Won" },
  pvp_participated: { image: IMG_BADGE_PVP_PARTICIPATED, title: "PvP Participation" },
  spars_participated: {
    image: IMG_BADGE_SPARS_PARTICIPATED,
    title: "Spar Participation",
  },
  ranked_wins: { image: IMG_BADGE_RANKED_WINS, title: "Ranked Games Won" },
  ranked_participated: {
    image: IMG_BADGE_RANKED_PARTICIPATED,
    title: "Ranked Participation",
  },
  overworld_ai_fought: {
    image: IMG_BADGE_OVERWORLD_AI_FOUGHT,
    title: "Overworld AI Fought",
  },
  dungeons_completed: {
    image: IMG_BADGE_DUNGEONS_COMPLETED,
    title: "Dungeons Completed",
  },
  battle_pyramids_completed: {
    image: IMG_BADGE_BATTLE_PYRAMIDS_COMPLETED,
    title: "Battle Pyramids Completed",
  },
  raids_completed: { image: IMG_BADGE_RAIDS_COMPLETED, title: "Raids Completed" },
  stories_completed: {
    image: IMG_BADGE_STORIES_COMPLETED,
    title: "Stories Completed",
  },
  events_completed: {
    image: IMG_BADGE_EVENTS_COMPLETED,
    title: "Events Completed",
  },
  overworld_quests_completed: {
    image: IMG_BADGE_OVERWORLD_QUESTS_COMPLETED,
    title: "Overworld Quests Completed",
  },
  medical_experience: {
    image: IMG_BADGE_MEDICAL_EXPERIENCE,
    title: "Medical Experience",
  },
  medical_experience_gained: {
    image: IMG_BADGE_MEDICAL_EXPERIENCE,
    title: "Medical Experience Gained",
  },
  crafting_experience: {
    image: IMG_BADGE_CRAFTING_EXPERIENCE,
    title: "Crafting Experience",
  },
  crafting_experience_gained: {
    image: IMG_BADGE_CRAFTING_EXPERIENCE,
    title: "Crafting Experience Gained",
  },
  hunting_experience: {
    image: IMG_BADGE_HUNTING_EXPERIENCE,
    title: "Hunting Experience",
  },
  hunting_experience_gained: {
    image: IMG_BADGE_HUNTING_EXPERIENCE,
    title: "Hunting Experience Gained",
  },
  gathering_experience: {
    image: IMG_BADGE_GATHERING_EXPERIENCE,
    title: "Gathering Experience",
  },
  gathering_experience_gained: {
    image: IMG_BADGE_GATHERING_EXPERIENCE,
    title: "Gathering Experience Gained",
  },
  items_crafted: { image: IMG_BADGE_ITEMS_CRAFTED, title: "Items Crafted" },
  creatures_hunted: { image: IMG_BADGE_CREATURES_HUNTED, title: "Creatures Hunted" },
  herbs_gathered: { image: IMG_BADGE_HERBS_GATHERED, title: "Herbs Gathered" },
  seeds_planted: { image: IMG_BADGE_SEEDS_PLANTED, title: "Seeds Planted" },
  plants_watered: { image: IMG_BADGE_PLANTS_WATERED, title: "Plants Watered" },
  plants_fertilized: { image: IMG_BADGE_PLANTS_FERTILIZED, title: "Plants Fertilized" },
  plants_harvested: { image: IMG_BADGE_PLANTS_HARVESTED, title: "Plants Harvested" },
  farming_collection_log: {
    image: IMG_BADGE_FARMING_COLLECTION_LOG,
    title: "Farming Collection",
  },
  farming_level: { image: IMG_BADGE_FARMING_LEVEL, title: "Farming Level" },
  bloodline_collection: {
    image: IMG_BADGE_BLOODLINE_COLLECTION,
    title: "Bloodline Collection",
  },
  move_to_location: { image: IMG_BADGE_MOVE_TO_LOCATION, title: "Travel" },
  win_encounter_at_location: {
    image: IMG_BADGE_RANDOM_ENCOUNTER_WINS,
    title: "Encounters at Location",
  },
  collect_item: { image: IMG_BADGE_COLLECT_ITEM, title: "Collect Item" },
  deliver_item: { image: IMG_BADGE_COLLECT_ITEM, title: "Deliver Item" },
  defeat_opponents: { image: IMG_BADGE_DEFEAT_OPPONENTS, title: "Defeat" },
  fail_quest: { image: IMG_BADGE_FAIL_QUEST, title: "Fail Quest" },
  win_quest: { image: IMG_BADGE_WIN_QUEST, title: "Win Quest" },
  new_quest: { image: IMG_BADGE_NEW_QUEST, title: "New Quest" },
  start_battle: { image: IMG_BADGE_START_BATTLE, title: "Start Battle" },
  open_raid: { image: IMG_BADGE_OPEN_RAID, title: "Open Raid" },
  exclusive_raid: { image: IMG_BADGE_EXCLUSIVE_RAID, title: "Exclusive Raid" },
  reset_quest: { image: IMG_BADGE_RESET_QUEST, title: "Reset Quest" },
  dialog: { image: IMG_BADGE_DIALOG, title: "Dialog" },
  craft_specific_item: {
    image: IMG_BADGE_CRAFT_SPECIFIC_ITEM,
    title: "Craft Specific Item",
  },
  train_specific_jutsu: {
    image: IMG_BADGE_TRAIN_SPECIFIC_JUTSU,
    title: "Train Specific Jutsu",
  },
  complete_specific_quest: {
    image: IMG_BADGE_COMPLETE_SPECIFIC_QUEST,
    title: "Complete Specific Quest",
  },
  buy_item: { image: IMG_BADGE_BUY_ITEM, title: "Buy Item" },
  use_specific_item_combat: {
    image: IMG_BADGE_USE_ITEM_COMBAT,
    title: "Use Item in Combat",
  },
  use_specific_jutsu_combat: {
    image: IMG_BADGE_USE_JUTSU_COMBAT,
    title: "Use Jutsu in Combat",
  },
  tag_usage_win: { image: IMG_BADGE_TAG_USAGE_WIN, title: "Tag Usage (Win)" },
  damage_dealt: { image: IMG_BADGE_DAMAGE_DEALT, title: "Damage Dealt" },
};

export const attackerFields = {
  attackers: idsWithNumberField,
  attackers_scaled_to_user: z.coerce.boolean().prefault(false),
  attackers_scale_gains: z.coerce.number().min(0).max(1).prefault(1),
  attackers_max_per_battle: z.coerce.number().min(0).max(100).prefault(1),
};

/**
 * Authored NPC templates and whole-number copy counts, independent of opponents.
 * Missing content defaults to no allies; a selected entry defaults to one copy.
 * Counts describe combatants, unlike the percentages used by reward/encounter fields.
 */
const allyAIsField = z
  .array(
    idsWithNumberField.unwrap().element.extend({
      number: z.coerce.number().int().min(1).max(100).prefault(1),
    }),
  )
  .prefault([]);

// Shared fields for battle objectives (start_battle, raids, defeat_opponents)
export const battleObjectiveFields = {
  failObjectiveId: z.string().optional(),
  opponent_scaled_to_user: z.coerce.boolean().prefault(false),
  completionOutcome: z.enum(["Win", "Lose", "Flee", "Draw", "Any"]).prefault("Win"),
  failDescription: z.string().prefault("You failed to defeat the opponent"),
  fleeDescription: z.string().prefault("You fled from the opponent"),
  drawDescription: z.string().prefault("The battle ended in a draw"),
  scaleGains: z.coerce.number().min(0).max(1).prefault(1),
  keepOriginalPools: z.coerce.boolean().prefault(false),
  // Absent means carry pools; an explicit percentage replaces all three starting pools.
  givePools: z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.coerce.number().min(0).max(100).optional(),
  ),
  applyBuffs: questStartingEffectsSchema(questBuffTypes),
  applyDebuffs: questStartingEffectsSchema(questDebuffTypes),
};

/** Scene shown behind a quest or objective. */
const sceneFields = {
  sceneBackground: z.string().prefault(""),
  sceneCharacters: z.array(z.string()).prefault([]),
};

export const baseObjectiveFields = {
  ...mapLocationFields,
  id: z.string(),
  description: z.string().prefault(""),
  successDescription: z.string().prefault(""),
  nextObjectiveId: z.string().optional(),
  ...sceneFields,
  // Default not set, but used for e.g. dialog objectives
  sector: z.coerce.number().optional(),
  longitude: z.coerce.number().optional(),
  latitude: z.coerce.number().optional(),
  // Optional binding to a specific overworld NPC placement (authoritative over coordinates)
  overworldPlacementId: z.string().optional(),
};

export const SimpleObjective = z
  .object({
    ...baseObjectiveFields,
    task: z.enum(SimpleTasks),
    durationSeconds: z.coerce.number().int().min(1).max(86400).prefault(60),
    value: z.coerce.number().min(0).prefault(3),
    ...questRewardFields,
    ...attackerFields,
  })
  .superRefine((objective, ctx) => {
    if (
      ["espionage", "sabotage"].includes(objective.task) &&
      (!Number.isInteger(objective.value) || objective.value <= 0)
    )
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: "War mission points and damage must be positive whole numbers",
      });
  });

export const InstantWinLoseObjective = z.object({
  ...baseObjectiveFields,
  task: z.enum(["fail_quest", "win_quest"]),
  ...questRewardFields,
});

export const ResetQuestObjective = z.object({
  ...baseObjectiveFields,
  task: z.literal("reset_quest"),
  resetObjectiveId: z.string().optional(),
  ...questRewardFields,
});

export const InstantNewQuestObjective = z.object({
  ...baseObjectiveFields,
  task: z.literal("new_quest"),
  newQuestIds: z.array(z.string()).prefault([]),
  ...questRewardFields,
});

export const InstantStartBattleObjective = z.object({
  ...baseObjectiveFields,
  ...battleObjectiveFields,
  task: z.literal("start_battle"),
  allyAIs: allyAIsField,
  opponentAIs: idsWithNumberField.refine((data) => data.length > 0, {
    error: "At least one opponent AI is required",
  }),
  ...questRewardFields,
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
const LOCATION_TYPES = ["specific", "random"] as const;

const complexObjectiveFields = {
  // Location type fields
  sectorType: z.enum(SECTOR_TYPES).prefault("specific"),
  locationType: z.enum(LOCATION_TYPES).prefault("specific"),
  // Specific locations (also used once objective is instantiated from e.g. random, from_list, village, etc.)
  sector: z.coerce.number().min(0).prefault(0),
  longitude: z.coerce.number().min(0).prefault(0),
  latitude: z.coerce.number().min(0).prefault(0),
  // Sector list
  sectorList: z.array(z.string()).prefault([]),
  // Generic fields
  hideLocation: z.coerce.boolean().prefault(false),
  completed: z.coerce.number().min(0).max(1).prefault(0),
  image: z.string().prefault(""),
  ...questRewardFields,
  ...attackerFields,
};
export const baseComplexObjective = z.object(complexObjectiveFields);
export type ComplexObjectiveFields = z.infer<typeof baseComplexObjective>;

// Dialog objective schema
export const DialogObjective = z.object({
  ...baseObjectiveFields,
  ...questRewardFields,
  ...attackerFields,
  task: z.literal("dialog"),
  image: z.string().prefault(""),
  nextObjectiveId: z
    .array(
      z.object({
        text: z.string(),
        nextObjectiveId: z.string().optional(),
      }),
    )
    .prefault([]),
});

export const MoveToObjective = z.object({
  ...baseObjectiveFields,
  ...complexObjectiveFields,
  task: z.literal("move_to_location"),
});

export const EncountersAtLocation = z.object({
  ...baseObjectiveFields,
  ...complexObjectiveFields,
  locationType: z.enum(LOCATION_TYPES).prefault("random"),
  task: z.literal("win_encounter_at_location"),
});

export const CollectItem = z.object({
  ...baseObjectiveFields,
  task: z.literal("collect_item"),
  item_name: z.string().min(3).prefault("Secret scroll"),
  collectItemIds: z.array(z.string()).prefault([]),
  delete_on_complete: z.coerce.boolean().prefault(false),
  collect_time_minutes: z.coerce.number().min(0).max(60).prefault(0),
  ...complexObjectiveFields,
});

export const DeliverItem = z.object({
  ...baseObjectiveFields,
  task: z.literal("deliver_item"),
  item_name: z.string().min(3).prefault("Secret scroll"),
  deliverItemIds: z.array(z.string()).prefault([]),
  delete_on_complete: z.coerce.boolean().prefault(true),
  ...complexObjectiveFields,
});

export const DefeatOpponents = z.object({
  ...baseObjectiveFields,
  ...battleObjectiveFields,
  task: z.literal("defeat_opponents"),
  allyAIs: allyAIsField,
  opponentAIs: idsWithNumberField,
  ...complexObjectiveFields,
});

export const RaidObjective = z.object({
  ...baseObjectiveFields,
  ...battleObjectiveFields,
  task: z.enum(["open_raid", "exclusive_raid"]),
  image: z.string().prefault(""),
  // Override sector from baseObjectiveFields to be required for raids
  sector: z.coerce.number().min(0),
  opponentAIs: idsWithNumberField.refine((data) => data.length > 0, {
    error: "At least one raid boss AI is required",
  }),
  // Override default descriptions for raid context
  failDescription: z.string().prefault("You failed to defeat the raid boss"),
  fleeDescription: z.string().prefault("You fled from the raid boss"),
  ...questRewardFields,
});
export type RaidObjectiveType = z.infer<typeof RaidObjective>;

// contentId stores the crafted item id (matched against craftItemIds).
export const CraftSpecificItem = z.object({
  ...baseObjectiveFields,
  task: z.literal("craft_specific_item"),
  craftItemIds: z.array(z.string()).prefault([]),
  value: z.coerce.number().min(0).prefault(1),
  ...questRewardFields,
});

// contentId stores the trained jutsu id (matched against trainJutsuIds).
export const TrainSpecificJutsu = z.object({
  ...baseObjectiveFields,
  task: z.literal("train_specific_jutsu"),
  trainJutsuIds: z.array(z.string()).prefault([]),
  masteryType: z.enum(["None", ...MasteryTypes]).prefault("None"),
  value: z.coerce.number().min(0).prefault(1),
  ...questRewardFields,
});

// contentId stores the completed quest id (matched against completeQuestIds).
export const CompleteSpecificQuest = z.object({
  ...baseObjectiveFields,
  task: z.literal("complete_specific_quest"),
  completeQuestIds: z.array(z.string()).prefault([]),
  value: z.coerce.number().min(0).prefault(1),
  ...questRewardFields,
});

// contentId stores the purchased item id (matched against buyItemIds). NPC shop only (v1).
export const BuyItem = z.object({
  ...baseObjectiveFields,
  task: z.literal("buy_item"),
  buyItemIds: z.array(z.string()).prefault([]),
  value: z.coerce.number().min(0).prefault(1),
  ...questRewardFields,
});

// contentId stores a used item id from this battle (matched against useItemIds).
export const UseSpecificItemCombat = z.object({
  ...baseObjectiveFields,
  task: z.literal("use_specific_item_combat"),
  useItemIds: z.array(z.string()).prefault([]),
  value: z.coerce.number().min(0).prefault(1),
  ...questRewardFields,
});

// contentId stores a used jutsu id from this battle (matched against useJutsuIds).
export const UseSpecificJutsuCombat = z.object({
  ...baseObjectiveFields,
  task: z.literal("use_specific_jutsu_combat"),
  useJutsuIds: z.array(z.string()).prefault([]),
  masteryType: z.enum(["None", ...MasteryTypes]).prefault("None"),
  combatType: z.enum(["Any", "PVP", "PVE"]).prefault("Any"),
  value: z.coerce.number().min(0).prefault(1),
  ...questRewardFields,
});

// contentId stores an applied combat tag type from a won battle (matched against tagType).
export const TagUsageWin = z.object({
  ...baseObjectiveFields,
  task: z.literal("tag_usage_win"),
  // Default to a valid tag so a freshly-added objective parses (otherwise the editor's
  // safeParse fails, falls back to the raw object, and never renders the tag picker).
  tagType: z.enum(OBJECTIVE_TAG_TYPES).prefault(OBJECTIVE_TAG_TYPES[0]),
  value: z.coerce.number().min(0).prefault(1),
  ...questRewardFields,
});

// value = damage threshold. singleBattle=false accumulates across the quest's battles;
// singleBattle=true tracks the best single battle (monotonic max). Flipping singleBattle
// on a live quest re-interprets the already-stored counter (a cumulative sum reads as a
// single-battle max), so such edits must ship with a reset of affected user trackers.
export const DamageDealt = z.object({
  ...baseObjectiveFields,
  task: z.literal("damage_dealt"),
  singleBattle: z.coerce.boolean().prefault(false),
  value: z.coerce.number().min(0).prefault(1),
  ...questRewardFields,
});

export const BloodlineCollection = z.strictObject(
  {
    ...baseObjectiveFields,
    task: z.literal("bloodline_collection"),
    /** Collect every visible bloodline in the selected ranks, including H when selected. */
    bloodlineRanks: z
      .array(z.enum(LetterRanks))
      .min(1)
      .prefault([...LetterRanks]),
    ...questRewardFields,
  },
  {
    // Reject stale editor fields before a missing rank array defaults to every rank.
    error: (issue) =>
      issue.code === "unrecognized_keys"
        ? "This bloodline collection uses unsupported fields. Reload the editor before saving."
        : undefined,
  },
);

export const AllObjectives = z.discriminatedUnion("task", [
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
  CraftSpecificItem,
  TrainSpecificJutsu,
  CompleteSpecificQuest,
  BuyItem,
  UseSpecificItemCombat,
  UseSpecificJutsuCombat,
  TagUsageWin,
  DamageDealt,
  BloodlineCollection,
]);
export type AllObjectivesType = z.infer<typeof AllObjectives>;

export const ObjectiveTracker = z.object({
  id: z.string(),
  done: z.boolean().prefault(false),
  value: z.coerce.number().prefault(0),
  /** Catalogue size when collection progress was last evaluated; frozen once done. */
  target: z.coerce.number().int().min(0).optional(),
  collected: z.boolean().prefault(false),
  sector: z.coerce.number().min(0).optional(),
  longitude: z.coerce.number().min(0).optional(),
  latitude: z.coerce.number().min(0).optional(),
  /** Set once the coordinates were verified (or moved) onto a reachable tile of the sector map. */
  locationChecked: z.boolean().optional(),
  selectedNextObjectiveId: z.string().optional(),
  timestamp: z.iso.datetime().optional(),
  /** Captured at collection start; passive changes apply only to subsequent collections. */
  collectDeadline: z.iso.datetime().optional(),
  /** Gathering yield captured for this collection, retained until its reward is paid. */
  gatheringBonusQuantity: z.number().int().nonnegative().optional(),
  recentlyDied: z.boolean().prefault(false),
  /** Personal side-effect receipt, independent of copied shared objective completion. */
  partyEffectsApplied: z.boolean().optional(),
  /** Personal damage by battle; canonical party goals contain the corresponding team totals. */
  battleValues: z.record(z.string(), z.number().min(0)).optional(),
});
export type ObjectiveTrackerType = z.infer<typeof ObjectiveTracker>;

/** Each selected ID is required at the given quantity; duplicates add rather than offer alternatives. */
export const questEntryItemsSchema = z
  .array(
    z.object({
      ids: z.array(z.string().min(1)).min(1),
      number: z.coerce.number().int().min(1).max(9999),
    }),
  )
  .prefault([]);

/** Shared authoring fields; entry is paid when the run starts and isolation is Pyramid-only. */
export const questRunFields = {
  entryItems: questEntryItemsSchema,
  isolated: z.coerce.boolean().prefault(false),
};

/** Designer coordinates keyed by objective ID, shared with everyone editing the quest. */
export const questNodePositionsSchema = z.record(
  z.string(),
  z.object({ x: z.number(), y: z.number() }),
);
export type QuestNodePositions = z.infer<typeof questNodePositionsSchema>;

export type QuestContentType = {
  nodePositions?: QuestNodePositions;
  /** Personal-run item requirements, consumed once when the run starts. */
  entryItems?: z.infer<typeof questEntryItemsSchema>;
  /** Freeze outside recovery and restrict inventory/travel until the attempt closes. */
  isolated?: boolean;
  reward: QuestRewardType;
  /** Absent on quests saved before reward choice existed; treated as "all". */
  rewardMode?: QuestRewardMode;
  /** Rewards the player picks when `rewardMode` is "choose". */
  rewardPickCount?: number;
  objectives: AllObjectivesType[];
  sceneBackground: string;
  sceneCharacters: string[];
};

export const QuestTracker = z.object({
  id: z.string(),
  startAt: z.iso.datetime().prefault(() => new Date().toISOString()),
  goals: z.array(ObjectiveTracker).prefault([]),
  /** Shared reset epoch; contributions from older generations cannot advance the team. */
  generation: z.number().int().min(0).optional(),
  /** Per-goal reset epochs invalidate affected personal receipts while retaining others. */
  resetGenerations: z.record(z.string(), z.number().int().min(0)).optional(),
  failed: z.boolean().optional(),
  /** Cumulative personal contributions; merging these never counts a shared snapshot twice. */
  party: z
    .object({
      id: z.string(),
      generation: z.number().int().min(0).prefault(0),
      contributions: z.array(ObjectiveTracker),
    })
    .optional(),
});
export type QuestTrackerType = z.infer<typeof QuestTracker>;

export const QuestValidatorRawSchema = z.object({
  ...masteryRequirementFields,
  name: z.string().min(1).max(191),
  image: z.url().nullish(),
  description: z.string().min(1).max(5000).nullable(),
  successDescription: z.string().min(1).max(5000).nullable(),
  questRank: z.enum(LetterRanks).optional(),
  medicalRank: z.enum(MEDNIN_RANKS).nullish(),
  huntingRank: z.enum(HUNTING_RANKS).nullish(),
  gatheringRank: z.enum(GATHERING_RANKS).nullish(),
  petTaskMinutes: petTaskMinutesSchema,
  requiredLevel: z.coerce.number().int().min(0).max(MAX_PLAYER_LEVEL).optional(),
  requiredFarmingLevel: z.coerce.number().min(0).max(FARMING_MAX_LEVEL).optional(),
  maxLevel: z.coerce.number().int().min(0).max(MAX_PLAYER_LEVEL).optional(),
  maxAttempts: z.coerce.number().min(0).max(100).prefault(1),
  maxCompletes: z.coerce.number().min(0).max(100).prefault(1),
  requiredVillage: z.string().max(30).nullish(),
  requiredBloodlineId: z.string().max(191).nullish(),
  /** Exact equipped sage mode required to take the quest; unset = no mode gate. */
  requiredSageModeId: z.string().max(191).nullish(),
  /** Minimum mastery rank (`NONE`…`LEGENDARY`); unset / empty = no rank gate. */
  requiredSageRank: z.preprocess(
    (v) => (v === "" ? null : v),
    z.enum(SAGE_MASTERY_RANKS).nullish(),
  ),
  prerequisiteQuestId: z.string().max(191).nullish(),
  tierLevel: z.coerce.number().min(0).max(100).nullable(),
  questType: z.enum(QuestTypes),
  content: z.object({
    ...questRunFields,
    nodePositions: questNodePositionsSchema.optional(),
    objectives: z.array(AllObjectives),
    reward: QuestReward,
    ...questRewardModeFields,
    ...sceneFields,
  }),
  hidden: z.coerce.boolean(),
  teamEnabled: z.boolean().prefault(false),
  publicLocations: z.boolean().prefault(false),
  retryDelay: z.enum(RetryQuestDelays).optional(),
  attemptDelay: z.enum(RetryQuestDelays).optional(),
  consecutiveObjectives: z.coerce.boolean(),
  endsAt: z.string().regex(DateTimeRegExp, "Must be of format YYYY-MM-DD").nullable(),
  startsAt: z.string().regex(DateTimeRegExp, "Must be of format YYYY-MM-DD").nullable(),
  // Raid-specific fields (only persisted data, AI and sector come from objective)
  raidBossMaxHealth: z.coerce.number().min(1).nullish(),
  raidBossCurrentHealth: z.coerce.number().min(0).nullish(),
});
/** Validate cross-field quest and objective constraints with errors attached to their form paths. */
const questSuperRefine = (
  val: z.infer<typeof QuestValidatorRawSchema>,
  ctx: z.RefinementCtx,
) => {
  val.content.objectives.forEach((objective, index) => {
    if (!objective.structureAssetId) return;
    const issue = (message: string) =>
      ctx.addIssue({
        code: "custom",
        path: ["content", "objectives", index, "structureAssetId"],
        message,
      });
    if (!supportsMapStructure(objective.task))
      issue("This objective does not support a map structure");
    if (objective.sector !== undefined && !isValidSectorId(objective.sector))
      issue("Choose a valid sector for this structure");
    for (const coordinate of [objective.longitude, objective.latitude]) {
      if (
        coordinate !== undefined &&
        (!Number.isInteger(coordinate) ||
          coordinate < 0 ||
          coordinate >= SECTOR_MAP_MAX_DIMENSION)
      )
        issue("Structure coordinates must be whole tiles within the sector");
    }
    if (!objective.locationName || !objective.locationDescription)
      issue("Structures need a location name and neutral description");
    if (
      val.publicLocations &&
      (!("sectorType" in objective) ||
        objective.sectorType !== "specific" ||
        !("locationType" in objective) ||
        objective.locationType !== "specific" ||
        ("hideLocation" in objective && objective.hideLocation) ||
        objective.overworldPlacementId)
    )
      issue(
        "Public structures need a fixed, visible location without an NPC placement binding",
      );
  });
  if (val.petTaskMinutes !== null && !isPetTaskQuestType(val.questType))
    ctx.addIssue({
      code: "custom",
      path: ["petTaskMinutes"],
      message: "Only hunting and gathering contracts can be delegated to companions",
    });
  const concurrentObjectives = val.content.objectives.filter(
    (o) => o.task === "espionage" || o.task === "sabotage",
  );
  if (
    concurrentObjectives.length &&
    (val.questType !== "war" ||
      concurrentObjectives.length !== val.content.objectives.length)
  )
    ctx.addIssue({
      code: "custom",
      path: ["content", "objectives"],
      message:
        "Concurrent war quests may contain only espionage and sabotage objectives",
    });
  if (val.content.isolated && val.questType !== "battlepyramid") {
    ctx.addIssue({
      code: "custom",
      path: ["content", "isolated"],
      message: "Only Battle Pyramids can isolate a run",
    });
  }
  if (val.content.entryItems.length > 0 && isSharedRunQuestType(val.questType)) {
    ctx.addIssue({
      code: "custom",
      path: ["content", "entryItems"],
      message:
        "Entry items require a personal quest run; shared raids, Village Missions and achievements do not have personal entry receipts",
    });
  }
  if (
    val.content.entryItems.length > 0 &&
    !val.content.objectives.some((o) => "opponentAIs" in o)
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["content", "entryItems"],
      message: "Entry items require a battle objective",
    });
  }
  if (
    val.teamEnabled &&
    (!QUEST_PARTY_TYPES.some((type) => type === val.questType) ||
      val.content.entryItems.length > 0)
  ) {
    ctx.addIssue({
      code: "custom",
      message: "Quest teams support Story, Event and ANBU quests without entry items",
      path: ["teamEnabled"],
    });
  }
  if (val.questType === "village_mission") {
    const error = villageMissionContentError(val.content, val.consecutiveObjectives);
    if (error) ctx.addIssue({ code: "custom", message: error, path: ["content"] });
    if (
      val.requiredBloodlineId ||
      val.requiredSageModeId ||
      val.requiredSageRank ||
      val.prerequisiteQuestId
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Village Missions cannot require personal bloodline, sage mode or prerequisite quests",
        path: ["questType"],
      });
  } else if (val.questType === "mission" && val.questRank === "S") {
    ctx.addIssue({
      code: "custom",
      message: "S-rank missions belong to the Village Mission quest type",
      path: ["questType"],
    });
  }
  if (
    val.questType !== "village_mission" &&
    val.content.objectives.some((objective) =>
      (VILLAGE_MISSION_ONLY_TASKS as readonly string[]).includes(objective.task),
    )
  ) {
    ctx.addIssue({
      code: "custom",
      message:
        "Shared Siege Operation and Combined Mission Effort objectives require the Village Mission quest type",
      path: ["content", "objectives"],
    });
  }
  const reward = val.content.reward;
  // Milestones are single-completion progression, not repeatable objective or choice loot.
  // Rank rewards would also change the eligibility being claimed for the next level.
  if (reward.reward_level) {
    if (
      val.questType !== "starter" ||
      val.teamEnabled ||
      val.requiredLevel !== reward.reward_level - 1 ||
      val.maxLevel !== reward.reward_level - 1 ||
      val.maxCompletes !== 1 ||
      (val.retryDelay && val.retryDelay !== "none") ||
      val.content.rewardMode !== "all" ||
      [
        ...rewardPayloads(reward),
        ...val.content.objectives.flatMap((objective) => rewardPayloads(objective)),
      ].some((part) => part.reward_rank !== "NONE") ||
      !(reward.reward_stats && reward.reward_stats > 0)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["content", "reward", "reward_level"],
        message:
          "Elite Jonin milestones must be solo academy quests, grant positive combat stats, require exactly the preceding level, complete once without a reset, grant all rewards and have no rank reward.",
      });
    }
  } else if (reward.reward_stats) {
    ctx.addIssue({
      code: "custom",
      path: ["content", "reward", "reward_stats"],
      message: "Combat stat rewards require an Elite Jonin milestone level.",
    });
  }
  if (
    val.content.objectives.some(
      (objective) => objective.reward_level || objective.reward_stats,
    )
  )
    ctx.addIssue({
      code: "custom",
      path: ["content", "objectives"],
      message:
        "Milestone levels and combat stats belong on the completed quest, not individual objectives.",
    });
  if (hasUnpairedMasteryPromotion(reward)) {
    ctx.addIssue({
      code: "custom",
      message: MASTERY_PROMOTION_PAIR_MESSAGE,
      path: ["content", "reward"],
    });
  }
  if (
    val.content.objectives.some((objective) =>
      rewardPayloads(objective).some(hasPromotionRank),
    )
  ) {
    ctx.addIssue({
      code: "custom",
      message:
        "Mastery rank rewards belong on the completed quest, not individual objectives",
      path: ["content", "objectives"],
    });
  }
  // A real retry period means maxCompletes is a per-period cap, so 0 would
  // block the quest forever (or be silently uncapped). Require >= 1 to make intent
  // explicit. retryDelay "none"/omitted preserves the legacy lifetime-cap validation, where 0
  // remains accepted for existing content. Special quests are exempt because each
  // new attempt consumes an item instead of using completion caps.
  if (
    val.questType !== "special" &&
    val.retryDelay &&
    val.retryDelay !== "none" &&
    val.maxCompletes < 1
  ) {
    ctx.addIssue({
      code: "custom",
      message: "maxCompletes must be at least 1 when a retry delay is set",
      path: ["maxCompletes"],
    });
  }
  if (val.questType === "daily") {
    if (val.content.objectives.length < 3 || val.content.objectives.length > 7) {
      ctx.addIssue({
        code: "custom",
        message: "Daily quests must have between 3 and 7 objectives",
      });
    }
  }
  if (val.questType === "raid") {
    if (val.content.objectives.length !== 1) {
      ctx.addIssue({
        code: "custom",
        message: "Raid quests must have exactly one objective",
      });
    }
    const objectiveTask = val.content.objectives[0]?.task;
    if (objectiveTask && !["open_raid", "exclusive_raid"].includes(objectiveTask)) {
      ctx.addIssue({
        code: "custom",
        message: "Raid quest objective must be 'open_raid' or 'exclusive_raid'",
      });
    }
    // Validate raid-specific fields (persisted in quest table)
    if (!val.raidBossMaxHealth || val.raidBossMaxHealth < 1) {
      ctx.addIssue({
        code: "custom",
        message: "Raid quests require a boss max health > 0",
        path: ["raidBossMaxHealth"],
      });
    }
    if (val.raidBossCurrentHealth === null || val.raidBossCurrentHealth === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "Raid quests require current boss health",
        path: ["raidBossCurrentHealth"],
      });
    }
    // Validate that raidBossCurrentHealth doesn't exceed raidBossMaxHealth
    if (
      val.raidBossCurrentHealth != null &&
      val.raidBossMaxHealth != null &&
      val.raidBossCurrentHealth > val.raidBossMaxHealth
    ) {
      ctx.addIssue({
        code: "custom",
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
export const QuestFormRawSchema = QuestValidatorRawSchema.extend({
  ...QuestReward.shape,
  ...questRunFields,
  ...questRewardModeFields,
  ...sceneFields,
});
/**
 * Normalize flattened run settings and milestone-relevant rewards before shared validation.
 * Clear run settings hidden by a quest-type change.
 */
export const QuestFormSchema = QuestFormRawSchema.transform((val) => ({
  ...val,
  petTaskMinutes: isPetTaskQuestType(val.questType) ? val.petTaskMinutes : null,
  content: {
    ...val.content,
    reward: {
      ...val.content.reward,
      reward_rank: val.reward_rank,
      reward_packages: val.reward_packages,
      reward_level: val.reward_level,
      reward_stats: val.reward_stats,
    },
    rewardMode: val.rewardMode,
    entryItems: isSharedRunQuestType(val.questType) ? [] : val.entryItems,
    isolated: val.questType === "battlepyramid" && val.isolated,
  },
})).superRefine(questSuperRefine);
export type ZodQuestFormType = z.output<typeof QuestFormSchema>;
export type ZodQuestFormInput = z.input<typeof QuestFormSchema>;

/** Resolve the schema for a supported objective task and reject unknown task names. */
export const getObjectiveSchema = (type: string) => {
  const schema = AllObjectives.options.find(
    (option) => option.shape.task.safeParse(type).success,
  );
  if (!schema) throw new Error(`Unknown objective task ${type}`);
  return schema;
};

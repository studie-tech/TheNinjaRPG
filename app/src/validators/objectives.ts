import { z } from "zod";
import {
  GATHERING_RANKS,
  HUNTING_RANKS,
  IMG_BADGE_A_CRIME_TOTAL,
  IMG_BADGE_A_MISSION_TOTAL,
  IMG_BADGE_ARENAKILLS,
  IMG_BADGE_B_CRIME_TOTAL,
  IMG_BADGE_B_MISSION_TOTAL,
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
  IMG_BADGE_ERRANDS_TOTAL,
  IMG_BADGE_EXCLUSIVE_RAID,
  IMG_BADGE_FAIL_QUEST,
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
  IMG_BADGE_PVPKILLS,
  IMG_BADGE_RANDOM_ENCOUNTER_WINS,
  IMG_BADGE_REPUTATION_POINTS,
  IMG_BADGE_RESET_QUEST,
  IMG_BADGE_START_BATTLE,
  IMG_BADGE_STATS_TRAINED,
  IMG_BADGE_TAG_USAGE_WIN,
  IMG_BADGE_TRAIN_SPECIFIC_JUTSU,
  IMG_BADGE_USE_ITEM_COMBAT,
  IMG_BADGE_USE_JUTSU_COMBAT,
  IMG_BADGE_USER_LEVEL,
  IMG_BADGE_WIN_QUEST,
  LetterRanks,
  MEDNIN_RANKS,
  QuestTypes,
  RetryQuestDelays,
} from "@/drizzle/constants";
import { DateTimeRegExp } from "@/utils/regex";
import { idsWithNumberField } from "@/validators/base";
import { AllTags } from "@/validators/combat";
import {
  ObjectiveReward,
  type ObjectiveRewardType,
  rewardFields,
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
  "items_crafted",
  "creatures_hunted",
  "herbs_gathered",
  //"students_trained",
] as const;
export type SimpleTask = (typeof SimpleTasks)[number];

export const InstantTasks = [
  "fail_quest",
  "win_quest",
  "new_quest",
  "start_battle",
] as const;
export type InstantTasksType = (typeof InstantTasks)[number];

export const RaidTasks = ["open_raid", "exclusive_raid"] as const;
export type RaidTask = (typeof RaidTasks)[number];

// Curated subset of combat effect types (`effectFilters` in @/validators/combat) that can
// be applied during a winnable battle, used by the tag_usage_win objective picker + schema.
// Excludes non-combat / out-of-battle tag types (noncombat*, marriage, reskin,
// unlockitemvariant, repair, rollbloodline) AND combat tags that never resolve on a user
// target (barrier, clone, summon, move — ground-only / special handlers). Locked to the
// canonical list by tests/validators/objective_tag_types.test.ts (fails if a new effect type
// is added).
export const OBJECTIVE_TAG_TYPES = [
  "absorb",
  "afterburn",
  "buffprevent",
  "cleanse",
  "cleanseprevent",
  "clear",
  "clearprevent",
  "consume",
  "copy",
  "damage",
  "debuffprevent",
  "decreasecooldown",
  "decreasedamagegiven",
  "decreasedamagetaken",
  "decreaseheal",
  "decreasemaxpools",
  "decreasepoolcost",
  "decreasestat",
  "disarm",
  "drain",
  "elementalseal",
  "finalstand",
  "flee",
  "fleeprevent",
  "heal",
  "healprevent",
  "immunity",
  "increasecooldown",
  "increasedamagegiven",
  "increasedamagetaken",
  "increaseheal",
  "increasemaxpools",
  "increasepoolcost",
  "increaserange",
  "increasestat",
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
export type ObjectiveTagType = (typeof OBJECTIVE_TAG_TYPES)[number];

export const LocationTasks = [
  "move_to_location",
  "win_encounter_at_location",
  "collect_item",
  "deliver_item",
  "defeat_opponents",
] as const;
export type LocationTasksType = (typeof LocationTasks)[number];

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
export type TrackerObjectiveTask = (typeof TrackerObjectiveTasks)[number];

export const allObjectiveTasks = [
  ...SimpleTasks,
  ...LocationTasks,
  ...InstantTasks,
  ...RaidTasks,
  ...TrackerObjectiveTasks,
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
  spars_won: { image: IMG_BADGE_ARENAKILLS, title: "Spars Won" },
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
};

export const baseObjectiveFields = {
  id: z.string(),
  description: z.string().prefault(""),
  successDescription: z.string().prefault(""),
  nextObjectiveId: z.string().optional(),
  sceneBackground: z.string().prefault(""),
  sceneCharacters: z.array(z.string()).prefault([]),
  // Default not set, but used for e.g. dialog objectives
  sector: z.coerce.number().optional(),
  longitude: z.coerce.number().optional(),
  latitude: z.coerce.number().optional(),
};

export const SimpleObjective = z.object({
  ...baseObjectiveFields,
  task: z.enum(SimpleTasks),
  value: z.coerce.number().min(0).prefault(3),
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
  task: z.literal("reset_quest").prefault("reset_quest"),
  resetObjectiveId: z.string().optional(),
  ...rewardFields,
});

export const InstantNewQuestObjective = z.object({
  ...baseObjectiveFields,
  task: z.literal("new_quest").prefault("new_quest"),
  newQuestIds: z.array(z.string()).prefault([]),
  ...rewardFields,
});

export const InstantStartBattleObjective = z.object({
  ...baseObjectiveFields,
  ...battleObjectiveFields,
  task: z.literal("start_battle").prefault("start_battle"),
  opponentAIs: idsWithNumberField.refine((data) => data.length > 0, {
    error: "At least one opponent AI is required",
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
  task: z.literal("dialog").prefault("dialog"),
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
  task: z.literal("move_to_location").prefault("move_to_location"),
});

export const EncountersAtLocation = z.object({
  ...baseObjectiveFields,
  ...complexObjectiveFields,
  locationType: z.enum(LOCATION_TYPES).prefault("random"),
  task: z.literal("win_encounter_at_location").prefault("win_encounter_at_location"),
});

export const CollectItem = z.object({
  ...baseObjectiveFields,
  task: z.literal("collect_item").prefault("collect_item"),
  item_name: z.string().min(3).prefault("Secret scroll"),
  collectItemIds: z.array(z.string()).prefault([]),
  delete_on_complete: z.coerce.boolean().prefault(false),
  collect_time_minutes: z.coerce.number().min(0).max(60).prefault(0),
  ...complexObjectiveFields,
});
export type CollectItemType = z.infer<typeof CollectItem>;

export const DeliverItem = z.object({
  ...baseObjectiveFields,
  task: z.literal("deliver_item").prefault("deliver_item"),
  item_name: z.string().min(3).prefault("Secret scroll"),
  deliverItemIds: z.array(z.string()).prefault([]),
  delete_on_complete: z.coerce.boolean().prefault(true),
  ...complexObjectiveFields,
});
export type DeliverItemType = z.infer<typeof DeliverItem>;

export const DefeatOpponents = z.object({
  ...baseObjectiveFields,
  ...battleObjectiveFields,
  task: z.literal("defeat_opponents").prefault("defeat_opponents"),
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
  ...rewardFields,
});
export type RaidObjectiveType = z.infer<typeof RaidObjective>;

// contentId stores the crafted item id (matched against craftItemIds).
export const CraftSpecificItem = z.object({
  ...baseObjectiveFields,
  task: z.literal("craft_specific_item").prefault("craft_specific_item"),
  craftItemIds: z.array(z.string()).prefault([]),
  value: z.coerce.number().min(0).prefault(1),
  ...rewardFields,
});

// contentId stores the trained jutsu id (matched against trainJutsuIds).
export const TrainSpecificJutsu = z.object({
  ...baseObjectiveFields,
  task: z.literal("train_specific_jutsu").prefault("train_specific_jutsu"),
  trainJutsuIds: z.array(z.string()).prefault([]),
  value: z.coerce.number().min(0).prefault(1),
  ...rewardFields,
});

// contentId stores the completed quest id (matched against completeQuestIds).
export const CompleteSpecificQuest = z.object({
  ...baseObjectiveFields,
  task: z.literal("complete_specific_quest").prefault("complete_specific_quest"),
  completeQuestIds: z.array(z.string()).prefault([]),
  value: z.coerce.number().min(0).prefault(1),
  ...rewardFields,
});

// contentId stores the purchased item id (matched against buyItemIds). NPC shop only (v1).
export const BuyItem = z.object({
  ...baseObjectiveFields,
  task: z.literal("buy_item").prefault("buy_item"),
  buyItemIds: z.array(z.string()).prefault([]),
  value: z.coerce.number().min(0).prefault(1),
  ...rewardFields,
});

// contentId stores a used item id from this battle (matched against useItemIds).
export const UseSpecificItemCombat = z.object({
  ...baseObjectiveFields,
  task: z.literal("use_specific_item_combat").prefault("use_specific_item_combat"),
  useItemIds: z.array(z.string()).prefault([]),
  value: z.coerce.number().min(0).prefault(1),
  ...rewardFields,
});

// contentId stores a used jutsu id from this battle (matched against useJutsuIds).
export const UseSpecificJutsuCombat = z.object({
  ...baseObjectiveFields,
  task: z.literal("use_specific_jutsu_combat").prefault("use_specific_jutsu_combat"),
  useJutsuIds: z.array(z.string()).prefault([]),
  value: z.coerce.number().min(0).prefault(1),
  ...rewardFields,
});

// contentId stores an applied combat tag type from a won battle (matched against tagType).
export const TagUsageWin = z.object({
  ...baseObjectiveFields,
  task: z.literal("tag_usage_win").prefault("tag_usage_win"),
  // Default to a valid tag so a freshly-added objective parses (otherwise the editor's
  // safeParse fails, falls back to the raw object, and never renders the tag picker).
  tagType: z.enum(OBJECTIVE_TAG_TYPES).prefault(OBJECTIVE_TAG_TYPES[0]),
  value: z.coerce.number().min(0).prefault(1),
  ...rewardFields,
});

// value = damage threshold. singleBattle=false accumulates across the quest's battles;
// singleBattle=true tracks the best single battle (monotonic max). Flipping singleBattle
// on a live quest re-interprets the already-stored counter (a cumulative sum reads as a
// single-battle max), so such edits must ship with a reset of affected user trackers.
export const DamageDealt = z.object({
  ...baseObjectiveFields,
  task: z.literal("damage_dealt").prefault("damage_dealt"),
  singleBattle: z.coerce.boolean().prefault(false),
  value: z.coerce.number().min(0).prefault(1),
  ...rewardFields,
});

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
]);
export type AllObjectivesType = z.infer<typeof AllObjectives>;

export const ObjectiveTracker = z.object({
  id: z.string(),
  done: z.boolean().prefault(false),
  value: z.coerce.number().prefault(0),
  collected: z.boolean().prefault(false),
  sector: z.coerce.number().min(0).optional(),
  longitude: z.coerce.number().min(0).optional(),
  latitude: z.coerce.number().min(0).optional(),
  selectedNextObjectiveId: z.string().optional(),
  timestamp: z.iso.datetime().optional(),
  recentlyDied: z.boolean().prefault(false),
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
  startAt: z.iso.datetime().prefault(new Date().toISOString()),
  goals: z.array(ObjectiveTracker).prefault([]),
});
export type QuestTrackerType = z.infer<typeof QuestTracker>;

export const QuestValidatorRawSchema = z.object({
  name: z.string().min(1).max(191),
  image: z.url().optional().nullish(),
  description: z.string().min(1).max(5000).nullable(),
  successDescription: z.string().min(1).max(5000).nullable(),
  questRank: z.enum(LetterRanks).optional(),
  medicalRank: z.enum(MEDNIN_RANKS).optional().nullish(),
  huntingRank: z.enum(HUNTING_RANKS).optional().nullish(),
  gatheringRank: z.enum(GATHERING_RANKS).optional().nullish(),
  requiredLevel: z.coerce.number().min(0).max(100).optional(),
  maxLevel: z.coerce.number().min(0).max(100).optional(),
  maxAttempts: z.coerce.number().min(0).max(100).prefault(1),
  maxCompletes: z.coerce.number().min(0).max(100).prefault(1),
  requiredVillage: z.string().min(0).max(30).optional().nullish(),
  requiredBloodlineId: z.string().min(0).max(191).optional().nullish(),
  prerequisiteQuestId: z.string().min(0).max(191).optional().nullish(),
  tierLevel: z.coerce.number().min(0).max(100).nullable(),
  questType: z.enum(QuestTypes),
  content: z.object({
    objectives: z.array(AllObjectives),
    reward: ObjectiveReward,
    sceneBackground: z.string().prefault(""),
    sceneCharacters: z.array(z.string()).prefault([]),
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
    const objective = val.content.objectives[0];
    const objectiveTask = objective?.task;
    if (objectiveTask && !["open_raid", "exclusive_raid"].includes(objectiveTask)) {
      ctx.addIssue({
        code: "custom",
        message: "Raid quest objective must be 'open_raid' or 'exclusive_raid'",
      });
    }
    // Validate opponentAIs is present in objective (handled by schema refinement, but validate here too)
    const opponentAIs = (objective as { opponentAIs?: { ids: string[] }[] })
      ?.opponentAIs;
    if (!opponentAIs || opponentAIs.length === 0) {
      ctx.addIssue({
        code: "custom",
        message:
          "Raid quest objective must have at least one boss AI (configure opponentAIs in the objective)",
        path: ["content", "objectives", 0, "opponentAIs"],
      });
    }

    // Both raid types require a sector number in the objective
    const sector = (objective as { sector?: number })?.sector;
    if (sector === null || sector === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "Raids require a sector number in the objective (sector field)",
        path: ["content", "objectives", 0, "sector"],
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
      val.raidBossCurrentHealth !== undefined &&
      val.raidBossCurrentHealth !== null &&
      val.raidBossMaxHealth !== undefined &&
      val.raidBossMaxHealth !== null &&
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
export const QuestFormRawSchema = QuestValidatorRawSchema.extend(
  ObjectiveReward.shape,
).extend(
  z.object({
    sceneBackground: z.string().prefault(""),
    sceneCharacters: z.array(z.string()).prefault([]),
  }).shape,
);
export const QuestFormSchema = QuestFormRawSchema.superRefine(questSuperRefine);
export type ZodQuestFormType = z.output<typeof QuestFormSchema>;
export type ZodQuestFormInput = z.input<typeof QuestFormSchema>;

export const getObjectiveSchema = (type: string) => {
  if (SimpleTasks.includes(type as SimpleTask)) {
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
  } else if (type === "craft_specific_item") {
    return CraftSpecificItem;
  } else if (type === "train_specific_jutsu") {
    return TrainSpecificJutsu;
  } else if (type === "complete_specific_quest") {
    return CompleteSpecificQuest;
  } else if (type === "buy_item") {
    return BuyItem;
  } else if (type === "use_specific_item_combat") {
    return UseSpecificItemCombat;
  } else if (type === "use_specific_jutsu_combat") {
    return UseSpecificJutsuCombat;
  } else if (type === "tag_usage_win") {
    return TagUsageWin;
  } else if (type === "damage_dealt") {
    return DamageDealt;
  }
  throw new Error(`Unknown objective task ${type}`);
};

export const allObjectiveSchema = z.union([
  SimpleObjective,
  MoveToObjective,
  CollectItem,
  DeliverItem,
  DefeatOpponents,
  CraftSpecificItem,
  TrainSpecificJutsu,
  CompleteSpecificQuest,
  BuyItem,
  UseSpecificItemCombat,
  UseSpecificJutsuCombat,
  TagUsageWin,
  DamageDealt,
]);

/**
 * Validator schema for Raid Damage Threshold configuration.
 * Used for creating/updating threshold records via the admin UI.
 */
export const RaidDamageThresholdValidator = z.object({
  id: z.string().optional(), // Optional for creates
  questId: z.string(),
  damageRequired: z.coerce.number().min(1, "Damage must be at least 1"),
  sortOrder: z.coerce.number().min(0).max(255).prefault(0),
  rewards: ObjectiveReward,
  effects: z.array(AllTags).prefault([]),
  effectDurationMinutes: z.coerce.number().min(1).max(10080).prefault(60),
});
export type RaidDamageThresholdType = z.infer<typeof RaidDamageThresholdValidator>;

export const OCCUPATIONS = ["GATHERING", "HUNTER", "CRAFTING"] as const;
export type OccupationType = (typeof OCCUPATIONS)[number];

export const CURRENCY_TYPES = ["MONEY", "REPUTATION", "SEICHI_SILVER"] as const;
export type CurrencyType = (typeof CURRENCY_TYPES)[number];

export const TRADEABLE_CURRENCY_TYPES = ["MONEY", "REPUTATION"] as const;
export type TradeableCurrencyType = (typeof TRADEABLE_CURRENCY_TYPES)[number];

// Threejs drawing layers
export const STATUS_LAYER = -3;
export const USER_LAYER = -4;
export const ASSETS_LAYER = -5;
export const EFFECTS_LAYER = -6;
export const TILES_LAYER = -9;
export const DIRT_LAYER = -10;

// Occupation config
export const OCCUPATION_CHANGE_COOLDOWN_DAYS = 3;

export const PollOptionTypes = ["text", "user"] as const;
export type PollOptionType = (typeof PollOptionTypes)[number];

export const STARTER_VILLAGES = [
  "NONE",
  "SHINE",
  "TSUKIMORI",
  "GLACIER",
  "SHROUD",
  "CURRENT",
] as const;
export type StarterVillage = (typeof STARTER_VILLAGES)[number];

export const ACTIVE_VOTING_SITES = [
  "mmoHub",
  "arenaTop100",
  "bbogd",
  "topWebGames",
] as const;

export const GameAssetTypes = [
  "STATIC",
  "ANIMATION",
  "SCENE_BACKGROUND",
  "SCENE_CHARACTER",
  "SFX",
  "MUSIC",
] as const;
export type GameAssetType = (typeof GameAssetTypes)[number];

// Image orientations
export const IMG_ORIENTATIONS = ["square", "portrait", "landscape"] as const;
export type IMG_ORIENTATION = (typeof IMG_ORIENTATIONS)[number];

// How many seconds to regen a given regen value
export const REGEN_SECONDS = 30;

export const ContentTypes = [
  "asset",
  "ai",
  "badge",
  "bloodline",
  "bloodline_reskin",
  "item",
  "jutsu",
  "jutsu_reskin",
  "quest",
  "user",
  "skillTree",
] as const;
export type ContentType = (typeof ContentTypes)[number];

export const MAP_RESERVED_SECTORS = [
  73, 72, 75, 78, 275, 279, 201, 183, 272, 264, 270, 308, 289, 259, 260, 253, 304, 307,
  283, 284, 340, 334, 330, 331, 332, 337, 342, 336, 341, 335, 113, 109, 443,
];
export const MAP_TOTAL_SECTORS = 443;
export const MAP_WAKE_ISLAND_SECTOR = 222;
export const MAP_WAR_TORN_BATTLEGROUND_SECTOR = 335;
export const MAP_GLOBAL_TRAVEL_TIME_CAP_SECS = 10;

export const CoreVillages = [
  "Shine",
  "Tsukimori",
  "Glacier",
  "Shroud",
  "Current",
] as const;

export const LetterRanks = ["D", "C", "B", "A", "S", "H"] as const;
export type LetterRank = (typeof LetterRanks)[number];

// List of tags that share cooldowns
export const SHARED_COOLDOWN_TAGS = [
  "barrier",
  "buffprevent",
  "cleanse",
  "cleanseprevent",
  "clear",
  "clearprevent",
  "debuffprevent",
  "drain",
  "increasepoolcost",
  "moveprevent",
  "pierce",
  "poison",
  "seal",
  "stun",
  "summon",
] as const;

export const LOG_TYPES = [
  "ai",
  "badge",
  "battleAction",
  "bloodline",
  "clan",
  "item",
  "jutsu",
  "poll",
  "user",
  "userjutsu",
  "war",
] as const;
export type LogType = (typeof LOG_TYPES)[number];

export const StatTypes = [
  "Highest",
  "Ninjutsu",
  "Genjutsu",
  "Taijutsu",
  "Bukijutsu",
] as const;
export type StatType = (typeof StatTypes)[number];

export const GeneralTypes = [
  "Highest",
  "Strength",
  "Intelligence",
  "Willpower",
  "Speed",
] as const;
export type GeneralType = (typeof GeneralTypes)[number];

export const AdjustableBasicActions = [
  "basicAttack",
  "basicHeal",
  "move",
  "clear",
  "cleanse",
] as const;
export type AdjustableBasicAction = (typeof AdjustableBasicActions)[number];

export const PoolTypes = ["Health", "Chakra", "Stamina"] as const;
export type PoolType = (typeof PoolTypes)[number];

export const ItemRarities = ["COMMON", "RARE", "EPIC", "LEGENDARY"] as const;
export type ItemRarity = (typeof ItemRarities)[number];

export const ItemSlotTypes = [
  "HEAD",
  "CHEST",
  "LEGS",
  "FEET",
  "HAND",
  "ITEM",
  "WAIST",
  "KEYSTONE",
  "NONE",
] as const;

export const StructureRoutes = [
  "",
  "/academy",
  "/adminbuilding",
  "/anbu",
  "/bank",
  "/battlearena",
  "/blackmarket",
  "/clanhall",
  "/globalanbuhq",
  "/home",
  "/hospital",
  "/itemshop",
  "/missionhall",
  "/ramenshop",
  "/science",
  "/souvenirs",
  "/townhall",
  "/traininggrounds",
  "/occupation",
  "/auctionhouse",
] as const;
export type StructureRoute = (typeof StructureRoutes)[number];

export const ItemSlots = [
  "HEAD",
  "CHEST",
  "LEGS",
  "FEET",
  "HAND_1",
  "HAND_2",
  "WAIST",
  "KEYSTONE",
  "ITEM_1",
  "ITEM_2",
  "ITEM_3",
  "ITEM_4",
  "ITEM_5",
  "ITEM_6",
  "ITEM_7",
  "NONE",
] as const;
export type ItemSlot = (typeof ItemSlots)[number];

export const AutomoderationCategories = [
  "comment",
  "privateMessage",
  "forumPost",
  "userReport",
  "userNindo",
  "clanOrder",
  "anbuOrder",
  "kageOrder",
  "userAvatar",
] as const;
export type AutomoderationCategory = (typeof AutomoderationCategories)[number];

export const UserRoles = [
  "USER",
  "CODING-ADMIN",
  "CONTENT-ADMIN",
  "EVENT-ADMIN",
  "MODERATOR-ADMIN",
  "HEAD_MODERATOR",
  "MODERATOR",
  "JR_MODERATOR",
  "CONTENT",
  "EVENT",
  "CODER",
] as const;
export type UserRole = (typeof UserRoles)[number];

export const UserRolesWithSkillTreeAccess = ["CHUNIN", "JONIN", "ELITE JONIN", "ELDER"];
export type UserRoleWithSkillTreeAccess = (typeof UserRolesWithSkillTreeAccess)[number];

// Staff Applications
export const StaffApplicationStates = ["PENDING", "APPROVED", "REJECTED"] as const;
export type StaffApplicationState = (typeof StaffApplicationStates)[number];

// Approval groups required for promotion
export const StaffApprovalGroups = [
  "EVENT-ADMIN",
  "CODING-ADMIN",
  "MODERATOR-ADMIN",
  "CONTENT-ADMIN",
] as const satisfies readonly UserRole[];
export type StaffApprovalGroup = (typeof StaffApprovalGroups)[number];

// Per-group approval decision states
export const StaffApplicationApprovalStates = ["APPROVED", "REJECTED"] as const;
export type StaffApplicationApprovalState =
  (typeof StaffApplicationApprovalStates)[number];

// Roles users are allowed to apply for
export const StaffApplicationTargetRoles = [
  "CONTENT",
  "CODER",
  "EVENT",
  "JR_MODERATOR",
  "MODERATOR",
  "HEAD_MODERATOR",
] as const satisfies readonly UserRole[];
export type StaffApplicationTargetRole = (typeof StaffApplicationTargetRoles)[number];

export const UserStatuses = [
  "AWAKE",
  "HOSPITALIZED",
  "TRAVEL",
  "BATTLE",
  "QUEUED",
  "KAGE_QUEUED",
  "ASLEEP",
] as const;
export type UserStatus = (typeof UserStatuses)[number];

export const FederalStatuses = ["NONE", "NORMAL", "SILVER", "GOLD"] as const;
export type FederalStatus = (typeof FederalStatuses)[number];

export const UserRanks = [
  "STUDENT",
  "GENIN",
  "CHUNIN",
  "JONIN",
  "ELITE JONIN",
  "ELDER",
  "NONE",
] as const;
export type UserRank = (typeof UserRanks)[number];

export const ItemTypes = [
  "WEAPON",
  "CONSUMABLE",
  "ARMOR",
  "ACCESSORY",
  "MATERIAL",
  "KEYSTONE",
  "CRYSTAL",
  "OTHER",
] as const;
export type ItemType = (typeof ItemTypes)[number];

export const NonActionItemTypes: ItemType[] = [
  "MATERIAL",
  "CRYSTAL",
  "ARMOR",
  "ACCESSORY",
  "KEYSTONE",
];

export const BanStates = [
  "UNVIEWED",
  "REPORT_CLEARED",
  "BAN_ACTIVATED",
  "SILENCE_ACTIVATED",
  "BAN_ESCALATED",
  "SILENCE_ESCALATED",
  "OFFICIAL_WARNING",
  "TRADE_BAN_ACTIVATED",
] as const;
export type BanState = (typeof BanStates)[number];

export const TERR_BOT_ID = "iDoQgjrffFd81z8dCYdw7";

export const TimeUnits = ["minutes", "hours", "days", "weeks", "months"] as const;
export type TimeUnit = (typeof TimeUnits)[number];

export const WeaponTypes = [
  "STAFF",
  "AXE",
  "FIST_WEAPON",
  "SHURIKEN",
  "SICKLE",
  "DAGGER",
  "SWORD",
  "POLEARM",
  "FLAIL",
  "CHAIN",
  "FAN",
  "BOW",
  "HAMMER",
  "NONE",
] as const;

export const AttackTargets = [
  "SELF",
  "OTHER_USER",
  "OPPONENT",
  "ALLY",
  "CHARACTER",
  "GROUND",
  "EMPTY_GROUND",
] as const;
export type AttackTarget = (typeof AttackTargets)[number];

// Targets for passive skill tree effects applied on battle start
export const SkillTreeTargets = ["SELF", "ENEMIES", "ALLIES"] as const;
export type SkillTreeTarget = (typeof SkillTreeTargets)[number];

// Durability config
export const DURABILITY_MAX_DEFAULT = 100;
export const DURABILITY_USABILITY_THR = 0;
export const DURABILITY_POINT_PRICE_PERCENT = 0.1;

// Skill Tree Entry Types
export const SkillTreeEntryTypes = ["DEFAULT", "SPECIAL"] as const;
export type SkillTreeEntryType = (typeof SkillTreeEntryTypes)[number];

export const AttackMethods = [
  "SINGLE",
  "ALL",
  "AOE_CIRCLE_SPAWN",
  "AOE_LINE_SHOOT",
  "AOE_WALL_SHOOT",
  "AOE_LARGE_WALL_SHOOT",
  "AOE_CIRCLE_SHOOT",
  "AOE_SPIRAL_SHOOT",
] as const;
export type AttackMethod = (typeof AttackMethods)[number];

export const JutsuTypes = [
  "NORMAL",
  "SPECIAL",
  "BLOODLINE",
  "FORBIDDEN",
  "LOYALTY",
  "CLAN",
  "EVENT",
  "AI",
] as const;
export type JutsuType = (typeof JutsuTypes)[number];

export const UserStatNames = [
  "ninjutsuOffence",
  "taijutsuOffence",
  "genjutsuOffence",
  "bukijutsuOffence",
  "ninjutsuDefence",
  "taijutsuDefence",
  "genjutsuDefence",
  "bukijutsuDefence",
  "intelligence",
  "speed",
  "willpower",
  "strength",
] as const;
export type UserStatName = (typeof UserStatNames)[number];

export const BattleTypes = [
  "ARENA",
  "COMBAT",
  "SPARRING",
  "KAGE_AI",
  "KAGE_PVP",
  "CLAN_CHALLENGE",
  "CLAN_BATTLE",
  "SHRINE_WAR",
  "TOURNAMENT",
  "QUEST",
  "RANDOM_ENCOUNTER",
  "VILLAGE_PROTECTOR",
  "TRAINING",
  "RANKED_PVP",
  "RANKED_SPARRING",
] as const;
export type BattleType = (typeof BattleTypes)[number];

export const PvpBattleTypes: BattleType[] = [
  "COMBAT",
  "SPARRING",
  "CLAN_BATTLE",
  "TOURNAMENT",
  "RANKED_SPARRING",
  "KAGE_PVP",
  "KAGE_AI",
  "RANKED_PVP",
  "SHRINE_WAR",
];

export const PveBattleTypes: BattleType[] = [
  "ARENA",
  "QUEST",
  "RANDOM_ENCOUNTER",
  "TRAINING",
  "VILLAGE_PROTECTOR",
  "CLAN_CHALLENGE",
];

export const QuestBattleTypes: BattleType[] = ["QUEST", "RANDOM_ENCOUNTER"];

export const BattleUsageTypes = ["PVE", "PVP", "BOTH"] as const;
export type BattleUsageType = (typeof BattleUsageTypes)[number];

// Combat backgrounds
export const COMBAT_BIOMES = [
  "ocean",
  "ground",
  "dessert",
  "ice",
  "snow",
  "arena",
  "default",
] as const;
export type CombatBiome = (typeof COMBAT_BIOMES)[number];

export const HEXTILE_BIOMES = ["ocean", "ground", "dessert", "ice", "snow"] as const;
export type HEXTILE_TYPE = (typeof HEXTILE_BIOMES)[number];

// HEX grid settings
export const HEX_STACKING_DISPLACEMENT = 0.25; // To compensate for how hexagons stack, this is how much (in percent of width) we lose from a stacking op
export const HEX_ASPECT_RATIO = 0.5; // To give perspective, make hex height smaller than width
export const NO_DURABILITY_LOSS_COMBATS: BattleType[] = ["SPARRING"];

// Sector settings
export const SECTOR_WIDTH = 20;
export const SECTOR_HEIGHT = 26;

// Alliance hall settings default
export const ALLIANCEHALL_LONG = 10;
export const ALLIANCEHALL_LAT = 7;

// Hospital settings default
export const HOSPITAL_LONG = 13;
export const HOSPITAL_LAT = 8;

// Structure adjacent positions
export const STRUCTURE_ADJACENTS = [
  { dCol: -1, dRow: 0 },
  { dCol: -1, dRow: 1 },
  { dCol: -1, dRow: -1 },
  { dCol: 1, dRow: -1 },
  { dCol: 1, dRow: 1 },
  { dCol: 1, dRow: 0 },
  { dCol: 0, dRow: 0 },
  { dCol: 0, dRow: 1 },
  { dCol: 0, dRow: -1 },
  { dCol: 0, dRow: -1 },
  { dCol: 0, dRow: 1 },
  { dCol: 0, dRow: 0 },
];

export const TournamentTypes = ["CLAN"] as const;
export type TournamentType = (typeof TournamentTypes)[number];

export const TournamentStates = ["OPEN", "IN_PROGRESS", "COMPLETED"] as const;
export type TournamentState = (typeof TournamentStates)[number];

export const TournamentMatchStates = ["WAITING", "PLAYED", "NO_SHOW"] as const;
export type TournamentMatchState = (typeof TournamentMatchStates)[number];

export const AutoBattleTypes = ["KAGE_AI", "CLAN_CHALLENGE"];

export const BattleDataEntryType = [
  "jutsu",
  "item",
  "bloodline",
  "basic",
  "ai",
] as const;

export const RetryQuestDelays = ["daily", "weekly", "monthly", "none"] as const;
export type RetryQuestDelay = (typeof RetryQuestDelays)[number];

export const QuestTypes = [
  "starter",
  "tier",
  "daily",
  "mission",
  "errand",
  "crime",
  "exam",
  "event",
  "story",
  "anbu",
  "medical",
  "hunting",
  "gathering",
  "battlepyramid",
  "pvp",
  "achievement",
] as const;
export type QuestType = (typeof QuestTypes)[number];
export const QUESTS_CONCURRENT_LIMIT = 4;

// Ordering here represents the default ordering for tutorial component
export const OrderedQuestTypesInTutorial: QuestType[] = [
  "starter",
  "tier",
  "daily",
  "mission",
  "errand",
  "crime",
  "exam",
  "event",
  "story",
] as const;

// Quest reward metrics used in balance statistics and filters
export const QuestRewardMetrics = [
  "reward_money",
  "reward_seichi_silver",
  "reward_clanpoints",
  "reward_anbupoints",
  "reward_exp",
  "reward_tokens",
  "reward_prestige",
  "reward_reputation",
  "reward_skillpoints",
  "reward_medical_experience",
  "reward_hunting_experience",
  "reward_crafting_experience",
  "reward_gathering_experience",
] as const;
export type QuestRewardMetric = (typeof QuestRewardMetrics)[number];

export const QuestTypesWithMaxAttempts = ["event", "story", "battlepyramid", "starter"];
export type QuestTypeWithMaxAttempts = (typeof QuestTypesWithMaxAttempts)[number];

export const SmileyEmotions = ["like", "love", "laugh"] as const;

export const TrainingSpeeds = [
  "15min",
  "1hr",
  "4hrs",
  "8hrs",
  "12hrs",
  "24hrs",
] as const;
export type TrainingSpeed = (typeof TrainingSpeeds)[number];

export const JUTSU_MAX_RESIDUAL_EQUIPPED = 4;
export const JUTSU_MAX_PIERCE_EQUIPPED = 9999;
export const JUTSU_MAX_EVENT_EQUIPPED = 2;
export const JUTSU_MAX_BARRIER_EQUIPPED = 1;

// Content difficulty ratings
export const BloodlineDifficultyRatings = ["Easy", "Medium", "Hard", "Expert"] as const;
export type BloodlineDifficultyRating = (typeof BloodlineDifficultyRatings)[number];

export const UserAssociations = ["MARRIAGE", "DIVORCED"] as const;

export type UserAssociation = (typeof UserAssociations)[number];

export const UserRequestStates = [
  "PENDING",
  "ACCEPTED",
  "REJECTED",
  "CANCELLED",
  "EXPIRED",
] as const;
export type UserRequestState = (typeof UserRequestStates)[number];

export const UserRequestTypes = [
  "SPAR",
  "ALLIANCE",
  "SURRENDER",
  "SENSEI",
  "ANBU",
  "CLAN",
  "MARRIAGE",
  "KAGE",
  "WAR_ALLY",
] as const;
export type UserRequestType = (typeof UserRequestTypes)[number];

export const AllianceStates = ["NEUTRAL", "ALLY", "ENEMY"] as const;
export type AllianceState = (typeof AllianceStates)[number];

export const BasicElementName = [
  "Fire",
  "Water",
  "Wind",
  "Earth",
  "Lightning",
] as const;

export const ElementNames = [
  ...BasicElementName,
  "Ice",
  "Crystal",
  "Dust",
  "Shadow",
  "Wood",
  "Scorch",
  "Storm",
  "Magnet",
  "Yin-Yang",
  "Lava",
  "Explosion",
  "Light",
  "Boil",
  "Metal",
  "Sand",
  "None",
] as const;
export type ElementName = (typeof ElementNames)[number];

// User stats config
export const HP_PER_LVL = 50;
export const SP_PER_LVL = 50;
export const CP_PER_LVL = 50;
export const MAX_ATTRIBUTES = 5;
export const RYO_CAP = 1000000000;
export const MAX_STATS_CAP = 450000;
export const MAX_GENS_CAP = 200000;
export const MAX_DAILY_AI_CALLS = 100;

export const ROLL_CHANCE_PERCENTAGE = {
  ["H"]: 0,
  ["S"]: 0.005,
  ["A"]: 0.01,
  ["B"]: 0.05,
  ["C"]: 0.25,
} as const;

// Calculate cumulative probabilities from individual percentages
export const ROLL_CHANCE = {
  ["H"]: 0,
  ["S"]: ROLL_CHANCE_PERCENTAGE.S,
  ["A"]: ROLL_CHANCE_PERCENTAGE.S + ROLL_CHANCE_PERCENTAGE.A,
  ["B"]: ROLL_CHANCE_PERCENTAGE.S + ROLL_CHANCE_PERCENTAGE.A + ROLL_CHANCE_PERCENTAGE.B,
  ["C"]:
    ROLL_CHANCE_PERCENTAGE.S +
    ROLL_CHANCE_PERCENTAGE.A +
    ROLL_CHANCE_PERCENTAGE.B +
    ROLL_CHANCE_PERCENTAGE.C,
} as const;

// Bloodline Pricing
export const BLOODLINE_COST = {
  ["H"]: 999999,
  ["S"]: 999999,
  ["A"]: 200,
  ["B"]: 190,
  ["C"]: 180,
  ["D"]: 170,
} as const;

export const REMOVAL_COST = 5;

export const Sentiment = ["POSITIVE", "NEGATIVE", "NEUTRAL"] as const;
export type SentimentType = (typeof Sentiment)[number];

// Starter quest used for recruitment analytics
export const IMG_URL_ASSISTANT =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJrCz0dVhuJPmdY8zI2ptZXAoEj1c6BMKvrQOx" as const;
export const IMG_URL_ASSISTANT_2 =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJIG7HmDxfOewksxBoS1HQCihpL7c42Ky9uUFv" as const;
export const IMG_URL_HANDPOINTER =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJIvN7gkJxfOewksxBoS1HQCihpL7c42Ky9uUF" as const;
export const TUTORIAL_JUTSU_ID = "clh4d6pxd0006tb0h4y1yudi5";
export const TUTORIAL_ITEM_ID = "VOditPJ3X2id0yC-F5Kz3";
export const TUTORIAL_STARTER_QUEST_ID = "eYDVpL63vPhK3lywMexdv";
export const TUTORIAL_GENIN_EXAM_QUEST_ID = "9-t1rNWEzXbIfdUfxWrny";
export const TUTORIAL_ARENA_DUMMY_ID = "ICXb49Z0Jle3GyJ-rosTi";

// Recruitment analytics metric options (used by frontend and backend)
export const RecruitmentMetrics = [
  "level",
  "pveFights",
  "pvpFights",
  "missionsD",
  "missionsC",
  "missionsB",
  "missionsA",
  "crimesD",
  "crimesC",
  "crimesB",
  "crimesA",
  "completedQuests",
] as const;
export type RecruitmentMetric = (typeof RecruitmentMetrics)[number];

// Default clamp maxima for recruitment metrics (min is always 0)
export const RecruitmentMetricMax: Record<RecruitmentMetric, number> = {
  level: 50,
  pveFights: 50,
  pvpFights: 50,
  missionsD: 50,
  missionsC: 50,
  missionsB: 50,
  missionsA: 50,
  crimesD: 50,
  crimesC: 50,
  crimesB: 50,
  crimesA: 50,
  completedQuests: 50,
};

export const RECRUITMENT_GOALS = {
  SIGNUP_RATE_PERCENT: 20,
  RANK_RATE_PERCENT: 5,
  PVP_RATE_PERCENT: 5,
  TUTORIAL_RATE_PERCENT: 50,
  SIGNUP_VALUE_USD: 0.5,
} as const;

// Number of tutorial steps used by the onboarding flow (see hooks/tutorial.tsx)
// IMPORTANT: Keep this in sync with TUTORIAL_STEPS.length in hooks/tutorial.tsx
export const TUTORIAL_STEPS_COUNT = 52;

// Recruitment rewards config
export const RECRUITMENT_REWARDS = [
  "MONEY",
  "REPUTATION",
  "PRESTIGE",
  "CLAN_POINTS",
] as const;
export type RecruitmentReward = (typeof RECRUITMENT_REWARDS)[number];

// Bank config
export const BankTransferTypes = ["bank", "sensei", "recruiter"] as const;

// Caps lookup table
export const USER_CAPS: Record<
  UserRank,
  { GENS_CAP: number; STATS_CAP: number; LVL_CAP: number }
> = {
  STUDENT: { GENS_CAP: 20000, STATS_CAP: 20000, LVL_CAP: 10 },
  GENIN: { GENS_CAP: 40000, STATS_CAP: 40000, LVL_CAP: 20 },
  CHUNIN: { GENS_CAP: MAX_GENS_CAP, STATS_CAP: MAX_STATS_CAP, LVL_CAP: 100 },
  JONIN: { GENS_CAP: MAX_GENS_CAP, STATS_CAP: MAX_STATS_CAP, LVL_CAP: 100 },
  "ELITE JONIN": { GENS_CAP: MAX_GENS_CAP, STATS_CAP: MAX_STATS_CAP, LVL_CAP: 100 },
  ELDER: { GENS_CAP: MAX_GENS_CAP, STATS_CAP: MAX_STATS_CAP, LVL_CAP: 100 },
  NONE: { GENS_CAP: MAX_GENS_CAP, STATS_CAP: MAX_STATS_CAP, LVL_CAP: 100 },
} as const;

// OpenAI models
export const OPENAI_REVIEW_MODEL = "o4-mini";
export const OPENAI_CONTENT_MODEL = "o4-mini";
export const OPENAI_MODERATION_MODEL = "gpt-4o-mini";
export const OPENAI_CHAT_MODEL = "gpt-4o-mini";

// Paypal shop config
export const PAYPAL_DISCOUNT_PERCENT = 0;
export const TRANSACTION_TYPES = ["REP_PURCHASE", "REFERRAL"] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

// Outlaw config
export const ROBBING_SUCCESS_CHANCE = 0.4;
export const ROBBING_STOLLEN_AMOUNT = 0.3;
export const ROBBING_VILLAGE_PRESTIGE_GAIN = 5;
export const ROBBING_IMMUNITY_DURATION = 90;
export const KILLING_NOTORIETY_GAIN = 5;

// Reputation cost config
export const STARTING_REPUTATION_POINTS = 11;
export const COST_CHANGE_USERNAME = 5;
export const COST_CUSTOM_TITLE = 5;
export const COST_CHANGE_GENDER = 5;
export const COST_SWAP_BLOODLINE = 50;
export const COST_SWAP_VILLAGE = 0;
export const COST_RESET_STATS = 15;
export const COST_EXTRA_ITEM_SLOT = 10;
export const COST_EXTRA_JUTSU_SLOT = 50;
export const COST_REROLL_ELEMENT = 10;
export const COST_SKILL_RESET = 30;
export const COST_CONCEPT_IMAGE = 1;
export const COST_CONCEPT_VIDEO = 10;
export const MAX_EXTRA_JUTSU_SLOTS = 2;
export const BATTLE_LOG_FULL_LIMIT = 1000;
export const BATTLE_LOG_DEFAULT_LIMIT = 30;
export const MAX_EXTRA_RESKIN_SLOTS = 255;
export const BLOODLINE_ROLL_TYPES = [
  "NATURAL",
  "ITEM",
  "PITY",
  "DIRECT",
  "QUEST",
  "REGISTRATION",
] as const;

// Bloodline swap config
export const BLOODLINE_SWAP_COOLDOWN_HOURS = 48;
export const BLOODLINE_SWAP_FREE_DAYS = 30;
export const BLOODLINE_SWAP_FREE_AMOUNT = 0;
export const BLOODLINE_SWAP_FREE_NORMAL = 0;
export const BLOODLINE_SWAP_FREE_SILVER = 0;
export const BLOODLINE_SWAP_FREE_GOLD = 1;

// Skill tree config
export const SKILL_TREE_RESET_FREE_NORMAL = 0;
export const SKILL_TREE_RESET_FREE_SILVER = 1;
export const SKILL_TREE_RESET_FREE_GOLD = 2;

// Jutsu level transfer config
export const JUTSU_TRANSFER_DAYS = 20;
export const JUTSU_TRANSFER_COST = 20;
export const JUTSU_TRANSFER_MAX_LEVEL = 25;
export const JUTSU_TRANSFER_MINIMUM_LEVEL = 10;
export const JUTSU_TRANSFER_FREE_AMOUNT = 2;
export const JUTSU_TRANSFER_FREE_NORMAL = 3;
export const JUTSU_TRANSFER_FREE_SILVER = 4;
export const JUTSU_TRANSFER_FREE_GOLD = 5;

// Jutsu reskin config
export const RESKIN_LIMIT = 2;
export const COST_RESKIN_JUTSU = 60;

// Village config
export const VILLAGE_LEAVE_REQUIRED_RANK = "CHUNIN";
export const VILLAGE_REDUCED_GAINS_DAYS = 7;
export const VILLAGE_SYNDICATE_ID = "ryBk0qD4EgvPPyav2K4OC";

// ANBU config
export const ANBU_MEMBER_RANK_REQUIREMENT = "CHUNIN";
export const ANBU_LEADER_RANK_REQUIREMENT = "JONIN";
export const ANBU_MAX_MEMBERS = 4;
export const ANBU_HOSPITAL_DISCOUNT_PERC = 5;
export const ANBU_ITEMSHOP_DISCOUNT_PERC = 5;
export const ANBU_DELAY_SECS = 5 * 24 * 3600; // Delay before kage can disband ANBU squads (5 days)
export const ANBU_MAX_ESPIONAGE_LEVEL = 10;
export const ANBU_ESPIONAGE_BASE_CHANCE_PERC = 10;
export const ANBU_ESPIONAGE_CHANGE_PER_LEVEL = 5;
export const ANBU_ESPIONAGE_UPGRADE_COST = 200;
export const ANBU_ESPIONAGE_PRESTIGE_COST = 10000;
export const ANBU_ESPIONAGE_POINTS_COST = 100;
export const ANBU_MAX_STEALTH_LEVEL = 10;
export const ANBU_STEALTH_BASE_CHANCE_PERC = 10;
export const ANBU_STEALTH_CHANGE_PER_LEVEL = 5;
export const ANBU_STEALTH_UPGRADE_COST = 200;

// Sensei config
export const SENSEI_RANKS = ["JONIN", "ELITE JONIN", "ELDER"];
export const SENSEI_STUDENT_RYO_PER_MISSION = 100;
export const SENSEI_GENIN_TRAIN_EXP_BOOST_PERC = 5; // % extra stat training experience for Genin
export const SENSEI_GENIN_MED_EXP_SHARE_PERC = 5; // % of medical exp shared to Genin student when sensei heals
export const SENSEI_STUDENT_MISSION_EXP_BOOST_PERC = 3; // % extra mission experience for Chunin (<= lvl 40)
export const SENSEI_MAX_STUDENT_LEVEL = 40;
export const SENSEI_JUTSU_TRAIN_COST_REDUCTION_PERC = 5; // % reduced jutsu training cost for Chunin (<= lvl 40) and their senseis

// Medical Ninja config
export const MEDNIN_HEAL_ITEM_DISCOUNT_PERC = 30;
export const MEDNIN_HEALABLE_STATES = ["HOSPITALIZED", "AWAKE"] as const;
export const MEDNIN_MIN_RANK = "GENIN";
export const MEDNIN_RANKS = [
  "NONE",
  "NOVICE",
  "APPRENTICE",
  "MASTER",
  "LEGENDARY",
] as const;
export const MEDNIN_HEAL_TO_EXP = 0.1;
export type MEDNIN_RANK = (typeof MEDNIN_RANKS)[number];
export const MEDNIN_REQUIRED_EXP: Record<MEDNIN_RANK, number> = {
  NONE: 0,
  NOVICE: 0,
  APPRENTICE: 100000,
  MASTER: 400000,
  LEGENDARY: 600000,
};
export const MEDNIN_EXP_CAP = 4000000; // 4 million medical experience cap
export const MEDNIN_EXP_PER_IMPROVEMENT = 340000; // 340k exp per improvement
export const MEDNIN_CHAKRA_REDUCTION_PER_IMPROVEMENT = 0.01; // 0.01 reduction per improvement
export const MEDNIN_MIN_CHAKRA_FACTOR = 0.05; // Minimum chakra factor

// Hunting config
export const HUNTING_RANKS = [
  "NONE",
  "D RANK",
  "C RANK",
  "B RANK",
  "A RANK",
  "S RANK",
] as const;
export type HUNTING_RANK = (typeof HUNTING_RANKS)[number];
export const HUNTING_REQUIRED_EXP: Record<HUNTING_RANK, number> = {
  NONE: 0,
  "D RANK": 0,
  "C RANK": 30000,
  "B RANK": 76000,
  "A RANK": 90000,
  "S RANK": 120000,
};
export const HUNTING_ITEM_DROP_CHANCES: Record<
  HUNTING_RANK,
  Record<ItemRarity, number>
> = {
  NONE: {
    COMMON: 15,
    RARE: 0,
    EPIC: 0,
    LEGENDARY: 0,
  },
  "D RANK": {
    COMMON: 15,
    RARE: 10,
    EPIC: 0,
    LEGENDARY: 0,
  },
  "C RANK": {
    COMMON: 20,
    RARE: 15,
    EPIC: 5,
    LEGENDARY: 1,
  },
  "B RANK": {
    COMMON: 25,
    RARE: 20,
    EPIC: 10,
    LEGENDARY: 2,
  },
  "A RANK": {
    COMMON: 30,
    RARE: 25,
    EPIC: 15,
    LEGENDARY: 5,
  },
  "S RANK": {
    COMMON: 40,
    RARE: 30,
    EPIC: 20,
    LEGENDARY: 10,
  },
};

// Gathering config
export const GATHERING_RANKS = [
  "NONE",
  "D RANK",
  "C RANK",
  "B RANK",
  "A RANK",
  "S RANK",
] as const;
export type GATHERING_RANK = (typeof GATHERING_RANKS)[number];
export const GATHERING_REQUIRED_EXP: Record<GATHERING_RANK, number> = {
  NONE: 0,
  "D RANK": 0,
  "C RANK": 30000,
  "B RANK": 76000,
  "A RANK": 90000,
  "S RANK": 120000,
};
export const GATHERING_EXPERIENCE_GAIN: Record<ItemRarity, number> = {
  COMMON: 200,
  RARE: 300,
  EPIC: 400,
  LEGENDARY: 500,
};
export const GATHERING_ITEM_DROP_CHANCES: Record<
  GATHERING_RANK,
  Record<ItemRarity, number>
> = {
  NONE: {
    COMMON: 0,
    RARE: 0,
    EPIC: 0,
    LEGENDARY: 0,
  },
  "D RANK": {
    COMMON: 15,
    RARE: 10,
    EPIC: 0,
    LEGENDARY: 0,
  },
  "C RANK": {
    COMMON: 20,
    RARE: 15,
    EPIC: 5,
    LEGENDARY: 1,
  },
  "B RANK": {
    COMMON: 25,
    RARE: 20,
    EPIC: 10,
    LEGENDARY: 2,
  },
  "A RANK": {
    COMMON: 30,
    RARE: 25,
    EPIC: 15,
    LEGENDARY: 5,
  },
  "S RANK": {
    COMMON: 40,
    RARE: 30,
    EPIC: 20,
    LEGENDARY: 10,
  },
};

// Crafting config
export const CRAFTING_RANKS = [
  "NOVICE",
  "APPRENTICE",
  "MASTER",
  "FORGEMASTER",
] as const;
export type CRAFTING_RANK = (typeof CRAFTING_RANKS)[number];
export const CRAFTING_REQUIRED_EXP: Record<CRAFTING_RANK, number> = {
  NOVICE: 0,
  APPRENTICE: 100000,
  MASTER: 300000,
  FORGEMASTER: 600000,
};
export const CRAFTING_EXP_GAIN: Record<CRAFTING_RANK, number> = {
  NOVICE: 1000,
  APPRENTICE: 2000,
  MASTER: 3000,
  FORGEMASTER: 0,
};
export const CRAFTING_MAX_IMBUED_ITEMS: Record<CRAFTING_RANK, number> = {
  NOVICE: 0,
  APPRENTICE: 1,
  MASTER: 2,
  FORGEMASTER: 3,
};
export const CRAFTING_TIMES_MINS: Record<CRAFTING_RANK, Record<ItemRarity, number>> = {
  NOVICE: {
    COMMON: 60,
    RARE: 90,
    EPIC: 0, // Cannot craft epic items
    LEGENDARY: 0, // Cannot craft legendary items
  },
  APPRENTICE: {
    COMMON: 40,
    RARE: 65,
    EPIC: 90,
    LEGENDARY: 0, // Cannot craft legendary items
  },
  MASTER: {
    COMMON: 30,
    RARE: 50,
    EPIC: 70,
    LEGENDARY: 240,
  },
  FORGEMASTER: {
    COMMON: 15,
    RARE: 30,
    EPIC: 60,
    LEGENDARY: 160,
  },
};

// Ai profile config
export const AI_PROFILE_MAX_RULES = 20;

// Training config
export const JUTSU_XP_TO_LEVEL = 1000;
export const JUTSU_LEVEL_CAP = 20;
export const JUTSU_TRAIN_LEVEL_CAP = 25;
export const MAX_DAILY_TRAININGS = 64;
export const MAX_JUTSU_TRAIN_TIME_MS = 60 * 60 * 1000; // 1 hour in milliseconds

// Combat config
export const BATTLE_ARENA_DAILY_LIMIT = 99999;
export const BATTLE_TAG_STACKING = true;
export const RANKS_RESTRICTED_FROM_PVP = ["STUDENT", "GENIN"];
export const STREAK_LEVEL_DIFF = 10;

// Black market config
export const RYO_FOR_REP_DAYS_FROZEN = 3;
export const RYO_FOR_REP_DAYS_AUTO_DELIST = 30;
export const RYO_FOR_REP_MAX_LISTINGS = 5;
export const RYO_FOR_REP_MIN_REPS = 10;
export const PITY_BLOODLINE_ROLLS = 200;
export const PITY_SYSTEM_ENABLED = true;

// Reputation purchase config
export const MAX_REPS_PER_MONTH = 4000;
export const MAX_REPS_EXTRA_PER_MONTH = 250;

// Federal config
export const FED_NORMAL_REPS_COST = 15;
export const FED_SILVER_REPS_COST = 35;
export const FED_GOLD_REPS_COST = 50;
export const FED_NORMAL_BANK_INTEREST = 2;
export const FED_SILVER_BANK_INTEREST = 5;
export const FED_GOLD_BANK_INTEREST = 8;
export const FED_NORMAL_INVENTORY_SLOTS = 2;
export const FED_SILVER_INVENTORY_SLOTS = 5;
export const FED_GOLD_INVENTORY_SLOTS = 10;
export const FED_NORMAL_JUTSU_SLOTS = 1;
export const FED_SILVER_JUTSU_SLOTS = 2;
export const FED_GOLD_JUTSU_SLOTS = 3;
export const FED_NORMAL_JUTSU_LOADOUTS = 1;
export const FED_SILVER_JUTSU_LOADOUTS = 2;
export const FED_GOLD_JUTSU_LOADOUTS = 3;

export const FED_NORMAL_ITEM_LOADOUTS = 1;
export const FED_SILVER_ITEM_LOADOUTS = 2;
export const FED_GOLD_ITEM_LOADOUTS = 3;
export const FED_EVENT_ITEMS_NORMAL = 15;
export const FED_EVENT_ITEMS_SILVER = 20;
export const FED_EVENT_ITEMS_GOLD = 25;
export const FED_EVENT_ITEMS_DEFAULT = 10;

// Missions config
export const ERRANDS_PER_DAY = 50;
export const MISSIONS_PER_DAY = 20;
export const MEDICAL_MISSIONS_PER_DAY = 9;
export const PVP_MISSIONS_PER_DAY = 12;
export const ADDITIONAL_MISSION_REWARD_MULTIPLIER = 0.4;

// War config
export const WAR_VILLAGE_MAX_SECTORS = 12;
export const WAR_FACTION_MAX_SECTORS = 6;
export const WAR_MINIMUM_TOKENS_FOR_BEING_ATTACKABLE = 10000;
export const WAR_MINIMUM_MEMBERS_REQUIRED = 10; // Minimum members required for war participation
export const WAR_TOWNHALL_HP_REMOVE = 5;
export const WAR_TOWNHALL_HP_RECOVER = 2;
export const WAR_TOWNHALL_HP_ANBU_REMOVE = 10;
export const WAR_TOWNHALL_HP_ANBU_RECOVER = 5;
export const WAR_TOWNHALL_HP_ASSASSIN_REMOVE = 10;
export const WAR_TOWNHALL_HP_ASSASSIN_RECOVER = 5;
export const WAR_TOWNHALL_HP_ELDER_REMOVE = 15;
export const WAR_TOWNHALL_HP_ELDER_RECOVER = 10;
export const WAR_TOWNHALL_HP_COLEADER_REMOVE = 15;
export const WAR_TOWNHALL_HP_COLEADER_RECOVER = 10;
export const WAR_TOWNHALL_HP_KAGE_REMOVE = 35;
export const WAR_TOWNHALL_HP_KAGE_RECOVER = 15;
export const WAR_TOWNHALL_HP_KAGEDEATH_REMOVE = 50;
export const WAR_WINNING_BOOST_DAYS = 3;
export const WAR_WINNING_BOOST_REGEN_PERC = 40;
export const WAR_WINNING_BOOST_TRAINING_PERC = 20;
export const WAR_DAILY_STRUCTURE_HP_DRAIN = 100; // Structure hp drain per day
export const WAR_TOKEN_REDUCTION_INTERVAL_HOURS = 24; // How often tokens should be reduced
export const WAR_TOKEN_REDUCTION_MULTIPLIER_AFTER_3_DAYS = 1.3; // 30% increase after 3 days
export const WAR_TOKEN_REDUCTION_MULTIPLIER_AFTER_7_DAYS = 1.5; // 50% increase after 7 days
export const WAR_LOSING_COOLDOWN_DAYS = 4; // Cooldown for losing a war
export const WAR_WINNING_COOLDOWN_DAYS = 2; // Cooldown for winning a war
export const WAR_STRUCTURE_UPGRADE_BLOCK_DAYS = 7; // Structure upgrade block duration
export const WAR_VICTORY_TOKEN_BONUS = 100000; // Victory bonus tokens
export const WAR_PURCHASE_SHRINE_TOKEN_COST = 100000; // Cost in village tokens to purchase a shrine
export const WAR_DECLARATION_COST = 15000; // Cost in village tokens to declare war
export const WAR_DAILY_TOKEN_REDUCTION = 1000; // Daily token reduction during war
export const WAR_ALLY_OFFER_MIN = 1000; // Minimum token offer for allies
export const WAR_ALLY_MAX_PAYMENT_PERCENTAGE = 0.2; // Maximum payment as percentage of village tokens (20%)

// Skill point leveling constants
export const SKILL_POINT_MIN_LEVEL = 21; // Minimum level to start gaining skill points from leveling
export const SKILL_POINT_MAX_LEVEL = 40; // Maximum level to gain skill points from leveling
export const MAX_SKILL_POINTS_FROM_LEVELING = 20; // Maximum skill points that can be gained from leveling

export const WAR_SECTORWAR_AI_SHRINE_REDUCE = 3; // KIlling AI shrine hp decrease
export const WAR_SECTORWAR_AI_SHRINE_RECOVER = 3; // Shrine hp recover per day
export const WAR_SECTORWAR_PVP_SHRINE_REDUCE = 5; // Killing a player in a sector war shrine hp decrease
export const WAR_SECTORWAR_PVP_SHRINE_RECOVER = 7; // Shrine hp remove per day
export const WAR_SHRINE_IMAGE =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJgLihSncU9cpECTimBdjaqbNn7vQsxGR1wLk4";
export const WAR_RAMEN_IMAGE =
  "https://uploadthing.b-cdn.net/f/6407eedd-9382-41e9-b27d-eb02afe87ce9-srb0e7.webp";
export const WAR_STATES = [
  "ACTIVE",
  "ATTACKER_VICTORY",
  "DEFENDER_VICTORY",
  "DRAW",
] as const;
export const WAR_SHRINE_MAINTENANCE_DAYS = 7;
export const WAR_TYPES = ["VILLAGE_WAR", "SECTOR_WAR", "WAR_RAID"] as const;
export const SHRINE_MAX_PER_VILLAGE = 4;
export const SHRINE_BOOST_COST = 15_000;
export const SHRINE_BOOST_PERC = 2;
export const SHRINE_UPGRADE_COST = 60_000;
export const SHRINE_BOOST_DURATION_HOURS = 2;
export const SHRINE_AI_UNLOCK_COST = 10_000;
export const SHRINE_WEEKLY_MAINTENANCE_COST = 5_000;
export const SHRINE_MAX_AI_ASSIGNMENTS = 3;
export const SHRINE_HP_BY_LEVEL = { 1: 3000, 2: 4000, 3: 5000 } as const;
export const SHRINE_MAX_LEVEL = Math.max(
  ...Object.keys(SHRINE_HP_BY_LEVEL).map(Number),
);
export const SHRINE_BOOST_TYPES = [
  "Training",
  "PVP",
  "Mission",
  "Errands",
  "Crafting",
] as const;
export type SHRINE_BOOST_TYPE = (typeof SHRINE_BOOST_TYPES)[number];
export type WarType = (typeof WAR_TYPES)[number];
export type WarState = (typeof WAR_STATES)[number];

// PvP Rewards
export const PVP_KILL_TOKEN_REWARD = 300; // Base village tokens for PvP kill
export const PVP_KILL_TOKEN_REWARD_ANBU = 500; // Village tokens for PvP kill by ANBU member
export const PVP_KILL_TOKEN_REWARD_ASSASSIN = 500; // Village tokens for PvP kill by Assassin member
export const PVP_KILL_PRESTIGE_REWARD = 150; // Base prestige for PvP kill
export const PVP_KILL_PRESTIGE_REWARD_ANBU = 300; // Prestige for PvP kill by ANBU member
export const PVP_KILL_PRESTIGE_REWARD_ASSASSIN = 300; // Prestige for PvP kill by Assassin member
export const PVP_KILL_ANBU_POINTS_REWARD = 5; // ANBU points for PvP kill by ANBU member
export const WAR_TORN_SECTOR_BASE_MONEY = 2000; // Base money reward for battles in war-torn sector (sector 335)

// Clans config
export const CLAN_MPVP_MAX_USERS_PER_SIDE = 3;
export const CLAN_CREATE_PRESTIGE_REQUIREMENT = 100;
export const CLAN_CREATE_RYO_COST = 10000000;
export const CLAN_RANK_REQUIREMENT = "GENIN";
export const CLAN_MAX_MEMBERS = 100;
export const CLANS_PER_STRUCTURE_LEVEL = 999999;
export const CLAN_LOBBY_SECONDS = 30;
export const CLAN_BATTLE_REWARD_POINTS = 50;
export const CLAN_MAX_TRAINING_BOOST = 15;
export const CLAN_MAX_RYO_BOOST = 15;
export const CLAN_MAX_REGEN_BOOST = 15;
export const CLAN_TRAINING_BOOST_COST = 300;
export const CLAN_RYO_BOOST_COST = 100;
export const CLAN_REGEN_BOOST_COST = 300;
export const CLAN_COLOR_CHANGE_REP_COST = 50;
export const CLAN_ASSASSIN_SLOTS = [
  "assassin1",
  "assassin2",
  "assassin3",
  "assassin4",
  "assassin5",
  "assassin6",
  "assassin7",
  "assassin8",
  "assassin9",
  "assassin10",
] as const;
export type CLAN_ASSASSIN_SLOT = (typeof CLAN_ASSASSIN_SLOTS)[number];

// Assassin config (factions only)
export const ASSASSIN_MAX_PER_FACTION = 10;

// Hideout and town costs
export const HIDEOUT_COST = 50_000_000;
export const HIDEOUT_TOWN_UPGRADE = 2_000;
export const TOWN_REESTABLISH_COST = 30_000_000; // Ryo
export const TOWN_MONTHLY_MAINTENANCE = 30_000; // Faction points
export const FACTION_MIN_POINTS_FOR_TOWN = 1_000_000;
export const FACTION_MIN_MEMBERS_FOR_TOWN = 30;

// Tournament Config
export const TOURNAMENT_ROUND_SECONDS = 30 * 60;

// Training gains
export const GAME_SETTING_GAINS_MULTIPLIER = ["0", "2", "4", "8"] as const;

// Map settings
export const SECTOR_TYPES = [
  "VILLAGE",
  "OUTLAW",
  "SAFEZONE",
  "HIDEOUT",
  "TOWN",
] as const;

// Conversation config
export const CONVERSATION_QUIET_MINS = 5;
export const REPORT_CONTEXT_WINDOW = 10;

// Kage config
export const FRIENDLY_PRESTIGE_COST = 10000; // Prestige cost of killing friendly
export const KAGE_ANBU_DELETE_COST = 3000; // Anbu delete cost
export const KAGE_CHALLENGE_MINS = 10; // 10 minutes for accepting challenges
export const KAGE_CHALLENGE_SECS = KAGE_CHALLENGE_MINS * 60; // 10 minutes for accepting challenges
export const KAGE_CHALLENGE_TIMEOUT_MINS = 30; // Timeout for PvP kage battle
export const KAGE_DAILY_PRESTIGE_LOSS = 500; // Kage prestige loss
export const KAGE_DEFAULT_PRESTIGE = 5000; // Starting prestige of kage
export const KAGE_DELAY_SECS = 3 * 24 * 3600; // Delay before kage can perform actions (3 days)
export const KAGE_ELDER_MIN_DAYS = 100; // minimum days in village to be elder
export const KAGE_REQUESTS_SHOW_SECONDS = 24 * 60 * 60; // Show requests for 24 hours
export const KAGE_MAX_DAILIES = 3;
export const KAGE_MAX_ELDERS = 3;
export const KAGE_MAX_WEEKLY_PRESTIGE_SEND = 6000; // Maximum weekly prestige send from elders
export const KAGE_MIN_DAYS_IN_VILLAGE = 20; // minimum days in village to become kage
export const KAGE_MIN_PRESTIGE = 10000; // Remove kage if below
export const KAGE_PRESTIGE_COST = 10000; // Cost of failed challenge
export const KAGE_PRESTIGE_REQUIREMENT = 100000; // To challeng kage
export const KAGE_RANK_REQUIREMENT = "JONIN";
export const KAGE_WAR_DECLARE_COST = 10000; // Declare war cost
export const KAGE_CHALLENGE_REJECT_COST = 10000; // Cost of rejecting a challenge
export const KAGE_CHALLENGE_ACCEPT_PRESTIGE = 2000; // Kage prestige gain of accepting challenge
export const KAGE_CHALLENGE_WIN_PRESTIGE = 5000; // Kage prestige gain of winning challenge
export const KAGE_CHALLENGE_LOSE_PRESTIGE_MIN = 1500; // Minimum prestige cost per hour for closed challenges
export const KAGE_CHALLENGE_LOSE_PRESTIGE_PERCENTAGE = 0.04; // 4% of current prestige for closed challenges (current implementation)
export const KAGE_CHALLENGE_OPEN_FOR_SECONDS = 60 * 60; // Time in between being able to toggle challenges
export const KAGE_CHALLENGE_MAX_DAILY_LOCKED_HOURS = 12; // Maximum hours per day that challenges can be locked
export const KAGE_UNACCEPTED_CHALLENGE_COST = 5000; // Cost of unaccepted challenge, i.e. going to Ai vs Ai
export const WAR_FUNDS_COST = 10000; // Prestige cost of declaring war

// Ranked PVP config
export const RANKED_REQUIRED_RANK: UserRank = "CHUNIN";
export const RANKED_ENTRY_COST = 40000;
export const RANKED_STREAK_BONUS = 2;
export const RANKED_SANNIN_TOP_PLAYERS = 10;
export const RANKED_RANKS = [
  "Unranked",
  "Wood",
  "Adept",
  "Master",
  "Legend",
  "Sannin",
] as const;
export type RankedRank = (typeof RANKED_RANKS)[number];
export const RANKED_DIVISIONS = [
  { key: "UNRANKED", name: "Unranked", rankedLp: 0, kFactor: 40 },
  { key: "WOOD", name: "Wood", rankedLp: 150, kFactor: 40 },
  { key: "ADEPT", name: "Adept", rankedLp: 300, kFactor: 32 },
  { key: "MASTER", name: "Master", rankedLp: 600, kFactor: 24 },
  { key: "LEGEND", name: "Legend", rankedLp: 900, kFactor: 16 },
  { key: "SANNIN", name: "Sannin", rankedLp: Infinity, kFactor: 16 },
] as const;
export const RANKED_PVP_STATS = {
  strength: MAX_GENS_CAP,
  intelligence: MAX_GENS_CAP,
  willpower: MAX_GENS_CAP,
  speed: MAX_GENS_CAP,
  ninjutsuOffence: MAX_STATS_CAP,
  ninjutsuDefence: MAX_STATS_CAP,
  genjutsuOffence: MAX_STATS_CAP,
  genjutsuDefence: MAX_STATS_CAP,
  taijutsuOffence: MAX_STATS_CAP,
  taijutsuDefence: MAX_STATS_CAP,
  bukijutsuOffence: MAX_STATS_CAP,
  bukijutsuDefence: MAX_STATS_CAP,
};
export const RANKED_LOADOUT_MAX_JUTSUS = 15;
export const RANKED_LOADOUT_MAX_WEAPONS = 2;
export const RANKED_LOADOUT_MAX_CONSUMABLES = 4;
export const RANKED_LOADOUT_MAX_RESIDUAL_JUTSUS = 4;
export const RANKED_LOADOUT_MAX_POISON_ITEMS = 1;
export const RANKED_LOADOUT_MAX_POISON_JUTSUS = 1;
export const RANKED_LOADOUT_MAX_INCREASECOST_ITEMS = 1;
export const RANKED_LOADOUT_MAX_INCREASECOST_JUTSUS = 1;
export const RANKED_LOADOUT_MAX_SUMMON_JUTSUS = 0;
export const RANKED_LOADOUT_MAX_BARRIER_JUTSUS = 1;

// Game assets
export const ID_ANIMATION_SMOKE = "gkYHdSzsHu";
export const ID_ANIMATION_HIT = "oh4kVNrAwF";
export const ID_ANIMATION_HEAL = "I9aYhT5wMB";
export const ID_SFX_SMOKE = "16vlpusdcPY8Ki3zE4qOs";
export const ID_SFX_HIT = "yGzPWg1cLQc6dYd1EpCsl";
export const ID_SFX_HEAL = "4iG_WpgEmPGUzHn8z129r";
export const ID_SFX_MOVE = "Tze4i8gvgSHNZ-D4ffcAu";
export const ID_SFX_CLEANSE = "mOSkDnYv4hchkPbhdpTDd";
export const ID_SFX_CLEAR = "mOSkDnYv4hchkPbhdpTDd";

// Discord invite link
export const DISCORD_INVITE_URL = "https://discord.gg/eNtgPdAh7j";

// GitHub issue token
export const GITHUB_API_ENDPOINT =
  "https://api.github.com/repos/studie-tech/TheNinjaRPG";

// Draco files (see https://github.com/google/draco/tree/main/javascript)
export const DRACO_DECODER_URL =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJF0eCaMuG2iOewJtjGzvNcmEX3TBnoSfMDZPH";
export const DRACO_ENCODER_URL =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJGexpLZRfoVrha0LP4mAS5KM7wtiZbUNXJxdC";

// Biome backgrounds
export const IMG_BG_OCEAN =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJIo4wHixfOewksxBoS1HQCihpL7c42Ky9uUFv";
export const IMG_BG_GROUND =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJEJszlXPLfKL5D7TAFe29bymSaPCIQ846MdzG";
export const IMG_BG_DESSERT =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJnQHU9dvmojJ0EqeDCvBrNmZaXVdY97gSpOWi";
export const IMG_BG_ICE =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJRXmgug0udmODoNtpa0FMcwI4k2Eq7nJhyvjl";
export const IMG_BG_SNOW =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJVWyAP1F2veAXohUuE59nTQHRJIYjtiG18aF4";
export const IMG_BG_DIRT =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJob2ojkZ9MPZpHJ7VliuEWDfATdxhv62SXnm4";

// Images
export const IMG_PLAY_STORE_BANNER =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJyI5pULukVH2MI5Lo4ehEfAXvZdcmtWqPg7rp";
export const IMG_APP_STORE_BANNER =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJZOcwIVUaYQrBIUTu69nkMxWmS4ah0O7LVCp8";
export const IMG_DEFAULT_PROFILE_PICTURE =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJ19UqON6bo95WClq4K0wxZUmJcvThgdVenO3P";
export const IMG_OCCUPATION_GATHERING =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJePgzrqyV3OvUJQExAi0bGoIZDF74LqSnHRdp";
export const IMG_OCCUPATION_HUNTER =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJ2xooNenMXlcRpYmJ5do0zKw4Qx6PVEtBa9b8";
export const IMG_OCCUPATION_CRAFTING =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJ7YhkcAXKPBOUWGyFuM4DlL1v5HNTZhkte0z6";

export const IMG_FRONTPAGE_SCREENSHOT_COMBAT =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJliyD90rWYxAsuC7ofQn9pM45OD0ERqkdBXJU";
export const IMG_FRONTPAGE_SCREENSHOT_JUTSUS =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJyD4wioukVH2MI5Lo4ehEfAXvZdcmtWqPg7rp";
export const IMG_FRONTPAGE_SCREENSHOT_GLOBAL =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJeCMiuXvyV3OvUJQExAi0bGoIZDF74LqSnHRd";
export const IMG_FRONTPAGE_SCREENSHOT_SECTOR =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJYfcD9oOMAlNnPZ41ev6fCGcFK3hmjX9I8W7d";
export const IMG_FRONTPAGE_SCREENSHOT_VILLAGE =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJzuU9cvZemvaQu94EYJs8HpxVzofny6iPtbgC";

export const IMG_FRONTPAGE_SCREENSHOT_COMBAT_HR =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJhuLmX5MfUBdnwAX5LTajlNc4mrgzi0RJtqpM";
export const IMG_FRONTPAGE_SCREENSHOT_JUTSUS_HR =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJAaVOt2SoZUC4muiGcQNzjfEndY5y1w20B8hT";
export const IMG_FRONTPAGE_SCREENSHOT_GLOBAL_HR =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJvSzUp4EmSnXwslYEpV1yOeNL8gMtqhjPdf36";
export const IMG_FRONTPAGE_SCREENSHOT_SECTOR_HR =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJXMBBarqIOpAoLKbZ4nW9Rsil2V67yuFwQhqv";
export const IMG_FRONTPAGE_SCREENSHOT_VILLAGE_HR =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJRmBtUg0udmODoNtpa0FMcwI4k2Eq7nJhyvjl";

export const IMG_REGISTRATIN_STEP1 =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJeKNAEEyV3OvUJQExAi0bGoIZDF74LqSnHRdp";
export const IMG_REGISTRATIN_STEP2 =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJTOMd6Y5IU29dZYJPoOKSh5vmlqatMub3EigH";
export const IMG_REGISTRATIN_STEP3 =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJZlINOXaYQrBIUTu69nkMxWmS4ah0O7LVCp8b";
export const IMG_REGISTRATIN_STEP4 =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJqppFvGcdkOZgJQ8mGRcdx3SsWvPelyYFTt5V";
export const IMG_REGISTRATIN_STEP5 =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJ56sDpz797jl4ubX8xrRqTZasyMp2WA5eLGUP";
export const IMG_REGISTRATIN_STEP6 =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJwm1XDCT2j854CWbaITZyegfXimvd7s16cO0h";
export const IMG_REGISTRATIN_STEP7 =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJQU7pvzjhzBPya1rwfCIqOTU0cV5xgsMeo3u2";
export const IMG_REGISTRATIN_STEP8 =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJ8B9jC0rkkp45TvAnoIBa0rtCf1lbyXYjVKQ2";
export const IMG_REGISTRATIN_STEP9 =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJnjHXr3mojJ0EqeDCvBrNmZaXVdY97gSpOWiA";

export const IMG_SCENE_SCROLL =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJRceTKeq0udmODoNtpa0FMcwI4k2Eq7nJhyvj";
export const IMG_SCENE_BACKGROUND =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJ1HAqWl6bo95WClq4K0wxZUmJcvThgdVenO3P";
export const IMG_SCENE_CHARACTER =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJF08NAw3G2iOewJtjGzvNcmEX3TBnoSfMDZPH";

export const IMG_BADGE_RESET_QUEST =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJeCQbfYiyV3OvUJQExAi0bGoIZDF74LqSnHRd";
export const IMG_BADGE_FAIL_QUEST =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJuFEUH7CyJLoOFkrcn4gxSwCfEQ9eMNXZlG8b";
export const IMG_BADGE_WIN_QUEST =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJnk99IbmojJ0EqeDCvBrNmZaXVdY97gSpOWiA";
export const IMG_BADGE_NEW_QUEST =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJneJSZsmojJ0EqeDCvBrNmZaXVdY97gSpOWiA";
export const IMG_BADGE_START_BATTLE =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJqZXK1HdkOZgJQ8mGRcdx3SsWvPelyYFTt5Vn";
export const IMG_BADGE_DIALOG =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJpIn7vsbKBAOsGCHyl3Sk0mZFrgWPUdjMJ75D";
export const IMG_BADGE_RANDOM_ENCOUNTER_WINS =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJqyp2N4dkOZgJQ8mGRcdx3SsWvPelyYFTt5Vn";
export const IMG_BADGE_PVPKILLS =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJyPU0OdukVH2MI5Lo4ehEfAXvZdcmtWqPg7rp";
export const IMG_BADGE_ARENAKILLS =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJZXqeTaYQrBIUTu69nkMxWmS4ah0O7LVCp8bz";
export const IMG_BADGE_MINUTES_PASSED =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJCmrv4YU26OYrIJuNP1pvSyz29edFtKbngjRc";
export const IMG_BADGE_ERRANDS_TOTAL =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJFkFklPG2iOewJtjGzvNcmEX3TBnoSfMDZPH4";
export const IMG_BADGE_D_MISSION_TOTAL =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJuD6udtCyJLoOFkrcn4gxSwCfEQ9eMNXZlG8b";
export const IMG_BADGE_C_MISSION_TOTAL =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJGudreBRfoVrha0LP4mAS5KM7wtiZbUNXJxdC";
export const IMG_BADGE_B_MISSION_TOTAL =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJy2Uv1s5ukVH2MI5Lo4ehEfAXvZdcmtWqPg7r";
export const IMG_BADGE_A_MISSION_TOTAL =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJEJpK3acLfKL5D7TAFe29bymSaPCIQ846MdzG";
export const IMG_BADGE_D_CRIME_TOTAL =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJDyHMWFlzEwoh0WXMnscL279N8ayVQUCbRzS3";
export const IMG_BADGE_C_CRIME_TOTAL =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJnJ43OQmojJ0EqeDCvBrNmZaXVdY97gSpOWiA";
export const IMG_BADGE_B_CRIME_TOTAL =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJHS8H1zQvYURJhgs76VZtf9wxpMa13Cq0iOnr";
export const IMG_BADGE_A_CRIME_TOTAL =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJQ6PtAxjhzBPya1rwfCIqOTU0cV5xgsMeo3u2";
export const IMG_BADGE_MINUTES_TRAINING =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJbZSRGyZAtYUndMi56GkX19q0A4PzyeIloBrE";
export const IMG_BADGE_JUTSUS_MASTERED =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJDyHTMUuzEwoh0WXMnscL279N8ayVQUCbRzS3";
export const IMG_BADGE_STATS_TRAINED =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJVNQSNpF2veAXohUuE59nTQHRJIYjtiG18aF4";
export const IMG_BADGE_DAYS_IN_VILLAGE =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJ2HU2el8nMXlcRpYmJ5do0zKw4Qx6PVEtBa9b";
export const IMG_BADGE_REPUTATION_POINTS =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJxyYNkgWZsq9k0Von5rUfP6OgQ2TyptCKHS4u";
export const IMG_BADGE_USER_LEVEL =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJo6lBgeZ9MPZpHJ7VliuEWDfATdxhv62SXnm4";
export const IMG_BADGE_MOVE_TO_LOCATION =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJ5qXZuJi797jl4ubX8xrRqTZasyMp2WA5eLGU";
export const IMG_BADGE_COLLECT_ITEM =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJtxtluhUYJDfpFXWm3nrcPluEtIZqyLkaSV1j";
export const IMG_BADGE_DEFEAT_OPPONENTS =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJYwI8YKOMAlNnPZ41ev6fCGcFK3hmjX9I8W7d";
export const IMG_BADGE_MEDICAL_EXPERIENCE =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJzr5NPBemvaQu94EYJs8HpxVzofny6iPtbgCZ";
export const IMG_BADGE_GATHERING_EXPERIENCE =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJMgUHxAtsO4cexqW2RDgkE3zZbNXSFGitmnar";
export const IMG_BADGE_HUNTING_EXPERIENCE =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJg0V017cU9cpECTimBdjaqbNn7vQsxGR1wLk4";
export const IMG_BADGE_CRAFTING_EXPERIENCE =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJIY2lVjxfOewksxBoS1HQCihpL7c42Ky9uUFv";

export const IMG_BG_COLISEUM =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJo5wb6hZ9MPZpHJ7VliuEWDfATdxhv62SXnm4";
export const IMG_BG_ARENA_CHRISMAS =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJQr5mXyjhzBPya1rwfCIqOTU0cV5xgsMeo3u2";
export const IMG_BG_ARENA_KONOKI =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJDyj0BtAzEwoh0WXMnscL279N8ayVQUCbRzS3";
export const IMG_BG_ARENA_SILENCE =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJSZtKvF3jWrEB7TyZlmpoAxMK5Qi16kNPVJuH";

export const IMG_VILLAGE_FACTION =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJyODt1NukVH2MI5Lo4ehEfAXvZdcmtWqPg7rp";

export const IMG_RARITY_RARE =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJvSyOMsEmSnXwslYEpV1yOeNL8gMtqhjPdf36";
export const IMG_RARITY_LEGENDARY =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJoooBQZ9MPZpHJ7VliuEWDfATdxhv62SXnm4B";
export const IMG_RARITY_EPIC =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJeCIgGvhyV3OvUJQExAi0bGoIZDF74LqSnHRd";
export const IMG_RARITY_COMMON =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJQP8otBjhzBPya1rwfCIqOTU0cV5xgsMeo3u2";

export const IMG_PROFILE_LEVELUPGUY =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJaeS5LnYYfKMcJ2B5EmWt6VsNgqxpG8OSXAQk";
export const IMG_RAMEN_WELCOME =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJmd2fWKHE4IMO5Goa7cgLxPJ0VC6lU8vbt1Ap";
export const IMG_RAMEN_SMALL =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJj7ESnm4XzPI8f1v96qBot0Q3wsUp2nxu7SMb";
export const IMG_RAMEN_MEDIUM =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJyoMsmMukVH2MI5Lo4ehEfAXvZdcmtWqPg7rp";
export const IMG_RAMEN_LARGE =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJHKlC2sQvYURJhgs76VZtf9wxpMa13Cq0iOnr";
export const IMG_REPSHOP_BRONZE =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJCg005h26OYrIJuNP1pvSyz29edFtKbngjRcA";
export const IMG_REPSHOP_SILVER =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJSk2raeh3jWrEB7TyZlmpoAxMK5Qi16kNPVJu";
export const IMG_REPSHOP_GOLD =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJebK38NyV3OvUJQExAi0bGoIZDF74LqSnHRdp";
export const IMG_EQUIP_SILHOUETTE =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJ6e2pEi7DfT5pyNCaUruzhPtAJqb8Kj9mc1nl";
export const IMG_HOME_TRAIN =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJ25o9TnMXlcRpYmJ5do0zKw4Qx6PVEtBa9b8C";
export const IMG_HOME_EAT =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJbZ8Rz1xAtYUndMi56GkX19q0A4PzyeIloBrE";
export const IMG_HOME_SLEEP =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJu8FpvZCyJLoOFkrcn4gxSwCfEQ9eMNXZlG8b";
export const IMG_HOME_AWAKE =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJ1BKctL6bo95WClq4K0wxZUmJcvThgdVenO3P";
export const IMG_MANUAL_TOWER_UPGRADES =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJPuGZOwpKeUGyX2kj6u45AOQiSa1zYH0mqZoc";
export const IMG_MANUAL_TOWER_ENEMIES =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJTIK3RW5IU29dZYJPoOKSh5vmlqatMub3EigH";
export const IMG_MANUAL_RANKED =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJAa3ucxOoZUC4muiGcQNzjfEndY5y1w20B8hT";
export const IMG_MANUAL_AWARDS =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJD2QXqVzEwoh0WXMnscL279N8ayVQUCbRzS3p";
export const IMG_MANUAL_COMBAT =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJUvE8xxILCIhwPniJ69VxpvAbTDWkOyGzS8rM";
export const IMG_MANUAL_TRAVEL =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJu1h1uHCyJLoOFkrcn4gxSwCfEQ9eMNXZlG8b";
export const IMG_MANUAL_BLOODLINE =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJaCMo8gYYfKMcJ2B5EmWt6VsNgqxpG8OSXAQk";
export const IMG_MANUAL_JUTSU =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJMI7fE4tsO4cexqW2RDgkE3zZbNXSFGitmnar";
export const IMG_MANUAL_JUTSU_RESKINS =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJEOTlPgLfKL5D7TAFe29bymSaPCIQ846MdzGg";
export const IMG_MANUAL_SKILLTREE =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJQB2gVJjhzBPya1rwfCIqOTU0cV5xgsMeo3u2";
export const IMG_MANUAL_BALANCE =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJunxMxUaCyJLoOFkrcn4gxSwCfEQ9eMNXZlG8";
export const IMG_MANUAL_BACKUP =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJctH7DQSnxBpQqGNDcTHbLmYz8uXAl3oa54ti";
export const IMG_MANUAL_ITEM =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJb59vlYAtYUndMi56GkX19q0A4PzyeIloBrEa";
export const IMG_MANUAL_AI =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJuTQifZCyJLoOFkrcn4gxSwCfEQ9eMNXZlG8b";
export const IMG_MANUAL_STAFF =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJ3CT6Io8pYHJX5rdkUTfOKtvu2eGIELmSWqBx";
export const IMG_MANUAL_QUEST =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJmWVaWXHE4IMO5Goa7cgLxPJ0VC6lU8vbt1Ap";
export const IMG_MANUAL_LOGS =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJwvy6QoT2j854CWbaITZyegfXimvd7s16cO0h";
export const IMG_MANUAL_DAM_CALCS =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJQF6qYYjhzBPya1rwfCIqOTU0cV5xgsMeo3u2";
export const IMG_MANUAL_BADGE =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJOUM5LPVHevxIThUauQkGJEBY3D2cPqy8f5sp";
export const IMG_MANUAL_ASSET =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJaGvHErYYfKMcJ2B5EmWt6VsNgqxpG8OSXAQk";
export const IMG_MANUAL_OPINION =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJ0dX0Z3grYldRWJcD6vE10SjNsXHeA9pVMfQi";
export const IMG_MANUAL_RECRUITMENT =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJTB8H7n5IU29dZYJPoOKSh5vmlqatMub3EigH";
export const IMG_MANUAL_POLLS =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJRc1v3JK0udmODoNtpa0FMcwI4k2Eq7nJhyvj";
export const IMG_LAYOUT_USERBANNER_MIDDLE =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJ6sgzOzDfT5pyNCaUruzhPtAJqb8Kj9mc1nlH";
export const IMG_LAYOUT_SIDESCROLL =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJAElfIGoZUC4muiGcQNzjfEndY5y1w20B8hTW";
export const IMG_LAYOUT_MOBILE_TOP =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJHTt3S9QvYURJhgs76VZtf9wxpMa13Cq0iOnr";
export const IMG_LAYOUT_SIDETOPBANNER_CONTENT =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJOG9gcTWVHevxIThUauQkGJEBY3D2cPqy8f5s";
export const IMG_LAYOUT_SIDETOPBANNER_BOTTOM =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJ19AHU06bo95WClq4K0wxZUmJcvThgdVenO3P";
export const IMG_LAYOUT_SCROLLBOTTOM_DECOR =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJCVjF0e26OYrIJuNP1pvSyz29edFtKbngjRcA";
export const IMG_LAYOUT_USERSBANNER_TOP =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJDV31MCzEwoh0WXMnscL279N8ayVQUCbRzS3p";
export const IMG_LAYOUT_USERSBANNER_BOTTOM =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJhWwvubMfUBdnwAX5LTajlNc4mrgzi0RJtqpM";
export const IMG_AVATAR_DEFAULT =
  "https://uploadthing.b-cdn.net/f/630cf6e7-c152-4dea-a3ff-821de76d7f5a_default.webp";
export const IMG_WALLPAPER_WINTER =
  "https://tnr-storage-cdn.b-cdn.net/wallpaper-winter.webp";
export const IMG_WALLPAPER_SPRING =
  "https://tnr-storage-cdn.b-cdn.net/wallpaper-spring.webp";
export const IMG_WALLPAPER_SUMMER =
  "https://tnr-storage-cdn.b-cdn.net/wallpaper-summer.webp";
export const IMG_WALLPAPER_FALL =
  "https://tnr-storage-cdn.b-cdn.net/wallpaper-fall.webp";
export const IMG_WALLPAPER_HALLOWEEN =
  "https://tnr-storage-cdn.b-cdn.net/wallpaper-halloween.webp";
export const IMG_LAYOUT_BUTTONDECOR =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJYectQDOMAlNnPZ41ev6fCGcFK3hmjX9I8W7d";
export const IMG_LAYOUT_NAVBAR =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJ1znttRb6bo95WClq4K0wxZUmJcvThgdVenO3";
export const IMG_LAYOUT_NAVBAR_HALLOWEEN =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJbYxvuGAtYUndMi56GkX19q0A4PzyeIloBrEa";
export const IMG_LAYOUT_HANDSIGN =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJ0hKI3IgrYldRWJcD6vE10SjNsXHeA9pVMfQi";
export const IMG_LAYOUT_HANDSIGN_HALLOWEEN =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJcGYTUXSnxBpQqGNDcTHbLmYz8uXAl3oa54ti";
export const IMG_LAYOUT_WELCOME_IMG =
  "https://tnr-storage-cdn.b-cdn.net/welcomeimage_compressed.webp";
// "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJqbkFzRdkOZgJQ8mGRcdx3SsWvPelyYFTt5Vn";
// export const IMG_LOGO_FULL =
//   "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJ8b0eqBkkp45TvAnoIBa0rtCf1lbyXYjVKQ2q";
export const IMG_LOGO_FULL =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJHeJzt0QvYURJhgs76VZtf9wxpMa13Cq0iOnr";
export const IMG_LOGO_SHORT =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJCClYWI26OYrIJuNP1pvSyz29edFtKbngjRcA";
export const IMG_LOADER =
  "https://uploadthing.b-cdn.net/f/4a3100e5-97c6-4e5a-96e2-1c3520838179-gwm3dh.svg";
export const IMG_SECTOR_INFO =
  "https://uploadthing.b-cdn.net/f/ddab9f31-0491-4445-8e6e-98370533a93d-1xdpq.png";
export const IMG_SECTOR_ATTACK =
  "https://uploadthing.b-cdn.net/f/d6587d1a-c11b-49e3-8e86-74bfb02a80a1-n9ug1k.png";
export const IMG_SECTOR_ROB =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJvNL3jBEmSnXwslYEpV1yOeNL8gMtqhjPdf36";
export const IMG_SECTOR_USER_MARKER =
  "https://uploadthing.b-cdn.net/f/cc347416-8bf6-40cf-9184-b4af64e6feae-n771t1.webp";
export const IMG_SECTOR_USER_SPRITE_MASK =
  "https://uploadthing.b-cdn.net/f/40061bc5-d73c-4265-8eff-4798fd840ae2-x83hc4.webp";
export const IMG_SECTOR_SHADOW =
  "https://uploadthing.b-cdn.net/f/bd8d8c75-96a0-4c71-94b6-f02e1ee382b5-exyuao.png";
export const IMG_SECTOR_USERSPRITE_LEFT =
  "https://uploadthing.b-cdn.net/f/5c812303-70aa-4fc4-982c-6e72eee3c4b6-u7oujn.webp";
export const IMG_SECTOR_USERSPRITE_RIGHT =
  "https://uploadthing.b-cdn.net/f/b6c5b6ba-99e0-49e5-b4a2-bf6ba9ca1ebc-dbaxa8.webp";
export const IMG_SECTOR_VS_ICON =
  "https://uploadthing.b-cdn.net/f/be789e50-095f-4e50-bffc-fe0fedd8777b-dd7l0q.webp";
export const IMG_SECTOR_WALL_STONE_TOWER =
  "https://uploadthing.b-cdn.net/f/aab037bb-7ac7-48f7-9994-548d87eb55f1-lga892.webp";
export const IMG_MAP_HEXASPHERE =
  "https://tnr-storage-cdn.b-cdn.net/eb805d73-5216-4d5c-b3e9-c39cc2340922-ixejn7.json";
export const IMG_MAP_WAR_ICON =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJgipq89cU9cpECTimBdjaqbNn7vQsxGR1wLk4";
export const IMG_MAP_QUEST_ICON =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJRsb4NN0udmODoNtpa0FMcwI4k2Eq7nJhyvjl";
export const IMG_TRAIN_INTELLIGENCE =
  "https://uploadthing.b-cdn.net/f/815a53ea-23d2-4767-9219-a36ed3d4c619-d73vsv.png";
export const IMG_TRAIN_WILLPOWER =
  "https://uploadthing.b-cdn.net/f/a303f719-e216-4142-b1c2-50b2ac1d98c3-t57iq5.png";
export const IMG_TRAIN_STRENGTH =
  "https://uploadthing.b-cdn.net/f/70e251a8-17d2-4d5d-a121-55fb43bf5b37-tmi4ap.png";
export const IMG_TRAIN_SPEED =
  "https://uploadthing.b-cdn.net/f/893e0cc5-9b53-442c-af5d-9aacd95e6d8b-1ta05j.png";
export const IMG_TRAIN_GEN_OFF =
  "https://uploadthing.b-cdn.net/f/598a40f5-4cfa-4ad7-8378-eb63f0b28282-f9eh41.png";
export const IMG_TRAIN_GEN_DEF =
  "https://uploadthing.b-cdn.net/f/38463f2d-8c5b-4e4f-b74e-52667469a478-z4l40b.png";
export const IMG_TRAIN_TAI_DEF =
  "https://uploadthing.b-cdn.net/f/c6091de0-8c6f-4a17-8d75-067338f9fdf0-8ghs8v.png";
export const IMG_TRAIN_TAI_OFF =
  "https://uploadthing.b-cdn.net/f/6dcf3cfd-0084-49ec-8b5f-36dff3212d35-beounf.png";
export const IMG_TRAIN_BUKI_OFF =
  "https://uploadthing.b-cdn.net/f/b6daa0ab-698a-4e13-8e5f-c7560cfdc499-mcc2dc.png";
export const IMG_TRAIN_BUKI_DEF =
  "https://uploadthing.b-cdn.net/f/5faa1363-2ecc-4533-9077-b3c14afd58c6-stlcpi.png";
export const IMG_TRAIN_NIN_OFF =
  "https://uploadthing.b-cdn.net/f/4727d488-1eb0-475e-adfe-ca26837c45a1-g8pm8u.png";
export const IMG_TRAIN_NIN_DEF =
  "https://uploadthing.b-cdn.net/f/308d9bee-5105-4534-b11c-59592db90181-yx7su0.png";

export const IMG_ELEMENT_YINYANG =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJIlW2BrxfOewksxBoS1HQCihpL7c42Ky9uUFv";
export const IMG_ELEMENT_SHADOW =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJvSWrdXEmSnXwslYEpV1yOeNL8gMtqhjPdf36";
export const IMG_ELEMENT_NONE =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJeC2dFWVyV3OvUJQExAi0bGoIZDF74LqSnHRd";
export const IMG_ELEMENT_EXPLOSION =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJCH1oeV26OYrIJuNP1pvSyz29edFtKbngjRcA";
export const IMG_ELEMENT_WIND =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJ2HrMNjAnMXlcRpYmJ5do0zKw4Qx6PVEtBa9b";
export const IMG_ELEMENT_WATER =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJoYFqRUhZ9MPZpHJ7VliuEWDfATdxhv62SXnm";
export const IMG_ELEMENT_LAVA =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJaK2IZBYYfKMcJ2B5EmWt6VsNgqxpG8OSXAQk";
export const IMG_ELEMENT_ICE =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJCqHOvc26OYrIJuNP1pvSyz29edFtKbngjRcA";
export const IMG_ELEMENT_WOOD =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJbZYZaSPAtYUndMi56GkX19q0A4PzyeIloBrE";
export const IMG_ELEMENT_STORM =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJzu4spmSemvaQu94EYJs8HpxVzofny6iPtbgC";
export const IMG_ELEMENT_CRYSTAL =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJaKoVVmYYfKMcJ2B5EmWt6VsNgqxpG8OSXAQk";
export const IMG_ELEMENT_MAGNET =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJuNr6tnCyJLoOFkrcn4gxSwCfEQ9eMNXZlG8b";
export const IMG_ELEMENT_FIRE =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJAX1vCjoZUC4muiGcQNzjfEndY5y1w20B8hTW";
export const IMG_ELEMENT_LIGHT =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJeVtMZpyV3OvUJQExAi0bGoIZDF74LqSnHRdp";
export const IMG_ELEMENT_EARTH =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJgi7liFcU9cpECTimBdjaqbNn7vQsxGR1wLk4";
export const IMG_ELEMENT_SCORCH =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJCmW9wm326OYrIJuNP1pvSyz29edFtKbngjRc";
export const IMG_ELEMENT_DUST =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJchNmlmSnxBpQqGNDcTHbLmYz8uXAl3oa54ti";
export const IMG_ELEMENT_SAND =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJzu4nv37emvaQu94EYJs8HpxVzofny6iPtbgC";
export const IMG_ELEMENT_LIGHTNING =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJ4DIVIclYIif5CL8BKvMsOh2ZnmS7yHt0jTD3";
export const IMG_ELEMENT_BOIL =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJ5qAGAlo797jl4ubX8xrRqTZasyMp2WA5eLGU";
export const IMG_ELEMENT_METAL =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJu0t3mRCyJLoOFkrcn4gxSwCfEQ9eMNXZlG8b";

export const IMG_BASIC_HEAL =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJnlXNSKmojJ0EqeDCvBrNmZaXVdY97gSpOWiA";
export const IMG_BASIC_ATTACK =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJdMXlCrP62PI3ciLaYzgVX8FopBADxSrGmvQl";
export const IMG_BASIC_FLEE =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJRohRDR0udmODoNtpa0FMcwI4k2Eq7nJhyvjl";
export const IMG_BASIC_STEALTH =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJDtLSxhzEwoh0WXMnscL279N8ayVQUCbRzS3p";
export const IMG_BASIC_WAIT =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJ8ByNJwOkkp45TvAnoIBa0rtCf1lbyXYjVKQ2";
export const IMG_BASIC_MOVE =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJnQxuGeXmojJ0EqeDCvBrNmZaXVdY97gSpOWi";
export const IMG_BASIC_CLEANSE =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJ5oYOji797jl4ubX8xrRqTZasyMp2WA5eLGUP";
export const IMG_BASIC_CLEAR =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJTWnPJE5IU29dZYJPoOKSh5vmlqatMub3EigH";

export const IMG_ICON_DISCORD =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJCZvaND26OYrIJuNP1pvSyz29edFtKbngjRcA";
export const IMG_ICON_FACEBOOK =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJ1zjiDxX6bo95WClq4K0wxZUmJcvThgdVenO3";
export const IMG_ICON_GITHUB =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJydaEQfukVH2MI5Lo4ehEfAXvZdcmtWqPg7rp";
export const IMG_ICON_GOOGLE =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJCV0Mc426OYrIJuNP1pvSyz29edFtKbngjRcA";
export const IMG_ICON_INSTAGRAM =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJWLbTriPvszvj71yaSYC0MDOmbko5q9JAGuLH";
export const IMG_ICON_REDDIT =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJPYJEg8pKeUGyX2kj6u45AOQiSa1zYH0mqZoc";
export const IMG_ICON_TIKTOK =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJoYcyUDSZ9MPZpHJ7VliuEWDfATdxhv62SXnm";
export const IMG_ICON_TWITTER =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJMi2fCxtsO4cexqW2RDgkE3zZbNXSFGitmnar";
export const IMG_ICON_YOUTUBE =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJy7pL6jukVH2MI5Lo4ehEfAXvZdcmtWqPg7rp";
export const IMG_ICON_FORUM =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJTwT9cY5IU29dZYJPoOKSh5vmlqatMub3EigH";
export const IMG_ICON_MOVE =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJepKSYSyV3OvUJQExAi0bGoIZDF74LqSnHRdp";
export const IMG_ICON_HEAL =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJrtRSYfhuJPmdY8zI2ptZXAoEj1c6BMKvrQOx";

export const IMG_MISSION_S =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJz3Ph17emvaQu94EYJs8HpxVzofny6iPtbgCZ";
export const IMG_MISSION_A =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJ0ORGP9grYldRWJcD6vE10SjNsXHeA9pVMfQi";
export const IMG_MISSION_B =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJoVn7VTZ9MPZpHJ7VliuEWDfATdxhv62SXnm4";
export const IMG_MISSION_C =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJoe3eJHZ9MPZpHJ7VliuEWDfATdxhv62SXnm4";
export const IMG_MISSION_D =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJ7r7fFcXKPBOUWGyFuM4DlL1v5HNTZhkte0z6";
export const IMG_MISSION_E =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJPAguocQpKeUGyX2kj6u45AOQiSa1zYH0mqZo";
export const IMG_MISSION_M =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJyweIVKukVH2MI5Lo4ehEfAXvZdcmtWqPg7rp";
export const IMG_MISSION_PVP =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJzCBxBXemvaQu94EYJs8HpxVzofny6iPtbgCZ";

export const IMG_BUILDING_MISSIONHALL =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJ2TCTWInMXlcRpYmJ5do0zKw4Qx6PVEtBa9b8";
export const IMG_BUILDING_SCIENCEBUILDING =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJwQxr3PT2j854CWbaITZyegfXimvd7s16cO0h";
export const IMG_BUILDING_NEWS =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJYKooj7OMAlNnPZ41ev6fCGcFK3hmjX9I8W7d";
export const IMG_BUILDING_SOUVENIER =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJHmrEYkQvYURJhgs76VZtf9wxpMa13Cq0iOnr";
export const IMG_BUILDING_HOSPITAL =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJ3n9SmD8pYHJX5rdkUTfOKtvu2eGIELmSWqBx";
export const IMG_BUILDING_GLOBALANBU =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJIfwMDCxfOewksxBoS1HQCihpL7c42Ky9uUFv";
export const IMG_BUILDING_ACADEMY =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJ5kYqQv797jl4ubX8xrRqTZasyMp2WA5eLGUP";
export const IMG_BUILDING_BANK =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJEHFjuQLfKL5D7TAFe29bymSaPCIQ846MdzGg";
export const IMG_BUILDING_ARCHIVE =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJXk8AUJqIOpAoLKbZ4nW9Rsil2V67yuFwQhqv";
export const IMG_BUILDING_ADMINBUILDING =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJMyfWBKtsO4cexqW2RDgkE3zZbNXSFGitmnar";

export const IMG_ACTIONTIMER_BG =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJZNkUoDaYQrBIUTu69nkMxWmS4ah0O7LVCp8b";
export const IMG_ACTIONTIMER_YELLOW =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJXnRHYeqIOpAoLKbZ4nW9Rsil2V67yuFwQhqv";
export const IMG_ACTIONTIMER_RED =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJyrbex4ukVH2MI5Lo4ehEfAXvZdcmtWqPg7rp";
export const IMG_ACTIONTIMER_BLUE =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJqA6PRRdkOZgJQ8mGRcdx3SsWvPelyYFTt5Vn";
export const IMG_ACTIONTIMER_GREEN =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJwSFJxPT2j854CWbaITZyegfXimvd7s16cO0h";
export const IMG_ACTIONTIMER_OVERLAY =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJHVKSE4QvYURJhgs76VZtf9wxpMa13Cq0iOnr";

export const IMG_INITIATIVE_D20 =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJE7476GLfKL5D7TAFe29bymSaPCIQ846MdzGg";
export const IMG_BATTLEFIELD_TOMBSTONE =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJVVIq2fF2veAXohUuE59nTQHRJIYjtiG18aF4";
export const IMG_BATTLEFIELD_STAR =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJuGvcEjCyJLoOFkrcn4gxSwCfEQ9eMNXZlG8b";

export const MUSIC_SHADOW_OF_THE_BLADE =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJQCH0mJjhzBPya1rwfCIqOTU0cV5xgsMeo3u2";
export const MUSIC_WELCOME_TO_SEICHI =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJrwIzM2huJPmdY8zI2ptZXAoEj1c6BMKvrQOx";
export const MUSIC_SHINE_THEME =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJnL3NqnmojJ0EqeDCvBrNmZaXVdY97gSpOWiA";
export const MUSIC_TSUKIMORI_THEME =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJE9b6CNLfKL5D7TAFe29bymSaPCIQ846MdzGg";
export const MUSIC_CURRENT_THEME =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJY9DJWIOMAlNnPZ41ev6fCGcFK3hmjX9I8W7d";
export const MUSIC_SYNDICATE_THEME =
  "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJxrcAPUWZsq9k0Von5rUfP6OgQ2TyptCKHS4u";

export const HomeTypes = [
  "NONE",
  "STUDIO_APARTMENT",
  "ONE_BED_APARTMENT",
  "TWO_BED_HOUSE",
  "TOWN_HOUSE",
  "SMALL_MANSION",
  "SMALL_ESTATE",
  "LARGE_ESTATE",
] as const;
export type HomeType = (typeof HomeTypes)[number];

export const HomeTypeDetails = {
  NONE: { regen: 0, storage: 0, cost: 0, name: "No Home" },
  STUDIO_APARTMENT: { regen: 20, storage: 5, cost: 3000000, name: "Studio Apartment" },
  ONE_BED_APARTMENT: {
    regen: 50,
    storage: 10,
    cost: 10000000,
    name: "One Bedroom Apartment",
  },
  TWO_BED_HOUSE: { regen: 70, storage: 15, cost: 20000000, name: "Two Bedroom House" },
  TOWN_HOUSE: { regen: 100, storage: 20, cost: 35000000, name: "Town House" },
  SMALL_MANSION: { regen: 130, storage: 25, cost: 45000000, name: "Small Mansion" },
  SMALL_ESTATE: { regen: 150, storage: 30, cost: 60000000, name: "Small Estate" },
  LARGE_ESTATE: { regen: 200, storage: 40, cost: 100000000, name: "Large Estate" },
} as const;
export type HomeTypeDetails = (typeof HomeTypeDetails)[keyof typeof HomeTypeDetails];

// Auction system constants
export const AUCTION_LISTING_STATES = [
  "ACTIVE",
  "SOLD",
  "EXPIRED",
  "CANCELLED",
] as const;
export type AuctionListingState = (typeof AUCTION_LISTING_STATES)[number];

export const AUCTION_LISTING_TYPES = ["AUCTION", "DIRECT"] as const;
export type AuctionListingType = (typeof AUCTION_LISTING_TYPES)[number];

export const AUCTION_BID_STATES = ["ACTIVE", "REFUNDED", "WON"] as const;
export type AuctionBidState = (typeof AUCTION_BID_STATES)[number];

// Bounty system constants
export const BOUNTY_STATUSES = ["OPEN", "CLAIMED", "EXPIRED", "CANCELLED"] as const;
export type BountyStatus = (typeof BOUNTY_STATUSES)[number];
export const BOUNTY_MAX_HUNTERS = 3;
export const BOUNTY_MIN_AMOUNT = 1000000;

// Skill system constants
export const MAX_SKILL_POINTS = 100; // Total max skillpoints (20 from leveling + 80 from quests)

// Support System Settings
export const SupportTicketCategories = [
  "BUG_REPORT",
  "FEATURE_REQUEST",
  "ACCOUNT_ISSUE",
  "GAMEPLAY_QUESTION",
  "PAYMENT_ISSUE",
  "TECHNICAL_SUPPORT",
  "MODERATION_SUPPORT",
  "OTHER",
] as const;
export type SupportTicketCategory = (typeof SupportTicketCategories)[number];

export const SupportTicketPriorities = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export type SupportTicketPriority = (typeof SupportTicketPriorities)[number];

export const SupportTicketStatuses = [
  "OPEN",
  "IN_PROGRESS",
  "WAITING_FOR_USER",
  "WAITING_FOR_STAFF",
  "RESOLVED",
  "CLOSED",
] as const;
export type SupportTicketStatus = (typeof SupportTicketStatuses)[number];

export const SupportTicketActivityActions = [
  "CREATED",
  "UPDATED",
  "ASSIGNED",
  "UNASSIGNED",
  "STATUS_CHANGED",
  "PRIORITY_CHANGED",
  "CATEGORY_CHANGED",
  "TAGGED",
  "UNTAGGED",
  "MERGED",
  "ESCALATED_TO_GITHUB",
  "COMMENTED",
  "CLOSED",
  "REOPENED",
] as const;
export type SupportTicketActivityAction = (typeof SupportTicketActivityActions)[number];

// Support Ticket Limits
export const SUPPORT_TICKET_LIMITS = {
  TITLE_MIN_LENGTH: 10,
  TITLE_MAX_LENGTH: 255,
  DESCRIPTION_MIN_LENGTH: 50,
  DESCRIPTION_MAX_LENGTH: 5000,
  COMMENT_MIN_LENGTH: 1,
  COMMENT_MAX_LENGTH: 5000,
  MAX_TAGS: 20,
  MAX_TAG_LENGTH: 50,
  MAX_ATTACHMENT_SIZE: 10 * 1024 * 1024, // 10MB
  MAX_SUGGESTIONS: 10,
  MAX_SEARCH_RESULTS: 50,
  MAX_BULK_ACTIONS: 100,
};

// Support Ticket Status Transitions
export const SUPPORT_TICKET_STATUS_TRANSITIONS: Record<
  SupportTicketStatus,
  SupportTicketStatus[]
> = {
  OPEN: ["IN_PROGRESS", "WAITING_FOR_USER", "RESOLVED", "CLOSED", "OPEN"],
  IN_PROGRESS: [
    "WAITING_FOR_USER",
    "WAITING_FOR_STAFF",
    "RESOLVED",
    "CLOSED",
    "IN_PROGRESS",
  ],
  WAITING_FOR_USER: ["IN_PROGRESS", "RESOLVED", "CLOSED", "WAITING_FOR_USER"],
  WAITING_FOR_STAFF: ["IN_PROGRESS", "RESOLVED", "CLOSED", "WAITING_FOR_STAFF"],
  RESOLVED: ["CLOSED", "OPEN", "RESOLVED"],
  CLOSED: ["OPEN", "CLOSED"],
};

// Support Ticket Color Schemes
export const SUPPORT_TICKET_COLORS = {
  CATEGORY: {
    BUG_REPORT: "bg-red-100 text-red-800",
    FEATURE_REQUEST: "bg-blue-100 text-blue-800",
    ACCOUNT_ISSUE: "bg-yellow-100 text-yellow-800",
    GAMEPLAY_QUESTION: "bg-green-100 text-green-800",
    PAYMENT_ISSUE: "bg-purple-100 text-purple-800",
    TECHNICAL_SUPPORT: "bg-gray-100 text-gray-800",
    MODERATION_SUPPORT: "bg-orange-100 text-orange-800",
    OTHER: "bg-indigo-100 text-indigo-800",
  },
  PRIORITY: {
    LOW: "bg-gray-100 text-gray-800",
    MEDIUM: "bg-blue-100 text-blue-800",
    HIGH: "bg-orange-100 text-orange-800",
    URGENT: "bg-red-100 text-red-800",
  },
  STATUS: {
    OPEN: "bg-green-100 text-green-800",
    IN_PROGRESS: "bg-yellow-100 text-yellow-800",
    WAITING_FOR_USER: "bg-blue-100 text-blue-800",
    WAITING_FOR_STAFF: "bg-purple-100 text-purple-800",
    RESOLVED: "bg-teal-100 text-teal-800",
    CLOSED: "bg-gray-100 text-gray-800",
  },
};

// Category descriptions to help users choose the right category
export const SUPPORT_TICKET_CATEGORY_DESCRIPTIONS: Record<
  SupportTicketCategory,
  string
> = {
  BUG_REPORT: "Report a bug or technical issue with the game",
  FEATURE_REQUEST: "Suggest a new feature or improvement",
  ACCOUNT_ISSUE: "Problems with your account, login, or profile",
  GAMEPLAY_QUESTION: "Questions about game mechanics, rules, or strategies",
  PAYMENT_ISSUE: "Problems with purchases, subscriptions, or payments",
  TECHNICAL_SUPPORT: "Technical problems or performance issues",
  MODERATION_SUPPORT: "Moderation-related issues or questions",
  OTHER: "Any other questions or concerns",
} as const;

// Priority descriptions
export const SUPPORT_TICKET_PRIORITY_DESCRIPTIONS: Record<
  SupportTicketPriority,
  string
> = {
  LOW: "Minor issue that doesn't affect gameplay",
  MEDIUM: "Standard issue that may affect gameplay",
  HIGH: "Important issue that significantly affects gameplay",
  URGENT: "Critical issue that prevents gameplay",
} as const;

// Materials inventory config
export const MATERIALS_BASE_SLOTS = 25;
export const FED_MATERIALS_NORMAL_SLOTS = 5;
export const FED_MATERIALS_SILVER_SLOTS = 10;
export const FED_MATERIALS_GOLD_SLOTS = 15;

/**
 * Safely get user caps based on rank, with fallback to max caps
 * @param rank - the user's rank
 * @returns caps object with stats_cap, gens_cap, and lvl_cap
 */
export function getUserCaps(rank?: UserRank | null) {
  const caps = rank ? USER_CAPS[rank] : undefined;
  if (!caps)
    return {
      stats_cap: MAX_STATS_CAP,
      gens_cap: MAX_GENS_CAP,
      lvl_cap: 100,
    };
  return { stats_cap: caps.STATS_CAP, gens_cap: caps.GENS_CAP, lvl_cap: caps.LVL_CAP };
}

// ============================================
// Tower Defense Constants
// ============================================

export const TD_ENEMY_DIRECTIONS = [
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
  "nw",
] as const;
export type TDEnemyDirection = (typeof TD_ENEMY_DIRECTIONS)[number];

export const TowerDefenseUpgradeTypes = [
  // Attack upgrades
  "DAMAGE",
  "ATTACK_SPEED",
  "RANGE",
  "CRIT_CHANCE",
  "DAMAGE_PER_TILE",
  // Defense upgrades
  "HEALTH",
  "HEALTH_REGEN",
  "DEFENSE_PERCENT",
  "DEFENSE_FLAT",
  "LIFESTEAL",
  "KNOCKBACK_CHANCE",
  "KNOCKBACK_FORCE",
  // Utility upgrades
  "TOKENS_PER_WAVE",
  "TOKENS_PER_KILL",
  "INTEREST_PER_WAVE",
  "SKIP_ENEMY_CHANCE",
  // Ability unlocks
  "ABILITY_UNLOCK",
] as const;
export type TowerDefenseUpgradeType = (typeof TowerDefenseUpgradeTypes)[number];

// Upgrade categories for UI organization
export const TowerDefenseUpgradeCategories: Record<
  string,
  readonly TowerDefenseUpgradeType[]
> = {
  ATTACK: ["DAMAGE", "ATTACK_SPEED", "RANGE", "CRIT_CHANCE", "DAMAGE_PER_TILE"],
  DEFENSE: [
    "HEALTH",
    "DEFENSE_FLAT",
    "DEFENSE_PERCENT",
    "HEALTH_REGEN",
    "LIFESTEAL",
    "KNOCKBACK_CHANCE",
    "KNOCKBACK_FORCE",
  ],
  UTILITY: [
    "TOKENS_PER_KILL",
    "TOKENS_PER_WAVE",
    "INTEREST_PER_WAVE",
    "SKIP_ENEMY_CHANCE",
  ],
  ABILITIES: ["ABILITY_UNLOCK"],
} as const;
export type TowerDefenseUpgradeCategory = keyof typeof TowerDefenseUpgradeCategories;

export const TowerDefenseRunStatuses = ["ACTIVE", "COMPLETED", "ABANDONED"] as const;
export type TowerDefenseRunStatus = (typeof TowerDefenseRunStatuses)[number];

// Game balance constants
export const TD_INITIAL_GRID_SIZE = 7;
export const TD_MAX_GRID_SIZE = 15;
export const TD_GRID_EXPAND_EVERY_N_WAVES = 5;
export const TD_WAVE_ENEMY_BASE = 3;
export const TD_WAVE_ENEMY_SCALING = 1.2;
export const TD_SCORE_PER_KILL = 10;
export const TD_SCORE_TO_POINTS_RATIO = 100; // 100 score = 1 permanent point
export const TD_PLAYER_BASE_HEALTH = 100;
export const TD_SHURIKEN_BASE_DAMAGE = 10;
export const TD_SHURIKEN_BASE_RANGE = 2;
export const TD_SHURIKEN_BASE_COOLDOWN = 500; // ms
export const TD_BASE_CRIT_CHANCE = 0; // Base critical hit chance (0%)
export const TD_BASE_DAMAGE_PER_TILE = 0; // Extra damage per tile distance traveled (0)
export const TD_WAVE_END_GRACE_PERIOD_MS = 200; // Grace period after last enemy dies before transitioning to wave-end
export const TD_RANGE_VISUAL_FACTOR = 0.85; // Range visual factor for ellipse-based range checking
export const TD_EXISTING_SESSION_CHECK_TIMEOUT_MS = 500; // Time to wait for SpacetimeDB to send existing session data
export const TD_HIT_EVENT_DURATION_MS = 500; // Duration for hit event animations

// Ability IDs
export const TD_ABILITY_IDS = {
  SHURIKEN: "shuriken",
} as const;
export type TDAbilityId = (typeof TD_ABILITY_IDS)[keyof typeof TD_ABILITY_IDS];

// Visual & Effect Constants
export const TD_DAMAGE_NUMBER_POOL_SIZE = 20;
export const TD_DAMAGE_NUMBER_LIFETIME = 0.8; // seconds
export const TD_DAMAGE_NUMBER_RISE_SPEED_FACTOR = 0.48; // relative to hexWidth
export const TD_SHURIKEN_IMAGE_URL = "/towerdefence/shuriken.png";
export const TD_HEX_SIZE = 100;

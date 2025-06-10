export const PollOptionTypes = ["text", "user"] as const;
export type PollOptionType = (typeof PollOptionTypes)[number];

export const ACTIVE_VOTING_SITES = [
  "top100Arena",
  "mmoHub",
  "arenaTop100",
  "bbogd",
  "topWebGames",
] as const;

export const GameAssetTypes = ["STATIC", "ANIMATION"] as const;
export type GameAssetType = (typeof GameAssetTypes)[number];

// How many seconds to regen a given regen value
export const REGEN_SECONDS = 30;

export const ContentTypes = [
  "asset",
  "ai",
  "badge",
  "bloodline",
  "item",
  "jutsu",
  "quest",
  "user",
] as const;
export type ContentType = (typeof ContentTypes)[number];

export const MAP_RESERVED_SECTORS = [
  73, 72, 75, 78, 275, 279, 201, 183, 272, 264, 270, 308, 289, 259, 260, 253, 304, 307,
  283, 284, 340, 334, 330, 331, 332, 337, 342, 336, 341, 335, 113, 109, 443,
];
export const MAP_TOTAL_SECTORS = 443;

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
  "stun",
  "summon",
  "shield",
  "drain",
  "poison",
  "clear",
  "cleanse",
  "pierce",
  "debuffprevent",
  "buffprevent",
  "cleanseprevent",
  "clearprevent",
  "seal",
  "increasepoolcost",
] as const;

export const LOG_TYPES = [
  "ai",
  "user",
  "jutsu",
  "userjutsu",
  "bloodline",
  "item",
  "badge",
  "clan",
  "war",
  "poll",
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

export const PoolTypes = ["Health", "Chakra", "Stamina"] as const;
export type PoolType = (typeof PoolTypes)[number];

export const ItemRarities = ["COMMON", "RARE", "EPIC", "LEGENDARY"] as const;

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
  "MODERATOR-ADMIN",
  "HEAD_MODERATOR",
  "MODERATOR",
  "JR_MODERATOR",
  "CONTENT",
  "EVENT",
  "CODER",
] as const;
export type UserRole = (typeof UserRoles)[number];

export const UserStatuses = [
  "AWAKE",
  "HOSPITALIZED",
  "TRAVEL",
  "BATTLE",
  "QUEUED",
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

export const RankedDivisions = [
  { key: "UNRANKED", name: "Unranked", rankedLp: 0 },
  { key: "WOOD", name: "Wood", rankedLp: 150 },
  { key: "ADEPT", name: "Adept", rankedLp: 300 },
  { key: "MASTER", name: "Master", rankedLp: 600 },
  { key: "LEGEND", name: "Legend", rankedLp: 900 },
  { key: "SANNIN", name: "Sannin", rankedLp: Infinity },
] as const;

// Type Definitions
export type RankedDivision = (typeof RankedDivisions)[number]["name"];
export type RankedDivisionEntry = (typeof RankedDivisions)[number];

export const ItemTypes = [
  "WEAPON",
  "CONSUMABLE",
  "ARMOR",
  "ACCESSORY",
  "MATERIAL",
  "KEYSTONE",
  "OTHER",
] as const;
export type ItemType = (typeof ItemTypes)[number];

export const BanStates = [
  "UNVIEWED",
  "REPORT_CLEARED",
  "BAN_ACTIVATED",
  "SILENCE_ACTIVATED",
  "BAN_ESCALATED",
  "SILENCE_ESCALATED",
  "OFFICIAL_WARNING",
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

export const AttackMethods = [
  "SINGLE",
  "ALL",
  "AOE_CIRCLE_SPAWN",
  "AOE_LINE_SHOOT",
  "AOE_WALL_SHOOT",
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
  "strength",
  "speed",
  "intelligence",
  "willpower",
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
  "VILLAGE_PROTECTOR",
  "TRAINING",
  "RANKED",
] as const;
export type BattleType = (typeof BattleTypes)[number];

export const PvpBattleTypes: BattleType[] = [
  "COMBAT",
  "SPARRING",
  "CLAN_BATTLE",
  "TOURNAMENT",
  "RANKED",
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

export const TimeFrames = ["daily", "weekly", "monthly", "all_time"] as const;
export type TimeFrame = (typeof TimeFrames)[number];

export const QuestTypes = [
  "mission",
  "crime",
  "event",
  "exam",
  "errand",
  "tier",
  "daily",
  "achievement",
  "story",
] as const;
export type QuestType = (typeof QuestTypes)[number];
export const QUESTS_CONCURRENT_LIMIT = 4;

export const SmileyEmotions = ["like", "love", "laugh"] as const;

export const TrainingSpeeds = ["15min", "1hr", "4hrs", "8hrs"] as const;
export type TrainingSpeed = (typeof TrainingSpeeds)[number];

export const JUTSU_MAX_RESIDUAL_EQUIPPED = 4;
export const JUTSU_MAX_SHIELD_EQUIPPED = 2;
export const JUTSU_MAX_GROUND_EQUIPPED = 1;
export const JUTSU_MAX_MOVEPREVENT_EQUIPPED = 1;
export const JUTSU_MAX_PIERCE_EQUIPPED = 9999;

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
  ["D"]: 0.3,
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
  ["D"]:
    ROLL_CHANCE_PERCENTAGE.S +
    ROLL_CHANCE_PERCENTAGE.A +
    ROLL_CHANCE_PERCENTAGE.B +
    ROLL_CHANCE_PERCENTAGE.C +
    ROLL_CHANCE_PERCENTAGE.D,
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
export const COST_CHANGE_USERNAME = 5;
export const COST_CUSTOM_TITLE = 5;
export const COST_CHANGE_GENDER = 5;
export const COST_SWAP_BLOODLINE = 0;
export const COST_SWAP_VILLAGE = 0;
export const COST_RESET_STATS = 15;
export const COST_EXTRA_ITEM_SLOT = 10;
export const COST_EXTRA_JUTSU_SLOT = 50;
export const COST_REROLL_ELEMENT = 20;
export const MAX_EXTRA_JUTSU_SLOTS = 2;
export const BLOODLINE_ROLL_TYPES = ["NATURAL", "ITEM"] as const;

// Jutsu level transfer config
export const JUTSU_TRANSFER_DAYS = 20;
export const JUTSU_TRANSFER_COST = 20;
export const JUTSU_TRANSFER_MAX_LEVEL = 25;
export const JUTSU_TRANSFER_MINIMUM_LEVEL = 10;
export const JUTSU_TRANSFER_FREE_AMOUNT = 2;
export const JUTSU_TRANSFER_FREE_NORMAL = 3;
export const JUTSU_TRANSFER_FREE_SILVER = 4;
export const JUTSU_TRANSFER_FREE_GOLD = 5;

// Village config
export const VILLAGE_LEAVE_REQUIRED_RANK = "CHUNIN";
export const VILLAGE_REDUCED_GAINS_DAYS = 7;
export const VILLAGE_SYNDICATE_ID = "ryBk0qD4EgvPPyav2K4OC";

// ANBU config
export const ANBU_MEMBER_RANK_REQUIREMENT = "CHUNIN";
export const ANBU_LEADER_RANK_REQUIREMENT = "JONIN";
export const ANBU_MAX_MEMBERS = 20;
export const ANBU_HOSPITAL_DISCOUNT_PERC = 5;
export const ANBU_ITEMSHOP_DISCOUNT_PERC = 5;
export const ANBU_DELAY_SECS = 24 * 3600;

// Sensei config
export const SENSEI_RANKS = ["JONIN", "ELITE JONIN", "ELDER"];
export const SENSEI_STUDENT_RYO_PER_MISSION = 100;

// Medical Ninja config
export const MEDNIN_HEALABLE_STATES = ["HOSPITALIZED", "AWAKE"] as const;
export const MEDNIN_MIN_RANK = "GENIN";
export const MEDNIN_RANKS = ["NONE", "NOVICE", "APPRENTICE", "MASTER"] as const;
export const MEDNIN_HEAL_TO_EXP = 0.1;
export type MEDNIN_RANK = (typeof MEDNIN_RANKS)[number];
export const MEDNIN_REQUIRED_EXP: Record<MEDNIN_RANK, number> = {
  NONE: 0,
  NOVICE: 0,
  APPRENTICE: 100000,
  MASTER: 400000,
};

// Ai profile config
export const AI_PROFILE_MAX_RULES = 20;

// Training config
export const JUTSU_XP_TO_LEVEL = 1000;
export const JUTSU_LEVEL_CAP = 20;
export const JUTSU_TRAIN_LEVEL_CAP = 25;
export const MAX_DAILY_TRAININGS = 64;

// Combat config
export const BATTLE_ARENA_DAILY_LIMIT = 99999;
export const BATTLE_TAG_STACKING = true;
export const RANKS_RESTRICTED_FROM_PVP = ["STUDENT", "GENIN"];
export const STREAK_LEVEL_DIFF = 10;

// Black market config
export const RYO_FOR_REP_DAYS_FROZEN = 3;
export const RYO_FOR_REP_DAYS_AUTO_DELIST = 30;
export const RYO_FOR_REP_MAX_LISTINGS = 5;
export const RYO_FOR_REP_MIN_REPS = 5;
export const PITY_BLOODLINE_ROLLS = 200;
export const PITY_SYSTEM_ENABLED = true;

// Reputation purchase config
export const MAX_REPS_PER_MONTH = 4000;

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
export const FED_EVENT_ITEMS_NORMAL = 15;
export const FED_EVENT_ITEMS_SILVER = 20;
export const FED_EVENT_ITEMS_GOLD = 25;
export const FED_EVENT_ITEMS_DEFAULT = 10;

// Missions config
export const ERRANDS_PER_DAY = 9;
export const MISSIONS_PER_DAY = 9;
export const ADDITIONAL_MISSION_REWARD_MULTIPLIER = 0.4;

// War config
export const WAR_VILLAGE_MAX_SECTORS = 12;
export const WAR_FACTION_MAX_SECTORS = 6;
export const WAR_MINIMUM_TOKENS_FOR_BEING_ATTACKABLE = 10000;
export const WAR_TOWNHALL_HP_REMOVE = 5;
export const WAR_TOWNHALL_HP_RECOVER = 2;
export const WAR_TOWNHALL_HP_ANBU_REMOVE = 10;
export const WAR_TOWNHALL_HP_ANBU_RECOVER = 5;
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
export const WAR_EXHAUSTION_DURATION_DAYS = 3; // War exhaustion duration
export const WAR_STRUCTURE_UPGRADE_BLOCK_DAYS = 7; // Structure upgrade block duration
export const WAR_VICTORY_TOKEN_BONUS = 100000; // Victory bonus tokens
export const WAR_PURCHASE_SHRINE_TOKEN_COST = 100000; // Cost in village tokens to purchase a shrine
export const WAR_DECLARATION_COST = 15000; // Cost in village tokens to declare war
export const WAR_DAILY_TOKEN_REDUCTION = 1000; // Daily token reduction during war
export const WAR_ALLY_OFFER_MIN = 1000; // Minimum token offer for allies
export const WAR_SHRINE_HP = 3000; // Shrine hp
export const WAR_SECTORWAR_AI_SHRINE_REDUCE = 3; // KIlling AI shrine hp decrease
export const WAR_SECTORWAR_AI_SHRINE_RECOVER = 3; // Shrine hp recover per day
export const WAR_SECTORWAR_PVP_SHRINE_REDUCE = 5; // Killing a player in a sector war shrine hp decrease
export const WAR_SECTORWAR_PVP_SHRINE_RECOVER = 7; // Shrine hp remove per day
export const WAR_SHRINE_IMAGE =
  "https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJgLihSncU9cpECTimBdjaqbNn7vQsxGR1wLk4";
export const WAR_RAMEN_IMAGE =
  "https://utfs.io/f/6407eedd-9382-41e9-b27d-eb02afe87ce9-srb0e7.webp";
export const WAR_STATES = [
  "ACTIVE",
  "ATTACKER_VICTORY",
  "DEFENDER_VICTORY",
  "DRAW",
] as const;
export const WAR_TYPES = ["VILLAGE_WAR", "SECTOR_WAR", "WAR_RAID"] as const;
export type WarType = (typeof WAR_TYPES)[number];
export type WarState = (typeof WAR_STATES)[number];

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
export const KAGE_DELAY_SECS = 24 * 3600; // Delay before kage can perform actions
export const KAGE_ELDER_MIN_DAYS = 100; // minimum days in village to be elder
export const KAGE_REQUESTS_SHOW_SECONDS = 24 * 60 * 60; // Show requests for 24 hours
export const KAGE_MAX_DAILIES = 3;
export const KAGE_MAX_ELDERS = 3;
export const KAGE_MAX_WEEKLY_PRESTIGE_SEND = 6000; // Maximum weekly prestige send from elders
export const KAGE_MIN_DAYS_IN_VILLAGE = 40; // minimum days in village to become kage
export const KAGE_MIN_PRESTIGE = 4000; // Remove kage if below
export const KAGE_PRESTIGE_COST = 10000; // Cost of failed challenge
export const KAGE_PRESTIGE_REQUIREMENT = 30000; // To challeng kage
export const KAGE_RANK_REQUIREMENT = "JONIN";
export const KAGE_WAR_DECLARE_COST = 10000; // Declare war cost
export const KAGE_CHALLENGE_REJECT_COST = 500; // Cost of rejecting a challenge
export const KAGE_CHALLENGE_ACCEPT_PRESTIGE = 200; // Kage prestige gain of accepting challenge
export const KAGE_CHALLENGE_WIN_PRESTIGE = 500; // Kage prestige gain of winning challenge
export const KAGE_CHALLENGE_LOSE_PRESTIGE_PER_HOUR = 300; // Kage prestige loss of not accepting challenges
export const KAGE_CHALLENGE_OPEN_FOR_SECONDS = 60 * 60; // Time in between being able to toggle challenges
export const KAGE_UNACCEPTED_CHALLENGE_COST = 1000; // Cost of unaccepted challenge, i.e. going to Ai vs Ai
export const WAR_FUNDS_COST = 10000; // Prestige cost of declaring war

// Game assets
export const ID_ANIMATION_SMOKE = "gkYHdSzsHu";
export const ID_ANIMATION_HIT = "oh4kVNrAwF";
export const ID_ANIMATION_HEAL = "I9aYhT5wMB";

// Draco files (see https://github.com/google/draco/tree/main/javascript)
export const DRACO_DECODER_URL =
  "https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJF0eCaMuG2iOewJtjGzvNcmEX3TBnoSfMDZPH";
export const DRACO_ENCODER_URL =
  "https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJGexpLZRfoVrha0LP4mAS5KM7wtiZbUNXJxdC";

// Images
export const IMG_FRONTPAGE_SCREENSHOT_COMBAT =
  "https://utfs.io/f/Hzww9EQvYURJmap513HE4IMO5Goa7cgLxPJ0VC6lU8vbt1Ap";
export const IMG_FRONTPAGE_SCREENSHOT_JUTSUS =
  "https://utfs.io/f/Hzww9EQvYURJhf79QHMfUBdnwAX5LTajlNc4mrgzi0RJtqpM";
export const IMG_FRONTPAGE_SCREENSHOT_GLOBAL =
  "https://utfs.io/f/Hzww9EQvYURJn24vk3mojJ0EqeDCvBrNmZaXVdY97gSpOWiA";
export const IMG_FRONTPAGE_SCREENSHOT_SECTOR =
  "https://utfs.io/f/Hzww9EQvYURJdVdE0WP62PI3ciLaYzgVX8FopBADxSrGmvQl";
export const IMG_FRONTPAGE_SCREENSHOT_VILLAGE =
  "https://utfs.io/f/Hzww9EQvYURJAPlRYqoZUC4muiGcQNzjfEndY5y1w20B8hTW";

export const IMG_FRONTPAGE_SCREENSHOT_COMBAT_HR =
  "https://utfs.io/f/Hzww9EQvYURJhuLmX5MfUBdnwAX5LTajlNc4mrgzi0RJtqpM";
export const IMG_FRONTPAGE_SCREENSHOT_JUTSUS_HR =
  "https://utfs.io/f/Hzww9EQvYURJAaVOt2SoZUC4muiGcQNzjfEndY5y1w20B8hT";
export const IMG_FRONTPAGE_SCREENSHOT_GLOBAL_HR =
  "https://utfs.io/f/Hzww9EQvYURJvSzUp4EmSnXwslYEpV1yOeNL8gMtqhjPdf36";
export const IMG_FRONTPAGE_SCREENSHOT_SECTOR_HR =
  "https://utfs.io/f/Hzww9EQvYURJXMBBarqIOpAoLKbZ4nW9Rsil2V67yuFwQhqv";
export const IMG_FRONTPAGE_SCREENSHOT_VILLAGE_HR =
  "https://utfs.io/f/Hzww9EQvYURJRmBtUg0udmODoNtpa0FMcwI4k2Eq7nJhyvjl";

export const IMG_REGISTRATIN_STEP1 =
  "https://utfs.io/f/Hzww9EQvYURJeKNAEEyV3OvUJQExAi0bGoIZDF74LqSnHRdp";
export const IMG_REGISTRATIN_STEP2 =
  "https://utfs.io/f/Hzww9EQvYURJTOMd6Y5IU29dZYJPoOKSh5vmlqatMub3EigH";
export const IMG_REGISTRATIN_STEP3 =
  "https://utfs.io/f/Hzww9EQvYURJZlINOXaYQrBIUTu69nkMxWmS4ah0O7LVCp8b";
export const IMG_REGISTRATIN_STEP4 =
  "https://utfs.io/f/Hzww9EQvYURJqppFvGcdkOZgJQ8mGRcdx3SsWvPelyYFTt5V";
export const IMG_REGISTRATIN_STEP5 =
  "https://utfs.io/f/Hzww9EQvYURJ56sDpz797jl4ubX8xrRqTZasyMp2WA5eLGUP";
export const IMG_REGISTRATIN_STEP6 =
  "https://utfs.io/f/Hzww9EQvYURJwm1XDCT2j854CWbaITZyegfXimvd7s16cO0h";
export const IMG_REGISTRATIN_STEP7 =
  "https://utfs.io/f/Hzww9EQvYURJQU7pvzjhzBPya1rwfCIqOTU0cV5xgsMeo3u2";
export const IMG_REGISTRATIN_STEP8 =
  "https://utfs.io/f/Hzww9EQvYURJ8B9jC0rkkp45TvAnoIBa0rtCf1lbyXYjVKQ2";
export const IMG_REGISTRATIN_STEP9 =
  "https://utfs.io/f/Hzww9EQvYURJnjHXr3mojJ0EqeDCvBrNmZaXVdY97gSpOWiA";

export const IMG_BADGE_PVPKILLS =
  "https://utfs.io/f/Hzww9EQvYURJyPU0OdukVH2MI5Lo4ehEfAXvZdcmtWqPg7rp";
export const IMG_BADGE_ARENAKILLS =
  "https://utfs.io/f/Hzww9EQvYURJZXqeTaYQrBIUTu69nkMxWmS4ah0O7LVCp8bz";
export const IMG_BADGE_MINUTES_PASSED =
  "https://utfs.io/f/Hzww9EQvYURJCmrv4YU26OYrIJuNP1pvSyz29edFtKbngjRc";
export const IMG_BADGE_ERRANDS_TOTAL =
  "https://utfs.io/f/Hzww9EQvYURJFkFklPG2iOewJtjGzvNcmEX3TBnoSfMDZPH4";
export const IMG_BADGE_D_MISSION_TOTAL =
  "https://utfs.io/f/Hzww9EQvYURJuD6udtCyJLoOFkrcn4gxSwCfEQ9eMNXZlG8b";
export const IMG_BADGE_C_MISSION_TOTAL =
  "https://utfs.io/f/Hzww9EQvYURJGudreBRfoVrha0LP4mAS5KM7wtiZbUNXJxdC";
export const IMG_BADGE_B_MISSION_TOTAL =
  "https://utfs.io/f/Hzww9EQvYURJy2Uv1s5ukVH2MI5Lo4ehEfAXvZdcmtWqPg7r";
export const IMG_BADGE_A_MISSION_TOTAL =
  "https://utfs.io/f/Hzww9EQvYURJEJpK3acLfKL5D7TAFe29bymSaPCIQ846MdzG";
export const IMG_BADGE_D_CRIME_TOTAL =
  "https://utfs.io/f/Hzww9EQvYURJDyHMWFlzEwoh0WXMnscL279N8ayVQUCbRzS3";
export const IMG_BADGE_C_CRIME_TOTAL =
  "https://utfs.io/f/Hzww9EQvYURJnJ43OQmojJ0EqeDCvBrNmZaXVdY97gSpOWiA";
export const IMG_BADGE_B_CRIME_TOTAL =
  "https://utfs.io/f/Hzww9EQvYURJHS8H1zQvYURJhgs76VZtf9wxpMa13Cq0iOnr";
export const IMG_BADGE_A_CRIME_TOTAL =
  "https://utfs.io/f/Hzww9EQvYURJQ6PtAxjhzBPya1rwfCIqOTU0cV5xgsMeo3u2";
export const IMG_BADGE_MINUTES_TRAINING =
  "https://utfs.io/f/Hzww9EQvYURJbZSRGyZAtYUndMi56GkX19q0A4PzyeIloBrE";
export const IMG_BADGE_JUTSUS_MASTERED =
  "https://utfs.io/f/Hzww9EQvYURJDyHTMUuzEwoh0WXMnscL279N8ayVQUCbRzS3";
export const IMG_BADGE_STATS_TRAINED =
  "https://utfs.io/f/Hzww9EQvYURJVNQSNpF2veAXohUuE59nTQHRJIYjtiG18aF4";
export const IMG_BADGE_DAYS_IN_VILLAGE =
  "https://utfs.io/f/Hzww9EQvYURJ2HU2el8nMXlcRpYmJ5do0zKw4Qx6PVEtBa9b";
export const IMG_BADGE_REPUTATION_POINTS =
  "https://utfs.io/f/Hzww9EQvYURJxyYNkgWZsq9k0Von5rUfP6OgQ2TyptCKHS4u";
export const IMG_BADGE_USER_LEVEL =
  "https://utfs.io/f/Hzww9EQvYURJo6lBgeZ9MPZpHJ7VliuEWDfATdxhv62SXnm4";
export const IMG_BADGE_MOVE_TO_LOCATION =
  "https://utfs.io/f/Hzww9EQvYURJ5qXZuJi797jl4ubX8xrRqTZasyMp2WA5eLGU";
export const IMG_BADGE_COLLECT_ITEM =
  "https://utfs.io/f/Hzww9EQvYURJtxtluhUYJDfpFXWm3nrcPluEtIZqyLkaSV1j";
export const IMG_BADGE_DEFEAT_OPPONENTS =
  "https://utfs.io/f/Hzww9EQvYURJYwI8YKOMAlNnPZ41ev6fCGcFK3hmjX9I8W7d";

export const IMG_BG_COLISEUM =
  "https://utfs.io/f/Hzww9EQvYURJo5wb6hZ9MPZpHJ7VliuEWDfATdxhv62SXnm4";
export const IMG_BG_ARENA_CHRISMAS =
  "https://utfs.io/f/Hzww9EQvYURJQr5mXyjhzBPya1rwfCIqOTU0cV5xgsMeo3u2";
export const IMG_BG_ARENA_KONOKI =
  "https://utfs.io/f/Hzww9EQvYURJDyj0BtAzEwoh0WXMnscL279N8ayVQUCbRzS3";
export const IMG_BG_ARENA_SILENCE =
  "https://utfs.io/f/Hzww9EQvYURJSZtKvF3jWrEB7TyZlmpoAxMK5Qi16kNPVJuH";
export const IMG_BG_OCEAN =
  "https://utfs.io/f/Hzww9EQvYURJWrGawgvszvj71yaSYC0MDOmbko5q9JAGuLHf";
export const IMG_BG_FOREST =
  "https://utfs.io/f/Hzww9EQvYURJIPGHFyxfOewksxBoS1HQCihpL7c42Ky9uUFv";
export const IMG_BG_DESSERT =
  "https://utfs.io/f/Hzww9EQvYURJnAdfRSmojJ0EqeDCvBrNmZaXVdY97gSpOWiA";
export const IMG_BG_ICE =
  "https://utfs.io/f/Hzww9EQvYURJGVWObnRfoVrha0LP4mAS5KM7wtiZbUNXJxdC";

export const IMG_VILLAGE_FACTION =
  "https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJyODt1NukVH2MI5Lo4ehEfAXvZdcmtWqPg7rp";

export const IMG_RARITY_RARE =
  "https://utfs.io/f/Hzww9EQvYURJvSyOMsEmSnXwslYEpV1yOeNL8gMtqhjPdf36";
export const IMG_RARITY_LEGENDARY =
  "https://utfs.io/f/Hzww9EQvYURJoooBQZ9MPZpHJ7VliuEWDfATdxhv62SXnm4B";
export const IMG_RARITY_EPIC =
  "https://utfs.io/f/Hzww9EQvYURJeCIgGvhyV3OvUJQExAi0bGoIZDF74LqSnHRd";
export const IMG_RARITY_COMMON =
  "https://utfs.io/f/Hzww9EQvYURJQP8otBjhzBPya1rwfCIqOTU0cV5xgsMeo3u2";

export const IMG_PROFILE_LEVELUPGUY =
  "https://utfs.io/f/Hzww9EQvYURJaeS5LnYYfKMcJ2B5EmWt6VsNgqxpG8OSXAQk";
export const IMG_RAMEN_WELCOME =
  "https://utfs.io/f/Hzww9EQvYURJmd2fWKHE4IMO5Goa7cgLxPJ0VC6lU8vbt1Ap";
export const IMG_RAMEN_SMALL =
  "https://utfs.io/f/Hzww9EQvYURJj7ESnm4XzPI8f1v96qBot0Q3wsUp2nxu7SMb";
export const IMG_RAMEN_MEDIUM =
  "https://utfs.io/f/Hzww9EQvYURJyoMsmMukVH2MI5Lo4ehEfAXvZdcmtWqPg7rp";
export const IMG_RAMEN_LARGE =
  "https://utfs.io/f/Hzww9EQvYURJHKlC2sQvYURJhgs76VZtf9wxpMa13Cq0iOnr";
export const IMG_REPSHOP_BRONZE =
  "https://utfs.io/f/Hzww9EQvYURJCg005h26OYrIJuNP1pvSyz29edFtKbngjRcA";
export const IMG_REPSHOP_SILVER =
  "https://utfs.io/f/Hzww9EQvYURJSk2raeh3jWrEB7TyZlmpoAxMK5Qi16kNPVJu";
export const IMG_REPSHOP_GOLD =
  "https://utfs.io/f/Hzww9EQvYURJebK38NyV3OvUJQExAi0bGoIZDF74LqSnHRdp";
export const IMG_EQUIP_SILHOUETTE =
  "https://utfs.io/f/Hzww9EQvYURJ6e2pEi7DfT5pyNCaUruzhPtAJqb8Kj9mc1nl";
export const IMG_HOME_TRAIN =
  "https://utfs.io/f/Hzww9EQvYURJ25o9TnMXlcRpYmJ5do0zKw4Qx6PVEtBa9b8C";
export const IMG_HOME_EAT =
  "https://utfs.io/f/Hzww9EQvYURJbZ8Rz1xAtYUndMi56GkX19q0A4PzyeIloBrE";
export const IMG_HOME_SLEEP =
  "https://utfs.io/f/Hzww9EQvYURJu8FpvZCyJLoOFkrcn4gxSwCfEQ9eMNXZlG8b";
export const IMG_HOME_AWAKE =
  "https://utfs.io/f/Hzww9EQvYURJ1BKctL6bo95WClq4K0wxZUmJcvThgdVenO3P";
export const IMG_MANUAL_AWARDS =
  "https://utfs.io/f/Hzww9EQvYURJD2QXqVzEwoh0WXMnscL279N8ayVQUCbRzS3p";
export const IMG_MANUAL_COMBAT =
  "https://utfs.io/f/Hzww9EQvYURJUvE8xxILCIhwPniJ69VxpvAbTDWkOyGzS8rM";
export const IMG_MANUAL_TRAVEL =
  "https://utfs.io/f/Hzww9EQvYURJu1h1uHCyJLoOFkrcn4gxSwCfEQ9eMNXZlG8b";
export const IMG_MANUAL_BLOODLINE =
  "https://utfs.io/f/Hzww9EQvYURJaCMo8gYYfKMcJ2B5EmWt6VsNgqxpG8OSXAQk";
export const IMG_MANUAL_JUTSU =
  "https://utfs.io/f/Hzww9EQvYURJMI7fE4tsO4cexqW2RDgkE3zZbNXSFGitmnar";
export const IMG_MANUAL_ITEM =
  "https://utfs.io/f/Hzww9EQvYURJb59vlYAtYUndMi56GkX19q0A4PzyeIloBrEa";
export const IMG_MANUAL_AI =
  "https://utfs.io/f/Hzww9EQvYURJuTQifZCyJLoOFkrcn4gxSwCfEQ9eMNXZlG8b";
export const IMG_MANUAL_QUEST =
  "https://utfs.io/f/Hzww9EQvYURJmWVaWXHE4IMO5Goa7cgLxPJ0VC6lU8vbt1Ap";
export const IMG_MANUAL_LOGS =
  "https://utfs.io/f/Hzww9EQvYURJwvy6QoT2j854CWbaITZyegfXimvd7s16cO0h";
export const IMG_MANUAL_DAM_CALCS =
  "https://utfs.io/f/Hzww9EQvYURJQF6qYYjhzBPya1rwfCIqOTU0cV5xgsMeo3u2";
export const IMG_MANUAL_BADGE =
  "https://utfs.io/f/Hzww9EQvYURJOUM5LPVHevxIThUauQkGJEBY3D2cPqy8f5sp";
export const IMG_MANUAL_ASSET =
  "https://utfs.io/f/Hzww9EQvYURJaGvHErYYfKMcJ2B5EmWt6VsNgqxpG8OSXAQk";
export const IMG_MANUAL_OPINION =
  "https://utfs.io/f/Hzww9EQvYURJ0dX0Z3grYldRWJcD6vE10SjNsXHeA9pVMfQi";
export const IMG_MANUAL_POLLS =
  "https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJRc1v3JK0udmODoNtpa0FMcwI4k2Eq7nJhyvj";
export const IMG_MANUAL_RANKED =
  "https://utfs.io/f/Hzww9EQvYURJAa3ucxOoZUC4muiGcQNzjfEndY5y1w20B8hT";
export const IMG_LAYOUT_USERBANNER_MIDDLE =
  "https://utfs.io/f/Hzww9EQvYURJ6sgzOzDfT5pyNCaUruzhPtAJqb8Kj9mc1nlH";
export const IMG_LAYOUT_SIDESCROLL =
  "https://utfs.io/f/Hzww9EQvYURJAElfIGoZUC4muiGcQNzjfEndY5y1w20B8hTW";
export const IMG_LAYOUT_MOBILE_TOP =
  "https://utfs.io/f/Hzww9EQvYURJHTt3S9QvYURJhgs76VZtf9wxpMa13Cq0iOnr";
export const IMG_LAYOUT_SIDETOPBANNER_CONTENT =
  "https://utfs.io/f/Hzww9EQvYURJOG9gcTWVHevxIThUauQkGJEBY3D2cPqy8f5s";
export const IMG_LAYOUT_SIDETOPBANNER_BOTTOM =
  "https://utfs.io/f/Hzww9EQvYURJ19AHU06bo95WClq4K0wxZUmJcvThgdVenO3P";
export const IMG_LAYOUT_SCROLLBOTTOM_DECOR =
  "https://utfs.io/f/Hzww9EQvYURJCVjF0e26OYrIJuNP1pvSyz29edFtKbngjRcA";
export const IMG_LAYOUT_USERSBANNER_TOP =
  "https://utfs.io/f/Hzww9EQvYURJDV31MCzEwoh0WXMnscL279N8ayVQUCbRzS3p";
export const IMG_LAYOUT_USERSBANNER_BOTTOM =
  "https://utfs.io/f/Hzww9EQvYURJhWwvubMfUBdnwAX5LTajlNc4mrgzi0RJtqpM";
export const IMG_AVATAR_DEFAULT =
  "https://utfs.io/f/630cf6e7-c152-4dea-a3ff-821de76d7f5a_default.webp";
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
  "https://utfs.io/f/Hzww9EQvYURJYectQDOMAlNnPZ41ev6fCGcFK3hmjX9I8W7d";
export const IMG_LAYOUT_NAVBAR =
  "https://utfs.io/f/Hzww9EQvYURJ1znttRb6bo95WClq4K0wxZUmJcvThgdVenO3";
export const IMG_LAYOUT_NAVBAR_HALLOWEEN =
  "https://utfs.io/f/Hzww9EQvYURJbYxvuGAtYUndMi56GkX19q0A4PzyeIloBrEa";
export const IMG_LAYOUT_HANDSIGN =
  "https://utfs.io/f/Hzww9EQvYURJ0hKI3IgrYldRWJcD6vE10SjNsXHeA9pVMfQi";
export const IMG_LAYOUT_HANDSIGN_HALLOWEEN =
  "https://utfs.io/f/Hzww9EQvYURJcGYTUXSnxBpQqGNDcTHbLmYz8uXAl3oa54ti";
export const IMG_LAYOUT_WELCOME_IMG =
  "https://tnr-storage-cdn.b-cdn.net/welcomeimage_compressed.webp";
// "https://utfs.io/f/Hzww9EQvYURJqbkFzRdkOZgJQ8mGRcdx3SsWvPelyYFTt5Vn";
export const IMG_LOGO_FULL =
  "https://utfs.io/f/Hzww9EQvYURJ8b0eqBkkp45TvAnoIBa0rtCf1lbyXYjVKQ2q";
export const IMG_LOGO_SHORT =
  "https://utfs.io/f/Hzww9EQvYURJCClYWI26OYrIJuNP1pvSyz29edFtKbngjRcA";
export const IMG_LOADER =
  "https://utfs.io/f/4a3100e5-97c6-4e5a-96e2-1c3520838179-gwm3dh.svg";
export const IMG_SECTOR_INFO =
  "https://utfs.io/f/ddab9f31-0491-4445-8e6e-98370533a93d-1xdpq.png";
export const IMG_SECTOR_ATTACK =
  "https://utfs.io/f/d6587d1a-c11b-49e3-8e86-74bfb02a80a1-n9ug1k.png";
export const IMG_SECTOR_ROB =
  "https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJvNL3jBEmSnXwslYEpV1yOeNL8gMtqhjPdf36";
export const IMG_SECTOR_USER_MARKER =
  "https://utfs.io/f/cc347416-8bf6-40cf-9184-b4af64e6feae-n771t1.webp";
export const IMG_SECTOR_USER_SPRITE_MASK =
  "https://utfs.io/f/40061bc5-d73c-4265-8eff-4798fd840ae2-x83hc4.webp";
export const IMG_SECTOR_SHADOW =
  "https://utfs.io/f/bd8d8c75-96a0-4c71-94b6-f02e1ee382b5-exyuao.png";
export const IMG_SECTOR_USERSPRITE_LEFT =
  "https://utfs.io/f/5c812303-70aa-4fc4-982c-6e72eee3c4b6-u7oujn.webp";
export const IMG_SECTOR_USERSPRITE_RIGHT =
  "https://utfs.io/f/b6c5b6ba-99e0-49e5-b4a2-bf6ba9ca1ebc-dbaxa8.webp";
export const IMG_SECTOR_VS_ICON =
  "https://utfs.io/f/be789e50-095f-4e50-bffc-fe0fedd8777b-dd7l0q.webp";
export const IMG_SECTOR_WALL_STONE_TOWER =
  "https://utfs.io/f/aab037bb-7ac7-48f7-9994-548d87eb55f1-lga892.webp";
export const IMG_MAP_HEXASPHERE =
  "https://tnr-storage-cdn.b-cdn.net/eb805d73-5216-4d5c-b3e9-c39cc2340922-ixejn7.json";
export const IMG_MAP_WAR_ICON =
  "https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJgipq89cU9cpECTimBdjaqbNn7vQsxGR1wLk4";
export const IMG_MAP_QUEST_ICON =
  "https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJRsb4NN0udmODoNtpa0FMcwI4k2Eq7nJhyvjl";
export const IMG_TRAIN_INTELLIGENCE =
  "https://utfs.io/f/815a53ea-23d2-4767-9219-a36ed3d4c619-d73vsv.png";
export const IMG_TRAIN_WILLPOWER =
  "https://utfs.io/f/a303f719-e216-4142-b1c2-50b2ac1d98c3-t57iq5.png";
export const IMG_TRAIN_STRENGTH =
  "https://utfs.io/f/70e251a8-17d2-4d5d-a121-55fb43bf5b37-tmi4ap.png";
export const IMG_TRAIN_SPEED =
  "https://utfs.io/f/893e0cc5-9b53-442c-af5d-9aacd95e6d8b-1ta05j.png";
export const IMG_TRAIN_GEN_OFF =
  "https://utfs.io/f/598a40f5-4cfa-4ad7-8378-eb63f0b28282-f9eh41.png";
export const IMG_TRAIN_GEN_DEF =
  "https://utfs.io/f/38463f2d-8c5b-4e4f-b74e-52667469a478-z4l40b.png";
export const IMG_TRAIN_TAI_DEF =
  "https://utfs.io/f/c6091de0-8c6f-4a17-8d75-067338f9fdf0-8ghs8v.png";
export const IMG_TRAIN_TAI_OFF =
  "https://utfs.io/f/6dcf3cfd-0084-49ec-8b5f-36dff3212d35-beounf.png";
export const IMG_TRAIN_BUKI_OFF =
  "https://utfs.io/f/b6daa0ab-698a-4e13-8e5f-c7560cfdc499-mcc2dc.png";
export const IMG_TRAIN_BUKI_DEF =
  "https://utfs.io/f/5faa1363-2ecc-4533-9077-b3c14afd58c6-stlcpi.png";
export const IMG_TRAIN_NIN_OFF =
  "https://utfs.io/f/4727d488-1eb0-475e-adfe-ca26837c45a1-g8pm8u.png";
export const IMG_TRAIN_NIN_DEF =
  "https://utfs.io/f/308d9bee-5105-4534-b11c-59592db90181-yx7su0.png";

export const IMG_ELEMENT_YINYANG =
  "https://utfs.io/f/Hzww9EQvYURJIlW2BrxfOewksxBoS1HQCihpL7c42Ky9uUFv";
export const IMG_ELEMENT_SHADOW =
  "https://utfs.io/f/Hzww9EQvYURJvSWrdXEmSnXwslYEpV1yOeNL8gMtqhjPdf36";
export const IMG_ELEMENT_NONE =
  "https://utfs.io/f/Hzww9EQvYURJeC2dFWVyV3OvUJQExAi0bGoIZDF74LqSnHRd";
export const IMG_ELEMENT_EXPLOSION =
  "https://utfs.io/f/Hzww9EQvYURJCH1oeV26OYrIJuNP1pvSyz29edFtKbngjRcA";
export const IMG_ELEMENT_WIND =
  "https://utfs.io/f/Hzww9EQvYURJ2HrMNjAnMXlcRpYmJ5do0zKw4Qx6PVEtBa9b";
export const IMG_ELEMENT_WATER =
  "https://utfs.io/f/Hzww9EQvYURJoYFqRUhZ9MPZpHJ7VliuEWDfATdxhv62SXnm";
export const IMG_ELEMENT_LAVA =
  "https://utfs.io/f/Hzww9EQvYURJaK2IZBYYfKMcJ2B5EmWt6VsNgqxpG8OSXAQk";
export const IMG_ELEMENT_ICE =
  "https://utfs.io/f/Hzww9EQvYURJCqHOvc26OYrIJuNP1pvSyz29edFtKbngjRcA";
export const IMG_ELEMENT_WOOD =
  "https://utfs.io/f/Hzww9EQvYURJbZYZaSPAtYUndMi56GkX19q0A4PzyeIloBrE";
export const IMG_ELEMENT_STORM =
  "https://utfs.io/f/Hzww9EQvYURJzu4spmSemvaQu94EYJs8HpxVzofny6iPtbgC";
export const IMG_ELEMENT_CRYSTAL =
  "https://utfs.io/f/Hzww9EQvYURJaKoVVmYYfKMcJ2B5EmWt6VsNgqxpG8OSXAQk";
export const IMG_ELEMENT_MAGNET =
  "https://utfs.io/f/Hzww9EQvYURJuNr6tnCyJLoOFkrcn4gxSwCfEQ9eMNXZlG8b";
export const IMG_ELEMENT_FIRE =
  "https://utfs.io/f/Hzww9EQvYURJAX1vCjoZUC4muiGcQNzjfEndY5y1w20B8hTW";
export const IMG_ELEMENT_LIGHT =
  "https://utfs.io/f/Hzww9EQvYURJeVtMZpyV3OvUJQExAi0bGoIZDF74LqSnHRdp";
export const IMG_ELEMENT_EARTH =
  "https://utfs.io/f/Hzww9EQvYURJgi7liFcU9cpECTimBdjaqbNn7vQsxGR1wLk4";
export const IMG_ELEMENT_SCORCH =
  "https://utfs.io/f/Hzww9EQvYURJCmW9wm326OYrIJuNP1pvSyz29edFtKbngjRc";
export const IMG_ELEMENT_DUST =
  "https://utfs.io/f/Hzww9EQvYURJchNmlmSnxBpQqGNDcTHbLmYz8uXAl3oa54ti";
export const IMG_ELEMENT_LIGHTNING =
  "https://utfs.io/f/Hzww9EQvYURJ4DIVIclYIif5CL8BKvMsOh2ZnmS7yHt0jTD3";
export const IMG_ELEMENT_BOIL =
  "https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJ5qAGAlo797jl4ubX8xrRqTZasyMp2WA5eLGU";

export const IMG_BASIC_HEAL =
  "https://utfs.io/f/Hzww9EQvYURJnlXNSKmojJ0EqeDCvBrNmZaXVdY97gSpOWiA";
export const IMG_BASIC_ATTACK =
  "https://utfs.io/f/Hzww9EQvYURJdMXlCrP62PI3ciLaYzgVX8FopBADxSrGmvQl";
export const IMG_BASIC_FLEE =
  "https://utfs.io/f/Hzww9EQvYURJRohRDR0udmODoNtpa0FMcwI4k2Eq7nJhyvjl";
export const IMG_BASIC_STEALTH =
  "https://utfs.io/f/Hzww9EQvYURJDtLSxhzEwoh0WXMnscL279N8ayVQUCbRzS3p";
export const IMG_BASIC_WAIT =
  "https://utfs.io/f/Hzww9EQvYURJ8ByNJwOkkp45TvAnoIBa0rtCf1lbyXYjVKQ2";
export const IMG_BASIC_MOVE =
  "https://utfs.io/f/Hzww9EQvYURJnQxuGeXmojJ0EqeDCvBrNmZaXVdY97gSpOWi";
export const IMG_BASIC_CLEANSE =
  "https://utfs.io/f/Hzww9EQvYURJ5oYOji797jl4ubX8xrRqTZasyMp2WA5eLGUP";
export const IMG_BASIC_CLEAR =
  "https://utfs.io/f/Hzww9EQvYURJTWnPJE5IU29dZYJPoOKSh5vmlqatMub3EigH";

export const IMG_ICON_DISCORD =
  "https://utfs.io/f/Hzww9EQvYURJCZvaND26OYrIJuNP1pvSyz29edFtKbngjRcA";
export const IMG_ICON_FACEBOOK =
  "https://utfs.io/f/Hzww9EQvYURJ1zjiDxX6bo95WClq4K0wxZUmJcvThgdVenO3";
export const IMG_ICON_GITHUB =
  "https://utfs.io/f/Hzww9EQvYURJydaEQfukVH2MI5Lo4ehEfAXvZdcmtWqPg7rp";
export const IMG_ICON_GOOGLE =
  "https://utfs.io/f/Hzww9EQvYURJCV0Mc426OYrIJuNP1pvSyz29edFtKbngjRcA";
export const IMG_ICON_INSTAGRAM =
  "https://utfs.io/f/Hzww9EQvYURJWLbTriPvszvj71yaSYC0MDOmbko5q9JAGuLH";
export const IMG_ICON_REDDIT =
  "https://utfs.io/f/Hzww9EQvYURJPYJEg8pKeUGyX2kj6u45AOQiSa1zYH0mqZoc";
export const IMG_ICON_TIKTOK =
  "https://utfs.io/f/Hzww9EQvYURJoYcyUDSZ9MPZpHJ7VliuEWDfATdxhv62SXnm";
export const IMG_ICON_TWITTER =
  "https://utfs.io/f/Hzww9EQvYURJMi2fCxtsO4cexqW2RDgkE3zZbNXSFGitmnar";
export const IMG_ICON_YOUTUBE =
  "https://utfs.io/f/Hzww9EQvYURJy7pL6jukVH2MI5Lo4ehEfAXvZdcmtWqPg7rp";
export const IMG_ICON_FORUM =
  "https://utfs.io/f/Hzww9EQvYURJTwT9cY5IU29dZYJPoOKSh5vmlqatMub3EigH";
export const IMG_ICON_MOVE =
  "https://utfs.io/f/Hzww9EQvYURJepKSYSyV3OvUJQExAi0bGoIZDF74LqSnHRdp";
export const IMG_ICON_HEAL =
  "https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJrtRSYfhuJPmdY8zI2ptZXAoEj1c6BMKvrQOx";

export const IMG_MISSION_S =
  "https://utfs.io/f/Hzww9EQvYURJz3Ph17emvaQu94EYJs8HpxVzofny6iPtbgCZ";
export const IMG_MISSION_A =
  "https://utfs.io/f/Hzww9EQvYURJ0ORGP9grYldRWJcD6vE10SjNsXHeA9pVMfQi";
export const IMG_MISSION_B =
  "https://utfs.io/f/Hzww9EQvYURJoVn7VTZ9MPZpHJ7VliuEWDfATdxhv62SXnm4";
export const IMG_MISSION_C =
  "https://utfs.io/f/Hzww9EQvYURJoe3eJHZ9MPZpHJ7VliuEWDfATdxhv62SXnm4";
export const IMG_MISSION_D =
  "https://utfs.io/f/Hzww9EQvYURJ7r7fFcXKPBOUWGyFuM4DlL1v5HNTZhkte0z6";
export const IMG_MISSION_E =
  "https://utfs.io/f/Hzww9EQvYURJPAguocQpKeUGyX2kj6u45AOQiSa1zYH0mqZo";

export const IMG_BUILDING_MISSIONHALL =
  "https://utfs.io/f/Hzww9EQvYURJ2TCTWInMXlcRpYmJ5do0zKw4Qx6PVEtBa9b8";
export const IMG_BUILDING_SCIENCEBUILDING =
  "https://utfs.io/f/Hzww9EQvYURJwQxr3PT2j854CWbaITZyegfXimvd7s16cO0h";
export const IMG_BUILDING_NEWS =
  "https://utfs.io/f/Hzww9EQvYURJYKooj7OMAlNnPZ41ev6fCGcFK3hmjX9I8W7d";
export const IMG_BUILDING_SOUVENIER =
  "https://utfs.io/f/Hzww9EQvYURJHmrEYkQvYURJhgs76VZtf9wxpMa13Cq0iOnr";
export const IMG_BUILDING_HOSPITAL =
  "https://utfs.io/f/Hzww9EQvYURJ3n9SmD8pYHJX5rdkUTfOKtvu2eGIELmSWqBx";
export const IMG_BUILDING_GLOBALANBU =
  "https://utfs.io/f/Hzww9EQvYURJIfwMDCxfOewksxBoS1HQCihpL7c42Ky9uUFv";
export const IMG_BUILDING_BANK =
  "https://utfs.io/f/Hzww9EQvYURJEHFjuQLfKL5D7TAFe29bymSaPCIQ846MdzGg";
export const IMG_BUILDING_ARCHIVE =
  "https://utfs.io/f/Hzww9EQvYURJXk8AUJqIOpAoLKbZ4nW9Rsil2V67yuFwQhqv";
export const IMG_BUILDING_ADMINBUILDING =
  "https://utfs.io/f/Hzww9EQvYURJMyfWBKtsO4cexqW2RDgkE3zZbNXSFGitmnar";

export const IMG_ACTIONTIMER_BG =
  "https://utfs.io/f/Hzww9EQvYURJZNkUoDaYQrBIUTu69nkMxWmS4ah0O7LVCp8b";
export const IMG_ACTIONTIMER_YELLOW =
  "https://utfs.io/f/Hzww9EQvYURJXnRHYeqIOpAoLKbZ4nW9Rsil2V67yuFwQhqv";
export const IMG_ACTIONTIMER_RED =
  "https://utfs.io/f/Hzww9EQvYURJyrbex4ukVH2MI5Lo4ehEfAXvZdcmtWqPg7rp";
export const IMG_ACTIONTIMER_BLUE =
  "https://utfs.io/f/Hzww9EQvYURJqA6PRRdkOZgJQ8mGRcdx3SsWvPelyYFTt5Vn";
export const IMG_ACTIONTIMER_GREEN =
  "https://utfs.io/f/Hzww9EQvYURJwSFJxPT2j854CWbaITZyegfXimvd7s16cO0h";
export const IMG_ACTIONTIMER_OVERLAY =
  "https://utfs.io/f/Hzww9EQvYURJHVKSE4QvYURJhgs76VZtf9wxpMa13Cq0iOnr";

export const IMG_INITIATIVE_D20 =
  "https://utfs.io/f/Hzww9EQvYURJE7476GLfKL5D7TAFe29bymSaPCIQ846MdzGg";
export const IMG_BATTLEFIELD_TOMBSTONE =
  "https://utfs.io/f/Hzww9EQvYURJVVIq2fF2veAXohUuE59nTQHRJIYjtiG18aF4";
export const IMG_BATTLEFIELD_STAR =
  "https://utfs.io/f/Hzww9EQvYURJuGvcEjCyJLoOFkrcn4gxSwCfEQ9eMNXZlG8b";

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

import type { AttackMethods, AttackTargets } from "@/drizzle/constants";
import type { StatType, GeneralType, PoolType, ElementName } from "@/drizzle/constants";
import type { publicState } from "@/libs/combat/constants";
import type { StatNames, GenNames } from "@/libs/combat/constants";
import type {
  Jutsu,
  Item,
  ItemSlot,
  VillageAlliance,
  Clan,
  War,
  VillageStructure,
  Village,
  GameSetting,
  UserSkill,
  SkillTree,
  UserData,
  AiProfile,
  AnbuSquad,
  Bloodline,
  BloodlineReskin,
  UserJutsu,
  UserItem,
  UserItemImbuement,
  JutsuReskin,
  UserQuest,
  Bounty,
  BountySignup,
  Quest,
} from "@/drizzle/schema";
import type { CombatBiome } from "@/drizzle/constants";
import type { TerrainHex } from "@/libs/hexgrid";
import type { BattleType } from "@/drizzle/constants";
import type { QuestTrackerType } from "@/validators/objectives";
import type { Intersection, Object3D } from "three";
import type { ZodAllTags } from "@/validators/combat";

export type BattleWar = War & {
  warAllies: { villageId: string; supportVillageId: string }[];
  attackerVillage: { name: string; sector?: number } | null;
  defenderVillage: { name: string; sector?: number } | null;
};

/**
 * CombatQueryUserItem - Item type from DB query with relations
 */
export type CombatQueryUserItem = UserItem & {
  item: Item;
  imbuements: (UserItemImbuement & { item: Item })[];
};

/**
 * CombatQueryUserJutsu - Jutsu type from DB query with relations
 * Note: activeReskin is optional because not all queries include it
 */
export type CombatQueryUserJutsu = UserJutsu & {
  jutsu: Jutsu;
  activeReskin?: JutsuReskin | null;
};

/**
 * CombatQueryVillage - Village type from DB query with relations
 */
export type CombatQueryVillage = Village & {
  structures?: VillageStructure[];
  sectors?: { sector: number }[];
};

/**
 * CombatQueryUserSkill - Skill type from DB query with relations
 */
export type CombatQueryUserSkill = UserSkill & { skill: SkillTree };

/**
 * Partial bounty type matching the combat query columns select
 */
export type CombatQueryBounty = Pick<Bounty, "id" | "status" | "amountRyo">;

/**
 * Partial bounty signup type matching the combat query columns select
 */
export type CombatQueryBountySignup = Pick<BountySignup, "id" | "bountyId">;

/**
 * Partial completed quest type matching the combat query columns select.
 * Note: completed is always defined when queried (not undefined) because the column has a default.
 */
export type CombatQueryCompletedQuest = {
  id: string;
  questId: string;
  completed: number;
};

/**
 * CombatQueryUser - The exact shape of user data returned from the combat DB query.
 * This type matches the `client.query.userData.findMany` with combat relations.
 * Some fields are optional as they're not included in all combat queries (e.g., summons).
 */
export type CombatQueryUser = UserData & {
  bloodline: Bloodline | null;
  activeReskin?: BloodlineReskin | null; // For bloodline reskinning
  village: CombatQueryVillage | null;
  loadout?: { jutsuIds: string[] } | null;
  clan?: Clan | null;
  anbuSquad?: AnbuSquad | null;
  items: CombatQueryUserItem[];
  jutsus: CombatQueryUserJutsu[];
  userSkills: CombatQueryUserSkill[];
  userQuests?: UserQuest[]; // Full UserQuest with quest relation
  completedQuests?: CombatQueryCompletedQuest[];
  aiProfile: AiProfile | null;
  bounties?: CombatQueryBounty[];
  bountySignups?: CombatQueryBountySignup[];
};

/**
 * ProcessedJutsu - Jutsu with processing fields added
 */
export type ProcessedJutsu = CombatQueryUserJutsu & {
  lastUsedRound: number;
  originalCooldown: number;
};

/**
 * ProcessedItem - Item with processing fields added
 */
export type ProcessedItem = CombatQueryUserItem & {
  lastUsedRound: number;
  originalCooldown: number;
};

/**
 * Combat-specific fields added to users during battle processing.
 * Shared between ProcessingBattleUser and BattleUserState.
 */
export type CombatUserFields = {
  controllerId: string;
  direction: "left" | "right";
  isAggressor: boolean;
  highestOffence: (typeof StatNames)[number];
  highestDefence: (typeof StatNames)[number];
  highestGenerals: (typeof GenNames)[number][];
  round: number;
  iAmHere: boolean;
  originalLevel: number;
  originalMoney: number;
  originalLongitude: number;
  originalLatitude: number;
  actionPoints: number;
  isOriginal: boolean;
  usedGenerals: Record<(typeof GenNames)[number], number>;
  usedStats: Record<(typeof StatNames)[number], number>;
  leftBattle: boolean;
  fledBattle: boolean;
  moneyStolen: number;
  allyVillage: boolean;
  usedActions: { id: string; type: "jutsu" | "item" | "basic" | "bloodline" }[];
  initiative: number;
  basicActions: BattleBasicAction[];
  hex?: TerrainHex;
  hidden?: boolean;
  keystoneName?: string | null;
  // Reference IDs to static data in extraState
  relationIds: string[];
  warIds: string[];
  /** Base stat values used for additive percentage modifier calculations (e.g., increaseStat, decreaseStat) */
  baseStatsForModifiers?: {
    ninjutsuOffence?: number;
    ninjutsuDefence?: number;
    genjutsuOffence?: number;
    genjutsuDefence?: number;
    taijutsuOffence?: number;
    taijutsuDefence?: number;
    bukijutsuOffence?: number;
    bukijutsuDefence?: number;
    strength?: number;
    speed?: number;
    intelligence?: number;
    willpower?: number;
  };
  // Internal tracking for pool adjustment deltas (set/cleared by applyPoolAdjustmentsToBase)
  _prevHealthAdj?: number;
  _prevChakraAdj?: number;
  _prevStaminaAdj?: number;
};

/**
 * ProcessingBattleUser - Intermediate type during battle processing.
 * Has full relation objects for processing, converted to BattleUserState at end.
 */
export type ProcessingBattleUser = Omit<CombatQueryUser, "jutsus" | "items"> &
  Omit<CombatUserFields, "basicActions"> & {
    // Full objects needed during processing (not in final BattleUserState)
    relations?: VillageAlliance[];
    wars?: BattleWar[];
    keystoneItem?: Item | null;
    // Processed jutsus/items with full Jutsu/Item objects
    jutsus: ProcessedJutsu[];
    items: ProcessedItem[];
    // Full basic actions during processing (converted to BattleBasicAction[] in final state)
    basicActions: CombatAction[];
  };

/**
 * Cached raycaster intersections to avoid redundant calculations
 * Performance optimization: run raycaster.intersectObjects() once per frame
 * instead of 4+ times (once per highlight function)
 */
export type CachedIntersections = {
  tiles: Intersection<Object3D>[];
  battleTiles: Intersection<Object3D>[];
  ground: Intersection<Object3D>[];
};

/**
 * BattleUserJutsu - Reference type stored in BattleUserState.
 * Contains only dynamic combat state. Static jutsu data is in extraState.jutsus.
 * Use lookup functions to get full jutsu data.
 */
export type BattleUserJutsu = {
  id: string; // userJutsu.id
  jutsuId: string; // Reference to extraState.jutsus[jutsuId]
  level: number;
  equipped: boolean;
  experience: number;
  reskinId?: string | null; // Reference to extraState.jutsuReskins[reskinId]
  lastUsedRound: number;
  originalCooldown: number;
  origin?: "user" | "bloodline" | "injected";
};

/**
 * BattleUserItem - Reference type stored in BattleUserState.
 * Contains only dynamic combat state. Static item data is in extraState.items.
 * Use lookup functions to get full item data.
 */
export type BattleUserItem = {
  id: string; // userItem.id
  itemId: string; // Reference to extraState.items[itemId]
  quantity: number;
  equipped: ItemSlot;
  durability: number;
  dropChancePerc: number;
  lastUsedRound: number;
  originalCooldown: number;
};

/**
 * BattleBasicAction - Minimal tracking data for basic actions.
 * Full action definitions are regenerated via getDefaultBasicActions().
 * Only stores per-user dynamic state.
 */
export type BattleBasicAction = {
  id: string; // basicAttack, basicHeal, move, cleanse, clear, flee
  lastUsedRound: number;
  cooldown?: number; // Optional GCD override (only set when GCD is applied)
};

/**
 * BattleUserState - The user state stored in battle.usersState.
 * Contains ONLY references to static data, not full objects.
 * Use lookup functions (getJutsu, getItem, getVillage, etc.) to access full data.
 *
 * Based on UserData plus combat-specific fields.
 * Full relation objects (village, clan, bloodline, etc.) are stored in extraState and referenced by ID.
 */
export type BattleUserState = Omit<UserData, "questData"> &
  CombatUserFields & {
    // Reference jutsus/items (static data in extraState)
    jutsus: BattleUserJutsu[];
    items: BattleUserItem[];
    // Additional reference IDs to static data
    aiProfileId?: string | null; // Reference to extraState.aiProfiles[id]
    keystoneItemId?: string | null; // Reference to extraState.keystoneItems[id]
  };

/**
 * Basic actions are the actions that are available to a user by default
 * They are defined in the database, and can be modified by tags
 */
export type BasicActions = {
  basicAttack: CombatAction;
  basicHeal: CombatAction;
  basicMove: CombatAction;
  basicClear: CombatAction;
  basicCleanse: CombatAction;
  basicFlee: CombatAction;
};

/**
 * Extra battle state containing static data and battle settings.
 * Static data is stored once at battle initiation and looked up by ID.
 */
export type ExtraState = {
  // Static data - never changes during battle (looked up by ID)
  jutsus: Record<string, Jutsu>; // jutsuId -> Jutsu (includes user jutsus + injectable jutsus)
  jutsuReskins: Record<string, JutsuReskin>; // reskinId -> Reskin data
  items: Record<string, Item>; // itemId -> Item
  bloodlines: Record<string, Bloodline>; // bloodlineId -> Bloodline
  villages: Record<string, CombatQueryVillage>; // villageId -> Village
  anbuSquads: Record<string, AnbuSquad>; // anbuId -> AnbuSquad
  keystoneItems: Record<string, Item>; // itemId -> Item
  wars: Record<string, BattleWar>; // warId -> War
  aiProfiles: Record<string, AiProfile>; // aiProfileId or "Default" -> AiProfile
  relations: Record<string, VillageAlliance>; // relationId -> VillageAlliance
  clans: Record<string, Clan>; // clanId -> Clan
  // User-specific static data (keyed by controllerId)
  userQuests: Record<string, UserQuest[]>; // controllerId -> array of user quests
  completedQuests: Record<string, CombatQueryCompletedQuest[]>; // controllerId -> array of completed quest refs
  questData: Record<string, QuestTrackerType[]>; // controllerId -> array of quest trackers
  bounties: Record<string, CombatQueryBounty[]>; // controllerId -> array of bounties on this user
  bountySignups: Record<string, CombatQueryBountySignup[]>; // controllerId -> array of bounty signups
  // Battle settings
  settings?: GameSetting[];
  textureAssets?: string[];
  sfxAssets?: string[];
  initialDurability?: Record<string, Record<string, number>>; // userId -> userItemId -> durability
  // Raid-specific data
  raidQuestId?: string; // The quest ID for raid battles
  raidInitialBossHp?: number; // Initial boss HP at start of raid battle
  raidStartBattleCount?: Record<string, number>; // userId -> battleCount at battle start
  // Exclusive raids for SHRINE_WAR battles (pre-loaded at initiation)
  sectorExclusiveRaids?: Quest[];
};

// Create type for battle, which contains information on user current state
export type CompleteBattle = {
  usersState: BattleUserState[];
  usersEffects: UserEffect[];
  groundEffects: GroundEffect[];
  id: string;
  activeUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  roundStartAt: Date;
  background: CombatBiome;
  width: number;
  height: number;
  battleType: BattleType;
  version: number;
  round: number;
  rewardScaling: number;
  forceKeepPools: boolean;
  extraState: ExtraState;
};

/**
 * User state returned is masked to hide confidential information about other players
 */
export type ReturnedUserState = Pick<BattleUserState, (typeof publicState)[number]> &
  Partial<BattleUserState>;

/**
 * A returned battle used on frontend where private information is hidden
 */
export type ReturnedBattle = Omit<CompleteBattle, "usersState"> & {
  usersState: ReturnedUserState[];
};

/**
 * Dynamic battle state - only the fields that change during battle.
 * Used for efficient updates from performAction (excludes static extraState).
 */
export type BattleDynamicUpdate = Omit<CompleteBattle, "extraState">;

/**
 * Returned dynamic battle update with masked user state.
 * Used for performAction responses to avoid sending static extraState.
 */
export type ReturnedBattleDynamic = Omit<BattleDynamicUpdate, "usersState"> & {
  usersState: ReturnedUserState[];
};

export type DroppedItem = {
  itemId: string;
  name: string;
  userItemId: string;
  fromUserId: string;
};

/**
 * Result type for users when battle is ended
 */
export type CombatResult = {
  outcome: "Won" | "Lost" | "Draw" | "Fled";
  didWin: number;
  eloDiff: number;
  lpDiff: number;
  experience: number;
  earnedExperience: number;
  pvpStreak: number;
  curHealth: number;
  curStamina: number;
  curChakra: number;
  strength: number;
  intelligence: number;
  willpower: number;
  speed: number;
  money: number;
  seichiSilver: number;
  ninjutsuOffence: number;
  ninjutsuDefence: number;
  genjutsuOffence: number;
  genjutsuDefence: number;
  taijutsuOffence: number;
  taijutsuDefence: number;
  bukijutsuOffence: number;
  bukijutsuDefence: number;
  villagePrestige: number;
  friendsLeft: number;
  targetsLeft: number;
  villageTokens: number;
  anbuPoints: number;
  warHealthChange: number;
  shrineChangeHp: number;
  warHealthInfo: Record<string, number>;
  shrineInfo: Record<number, number>;
  villageWarShrineInfo: Record<string, { attacker: number; defender: number }>;
  villageWarShrineDisplay: Record<string, number>;
  clanPoints: number;
  notifications: string[];
  bountiesClaimed: { bountyId: string; hunterId: string; amountRyo: number }[];
  droppedItems: DroppedItem[];
};

export type CombatAction = {
  id: string;
  name: string;
  image: string;
  battleDescription: string;
  type: "basic" | "jutsu" | "item";
  target: (typeof AttackTargets)[number];
  method: (typeof AttackMethods)[number];
  range: number;
  healthCost: number;
  chakraCost: number;
  staminaCost: number;
  actionCostPerc: number;
  updatedAt: number;
  cooldown: number;
  originalCooldown: number;
  effects: ZodAllTags[];
  lastUsedRound?: number;
  data?: Jutsu | Item;
  level?: number;
  quantity?: number;
  hidden?: boolean;
  durability?: number;
  maxDurability?: number;
};

export interface BattleState {
  battle?: ReturnedBattle | null | undefined;
  result: CombatResult | null | undefined;
  isPending: boolean;
}

/**
 * Battle Consequence, i.e. the permanent things that happen to a user as a result of an action
 */
export type Consequence = {
  userId: string;
  targetId: string;
  heal_hp?: number;
  heal_sp?: number;
  heal_cp?: number;
  damage?: number;
  rawDamage?: number;
  residual?: number;
  rawResidual?: number;
  /** Base damage value used for additive percentage modifier calculations (e.g., increaseDamageGiven) */
  baseDamageForModifiers?: number;
  /** Base damage after Stage 1 (equipment/pre-battle) modifiers are applied */
  baseDamageAfterStage1?: number;
  wound?: number;
  reflect?: number;
  recoil?: number;
  afterburn?: number;
  lifesteal_hp?: number;
  absorb_hp?: number;
  absorb_sp?: number;
  absorb_cp?: number;
  drain_hp?: number;
  drain_cp?: number;
  drain_sp?: number;
  poison?: number;
  preShieldDamage?: number;
  types?: (GeneralType | StatType | ElementName | PoolType | ZodAllTags["type"])[];
};

/**
 * Realized tag, i.e. these are the tags that are actually inserted in battle, with
 * reference information added to the tag (i.e. how powerful was the effect)
 */
export type BattleEffect = ZodAllTags & {
  id: string;
  creatorId: string;
  level: number;
  isNew: boolean;
  castThisRound: boolean;
  createdRound: number;
  villageId?: string | null;
  targetType?: "user" | "barrier";
  power?: number;
  highestOffence?: (typeof StatNames)[number];
  highestDefence?: (typeof StatNames)[number];
  highestGenerals?: (typeof GenNames)[number][];
  targetHighestOffence?: (typeof StatNames)[number];
  targetHighestDefence?: (typeof StatNames)[number];
  targetHighestGenerals?: (typeof GenNames)[number][];
  longitude: number;
  latitude: number;
  barrierAbsorb: number;
  actionId: string;
};

export type GroundEffect = BattleEffect;

export type UserEffect = BattleEffect & {
  targetId: string;
  fromEffectId?: string;
  fromGround?: boolean;
  fromType?:
    | "jutsu"
    | "armor"
    | "item"
    | "basic"
    | "bloodline"
    | "village"
    | "skill"
    | "ranked";
  elements?: ElementName[];
  cpSpent?: number;
  spSpent?: number;
};

export type ActionEffect = {
  txt: string;
  color: "red" | "green" | "blue" | "yellow" | "purple" | "orange" | "pink" | "gray";
  types?: (GeneralType | StatType | ElementName | PoolType | ZodAllTags["type"])[];
};

import type { Intersection, Object3D } from "three";
import type {
  AttackMethods,
  AttackTargets,
  BattleType,
  CombatBiome,
  ElementName,
  GeneralType,
  MasteryName,
  MasteryType,
  PoolType,
  StatType,
} from "@/drizzle/constants";
import type {
  AiProfile,
  AnbuSquad,
  Bloodline,
  BloodlineReskin,
  Bounty,
  BountySignup,
  Clan,
  GameSetting,
  Item,
  ItemSlot,
  ItemVariant,
  Jutsu,
  JutsuReskin,
  Quest,
  SageMode,
  SkillTree,
  UserData,
  UserItem,
  UserItemImbuement,
  UserJutsu,
  UserQuest,
  UserSkill,
  Village,
  VillageAlliance,
  VillageStructure,
  War,
  WarCamp,
} from "@/drizzle/schema";
import type { GenNames, publicState, StatNames } from "@/libs/combat/constants";
import type { TerrainHex } from "@/libs/hexgrid";
import type { ActivityCompletions } from "@/server/utils/achievementObjectives";
import type { EffectType, ZodAllTags } from "@/validators/combat";
import type { CoordinateTargeting } from "@/validators/coordinateTargeting";
import type { MethodSize } from "@/validators/methodSize";
import type { QuestTrackerType } from "@/validators/objectives";
import type { DmgConfig } from "./constants";
import type { CombatCacheSnapshot, CombatProfileUpdate } from "./userCache";

export type BattleWar = War & {
  mercenaryWarIds?: Record<string, string>;
  warMercenaries?: { userId: string; sideVillageId: string }[];
  warAllies: { villageId: string; supportVillageId: string }[];
  attackerVillage: { name: string; sector?: number } | null;
  defenderVillage: { name: string; sector?: number } | null;
};

/**
 * CombatQueryUserItem - Item type from DB query with relations
 */
export type CombatQueryUserItem = UserItem & {
  item: Item & { variants?: ItemVariant[] };
  imbuements: (UserItemImbuement & { item: Item })[];
  /** Real UserItem row backing a synthetic forced-loadout entry (XP is credited to it). */
  progressionRowId?: string | null;
  /** Effects of this row's imbuements, carried when it is rebuilt from battle state. */
  imbuementEffects?: UserEffect[];
};

/**
 * CombatQueryUserJutsu - Jutsu type from DB query with relations
 * Note: activeReskin is optional because not all queries include it
 */
export type CombatQueryUserJutsu = UserJutsu & {
  jutsu: Jutsu;
  linkedReskin?: Jutsu | null;
  activeReskin?: JutsuReskin | null;
};

/**
 * CombatQueryVillage - Village type from DB query with relations
 */
export type CombatQueryVillage = Village & {
  structures?: VillageStructure[];
  sectors?: { sector: number; shrineLevel?: number; boostLockedUntil?: Date | null }[];
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
  questType?: Quest["questType"];
  previousCompletes?: number;
};

/**
 * CombatQueryUser - The exact shape of user data returned from the combat DB query.
 * This type matches the `client.query.userData.findMany` with combat relations.
 * Some fields are optional as they're not included in all combat queries (e.g., summons).
 */
export type CombatQueryUser = UserData &
  ActivityCompletions & {
    titles?: import("@/drizzle/schema").UserTitle[];
    /** Loaded at initiation and realized into battle effects; never fetched during an action. */
    raidBuffs?: import("@/drizzle/schema").UserRaidBuff[];
    /** Completion receipts loaded only for settlement before entering combat. */
    cookingJobs?: { id: string; experience: number; finishesAt: Date }[];
    bloodline: (Bloodline & { bloodrightTiers?: SkillTree[] }) | null;
    activeReskin?: BloodlineReskin | null; // For bloodline reskinning
    sageMode?: SageMode | null; // Sage mode (must be manually activated)
    // Present when processUsersForBattle is re-run from live BattleUserState
    sageModeActivated?: boolean;
    sageModeActivatedRound?: number | null;
    sageModeExpiresRound?: number | null;
    sageModeUsedThisBattle?: boolean;
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
  /** Identity masking captured with the combatant's battle snapshot. */
  isMasked?: boolean;
  /** Damage already deferred by Diffuse; survives the granting effect's expiry. */
  diffuseDamage?: {
    attackerId: string;
    /** Original damage actor; absent for recoil or debts without threat attribution. */
    enmityUserId?: string;
    /** Actual caster, retained separately from controller quest credit. */
    sourceUserId?: string;
    remainingDamage: number;
    remainingTurns: number;
    lastAppliedRound: number;
    creditDamage: boolean;
  }[];
  controllerId: string;
  /** Fixed battle team, assigned at initiation and inherited by summons/clones. */
  direction: "left" | "right";
  isAggressor: boolean;
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
  usedMasteries?: Partial<Record<MasteryName, number>>;
  usedStats: Record<(typeof StatNames)[number], number>;
  leftBattle: boolean;
  fledBattle: boolean;
  /** This participant reserved the village/side's PvP mission credit at settlement. */
  villageMissionPvpCredited?: boolean;
  moneyStolen: number;
  allyVillage: boolean;
  /** One entry per successful action, including repeated casts; serialized for end-of-battle quest progress. */
  usedActions: {
    id: string;
    type: "jutsu" | "item" | "basic" | "bloodline";
    /** Catalog disciplines captured at cast time so settlement needs no content query. */
    masteryTypes?: MasteryType[];
  }[];
  /** Distinct tag types the user applied this battle (for tag_usage_win tracker). Array not Set — serializes to JSON. */
  usedTagTypes: EffectType[];
  /** Enemy-targeted skill and bloodright sources preloaded for on-action application. */
  enemySkillIds?: string[];
  pvpBoostPercent?: number;
  /** Activated skills captured at initiation for use gates, including injected jutsu. */
  activeSkillIds?: string[];
  /** Catalog jutsu blocked by skill requirements for the controller's action prediction. */
  skillLockedJutsuIds?: string[];
  /** Total damage this user dealt to opponents this battle (for damage_dealt tracker). */
  damageDealt: number;
  /** Battle-wide threat score used by authored AI targeting rules. */
  enmity?: number;
  initiative: number;
  basicActions: BattleBasicAction[];
  hex?: TerrainHex;
  hidden?: boolean;
  keystoneName?: string | null;
  /**
   * Transient: true only while a human player is piloting this summon (set in summon()).
   * isAi deliberately stays true so reward attribution, drop tables, and AI-path action
   * processing keep working — isPiloted is strictly a turn-routing / UI signal, never an
   * accounting/identity reclassification.
   */
  isPiloted?: boolean;
  /**
   * True while this human player has handed their turns to their own AI profile
   * (auto combat). The mirror image of isPiloted: isAi stays false so rewards,
   * result calculation, and DB write-back treat them as a normal player —
   * strictly a turn-routing / UI signal.
   */
  isAutoCombat?: boolean;
  /** Transient: true only for the hidden clone-source summon template. Set at
   *  load, cleared on spawn/clone. Server-internal — not in publicState. */
  isSummonTemplate?: boolean;
  /** Transient: the aiId of the creature this summon was spawned from. Set at
   *  spawn, because the spawn rebinds controllerId to its summoner and would
   *  otherwise lose all trace of which creature it is. Server-internal. */
  summonSourceId?: string;
  /** Persistent identity of an owned pet; the battlefield userId remains transient. */
  petId?: string;
  /** Frozen species identity for validating companion jutsu, including injected actions. */
  petSpeciesId?: string;
  // Reference IDs to static data in extraState
  relationIds: string[];
  /** Base stat values used for additive percentage modifier calculations (e.g., increaseStat, decreaseStat) */
  baseStatsForModifiers?: {
    offence?: number;
    defence?: number;
    ninjutsuMastery?: number;
    genjutsuMastery?: number;
    taijutsuMastery?: number;
    bukijutsuMastery?: number;
    bloodlineMastery?: number;
    sageMastery?: number;
    strength?: number;
    speed?: number;
    intelligence?: number;
    willpower?: number;
  };
  // Internal tracking for pool adjustment deltas (set/cleared by applyPoolAdjustmentsToBase)
  _prevHealthAdj?: number;
  _prevChakraAdj?: number;
  _prevStaminaAdj?: number;
  // Sage mode (battle-only; mirrored on BattleUserState)
  sageModeActivated?: boolean;
  sageModeActivatedRound?: number | null;
  sageModeExpiresRound?: number | null;
  /** Set when sage mode has been entered this battle; never cleared until battle ends */
  sageModeUsedThisBattle?: boolean;
};

/**
 * ProcessingBattleUser - Intermediate type during battle processing.
 * Has full relation objects for processing, converted to BattleUserState at end.
 */
export type ProcessingBattleUser = Omit<CombatQueryUser, "jutsus" | "items"> &
  Omit<CombatUserFields, "basicActions"> & {
    // Full objects needed during processing (not in final BattleUserState)
    relations?: VillageAlliance[];
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
  users?: Intersection<Object3D>[];
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
  linkedReskinId?: string | null; // Cosmetic variant in extraState.jutsus
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
  id: string; // userItem.id (synthetic for forced loadouts)
  itemId: string; // Reference to extraState.items[itemId]
  /** Real UserItem row for forced-loadout entries; XP grants target this id. */
  progressionRowId?: string | null;
  quantity: number;
  level: number;
  experience: number;
  equipped: ItemSlot;
  durability: number;
  dropChancePerc: number;
  lastUsedRound: number;
  originalCooldown: number;
  /**
   * Effects of this row's own imbuements. Kept per user item because
   * extraState.items is shared by every participant wearing the same template.
   */
  imbuementEffects?: UserEffect[];
  activeVariantId?: string | null; // which variant is active (if any)
  variantBattleDescription?: string | null; // pre-resolved from variant at battle init
  variantImage?: string | null; // pre-resolved from variant at battle init
  variantName?: string | null; // pre-resolved from variant at battle init
};

/**
 * BattleBasicAction - Minimal tracking data for basic actions.
 * Full action definitions are regenerated via getDefaultBasicActions().
 * Only stores per-user dynamic state.
 */
export type BattleBasicAction = {
  id: string; // basicAttack, offensiveStance, defensiveStance, basicHeal, meditate, move, replacementTechnique, cleanse, clear, flee
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
  ActivityCompletions &
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
  basicOffensiveStance: CombatAction;
  basicDefensiveStance: CombatAction;
  basicHeal: CombatAction;
  basicMeditate: CombatAction;
  basicMove: CombatAction;
  basicReplacementTechnique: CombatAction;
  basicClear: CombatAction;
  basicCleanse: CombatAction;
  basicFlee: CombatAction;
};

/** Per-user pre-battle armor/accessory/keystone % damage mods (percentage points). */
export type PreBattleGearModifiers = {
  incDamageGivenFromGear: number;
  incDamageTakenFromGear: number;
  drTakenFromGear: number;
  drGivenFromGear: number;
  incDamageGivenFromKeystone: number;
  incDamageTakenFromKeystone: number;
  drTakenFromKeystone: number;
  drGivenFromKeystone: number;
};

/**
 * Extra battle state containing static data and battle settings.
 * Static data is stored once at battle initiation and looked up by ID.
 */
export type ExtraState = {
  hunting?: import("@/validators/hunting").HuntingBattleState;
  /** Durable scheduled defense and tenure; settlement never needs another fetch. */
  kageMatch?: {
    id: string;
    villageId: string;
    kageId: string;
    tenure: string;
    /** Fixed by both participants' consent at launch; cannot be toggled during the battle. */
    ai: boolean;
  };
  /** Staff-event game identity; combat preloads it so settlement never fetches tournament data. */
  tournamentGameId?: string;
  /** Event AI rules cannot be disabled by participants. */
  tournamentAiOnly?: boolean;
  /** Preloaded enemy waves shared by authored co-op encounters. */
  encounter?: import("@/libs/combat/encounters").EncounterWaveState;
  /** Private run/wave snapshot used by combat actions and atomic party settlement. */
  dungeon?: import("@/libs/dungeon").DungeonBattleState;
  /** Encounter snapshot for strategic settlement without an intermediate combat read. */
  warCamp?: WarCamp;
  /** Private event/competitor snapshot frozen at initiation for write-only strategic settlement. */
  territoryWar?: import("@/libs/territoryWar").TerritoryBattleState;
  /** Definitions of publicly performed actions, retained after their caster despawns. */
  revealedActions?: { jutsuIds: string[]; itemIds: string[] };
  /** Persisted, unscaled player state for confirmed completion responses; never sent to opponents. */
  profileCacheSnapshots?: Record<string, CombatCacheSnapshot>;
  /** Repeated-opponent eligibility captured before inserting this battle. */
  energyRewardEligible?: boolean;
  /** Human shrine PvP XP scales independently of strategic shrine rewards. */
  pvpExperienceScaling?: number;
  energyCapacity?: Record<string, number>;
  energyRegeneration?: Record<string, number>;
  /** Preloaded timed bonuses for fractional Energy settlement and the matching client cache. */
  energyRegenerationPeriods?: Record<
    string,
    import("@/libs/timedBuffs").RegenerationPeriod[]
  >;
  /** Accompanying pet identities frozen at initiation, including pets that later retreat. */
  petIdsByOwner?: Record<string, string>;
  // Static data - never changes during battle (looked up by ID)
  jutsus: Record<string, Jutsu>; // jutsuId -> Jutsu (includes user jutsus + injectable jutsus)
  jutsuReskins: Record<string, JutsuReskin>; // reskinId -> Reskin data
  items: Record<string, Item>; // itemId -> Item
  bloodlines: Record<string, Bloodline>; // bloodlineId -> Bloodline
  enemySkills?: Record<string, ZodAllTags[]>; // skillId -> on-action effect templates
  sageModes: Record<string, SageMode>; // sageModeId -> SageMode
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
  dmgConfig?: DmgConfig;
  /** Per-user pre-battle gear/keystone % mods folded into the damage pipeline at battle start. */
  preBattleGearModifiers?: Record<string, PreBattleGearModifiers>;
  settings?: GameSetting[];
  initialDurability?: Record<string, Record<string, number>>; // userId -> userItemId -> durability
  /** Owning quest/objective; ticketed or versioned runs ignore kills from unrelated battles. */
  questBattleSource?: { questId: string; objectiveId: string };
  // Raid-specific data
  raidQuestId?: string; // The quest ID for raid battles
  raidInitialBossHp?: number; // Initial boss HP at start of raid battle
  raidStartBattleCount?: Record<string, number>; // userId -> battleCount at battle start
  // Exclusive raids for SHRINE_WAR battles (pre-loaded at initiation)
  sectorExclusiveRaids?: Quest[];
  // Ranked PvP: top Legend LP values for Sannin determination (loaded at initiation)
  topPlayersLP?: number[];
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
export type ReturnedExtraState = Omit<
  ExtraState,
  "villages" | "clans" | "dungeon" | "encounter"
> & {
  encounter?: Pick<import("@/libs/combat/encounters").EncounterWaveState, "wave">;
  /** Public progress only; authored future enemies and their loadouts stay server-side. */
  dungeon?: Pick<import("@/libs/dungeon").DungeonBattleState, "runId" | "expiresAt">;
  villages: Record<string, Pick<CombatQueryVillage, "id" | "hexColor">>;
  clans: Record<string, Pick<Clan, "id" | "image">>;
  textureAssets?: string[];
  sfxAssets?: string[];
};

export type ReturnedBattle = Omit<CompleteBattle, "usersState" | "extraState"> & {
  usersState: ReturnedUserState[];
  extraState: ReturnedExtraState;
};

/** Minimal battle context for per-round effect logic (e.g. castThisRound). */
export type BattleRoundContext = Pick<ReturnedBattle, "round">;

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
  hunting?: import("@/validators/hunting").HuntingReceipt;
  pvpExperience?: number;
  weeklyPvpKills?: number;
  profileUpdate?: CombatProfileUpdate;
  /** Shared kills reserved by the successful battle version claim. */
  villageMissionPvpKills?: number;
  energyReward?: number;
  masteryGains?: Partial<Record<MasteryName, number>>;
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
  offence: number;
  defence: number;
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
  coordinateTargeting?: CoordinateTargeting | null;
  methodSize?: MethodSize | null;
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

export type EnmityDamageKey =
  | "damage"
  | "residual"
  | "wound"
  | "afterburn"
  | "drain_hp"
  | "poison";

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
  wound?: number;
  reflect?: number;
  recoil?: number;
  afterburn?: number;
  /** Post-mitigation source hit before Diffuse, retained for Reflect's cap. */
  preDiffuseDamage?: number;
  /** Immediate damage eligible for defenses after a Diffuse split, before shields. */
  diffuseImmediateDamage?: number;
  diffuseSourceEffectId?: string;
  /** Returned damage normalized onto its recipient after Diffuse; excluded from quest credit. */
  damageSource?: "reflect" | "recoil";
  /** Post-defense contributions retained independently of target-level damage aggregation. */
  enmitySources?: Pick<Consequence, "userId" | EnmityDamageKey>[];
  lifesteal_hp?: number;
  vampRatio?: number;
  vampHeal?: number;
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

/** Outgoing Consume and incoming Siphon share conversion and per-action shield HP caps. */
export type ShieldConversionsByUser = Map<
  string,
  {
    ratio: number;
    shields: {
      type: "consume" | "siphon";
      ratio: number;
      hp: number;
      rounds: number;
    }[];
  }
>;

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
  fromType?:
    | "jutsu"
    | "armor"
    | "accessory"
    | "keystone"
    | "item"
    | "basic"
    | "bloodline"
    | "village"
    | "skill"
    | "ranked"
    | "sageMode"
    | "sageModeAfter"
    | "elementalMastery"
    | "quest";
  targetType?: "user" | "barrier";
  power?: number;
  highestGenerals?: (typeof GenNames)[number][];
  targetHighestGenerals?: (typeof GenNames)[number][];
  longitude: number;
  latitude: number;
  barrierAbsorb: number;
  actionId: string;
  /**
   * Summon effects only: the in-battle userId of the creature this effect
   * spawned, recorded at spawn so teardown removes exactly that summon. Runtime
   * state, not part of SummonTag — aiId stays pointed at the clone-source
   * template so a re-cast can still find it.
   */
  summonedUserId?: string;
};

export type GroundEffect = BattleEffect;

export type UserEffect = BattleEffect & {
  /** Absolute expiry in milliseconds; independent of the battle's round counter. */
  timedBuffExpiresAt?: number;
  targetId: string;
  fromEffectId?: string;
  fromGround?: boolean;
  elements?: ElementName[];
  cpSpent?: number;
  spSpent?: number;
};

export type ActionEffect = {
  txt: string;
  color: "red" | "green" | "blue" | "yellow" | "purple" | "orange" | "pink" | "gray";
  types?: (GeneralType | StatType | ElementName | PoolType | ZodAllTags["type"])[];
};

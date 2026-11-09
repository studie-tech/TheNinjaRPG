import type { Grid } from "honeycomb-grid";
import type {
  AvatarFacing,
  BattleType,
  CombatStatType,
  ElementName,
  PoolType,
  StatType,
} from "@/drizzle/constants";
import {
  AutoBattleTypes,
  BATTLE_TAG_STACKING,
  CombatStatTypes,
  DURABILITY_USABILITY_THR,
  isPreBattleGearFromType,
  NO_DURABILITY_LOSS_COMBATS,
  PoolTypes,
  PRE_BATTLE_SOURCE_TYPES,
} from "@/drizzle/constants";
import { areBattleAllies } from "@/libs/combat/participants";
import { getEffectPower } from "@/libs/combat/power";
import { getTargetTiles } from "@/libs/combat/targeting";
import type { BattleEffect, GroundEffect, UserEffect } from "@/libs/combat/types";
import type { PathCalculator, TerrainHex } from "@/libs/hexgrid";
import { createHexGrid, nameArenaTile, oddQHexDistance } from "@/libs/hexgrid";
import { randomInt, secureRandomInt } from "@/utils/math";
import type { EffectType, ZodAllTags } from "@/validators/combat";
import { stillInBattle } from "./actions";
import type { GenName } from "./constants";
import {
  BARRIER_DAMAGE_TAG_TYPES,
  damageDerivedTagTypes,
  damageModifierTypes,
  GenNames,
  POST_PIERCE_TAGS,
} from "./constants";
import type {
  BattleRoundContext,
  BattleUserState,
  CombatAction,
  CompleteBattle,
  Consequence,
  ExtraState,
  ReturnedBattle,
  ReturnedUserState,
} from "./types";

// =============================================================================
// STATIC DATA LOOKUP FUNCTIONS
// These functions retrieve full data from extraState using IDs.
// Use these whenever you need the full object instead of just the reference.
// =============================================================================

/**
 * Get full Jutsu data from extraState by jutsuId
 */
export const getJutsu = (battle: CompleteBattle | ReturnedBattle, jutsuId: string) => {
  return battle.extraState.jutsus?.[jutsuId];
};

/**
 * Get jutsu reskin data from extraState by reskinId
 */
export const getJutsuReskin = (
  battle: CompleteBattle | ReturnedBattle,
  reskinId: string | null | undefined,
) => {
  if (!reskinId) return undefined;
  return battle.extraState.jutsuReskins?.[reskinId];
};

/**
 * Get full Item data from extraState by itemId
 */
/** Wear an item down, unequipping it at the usability floor, in battles with durability loss. */
export const wearBattleItem = (
  battle: CompleteBattle,
  userItem: Pick<BattleUserState["items"][number], "durability" | "equipped">,
  item: { maxDurability: number },
  amount: number,
) => {
  if (NO_DURABILITY_LOSS_COMBATS.includes(battle.battleType)) return;
  const currentDurability = Math.min(userItem.durability, item.maxDurability);
  userItem.durability = Math.max(0, currentDurability - amount);
  if (userItem.durability <= DURABILITY_USABILITY_THR) {
    userItem.equipped = "NONE";
  }
};

export const getItem = (battle: CompleteBattle | ReturnedBattle, itemId: string) => {
  return battle.extraState.items?.[itemId];
};

/**
 * Get full Village data from extraState by villageId
 */
export const getVillage = <T extends CompleteBattle | ReturnedBattle>(
  battle: T,
  villageId: string | null | undefined,
): T["extraState"]["villages"][string] | undefined => {
  if (!villageId) return undefined;
  return battle.extraState.villages?.[villageId] as
    | T["extraState"]["villages"][string]
    | undefined;
};

/**
 * Get Clan data from extraState by clanId
 */
export const getClan = <T extends CompleteBattle | ReturnedBattle>(
  battle: T,
  clanId: string | null | undefined,
): T["extraState"]["clans"][string] | undefined => {
  if (!clanId) return undefined;
  return battle.extraState.clans?.[clanId] as
    | T["extraState"]["clans"][string]
    | undefined;
};

/**
 * Get Bloodline data from extraState by bloodlineId
 */
export const getBloodline = (
  battle: CompleteBattle | ReturnedBattle,
  bloodlineId: string | null | undefined,
) => {
  if (!bloodlineId) return undefined;
  return battle.extraState.bloodlines?.[bloodlineId];
};

/**
 * The static lookup maps processUsersForBattle fills from its participants (and the
 * summon templates it loads alongside them). Any caller merging one processed
 * extraState into another must carry all of them: a summon template whose
 * aiProfile or bloodline is dropped still spawns, but then has no rules to act on.
 */
const STATIC_EXTRA_STATE_KEYS = [
  "jutsus",
  "jutsuReskins",
  "items",
  "bloodlines",
  "enemySkills",
  "sageModes",
  "villages",
  "anbuSquads",
  "keystoneItems",
  "wars",
  "aiProfiles",
  "relations",
  "clans",
] as const satisfies readonly (keyof ExtraState)[];

/**
 * Copy every static lookup map from `source` into `target`, initializing missing
 * maps on `target`. Entries in `source` win on key collisions. Per-user and
 * battle-specific fields (quests, preBattleGearModifiers, ...) are left alone.
 */
export const mergeExtraState = (
  target: Partial<ExtraState>,
  source: Partial<ExtraState> | null | undefined,
) => {
  if (!source) return target;
  for (const key of STATIC_EXTRA_STATE_KEYS) {
    const entries = source[key];
    if (!entries) continue;
    target[key] ??= {};
    Object.assign(target[key] as Record<string, unknown>, entries);
  }
  return target;
};

/**
 * Get AiProfile from extraState by aiProfileId
 */
export const getAiProfile = (
  battle: CompleteBattle | ReturnedBattle,
  aiProfileId: string | null | undefined,
) => {
  if (!aiProfileId) return undefined;
  return battle.extraState.aiProfiles?.[aiProfileId];
};

/**
 * Get keystone Item from extraState by keystoneItemId
 */
export const getKeystoneItem = (
  battle: CompleteBattle | ReturnedBattle,
  keystoneItemId: string | null | undefined,
) => {
  if (!keystoneItemId) return undefined;
  return battle.extraState.keystoneItems?.[keystoneItemId];
};

/**
 * Get user quests from extraState for a user
 */
export const getUserQuestsFromBattle = (
  battle: CompleteBattle | ReturnedBattle,
  controllerId: string,
) => {
  return battle.extraState.userQuests?.[controllerId] ?? [];
};

/**
 * Get completed quests from extraState for a user
 */
export const getCompletedQuestsFromBattle = (
  battle: CompleteBattle | ReturnedBattle,
  controllerId: string,
) => {
  return battle.extraState.completedQuests?.[controllerId] ?? [];
};

/**
 * Get questData (quest progress trackers) from extraState for a user
 */
export const getQuestDataFromBattle = (
  battle: CompleteBattle | ReturnedBattle,
  controllerId: string,
) => {
  return battle.extraState.questData?.[controllerId] ?? [];
};

/** Row columns of a UserItem that only matter outside battle, for rows rebuilt in memory. */
export const inertUserItemColumns = (userId: string, at: Date) => ({
  userId,
  createdAt: at,
  updatedAt: at,
  storedAtHome: false,
  homeX: null,
  homeY: null,
  homeRotation: 0,
  homeRoom: "main" as const,
  craftingFinishedAt: null,
  isInAuction: false,
});

/**
 * True when `target` is a real opponent of `attacker` for damage tracking: a different user
 * (not self), not a summon, and on the opposing side (direction differs). Used by both
 * damage_dealt accumulation in process.ts and creatures_hunted counting in buildCombatTrackerTasks
 * so that both trackers agree on what constitutes a "real opponent".
 */
export const isOpponentDamageTarget = (
  attacker: BattleUserState,
  target: BattleUserState,
): boolean =>
  target.userId !== attacker.userId &&
  !target.isSummon &&
  target.direction !== attacker.direction;

/**
 * Resolves which user is credited with damage for the damage_dealt tracker: summons and
 * clones credit their controller — matching creatures_hunted, which already credits kills
 * a summon secures to the summoner — while everyone else credits themselves. Falls back
 * to the attacker when the controller is not in the battle state. Known narrow edge:
 * damage a summon deals in rounds after its controller's own battle result has already
 * been persisted (controller died/fled while the summon lingers) accumulates in battle
 * state but no longer reaches that controller's quest trackers.
 */
export const resolveDamageCreditUser = (
  usersState: BattleUserState[],
  attacker: BattleUserState,
): BattleUserState =>
  attacker.isSummon
    ? (usersState.find((u) => u.userId === attacker.controllerId) ?? attacker)
    : attacker;

/**
 * Credits `amount` of damage to `attacker.damageDealt` for the damage_dealt quest tracker,
 * but only for positive damage to a real opponent (isOpponentDamageTarget). Single point of
 * maintenance for every damage source in process.ts (direct damage plus each DoT/drain
 * branch) so that adding a new damage type can't silently skip the tracker.
 */
export const creditDamageDealt = (
  attacker: BattleUserState,
  target: BattleUserState,
  amount: number,
): void => {
  if (amount > 0 && isOpponentDamageTarget(attacker, target)) {
    attacker.damageDealt += amount;
  }
};

/**
 * Records an applied effect tag on the crediting user's `usedTagTypes` for the `tag_usage_win`
 * tracker. Summons/clones credit their controller (resolveDamageCreditUser), matching
 * damage_dealt; everyone else credits themselves. Deduped so a tag re-applied across rounds
 * counts once. Both write
 * sites in process.ts (the resolution branch and the damage-modifier loop) share this helper so
 * they agree on what "applied" means.
 */
export const recordUsedTag = (
  usersState: BattleUserState[],
  caster: BattleUserState,
  tagType: EffectType,
): void => {
  const creditUser = resolveDamageCreditUser(usersState, caster);
  if (!creditUser.usedTagTypes.includes(tagType)) {
    creditUser.usedTagTypes.push(tagType);
  }
};

/**
 * Pool property key mappings
 */
type PoolMaxKey = "maxHealth" | "maxChakra" | "maxStamina";
type PoolCurKey = "curHealth" | "curChakra" | "curStamina";

/**
 * Get the max and cur property keys for a given pool type
 */
export const getPoolKeys = (pool: PoolType): { max: PoolMaxKey; cur: PoolCurKey } => {
  switch (pool) {
    case "Health":
      return { max: "maxHealth", cur: "curHealth" };
    case "Chakra":
      return { max: "maxChakra", cur: "curChakra" };
    case "Stamina":
      return { max: "maxStamina", cur: "curStamina" };
  }
};

/**
 * Get the pools affected from an effect, defaulting to ["Health"]
 */
export const getPoolsAffected = (
  effect: { poolsAffected?: PoolType[] } | UserEffect,
): PoolType[] => {
  if (
    "poolsAffected" in effect &&
    effect.poolsAffected &&
    effect.poolsAffected.length > 0
  ) {
    return effect.poolsAffected.filter((pool) => pool !== "Energy") as PoolType[];
  }
  return ["Health"];
};

/**
 * Calculate total pool adjustment from active increasemaxpools/decreasemaxpools effects.
 * This is a pure calculation - no mutation occurs.
 * If no effects are provided, returns 0 (no adjustment).
 */
const getPoolAdjustment = (
  user: ReturnedUserState,
  effects: UserEffect[] | undefined,
  pool: PoolType,
): number => {
  if (!effects || effects.length === 0) return 0;

  const { max } = getPoolKeys(pool);
  const baseMax = user[max];
  let adjustment = 0;

  effects
    .filter((e) => e.targetId === user.userId && isEffectEnabled(e, effects))
    .forEach((e) => {
      if (e.type === "increasemaxpools" || e.type === "decreasemaxpools") {
        const pools = getPoolsAffected(e);
        if (pools.includes(pool)) {
          const power = getEffectPower(e);
          const amount =
            e.calculation === "percentage"
              ? Math.floor((power / 100) * baseMax)
              : power;
          const effectAdjustment = e.type === "increasemaxpools" ? amount : -amount;
          adjustment += effectAdjustment;
        }
      }
    });

  return adjustment;
};

/**
 * Get effective max pool value (base + adjustments from active effects).
 * Use this wherever you need to display or use max pool values in combat.
 * If no effects are provided, returns the base max pool value.
 *
 * Invariant: user.max* always represents the original base value (never mutated).
 * Effective = base + getPoolAdjustment()
 */
export const getEffectiveMaxPool = (
  user: ReturnedUserState,
  effects: UserEffect[] | undefined,
  pool: PoolType,
): number => {
  const { max } = getPoolKeys(pool);
  // user[max] is always the original base value (never mutated by pool adjustments)
  const adjustment = getPoolAdjustment(user, effects, pool);
  return Math.max(1, user[max] + adjustment);
};

/**
 * Get effective current pool value.
 * Use this wherever you need to display or use current pool values in combat.
 *
 * Note: Current pool values are directly mutated by applyPoolAdjustmentsToBase,
 * so we return user[cur] directly. The adjustment has already been applied to
 * the stored value. We don't clamp to effectiveMax because the backend handles
 * this correctly - clamping here would cause display issues when effects expire
 * if there's any timing mismatch between curHealth and effects updates.
 */
export const getEffectiveCurPool = (
  user: ReturnedUserState,
  pool: PoolType,
): number => {
  const { cur } = getPoolKeys(pool);
  // Current value is already adjusted by applyPoolAdjustmentsToBase
  return Math.max(0, user[cur]);
};

/**
 * Apply pool adjustments to current values using delta-adjustment model.
 *
 * Delta-adjustment model:
 * - Max pool values (maxHealth, maxChakra, maxStamina) are NEVER mutated
 * - They always represent the original base values
 * - Frontend uses getEffectiveMaxPool() to calculate display max (base + adjustment)
 * - Only current values are adjusted by the delta between previous and next adjustments
 *
 * Applying the adjustment to max here as well would double-count it, because
 * getEffectiveMaxPool adds it on read.
 */
export const applyPoolAdjustmentsToBase = (
  target: BattleUserState,
  usersEffects: UserEffect[],
) => {
  const adjustments = PoolTypes.map((pool) => {
    const { max, cur } = getPoolKeys(pool);
    // Max pools stay fixed, so each adjustment reads the same base whatever the order.
    const next = getPoolAdjustment(target, usersEffects, pool);
    const delta = next - (target[PREV_ADJUSTMENT_KEYS[pool]] ?? 0);
    // Empty pools stay 0; living pools stay at least 1, clamped to the effective max.
    target[cur] =
      target[cur] <= 0
        ? 0
        : Math.min(Math.max(1, target[max] + next), Math.max(1, target[cur] + delta));
    return { pool, next };
  });

  // Store current adjustments for the next delta; clear tracking when all are 0.
  const anyAdjusted = adjustments.some(({ next }) => next !== 0);
  for (const { pool, next } of adjustments) {
    target[PREV_ADJUSTMENT_KEYS[pool]] = anyAdjusted ? next : undefined;
  }
};

const PREV_ADJUSTMENT_KEYS = {
  Health: "_prevHealthAdj",
  Chakra: "_prevChakraAdj",
  Stamina: "_prevStaminaAdj",
} as const satisfies Record<PoolType, keyof BattleUserState>;

/**
 * Adjust base pools for users with max-pool effects now or tracked from a previous
 * adjustment, so an expiring effect is reversed.
 */
export const syncPoolAdjustments = (
  usersState: BattleUserState[],
  usersEffects: UserEffect[],
) => {
  usersState.forEach((user) => {
    const hasPoolEffects = usersEffects.some(
      (e) =>
        e.targetId === user.userId &&
        (e.type === "increasemaxpools" || e.type === "decreasemaxpools") &&
        isEffectActive(e),
    );
    const hadPoolEffects =
      user._prevHealthAdj !== undefined ||
      user._prevChakraAdj !== undefined ||
      user._prevStaminaAdj !== undefined;
    if (hasPoolEffects || hadPoolEffects) {
      applyPoolAdjustmentsToBase(user, usersEffects);
    }
  });
};

/** Whether a battle's lobby countdown is still running, on the server-synced clock. */
export const isBattleInLobby = (battle: { createdAt: Date }, timeDiff: number) =>
  battle.createdAt.getTime() > Date.now() - timeDiff;

/** Preserve lobby pools while tracking the complete effect list saved to battle state. */
export const reconcileLobbyPools = (
  user: BattleUserState,
  originalPools: Pick<BattleUserState, "curHealth" | "curChakra" | "curStamina">,
  effects: UserEffect[],
) => {
  // Retained incoming and sage effects contribute just like regenerated effects.
  // Synchronize even when effects were removed, so the next pass has no stale delta.
  applyPoolAdjustmentsToBase(user, effects);
  for (const pool of PoolTypes) {
    const { cur } = getPoolKeys(pool);
    user[cur] = Math.min(originalPools[cur], getEffectiveMaxPool(user, effects, pool));
  }
};

/**
 * Height of the rendered battlefield as a fraction of its width, for a grid of the given size
 */

/**
 * Gets the default width and height of the battle grid based on the type of battle and the level of the user
 * @param battleType - The type of battle
 * @param userLevel - The level of the user
 * @returns The default width and height of the battle grid
 */
export const getDefaultBattleSizes = (battleType: BattleType, userLevel: number) => {
  if (LEVEL_SCALED_BATTLES.includes(battleType)) {
    if (userLevel < 20) return { width: 9, height: 8 };
    if (userLevel < 30) return { width: 10, height: 9 };
    if (userLevel < 40) return { width: 11, height: 10 };
  }
  return { width: 12, height: 10 };
};

const LEVEL_SCALED_BATTLES: BattleType[] = [
  "HUNTING",
  "RANDOM_ENCOUNTER",
  "ARENA",
  "TRAINING",
  "QUEST",
];

/**
 * Retrieves the full battle grid including border tiles for rendering assets.
 */
export const getBattleGrid = (
  hexsize: number,
  battle: ReturnedBattle,
  origin?: { x: number; y: number },
) => createHexGrid(hexsize, battle.width, battle.height, origin).map(nameArenaTile);

/** The required maps of a battle's extra state, empty; callers fill in what they preload. */
export const createEmptyExtraState = () =>
  ({
    jutsus: {},
    jutsuReskins: {},
    items: {},
    bloodlines: {},
    sageModes: {},
    villages: {},
    anbuSquads: {},
    keystoneItems: {},
    wars: {},
    aiProfiles: {},
    relations: {},
    clans: {},
    userQuests: {},
    completedQuests: {},
    questData: {},
    bounties: {},
    bountySignups: {},
  }) satisfies ExtraState;

/**
 * The two generals a combatant fights with: their stored preferences, with any free slot
 * taken by their highest remaining general. Equal stats keep GenNames order.
 */
export const getHighestGenerals = (
  user: Record<GenName, number> & {
    preferredGeneral1?: string | null;
    preferredGeneral2?: string | null;
  },
): GenName[] => {
  const first = (user.preferredGeneral1?.toLowerCase() || undefined) as
    | GenName
    | undefined;
  const second = (user.preferredGeneral2?.toLowerCase() || undefined) as
    | GenName
    | undefined;
  const remaining = [...GenNames]
    .sort((a, b) => user[b] - user[a])
    .filter((general) => general !== first && general !== second);
  return [first ?? remaining[0], second ?? remaining[first ? 0 : 1]] as GenName[];
};

/**
 * Finds a user in the battle state based on location
 */
export const findUser = (
  users: ReturnedUserState[],
  longitude: number,
  latitude: number,
) => {
  return users.find(
    (u) => u.longitude === longitude && u.latitude === latitude && stillInBattle(u),
  );
};

/**
 * Which way an AI's artwork should point so it looks at the opponent it is
 * fighting. Picks the nearest living opponent — `direction` is the team side,
 * so anyone on the other side counts — and compares columns; ties and an empty
 * battlefield keep `fallback` so a sprite never flips for a sideways step.
 */
export const getFacingDirection = (
  user: ReturnedUserState,
  users: ReturnedUserState[],
  fallback: AvatarFacing,
): AvatarFacing => {
  let nearest: ReturnedUserState | undefined;
  let nearestDistance = Infinity;
  for (const other of users) {
    if (other.direction === user.direction) continue;
    if (!stillInBattle(other) || other.leftBattle) continue;
    const distance = Math.hypot(
      other.longitude - user.longitude,
      other.latitude - user.latitude,
    );
    // userId tie-break keeps the pick stable across frames when two foes are equidistant
    if (
      distance < nearestDistance ||
      (distance === nearestDistance && nearest && other.userId < nearest.userId)
    ) {
      nearest = other;
      nearestDistance = distance;
    }
  }
  if (!nearest || nearest.longitude === user.longitude) return fallback;
  return nearest.longitude < user.longitude ? "left" : "right";
};

/**
 * Finds a ground effect in the battle state based on location
 */
export const findBarrier = (
  groundEffects: GroundEffect[],
  longitude: number,
  latitude: number,
) => {
  return groundEffects.find(
    (b) => b.longitude === longitude && b.latitude === latitude && b.type === "barrier",
  );
};

/**
 * Effects of a type on the target that were not cast this round and are still enabled.
 * Effects without a duration count, unlike in findActiveEffectOfType.
 */
export const getActiveTargetEffects = <T extends UserEffect["type"]>(
  effects: UserEffect[] | undefined,
  targetId: string | null | undefined,
  type: T,
) =>
  effects?.filter(
    (e): e is Extract<UserEffect, { type: T }> =>
      e.type === type &&
      e.targetId === targetId &&
      !e.castThisRound &&
      isEffectEnabled(e, effects),
  ) ?? [];

/** The user's first active effect of the type with rounds remaining. */
const findActiveEffectOfType = <T extends UserEffect["type"]>(
  userId: string | undefined,
  userEffects: UserEffect[] | undefined,
  type: T,
) =>
  getActiveTargetEffects(userEffects, userId, type).find(
    (e) => e.rounds && e.rounds > 0,
  );

/**
 * Whether the user currently has an active effect of the given type.
 * Active = targeting the user, not cast this round, and still has rounds remaining.
 */
export const hasActiveEffectOfType = (
  userId: string | undefined,
  userEffects: UserEffect[] | undefined,
  type: ZodAllTags["type"],
): boolean => !!findActiveEffectOfType(userId, userEffects, type);

/**
 * Checks if a user is stealthed based on their effects.
 *
 * @param userId - The ID of the user to check.
 * @param userEffects - An array of user effects to evaluate.
 * @returns `true` if the user is stealthed, otherwise `false`.
 */
export const isUserStealthed = (
  userId: string | undefined,
  userEffects: UserEffect[] | undefined,
) => hasActiveEffectOfType(userId, userEffects, "stealth");

export const isUserSummonPrevented = (
  userId: string | undefined,
  userEffects: UserEffect[] | undefined,
) => hasActiveEffectOfType(userId, userEffects, "summonprevent");

export const isUserDisarmed = (
  userId: string | undefined,
  userEffects: UserEffect[] | undefined,
) => hasActiveEffectOfType(userId, userEffects, "disarm");

export const getUserElementalSeal = (
  userId: string | undefined,
  userEffects: UserEffect[] | undefined,
) => findActiveEffectOfType(userId, userEffects, "elementalseal");

/**
 * Checks if a user is immobilized based on their effects.
 *
 * @param userId - The ID of the user to check.
 * @param userEffects - An array of user effects to evaluate.
 * @returns `true` if the user is immobilized, otherwise `false`.
 */
export const isUserImmobilized = (
  userId: string | undefined,
  userEffects: UserEffect[] | undefined,
) => hasActiveEffectOfType(userId, userEffects, "moveprevent");

/**
 * Get copies of the barriers on the shortest path between two tiles, and the total
 * fraction of damage they absorb (0-1). Barriers are taken in path order; each copy's
 * absorbPercentage is replaced by its marginal 0-1 share of that total
 * (remaining share × absorbPercentage / 100), not the schema's 1-100 percentage.
 * The caster's own barriers are skipped unless they sit on the target tile.
 */
export const getBarriersBetween = (
  userId: string,
  aStar: PathCalculator,
  groundEffects: GroundEffect[],
  origin: TerrainHex,
  target: TerrainHex,
) => {
  // Get all the barriers
  const barriers = (aStar
    .getShortestPath(origin, target)
    ?.map((t) => findBarrier(groundEffects, t.col, t.row))
    ?.filter((b) => b !== undefined)
    .map((b) => structuredClone(b))
    .filter(
      (b) =>
        b.creatorId !== userId ||
        (b.longitude === target.col && b.latitude === target.row),
    ) ?? []) as BattleEffect[];
  // Calculate how much total is absorbed by the barriers
  const totalAbsorb = barriers.reduce((acc, b) => {
    if ("absorbPercentage" in b) {
      const remainder = 1 - acc;
      const absorb = remainder * (b.absorbPercentage / 100);
      b.absorbPercentage = absorb;
      return acc + absorb;
    }
    return acc;
  }, 0);
  return { barriers, totalAbsorb };
};

/**
 * Given a UserEffect, check if it is time to apply it. The effect is applied if:
 * 1. The effect is not already applied to the user
 * 2. A round has passed
 */
export const calcApplyRatio = (
  effect: UserEffect | GroundEffect,
  battle: ReturnedBattle,
  targetId: string,
  trackResults: boolean,
) => {
  // Certain buff/debuffs are applied always (e.g. resolving against each attack)
  const alwaysApply: ZodAllTags["type"][] = [
    "absorb",
    "afterburn",
    "consume",
    "siphon",
    "diffuse",
    "buffprevent",
    "cleanseprevent",
    "clearprevent",
    "debuffprevent",
    "decreasedamagegiven",
    "decreasedamagetaken",
    "decreaseheal",
    "decreasepoolcost",
    "decreasestat",
    "fleeprevent",
    "healprevent",
    "increasedamagegiven",
    "increasedamagetaken",
    "increaseheal",
    "increasepotency",
    "decreasepotency",
    "increasepoolcost",
    "increasestat",
    "increasemastery",
    "decreasemastery",
    "lifesteal",
    "moveprevent",
    "onehitkillprevent",
    "poison",
    "recoil",
    "reflect",
    "parry",
    "curse",
    "robprevent",
    "sealprevent",
    "stunprevent",
    "stealth",
    "summonprevent",
    "disarm",
    "weakness",
    "shield",
  ];
  // If always apply, then apply 1 time, but not if rounds set to 0
  if (alwaysApply.includes(effect.type)) {
    if (effect.rounds !== undefined && effect.rounds === 0) {
      // Zero-duration Consume still converts the casting action's damage.
      if (effect.type === "consume" && effect.isNew && effect.castThisRound) return 1;
      return 0;
    }
    return 1;
  }
  // Get latest application of effect to the given target
  let ratio = 1;
  const isDirectAggro =
    (effect.type === "increaseaggro" || effect.type === "decreaseaggro") &&
    effect.aggroMode === "ENMITY";
  if (
    trackResults &&
    (effect.rounds !== undefined || isDirectAggro) &&
    effect.timeTracker
  ) {
    const prevApply = effect.timeTracker[targetId];
    if (prevApply) {
      if (battle.round !== prevApply) {
        effect.timeTracker[targetId] = battle.round;
      } else {
        ratio = 0;
      }
    } else {
      effect.timeTracker[targetId] = battle.round;
    }
  }
  // If no rounds, or no previous applies, then apply 1 time
  return ratio;
};

/**
 * Calculate effect round information based on a given battle
 */
export const calcEffectRoundInfo = (
  effect: UserEffect | GroundEffect,
  battle: BattleRoundContext,
) => {
  if (effect.rounds !== undefined && effect.createdRound !== undefined) {
    return { startRound: effect.createdRound, curRound: battle.round };
  }
  return { startRound: -1, curRound: battle.round };
};

/** Check whether a tag still has duration remaining. */
/** Whether at least one effect carries both an appear animation and an appear sound. */
export const hasAppearAnimation = (effects: ZodAllTags[]) =>
  effects.some(
    (effect) =>
      "appearAnimation" in effect &&
      effect.appearAnimation &&
      "appearSfx" in effect &&
      effect.appearSfx,
  );

export const isEffectActive = (effect: UserEffect | GroundEffect) => {
  if (
    "timedBuffExpiresAt" in effect &&
    effect.timedBuffExpiresAt &&
    effect.timedBuffExpiresAt <= Date.now()
  )
    return false;
  return effect.rounds === undefined || effect.rounds > 0;
};

/**
 * Resolve passive effects without letting sealed bloodline tags participate.
 * Use isEffectActive for lifetime bookkeeping so suppressed tags survive the seal.
 * Pass the full user-effect context: only resolved, unexpired seals on the same
 * target suppress a bloodline tag; a newly cast seal must resolve first.
 */
export const isEffectEnabled = (
  effect: UserEffect | GroundEffect,
  usersEffects: UserEffect[] | undefined,
): boolean =>
  isEffectActive(effect) &&
  !(
    effect.fromType === "bloodline" &&
    "targetId" in effect &&
    usersEffects?.some(
      (seal) => isActiveSeal(seal) && seal.targetId === effect.targetId,
    )
  );

/** A seal that has landed and not yet expired. */
const isActiveSeal = (effect: UserEffect) =>
  effect.type === "seal" && !effect.isNew && isEffectActive(effect);

/** Collect resolved, unexpired seals for shared bloodline-suppression checks. */
export const getActiveSealEffects = (usersEffects: UserEffect[]) =>
  usersEffects.filter(isActiveSeal);

/** Check if a given effect is sealed based on the output of getActiveSealEffects */
export const sealCheck = (effect: UserEffect, sealEffects: UserEffect[]) =>
  effect.fromType === "bloodline" &&
  sealEffects.some((e) => e.targetId === effect.targetId);

/** Potency for distinct selections or calculation modes can coexist. */
export const getEffectStackKey = (effect: UserEffect) => {
  const key = `${effect.type}-${effect.creatorId}-${effect.targetId}-${effect.fromType}`;
  if (effect.timedBuffExpiresAt) return `${key}-${effect.id}`;
  if (effect.type === "increaseaggro" || effect.type === "decreaseaggro") {
    return `${key}-${effect.aggroMode}-${effect.calculation}`;
  }
  if (effect.type === "increasepotency" || effect.type === "decreasepotency") {
    const elements = [...new Set(effect.affectedElements)].sort().join(",");
    return `${key}-${effect.affectedTag}-${effect.calculation}-${elements || "all"}`;
  }
  return key;
};

/** Whether an effect may apply in a pass that has already applied the `applied` stack keys. */
export const canStackEffect = (effect: UserEffect, applied: Set<string>) =>
  BATTLE_TAG_STACKING ||
  !applied.has(getEffectStackKey(effect)) ||
  effect.fromType === "bloodline" ||
  effect.fromType === "sageMode" ||
  effect.fromType === "sageModeAfter" ||
  isPreBattleGearFromType(effect.fromType);

/**
 * Determines the processing stage for a damage modifier effect.
 * Stage 1 (Equipment/Pre-Battle): PRE_BATTLE_SOURCE_TYPES
 * Stage 2 (In-Battle): every other source, e.g. bloodline, jutsu, item, basic
 *
 * This is used for staged damage calculation where equipment effects
 * apply first (Stage 1), then in-battle effects apply to the result (Stage 2).
 */
export const getEffectStage = (effect: UserEffect | GroundEffect): 1 | 2 => {
  if (
    "fromType" in effect &&
    effect.fromType &&
    PRE_BATTLE_SOURCE_TYPES.includes(effect.fromType)
  ) {
    return 1;
  }
  return 2;
};

/**
 * Base for percentage damage modifiers: the staged pre-modifier damage when
 * recorded, else the current damage or residual. The effect argument is unused.
 */
export const getBaseDamageForModifier = (
  _effect: UserEffect,
  consequence: {
    damage?: number;
    residual?: number;
    baseDamageForModifiers?: number;
  },
): number => {
  return (
    consequence.baseDamageForModifiers ??
    consequence.damage ??
    consequence.residual ??
    0
  );
};

/**
 * Sort order in which effects are applied
 */
export const sortEffects = (
  a: UserEffect | GroundEffect,
  b: UserEffect | GroundEffect,
) => {
  const aIndex = EFFECT_SORT_RANK.get(a.type) ?? Number.POSITIVE_INFINITY;
  const bIndex = EFFECT_SORT_RANK.get(b.type) ?? Number.POSITIVE_INFINITY;
  // If they're the same type, handle special ordering
  if (aIndex === bIndex) {
    // For damage reduction effects, sort static before percentage
    if (a.type === "decreasedamagetaken" && b.type === "decreasedamagetaken") {
      if (a.calculation === "static" && b.calculation === "percentage") return -1;
      if (a.calculation === "percentage" && b.calculation === "static") return 1;
    }
    if (a.type === "decreasedamagegiven" && b.type === "decreasedamagegiven") {
      if (a.calculation === "static" && b.calculation === "percentage") return -1;
      if (a.calculation === "percentage" && b.calculation === "static") return 1;
    }
    return 0; // Same type, same calculation, maintain original order
  }

  // Special handling for damage reduction effects to ensure proper ordering
  // We want: decreasedamagetaken(static) -> decreasedamagegiven(static) -> decreasedamagegiven(percentage) -> decreasedamagetaken(percentage)
  if (
    (a.type === "decreasedamagetaken" && b.type === "decreasedamagegiven") ||
    (a.type === "decreasedamagegiven" && b.type === "decreasedamagetaken")
  ) {
    // If both are static, decreasedamagetaken comes first
    if (a.calculation === "static" && b.calculation === "static") {
      if (a.type === "decreasedamagetaken") return -1;
      if (b.type === "decreasedamagetaken") return 1;
    }

    // If both are percentage, decreasedamagegiven comes first
    if (a.calculation === "percentage" && b.calculation === "percentage") {
      if (a.type === "decreasedamagegiven") return -1;
      if (b.type === "decreasedamagegiven") return 1;
    }

    // If one is static and one is percentage, static comes first
    if (a.calculation === "static" && b.calculation === "percentage") return -1;
    if (a.calculation === "percentage" && b.calculation === "static") return 1;
  }

  return aIndex > bIndex ? 1 : -1;
};

/**
 * Application stage of each effect type. Unlisted types share a final rank, which
 * keeps the comparator consistent so listed types always follow this order.
 */
const EFFECT_SORT_RANK = new Map<string, number>(
  (
    [
      // Prevents
      "stealth",
      "buffprevent",
      "cleanseprevent",
      "clearprevent",
      "debuffprevent",
      "fleeprevent",
      "healprevent",
      "moveprevent",
      "onehitkillprevent",
      "robprevent",
      "sealprevent",
      "stunprevent",
      "summonprevent",
      "disarm",
      "weakness",
      // Pre-modifiers
      "elementalseal",
      "injectjutsus",
      "activatesagemode",
      "cleanse",
      "clear",
      "increaseaggro",
      "decreaseaggro",
      "increasepotency",
      "decreasepotency",
      "decreasepoolcost",
      "decreasestat",
      "decreasemastery",
      "increasepoolcost",
      "increasestat",
      "increasemastery",
      // Mid-modifiers
      "barrier",
      "shield",
      "finalstand",
      "diffuse",
      "clone",
      "redirection",
      "damage",
      "flee",
      "heal",
      "onehitkill",
      "rob",
      "seal",
      "stun",
      "summon",
      // Post-modifiers before pierce
      "decreasedamagegiven",
      "decreasedamagetaken",
      "increasedamagegiven",
      "increasedamagetaken",
      // Piercing damage
      "pierce",
      // Post-modifiers after pierce
      ...(POST_PIERCE_TAGS as ZodAllTags["type"][]),
      "copy",
      "mirror",
      // Time effects
      "timecompression",
      "timedilation",
      // End-modifiers
      "move",
      "visual",
    ] as ZodAllTags["type"][]
  ).map((type, index) => [type, index]),
);

/**
 * Given an action, list of user effects, and a target, calculate pool cost for the action
 */
export const calcPoolCost = (
  action: CombatAction,
  usersEffects: UserEffect[],
  target: BattleUserState,
) => {
  const costs = {
    Health: action.healthCost,
    Chakra: action.chakraCost,
    Stamina: action.staminaCost,
  };
  usersEffects
    .filter(
      (e) =>
        ["increasepoolcost", "decreasepoolcost"].includes(e.type) &&
        e.targetId === target.userId &&
        isEffectEnabled(e, usersEffects),
    )
    .forEach((e) => {
      // Get the power to apply (positive or negative)
      let power = getEffectPower(e);
      if (e.type === "increasepoolcost" && power < 0) power *= -1;
      if (e.type === "decreasepoolcost" && power > 0) power *= -1;
      // Apply the power to the pools affected
      if ("poolsAffected" in e) {
        e.poolsAffected?.forEach((pool) => {
          if (pool === "Energy") return;
          costs[pool] =
            e.calculation === "static"
              ? costs[pool] + power
              : (costs[pool] * (100 + power)) / 100;
        });
      }
    });
  // A reduction past the cost makes the action free; it never refunds pools.
  return {
    hpCost: Math.max(0, costs.Health),
    cpCost: Math.max(0, costs.Chakra),
    spCost: Math.max(0, costs.Stamina),
  };
};

/**
 * A reducer for collapsing a Map<string, Consequence> into a Consequence[]
 */
export const collapseConsequences = (acc: Consequence[], val: Consequence) => {
  const current = acc.find(
    (c) => c.targetId === val.targetId && c.damageSource === val.damageSource,
  );
  if (current) {
    if (val.enmitySources) {
      current.enmitySources = (current.enmitySources ?? []).concat(val.enmitySources);
    }
    if (val.vampRatio) {
      current.vampHeal = (current.vampHeal ?? 0) + calcVampHeal(val, val.vampRatio);
    }
    // Reads the running pre-shield total, so it comes before that total is summed.
    if (current.preDiffuseDamage !== undefined || val.preDiffuseDamage !== undefined) {
      current.preDiffuseDamage =
        (current.preDiffuseDamage ?? current.preShieldDamage ?? 0) +
        (val.preDiffuseDamage ?? val.preShieldDamage ?? 0);
    }
    for (const key of SUMMED_CONSEQUENCE_KEYS) {
      const value = val[key];
      if (value) current[key] = (current[key] || 0) + value;
    }
    for (const key of HIGHEST_CONSEQUENCE_KEYS) {
      const value = val[key];
      const held = current[key];
      if (value) current[key] = held ? Math.max(held, value) : value;
    }
    if (val.diffuseImmediateDamage !== undefined) {
      current.diffuseImmediateDamage =
        (current.diffuseImmediateDamage ?? 0) + val.diffuseImmediateDamage;
    }
    if (val.types) {
      current.types = current.types ? current.types.concat(val.types) : val.types;
    }
    if (val.afterburn) {
      current.afterburn = (current.afterburn ?? 0) + val.afterburn;
    }
  } else {
    if (val.vampRatio) {
      val.vampHeal = (val.vampHeal ?? 0) + calcVampHeal(val, val.vampRatio);
    }
    acc.push(val);
  }
  return acc;
};

const SUMMED_CONSEQUENCE_KEYS = [
  "damage",
  "residual",
  "reflect",
  "recoil",
  "lifesteal_hp",
  "preShieldDamage",
  "absorb_hp",
  "absorb_sp",
  "absorb_cp",
  "drain_hp",
  "drain_cp",
  "drain_sp",
  "poison",
  "wound",
] as const satisfies readonly (keyof Consequence)[];

const HIGHEST_CONSEQUENCE_KEYS = ["heal_hp", "heal_sp", "heal_cp"] as const;

/**
 * Vamp heals off the FULL pre-shield hit (matches lifesteal + the 60% cap, which both use
 * preShieldDamage). Fallback to damage when preShieldDamage is unset.
 */
const calcVampHeal = (hit: Consequence, ratio: number) =>
  ratio * (hit.preShieldDamage ?? hit.damage ?? 0);

/** User fields required for initiative calculation */
type InitiativeUser = {
  level?: number | null;
  sector?: number | null;
  pvpStreak?: number | null;
};

/** Roll initiative with relative-level, territory and PvP-streak multipliers from the loaded participant snapshot. */
export const rollInitiative = (
  user: InitiativeUser,
  opponents?: InitiativeUser[],
  villageSector?: number | null,
) => {
  // Get a random number between 1 and 20
  let roll = randomInt(1, 20);
  // Calculate level bonus
  if (opponents) {
    const avgLevel =
      opponents.reduce((a, b) => a + (b.level ?? 1), 0) / opponents.length;
    const levelBonus = Math.max(((user.level ?? 1) - avgLevel) * 0.03, 0);
    roll = roll * (1 + levelBonus);
  }
  // Calculate territory bonus
  const ownTerritory = user.sector === villageSector;
  const territoryBonus = ownTerritory ? 0.1 : -0.1;
  roll = roll * (1 + territoryBonus);
  // PvP bonus
  if ((user.pvpStreak ?? 0) > 0) {
    let pvpBonus = 0;
    for (let i = 1; i <= (user.pvpStreak ?? 0); i++) {
      pvpBonus += PVP_STREAK_INITIATIVE_BONUS[i - 1] ?? 0.0025;
    }
    roll = roll * (1 + pvpBonus);
  }
  return roll;
};

/** Initiative bonus of each consecutive streak step; later steps add 0.25%. */
const PVP_STREAK_INITIATIVE_BONUS = [0.02, 0.015, 0.01, 0.005];

/**
 * Checks if a move is valid on the battlefield.
 * Uses the 'direction' property to determine OPPONENT/ALLY - users on opposite
 * sides are opponents, users on the same side are allies.
 * @param info {
 *  action: CombatAction;
 *  target: TerrainHex;
 *  user: ReturnedUserState;
 *  users: ReturnedUserState[];
 *  barriers: GroundEffect[];
 *  clicked: TerrainHex;
 * }
 * @returns
 */
export const isValidMove = (info: {
  action: CombatAction;
  target: TerrainHex;
  user: ReturnedUserState;
  users: ReturnedUserState[];
  barriers: GroundEffect[];
  clicked: TerrainHex;
}) => {
  const { action, user, users, target, clicked, barriers } = info;
  const { userId } = user;
  const barrier = barriers.find(
    (b) => b.longitude === target.col && b.latitude === target.row,
  );
  if (!barrier) {
    const opponent = findUser(users, target.col, target.row);
    if (action.target === "CHARACTER") {
      if (opponent) return true;
    } else if (action.target === "OPPONENT") {
      // Opponent = different direction/team
      if (opponent && !areBattleAllies(opponent, user)) return true;
    } else if (action.target === "OTHER_USER") {
      if (opponent && opponent?.userId !== userId) return true;
    } else if (action.target === "ALLY") {
      // Ally = same direction/team
      if (opponent && areBattleAllies(opponent, user)) return true;
    } else if (action.target === "SELF") {
      // Allow self-targeting abilities like basic heal even when stealthed
      if (opponent && opponent?.userId === userId) return true;
    } else if (action.target === "EMPTY_GROUND") {
      if (!opponent || target !== clicked) return true;
    } else if (action.target === "GROUND") {
      return true;
    }
  } else {
    // Check if the action has a move effect
    const hasMoveEffect = action.effects.find((e) => e.type === "move");

    // If there's a move effect, barriers are not targetable
    if (hasMoveEffect) {
      return false;
    }

    // Otherwise, only allow damage/pierce actions to target barriers
    if (action.effects.find((e) => BARRIER_DAMAGE_TAG_TYPES.has(e.type))) {
      return true;
    }
  }

  return false;
};

/**
 * Filters the shared footprint through occupant, barrier and anchor restrictions.
 * RANDOM coordinates expose all eligible candidates in preview mode and sample on cast.
 * @returns Valid tiles in green and rejected tiles in red; ALL omits rejected tiles.
 */
export const getAffectedTiles = (info: {
  a: TerrainHex;
  b: TerrainHex;
  action: CombatAction;
  grid: Grid<TerrainHex>;
  restrictGrid?: Grid<TerrainHex>;
  users: ReturnedUserState[];
  ground: GroundEffect[];
  userId: string;
  preview?: boolean;
}) => {
  // Destruct & variables
  const { action, b, a, grid, restrictGrid, users, userId } = info;
  const green = new Set<TerrainHex>();
  const red = new Set<TerrainHex>();
  const user = users.find((u) => u.userId === userId);

  // Get all ground effects which are barriers
  const barriers = info.ground.filter((g) => g.type === "barrier");

  // Guard if no user
  if (!user) return { green, red };

  // Guard if action not on restricted grid
  if (restrictGrid) {
    if (!restrictGrid.getHex({ q: b.q, r: b.r })) {
      return { green, red };
    }
  }

  const tiles = getTargetTiles({ a, b, action, grid });
  if (action.method === "COORDINATES") {
    const pattern = action.coordinateTargeting;
    if (!pattern) return { green, red };
    const candidates = tiles.filter((target) => {
      // Coordinate patterns select tiles independently of the clicked anchor.
      if (action.target === "EMPTY_GROUND" && findUser(users, target.col, target.row))
        return false;
      if (isValidMove({ action, target, user, users, barriers, clicked: b }))
        return true;
      red.add(target);
      return false;
    });
    // Preview all eligible candidates; the server samples once when the cast is accepted.
    if (pattern.selection === "RANDOM" && !info.preview) {
      const count = Math.min(pattern.randomCount, candidates.length);
      for (let index = 0; index < count; index++) {
        const selected = index + secureRandomInt(candidates.length - index);
        const current = candidates[index];
        const chosen = candidates[selected];
        if (current && chosen) {
          candidates[index] = chosen;
          candidates[selected] = current;
          green.add(chosen);
        }
      }
    } else {
      candidates.forEach((target) => {
        green.add(target);
      });
    }
  }

  // Return green for valid moves and red for unvalid moves
  if (action.method !== "COORDINATES")
    tiles.forEach((target) => {
      if (isValidMove({ action, target, user, users, barriers, clicked: b })) {
        green.add(target);
      } else if (action.method !== "ALL") {
        red.add(target);
      }
    });

  return { green, red };
};

/** Resolve every tag before applying effects so spawned barriers cannot change later patterns. */
export const getActionAffectedTiles = (
  info: Parameters<typeof getAffectedTiles>[0],
) => {
  if (
    info.action.effects.some((tag) => tag.type === "move") &&
    (info.action.method === "COORDINATES" ||
      info.action.effects.some((tag) => tag.target === "COORDINATES"))
  ) {
    return {
      green: new Set<TerrainHex>(),
      red: new Set<TerrainHex>(),
      effectTiles: [],
    };
  }
  const inherited = getAffectedTiles(info);
  if (info.action.effects.length === 0) return { ...inherited, effectTiles: [] };
  const green = new Set<TerrainHex>();
  const red = new Set<TerrainHex>();
  const effectTiles = info.action.effects.map((tag) => {
    const result =
      tag.target === "COORDINATES"
        ? getAffectedTiles({
            ...info,
            action: {
              ...info.action,
              method: "COORDINATES",
              target: info.action.target === "EMPTY_GROUND" ? "EMPTY_GROUND" : "GROUND",
              coordinateTargeting: tag.coordinateTargeting,
              effects: [tag],
            },
          })
        : inherited;
    result.green.forEach((tile) => {
      green.add(tile);
    });
    result.red.forEach((tile) => {
      red.add(tile);
    });
    return result.green;
  });
  green.forEach((tile) => {
    red.delete(tile);
  });
  return { green, red, effectTiles };
};

/**
 * Get the distance to the closest enemy from a user's position.
 * Returns null if no enemies found or user not found.
 * Distance follows battle teams regardless of faction or controller identity.
 */
export const getDistanceToClosestEnemy = (
  battle: ReturnedBattle | undefined | null,
  userId: string | undefined,
): number | null => {
  if (!battle || !userId) return null;

  const user = battle.usersState.find((u) => u.userId === userId);
  if (!user) return null;

  const enemies = battle.usersState.filter(
    (u) => !areBattleAllies(u, user) && stillInBattle(u),
  );

  if (enemies.length === 0) return null;

  // Calculate distance to each enemy and return the minimum
  const distances = enemies.map((enemy) =>
    oddQHexDistance(user.longitude, user.latitude, enemy.longitude, enemy.latitude),
  );

  return Math.min(...distances);
};

/**
 * Extracts the base name from a prevent type by removing the "prevent" suffix
 * @param preventType - The full prevent type (e.g., "buffprevent", "healprevent")
 * @returns The base name without "prevent" suffix (e.g., "buff", "heal")
 */
export const getPreventTypeName = (preventType: string): string => {
  return preventType.replace(/prevent$/, "");
};

/**
 * What an effect's statTypes stand for. increasestat/decreasestat move the unified
 * Offence/Defence, picked by direction, and any statTypes only switch that on; every
 * other tag that supports statTypes uses them to match jutsu types.
 */
export const getStatTypeLabels = (effect: {
  type: string;
  statTypes?: readonly StatType[] | null;
  direction?: string;
  elements?: readonly ElementName[] | null;
}): (StatType | CombatStatType | "All damage")[] => {
  if (damageModifierTypes.includes(effect.type))
    return effect.elements?.length ? [] : ["All damage"];
  if (damageDerivedTagTypes.includes(effect.type)) return [];
  const statTypes = effect.statTypes ?? [];
  if (effect.type !== "increasestat" && effect.type !== "decreasestat") {
    return [...statTypes];
  }
  if (statTypes.length === 0) return [];
  const direction = effect.direction ?? "both";
  return CombatStatTypes.filter(
    (stat) => direction === "both" || direction === stat.toLowerCase(),
  );
};

/**
 * Determines which participant rows the battle-start update should claim.
 *
 * AI opponents are left out. One row backs every fight against a given AI, so
 * claiming it makes concurrent battles contend on a single shared row, and the
 * battle state clones AI under a fresh id anyway. Auto battles only ever claim
 * the attackers.
 *
 * The returned length is the expected rowsAffected for the compare-and-swap
 * guard, so it has to stay in step with that update's WHERE clause.
 *
 * @param info - Battle claim inputs
 * @param info.battleType - The type of battle being started
 * @param info.userIds - The attacking user ids
 * @param info.targetIds - The defending user ids
 * @param info.participants - Fetched rows for the battle, used to identify AI
 * @returns Deduplicated ids of the non-AI rows the update should claim
 */
export const getBattleClaimIds = (info: {
  battleType: BattleType;
  userIds: string[];
  targetIds: string[];
  participants: { userId: string; isAi: boolean }[];
}): string[] => {
  const { battleType, userIds, targetIds, participants } = info;
  const aiIds = new Set(participants.filter((u) => u.isAi).map((u) => u.userId));
  const claimed = AutoBattleTypes.includes(battleType)
    ? userIds
    : [...userIds, ...targetIds];
  return [...new Set(claimed)].filter((id) => !aiIds.has(id));
};

/**
 * From copy/mirror transfer candidates, pick the effects a single cast applies.
 * Rank individual instances by (priority rank asc, strength desc, id asc),
 * then take the top `cap`. Repeated types each consume a slot. Types absent
 * from `rank` fall to a shared tail rank.
 *
 * Strength is the MAGNITUDE of `getEffectPower(e)` (percentage magnitudes clamped
 * to 100): the damage-modifier pass negates `decrease*` powers in place, so a
 * signed comparison would rank a strong reduction below a weak boost and keep the
 * weaker instance ahead of a stronger one. Comparing static vs percentage
 * magnitudes within a tier is a coarse heuristic, consistent with the engine (no
 * cross-calculation normalization exists anywhere) — accepted limitation.
 */
export const selectTransferEffects = (
  candidates: UserEffect[],
  rank: ReadonlyMap<string, number>,
  cap: number,
): UserEffect[] => {
  if (cap <= 0) return [];
  const magnitudeOf = new Map<string, number>();
  for (const effect of candidates) {
    const magnitude = Math.abs(getEffectPower(effect));
    magnitudeOf.set(
      effect.id,
      effect.calculation === "percentage" && magnitude > 100 ? 100 : magnitude,
    );
  }
  const rankOf = (type: string) => rank.get(type) ?? Number.MAX_SAFE_INTEGER;
  return [...candidates]
    .sort((a, b) => {
      const byRank = rankOf(a.type) - rankOf(b.type);
      if (byRank !== 0) return byRank;
      const byPower = (magnitudeOf.get(b.id) ?? 0) - (magnitudeOf.get(a.id) ?? 0);
      if (byPower !== 0) return byPower;
      return a.id.localeCompare(b.id);
    })
    .slice(0, cap);
};

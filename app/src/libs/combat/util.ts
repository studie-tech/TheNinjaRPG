import { publicState, allState } from "./constants";
import { getPower } from "./tags";
import { randomInt } from "@/utils/math";
import { secondsPassed } from "@/utils/time";
import { availableUserActions } from "./actions";
import { calcActiveUser } from "./actions";
import { stillInBattle } from "./actions";
import { checkFriendlyFire } from "./process";
import {
  KAGE_PRESTIGE_COST,
  FRIENDLY_PRESTIGE_COST,
  MAP_WAR_TORN_BATTLEGROUND_SECTOR,
  WAR_TORN_SECTOR_BASE_MONEY,
} from "@/drizzle/constants";
import type { BattleType } from "@/drizzle/constants";
import { KAGE_CHALLENGE_WIN_PRESTIGE } from "@/drizzle/constants";
import { CLAN_BATTLE_REWARD_POINTS } from "@/drizzle/constants";
import { getUserCaps } from "@/drizzle/constants";
import { Orientation, Grid, rectangle } from "honeycomb-grid";
import { defineHex } from "../hexgrid";
import { actionPointsAfterAction } from "@/libs/combat/actions";
import { KILLING_NOTORIETY_GAIN } from "@/drizzle/constants";
import { findWarsWithUser } from "@/libs/war";
import { STREAK_LEVEL_DIFF } from "@/drizzle/constants";
import { getShrineBoost, getEffectiveStructureLevel } from "@/utils/village";
import { spiral, line, ring, fromCoordinates, Direction } from "honeycomb-grid";
import {
  SHARED_COOLDOWN_TAGS,
  WAR_HEALTH_REMOVE,
  WAR_HEALTH_RECOVER,
  WAR_HEALTH_ANBU_REMOVE,
  WAR_HEALTH_ANBU_RECOVER,
  WAR_HEALTH_ASSASSIN_REMOVE,
  WAR_HEALTH_ASSASSIN_RECOVER,
  WAR_HEALTH_ELDER_REMOVE,
  WAR_HEALTH_ELDER_RECOVER,
  WAR_HEALTH_COLEADER_REMOVE,
  WAR_HEALTH_COLEADER_RECOVER,
  WAR_HEALTH_KAGE_REMOVE,
  WAR_HEALTH_KAGE_RECOVER,
  WAR_HEALTH_KAGEDEATH_REMOVE,
  WAR_SECTORWAR_AI_SHRINE_REDUCE,
  WAR_SECTORWAR_AI_SHRINE_RECOVER,
  WAR_SECTORWAR_PVP_SHRINE_REDUCE,
  WAR_SECTORWAR_PVP_SHRINE_RECOVER,
  PVP_KILL_TOKEN_REWARD,
  PVP_KILL_TOKEN_REWARD_ANBU,
  PVP_KILL_TOKEN_REWARD_ASSASSIN,
  PVP_KILL_PRESTIGE_REWARD,
  PVP_KILL_PRESTIGE_REWARD_ANBU,
  PVP_KILL_PRESTIGE_REWARD_ASSASSIN,
  PVP_KILL_ANBU_POINTS_REWARD,
  HEX_ASPECT_RATIO,
} from "@/drizzle/constants";
import { calculateLpEloChange } from "@/libs/ranked_pvp";
import { checkCoLeader, checkAssassin } from "@/validators/clan";
import type { PathCalculator } from "../hexgrid";
import type { TerrainHex } from "../hexgrid";
import type { CombatResult, CompleteBattle, ReturnedBattle } from "./types";
import type {
  ReturnedUserState,
  Consequence,
  BattleWar,
  ReturnedBattleDynamic,
} from "./types";
import type { CombatAction, BattleUserState } from "./types";
import type { ZodAllTags } from "@/validators/combat";
import type { GroundEffect, UserEffect, BattleEffect } from "@/libs/combat/types";
import type { Battle, UserItem } from "@/drizzle/schema";
import type { GameSetting, VillageAlliance } from "@/drizzle/schema";
import type { DroppedItem } from "./types";

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
 * Get full Jutsu data - throws if not found (use when jutsu MUST exist)
 */
export const getJutsuOrThrow = (
  battle: CompleteBattle | ReturnedBattle,
  jutsuId: string,
) => {
  const jutsu = getJutsu(battle, jutsuId);
  if (!jutsu) throw new Error(`Jutsu not found in staticData: ${jutsuId}`);
  return jutsu;
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
export const getItem = (battle: CompleteBattle | ReturnedBattle, itemId: string) => {
  return battle.extraState.items?.[itemId];
};

/**
 * Get full Item data - throws if not found
 */
export const getItemOrThrow = (
  battle: CompleteBattle | ReturnedBattle,
  itemId: string,
) => {
  const item = getItem(battle, itemId);
  if (!item) throw new Error(`Item not found in staticData: ${itemId}`);
  return item;
};

/**
 * Get full Village data from extraState by villageId
 */
export const getVillage = (
  battle: CompleteBattle | ReturnedBattle,
  villageId: string | null | undefined,
) => {
  if (!villageId) return undefined;
  return battle.extraState.villages?.[villageId];
};

/**
 * Get AnbuSquad data from extraState by anbuId
 */
export const getAnbuSquad = (
  battle: CompleteBattle | ReturnedBattle,
  anbuId: string | null | undefined,
) => {
  if (!anbuId) return undefined;
  return battle.extraState.anbuSquads?.[anbuId];
};

/**
 * Get Clan data from extraState by clanId
 */
export const getClan = (
  battle: CompleteBattle | ReturnedBattle,
  clanId: string | null | undefined,
) => {
  if (!clanId) return undefined;
  return battle.extraState.clans?.[clanId];
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
 * Get War data from extraState by warId
 */
export const getWar = (battle: CompleteBattle | ReturnedBattle, warId: string) => {
  return battle.extraState.wars?.[warId];
};

/**
 * Get all wars for a user as array
 */
export const getWarsArray = (
  battle: CompleteBattle | ReturnedBattle,
  user: BattleUserState,
) => {
  return (user.warIds ?? [])
    .map((id) => battle.extraState.wars?.[id])
    .filter((w): w is BattleWar => Boolean(w));
};

/**
 * Get VillageAlliance (relation) from extraState by relationId
 */
export const getRelation = (
  battle: CompleteBattle | ReturnedBattle,
  relationId: string,
) => {
  return battle.extraState.relations?.[relationId];
};

/**
 * Get all relations for a user as array
 */
export const getRelationsArray = (
  battle: CompleteBattle | ReturnedBattle,
  user: BattleUserState,
) => {
  return (user.relationIds ?? [])
    .map((id) => battle.extraState.relations?.[id])
    .filter((r): r is VillageAlliance => Boolean(r));
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

/**
 * Hydrate a BattleUserState with data from extraState for use with e.g. getNewTrackers.
 * Returns a fully hydrated user with relations populated from battle.extraState.
 */
export const hydrateUserForQuests = (battle: CompleteBattle, user: BattleUserState) => {
  // Hydrate relations from extraState
  const userQuests = getUserQuestsFromBattle(battle, user.controllerId);
  const completedQuests = getCompletedQuestsFromBattle(battle, user.controllerId);
  const questData = getQuestDataFromBattle(battle, user.controllerId);
  const village = user.villageId ? getVillage(battle, user.villageId) : undefined;
  const bloodline = getBloodline(battle, user.bloodlineId);

  // Omit BattleUserState.items (BattleUserItem[]) to replace with UserItem[] for type compatibility
  const { items: battleItems, ...userWithoutItems } = user;

  // Convert BattleUserItem[] to UserItem[] by adding missing fields
  const now = new Date();
  const items: UserItem[] = battleItems.map((bi) => ({
    ...bi,
    createdAt: now,
    updatedAt: now,
    userId: user.userId,
    storedAtHome: false,
    craftingFinishedAt: null,
    isInAuction: false,
  }));

  // Return hydrated user for quest processing
  return {
    ...userWithoutItems,
    userQuests,
    completedQuests,
    questData,
    village,
    bloodline: bloodline ?? null,
    items,
  };
};

/**
 * Get bounties from extraState for a user
 */
export const getUserBounties = (
  battle: CompleteBattle | ReturnedBattle,
  controllerId: string,
) => {
  return battle.extraState.bounties?.[controllerId] ?? [];
};

/**
 * Get bounty signups from extraState for a user
 */
export const getUserBountySignups = (
  battle: CompleteBattle | ReturnedBattle,
  controllerId: string,
) => {
  return battle.extraState.bountySignups?.[controllerId] ?? [];
};

/**
 * Check if a single tag is a shared cooldown tag
 */
export const tagHasSharedCooldown = (effect: ZodAllTags) => {
  return SHARED_COOLDOWN_TAGS.some((tag) => effect.type === tag);
};

/**
 * Check if an action has any of the shared cooldown tags
 */
export const actionHasSharedCooldown = (action: { effects: ZodAllTags[] }): boolean => {
  return action.effects.some((effect) => tagHasSharedCooldown(effect));
};

/**
 * Gets the default width and height of the battle grid based on the type of battle and the level of the user
 * @param battleType - The type of battle
 * @param userLevel - The level of the user
 * @returns The default width and height of the battle grid
 */
export const getDefaultBattleSizes = (battleType: BattleType, userLevel: number) => {
  switch (battleType) {
    case "RANDOM_ENCOUNTER":
    case "ARENA":
    case "TRAINING":
    case "QUEST":
      if (userLevel < 20) {
        return { width: 9, height: 8 };
      } else if (userLevel < 30) {
        return { width: 10, height: 9 };
      } else if (userLevel < 40) {
        return { width: 11, height: 10 };
      } else if (userLevel < 50) {
        return { width: 12, height: 10 };
      } else {
        return { width: 12, height: 10 };
      }
    case "COMBAT":
      return { width: 12, height: 10 };
    case "SPARRING":
      return { width: 12, height: 10 };
    case "KAGE_AI":
      return { width: 12, height: 10 };
    case "KAGE_PVP":
      return { width: 12, height: 10 };
    case "CLAN_CHALLENGE":
      return { width: 12, height: 10 };
    case "CLAN_BATTLE":
      return { width: 12, height: 10 };
    case "SHRINE_WAR":
      return { width: 12, height: 10 };
    case "TOURNAMENT":
      return { width: 12, height: 10 };
    case "VILLAGE_PROTECTOR":
      return { width: 12, height: 10 };
    case "RANKED_PVP":
      return { width: 12, height: 10 };
    case "RANKED_SPARRING":
      return { width: 12, height: 10 };
    case "RAID":
      return { width: 12, height: 10 };
  }
};

/**
 * Retrieves the full battle grid including border tiles for rendering assets.
 */
export const getBattleGrid = (
  hexsize: number,
  battle: ReturnedBattle,
  origin?: { x: number; y: number },
) => {
  const Tile = defineHex({
    dimensions: { width: hexsize, height: hexsize * HEX_ASPECT_RATIO },
    origin,
    orientation: Orientation.FLAT,
  });

  const grid = new Grid(Tile, rectangle({ width: battle.width, height: battle.height }))
    .filter((tile) => {
      try {
        return tile.width !== 0;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (e) {
        return false;
      }
    })
    .map((tile) => {
      tile.cost = 1;
      tile.name = `${String.fromCharCode(65 + tile.col)}${tile.row + 1}`;
      return tile;
    });
  return grid;
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
 * Checks if a user is stealthed based on their effects.
 *
 * @param userId - The ID of the user to check.
 * @param userEffects - An array of user effects to evaluate.
 * @returns `true` if the user is stealthed, otherwise `false`.
 */
export const isUserStealthed = (
  userId: string | undefined,
  userEffects: UserEffect[] | undefined,
) => {
  return userEffects?.some(
    (e) =>
      e.type === "stealth" &&
      e.targetId === userId &&
      !e.castThisRound &&
      "rounds" in e &&
      e.rounds &&
      e.rounds > 0,
  );
};

export const isUserSummonPrevented = (
  userId: string | undefined,
  userEffects: UserEffect[] | undefined,
) => {
  return userEffects?.some(
    (e) =>
      e.type === "summonprevent" &&
      e.targetId === userId &&
      !e.castThisRound &&
      "rounds" in e &&
      e.rounds &&
      e.rounds > 0,
  );
};

export const getUserElementalSeal = (
  userId: string | undefined,
  userEffects: UserEffect[] | undefined,
) => {
  return userEffects?.find(
    (e) =>
      e.type === "elementalseal" &&
      e.targetId === userId &&
      !e.castThisRound &&
      e.rounds &&
      e.rounds > 0,
  );
};

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
) => {
  return userEffects?.some(
    (e) => e.type === "moveprevent" && e.targetId === userId && !e.castThisRound,
  );
};

/** Get a copy of the barriers between two tiles on the grid, as well as the total absorbtion along that path */
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
    "increasepoolcost",
    "increasestat",
    "lifesteal",
    "moveprevent",
    "onehitkillprevent",
    "poison",
    "recoil",
    "reflect",
    "robprevent",
    "sealprevent",
    "stunprevent",
    "stealth",
    "summonprevent",
    "weakness",
    "shield",
  ];
  // If always apply, then apply 1 time, but not if rounds set to 0
  if (alwaysApply.includes(effect.type)) {
    if (effect.rounds !== undefined && effect.rounds === 0) {
      return 0;
    }
    return 1;
  }
  // Get latest application of effect to the given target
  let ratio = 1;
  if (trackResults && effect.rounds !== undefined && effect.timeTracker) {
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
  battle: ReturnedBattle,
) => {
  if (effect.rounds !== undefined && effect.createdRound !== undefined) {
    return { startRound: effect.createdRound, curRound: battle.round };
  }
  return { startRound: -1, curRound: battle.round };
};

/**
 * Filter for effects based on their duration
 */
export const isEffectActive = (effect: UserEffect | GroundEffect) => {
  // Check1: If rounds not specified on tag, then yes, still active
  if (effect.rounds === undefined) return true;
  // Check2: If rounds > 0 then still active
  if (effect.rounds > 0) return true;
  // If none of the above, then no longer active
  return false;
};

/**
 * Sort order in which effects are applied
 */
export const sortEffects = (
  a: UserEffect | GroundEffect,
  b: UserEffect | GroundEffect,
) => {
  const ordered: ZodAllTags["type"][] = [
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
    "weakness",
    // Pre-modifiers
    "elementalseal",
    "injectjutsus",
    "cleanse",
    "clear",
    "decreasepoolcost",
    "decreasestat",
    "increasepoolcost",
    "increasestat",
    // Mid-modifiers
    "barrier",
    "shield",
    "finalstand",
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
    // Post-moodifiers before pierce
    "decreasedamagegiven",
    "decreasedamagetaken",
    "increasedamagegiven",
    "increasedamagetaken",
    // Piercing damage
    "pierce",
    // Post-modifiers after pierce
    "lifesteal",
    "drain",
    "poison",
    "afterburn",
    "absorb",
    "recoil",
    "reflect",
    "wound",
    "decreaseheal",
    "increaseheal",
    "copy",
    "mirror",
    // Time effects
    "timecompression",
    "timedilation",
    // End-modifiers
    "move",
    "visual",
  ];
  if (ordered.includes(a.type) && ordered.includes(b.type)) {
    const aIndex = ordered.indexOf(a.type);
    const bIndex = ordered.indexOf(b.type);

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
  }
  return 0;
};

/**
 * Given an action, list of user effects, and a target, calculate pool cost for the action
 */
export const calcPoolCost = (
  action: CombatAction,
  usersEffects: UserEffect[],
  target: BattleUserState,
) => {
  let hpCost = action.healthCost;
  let cpCost = action.chakraCost;
  let spCost = action.staminaCost;
  usersEffects
    .filter(
      (e) =>
        ["increasepoolcost", "decreasepoolcost"].includes(e.type) &&
        e.targetId === target.userId,
    )
    .forEach((e) => {
      // Get the power to apply (positive or negative)
      let { power } = getPower(e);
      if (e.type === "increasepoolcost" && power < 0) power *= -1;
      if (e.type === "decreasepoolcost" && power > 0) power *= -1;
      // Apply the power to the pools affected
      if ("poolsAffected" in e) {
        e.poolsAffected?.forEach((pool) => {
          if (pool === "Health") {
            hpCost =
              e.calculation === "static"
                ? hpCost + power
                : (hpCost * (100 + power)) / 100;
          } else if (pool === "Chakra") {
            cpCost =
              e.calculation === "static"
                ? cpCost + power
                : (cpCost * (100 + power)) / 100;
          } else if (pool === "Stamina") {
            spCost =
              e.calculation === "static"
                ? spCost + power
                : (spCost * (100 + power)) / 100;
          }
        });
      }
    });
  return { hpCost, cpCost, spCost };
};

/**
 * A reducer for collapsing a Map<string, Consequence> into a Consequence[]
 */
export const collapseConsequences = (acc: Consequence[], val: Consequence) => {
  const current = acc.find((c) => c.targetId === val.targetId);
  if (current) {
    if (val.damage) {
      current.damage = current.damage ? current.damage + val.damage : val.damage;
    }
    if (val.residual) {
      current.residual = current.residual
        ? current.residual + val.residual
        : val.residual;
    }
    if (val.heal_hp) {
      current.heal_hp = current.heal_hp
        ? Math.max(current.heal_hp, val.heal_hp)
        : val.heal_hp;
    }
    if (val.heal_sp) {
      current.heal_sp = current.heal_sp
        ? Math.max(current.heal_sp, val.heal_sp)
        : val.heal_sp;
    }
    if (val.heal_cp) {
      current.heal_cp = current.heal_cp
        ? Math.max(current.heal_cp, val.heal_cp)
        : val.heal_cp;
    }
    if (val.reflect) {
      current.reflect = current.reflect ? current.reflect + val.reflect : val.reflect;
    }
    if (val.recoil) {
      current.recoil = current.recoil ? current.recoil + val.recoil : val.recoil;
    }
    if (val.lifesteal_hp) {
      current.lifesteal_hp = current.lifesteal_hp
        ? current.lifesteal_hp + val.lifesteal_hp
        : val.lifesteal_hp;
    }
    if (val.absorb_hp) {
      current.absorb_hp = current.absorb_hp
        ? current.absorb_hp + val.absorb_hp
        : val.absorb_hp;
    }
    if (val.absorb_sp) {
      current.absorb_sp = current.absorb_sp
        ? current.absorb_sp + val.absorb_sp
        : val.absorb_sp;
    }
    if (val.absorb_cp) {
      current.absorb_cp = current.absorb_cp
        ? current.absorb_cp + val.absorb_cp
        : val.absorb_cp;
    }
    if (val.types) {
      current.types = current.types ? current.types.concat(val.types) : val.types;
    }
    if (val.drain_hp) {
      current.drain_hp = current.drain_hp
        ? current.drain_hp + val.drain_hp
        : val.drain_hp;
    }
    if (val.drain_cp) {
      current.drain_cp = current.drain_cp
        ? current.drain_cp + val.drain_cp
        : val.drain_cp;
    }
    if (val.drain_sp) {
      current.drain_sp = current.drain_sp
        ? current.drain_sp + val.drain_sp
        : val.drain_sp;
    }
    if (val.poison) {
      current.poison = current.poison ? current.poison + val.poison : val.poison;
    }
    if (val.wound) {
      current.wound = current.wound ? current.wound + val.wound : val.wound;
    }
  } else {
    acc.push(val);
  }
  return acc;
};

/**
 * Masks user state to hide private information from other players.
 * Returns public state for opponents and full state for the session user.
 */
const maskUsersState = (
  usersState: BattleUserState[],
  userId: string,
): ReturnedUserState[] => {
  return usersState.map((user) => {
    if (user.controllerId !== userId) {
      return Object.fromEntries(
        publicState.map((key) => [key, user[key]]),
      ) as unknown as ReturnedUserState;
    } else {
      return Object.fromEntries(
        allState.map((key) => [key, user[key]]),
      ) as unknown as ReturnedUserState;
    }
  });
};

/**
 * Masks information from a battle prior to returning it to the frontend,
 * i.e. do not leak opponents stats
 */
export const maskBattle = (battle: Battle, userId: string) => {
  return {
    ...battle,
    usersState: maskUsersState(battle.usersState, userId),
  };
};

/**
 * Masks a battle for returning dynamic updates (excludes extraState).
 * Used by performAction to send only the fields that changed during combat.
 * Frontend should merge this with existing extraState from initial battle fetch.
 */
export const maskBattleDynamic = (
  battle: Battle,
  userId: string,
): ReturnedBattleDynamic => {
  const { extraState: _extraState, ...dynamicBattle } = battle;
  void _extraState; // Intentionally excluded from dynamic updates
  return {
    ...dynamicBattle,
    usersState: maskUsersState(dynamicBattle.usersState, userId),
  };
};

/**
 * Figure out if user is still in battle, and if not whether the user won or lost
 */
export const calcBattleResult = (
  battle: CompleteBattle,
  userId: string,
  settings?: GameSetting[],
): CombatResult | null => {
  const battleType = battle.battleType;
  // Use users directly from battle state - lookup functions get full data when needed
  const users = battle.usersState;
  const user = users.find((u) => u.userId === userId);
  if (user && !user.leftBattle) {
    // If single village, then friends/targets are the opposing team. If MPvP, separate by village
    const villageIds = [
      ...new Set(users.filter((u) => !u.isSummon).map((u) => u.villageId)),
    ];
    let targets: BattleUserState[] = [];
    let friends: BattleUserState[] = [];
    if (battleType === "CLAN_BATTLE") {
      targets = users.filter((u) => u.clanId !== user.clanId && !u.isSummon);
      friends = users.filter((u) => u.clanId === user.clanId && !u.isSummon);
    } else if (villageIds.length === 1) {
      targets = users.filter((u) => u.controllerId !== userId && !u.isSummon);
      friends = users.filter((u) => u.controllerId === userId && !u.isSummon);
    } else {
      targets = users.filter((u) => u.villageId !== user.villageId && !u.isSummon);
      friends = users.filter((u) => u.villageId === user.villageId && !u.isSummon);
    }
    const survivingTargets = targets.filter(stillInBattle);
    if (!stillInBattle(user) || survivingTargets.length === 0) {
      // Update the user left
      user.leftBattle = true;

      // Calculate ELO change
      const uExp = friends.reduce((a, b) => a + b.experience, 0) / friends.length;
      const oExp = targets.reduce((a, b) => a + b.experience, 0) / targets.length;
      const didWin = user.curHealth > 0 && !user.fledBattle;
      const maxGain = 32;

      // Check if we have a shrine boost - look up village from staticData
      const village = getVillage(battle, user.villageId);
      const sectors = village?.sectors?.length || 0;
      const shrineBoost = getShrineBoost(sectors, "PVP", village);
      const shrineBoostFactor = shrineBoost ? 1 + shrineBoost : 1;

      // Experience boost
      let expBoost = 1;
      if (battleType === "ARENA") {
        village?.structures?.forEach((s) => {
          expBoost += (s.arenaRewardPerLvl * getEffectiveStructureLevel(s)) / 100;
        });
      }
      const userClan = getClan(battle, user.clanId);
      if (userClan?.trainingBoost && userClan.trainingBoost > 0) {
        expBoost += userClan.trainingBoost / 100;
      }

      // Calculate ELO change if user had won.
      let eloDiff = Math.max(calcEloChange(uExp, oExp || 1000, maxGain, true), 0.02);

      // If killing ally, then no experience (unless in war-torn sector)
      // Note: isInWarTornSector is declared later in the prestige calculation section
      const isInWarTornSectorForExp = user.sector === MAP_WAR_TORN_BATTLEGROUND_SECTOR;
      if (
        battleType === "COMBAT" &&
        villageIds.length === 1 &&
        !isInWarTornSectorForExp
      ) {
        eloDiff = 0;
      }

      // Calculate Experience gain
      let experience = didWin ? eloDiff * expBoost : 0;
      const streakBonus = 1 + user.pvpStreak * 0.05; // 5% per streak
      if (["COMBAT", "TOURNAMENT"].includes(battleType)) {
        experience *= 10;
        if (battleType === "COMBAT") {
          experience *= streakBonus;
        }
      } else if (
        [
          "CLAN_CHALLENGE",
          "KAGE_AI",
          "KAGE_PVP",
          "TRAINING",
          "VILLAGE_PROTECTOR",
          "RANKED_PVP",
        ].includes(battleType)
      ) {
        experience = 0;
      } else if (battleType === "ARENA") {
        experience = Math.min(experience, 20);
      }

      // Scale experience based on reward scaling
      experience *= battle.rewardScaling * shrineBoostFactor;

      // Apply battle arena exp multiplier if available
      if (settings && (battleType === "ARENA" || battleType === "COMBAT")) {
        const arenaSetting = settings.find((s) => s.name === "battleExpMultiplier");
        if (arenaSetting) {
          const secondsLeft = -secondsPassed(arenaSetting.time);
          if (secondsLeft > 0 && arenaSetting.value > 0) {
            experience *= arenaSetting.value;
          }
        }
      }

      // Find users who did not leave battle yet
      const friendsUsers = friends.filter((u) => !u.isAi);
      const targetUsers = targets.filter((u) => !u.isAi);
      const friendsLeft = friendsUsers.filter((u) => !u.leftBattle);
      const targetsLeft = targetUsers.filter((u) => !u.leftBattle);
      const friendsAlive = friends.filter((u) => u.curHealth > 0).length;
      const targetsAlive = targets.filter((u) => u.curHealth > 0).length;
      const totalAlive = friendsAlive + targetsAlive;
      const allOpponentsFled = targets.every((u) => u.fledBattle);

      // Figure outcome status from battle
      const outcome = user.fledBattle
        ? "Fled"
        : totalAlive > 0
          ? didWin
            ? "Won"
            : "Lost"
          : "Draw";

      // Ranked PvP LP change - handle draws
      let lpDiff = 0;
      if (battleType === "RANKED_PVP" && targets[0]) {
        if (outcome === "Draw") {
          // Both players gain 10 LP for draws
          lpDiff = 10;
        } else {
          lpDiff = calculateLpEloChange(user, targets[0], didWin, []);
        }
      }

      // Tokens & prestige
      let deltaTokens = 0;
      let deltaPrestige = 0;
      let deltaAnbuPoints = 0;
      let clanPoints = 0;
      let deltaEarnedExperience = 0;

      // Money/ryo calculation
      const moneyBoost = userClan?.ryoBoost ? 1 + userClan.ryoBoost / 100 : 1;
      const isCombatOrWarBattle =
        battleType === "COMBAT" || battleType === "SHRINE_WAR";
      let moneyDelta = didWin
        ? (isCombatOrWarBattle && isInWarTornSectorForExp
            ? WAR_TORN_SECTOR_BASE_MONEY
            : randomInt(30, 40) + user.level) * moneyBoost
        : 0;

      // If combat, more money
      if (battleType === "COMBAT") {
        moneyDelta *= 1.5;
      }

      // If ranked PVP, add benefits
      if (battleType === "RANKED_PVP") {
        if (didWin) {
          moneyDelta = 3000;
          deltaTokens += 400;
          deltaPrestige += 400;
          deltaEarnedExperience += 100;
        }
      }

      // Include money stolen during combat
      if (battleType === "COMBAT" && user.moneyStolen) {
        if (user.moneyStolen > 0 && outcome !== "Won") {
          user.moneyStolen = 0;
        } else if (user.moneyStolen < 0 && outcome === "Won") {
          user.moneyStolen = 0;
        }
      } else {
        user.moneyStolen = 0;
      }

      // Prestige calculation
      if (["KAGE_AI", "KAGE_PVP"].includes(battleType)) {
        if (!didWin && user.isAggressor) {
          deltaPrestige = -KAGE_PRESTIGE_COST;
        }
        if (didWin && !user.isAggressor) {
          deltaPrestige = KAGE_CHALLENGE_WIN_PRESTIGE;
        }
      }

      // Check for clan points
      if (didWin && !allOpponentsFled) {
        if (user.clanId) clanPoints += 1;
        if (battleType === "CLAN_BATTLE") clanPoints += CLAN_BATTLE_REWARD_POINTS;
      }

      // Check for prestige, tokens, etc.
      const vilId = user.villageId;
      const isInWarTornSector = user.sector === MAP_WAR_TORN_BATTLEGROUND_SECTOR;
      if (didWin && battleType === "COMBAT" && user.isAggressor) {
        targetUsers.forEach((target) => {
          if (user.isOutlaw) {
            deltaPrestige += KILLING_NOTORIETY_GAIN;
          } else {
            // Prestige deduction for killing allies (skip if in war-torn sector)
            if (!isInWarTornSector) {
              const targetRelations = getRelationsArray(battle, target);
              const isAlly = targetRelations
                .filter((r) => r.status === "ALLY")
                .find(
                  (r) =>
                    (r.villageIdA === vilId && r.villageIdB === target.villageId) ||
                    (r.villageIdA === target.villageId && r.villageIdB === vilId),
                );
              const sameVillage = target.villageId === vilId;
              deltaPrestige -= isAlly || sameVillage ? FRIENDLY_PRESTIGE_COST : 0;
            }
          }

          // Base prestige for PvP kill (only for enemies, even in war-torn sector)
          const targetRelationsAll = getRelationsArray(battle, target);
          if (
            user.isOutlaw ||
            !targetRelationsAll.some(
              (r) =>
                (r.status === "ALLY" &&
                  ((r.villageIdA === vilId && r.villageIdB === target.villageId) ||
                    (r.villageIdA === target.villageId && r.villageIdB === vilId))) ||
                target.villageId === vilId,
            )
          ) {
            const isUserAssassin =
              user.isOutlaw && checkAssassin(user.userId, userClan);

            deltaPrestige += user.anbuId
              ? PVP_KILL_PRESTIGE_REWARD_ANBU
              : isUserAssassin
                ? PVP_KILL_PRESTIGE_REWARD_ASSASSIN
                : PVP_KILL_PRESTIGE_REWARD;

            // Base village tokens for PvP kill (only for enemies)
            deltaTokens += user.anbuId
              ? PVP_KILL_TOKEN_REWARD_ANBU
              : isUserAssassin
                ? PVP_KILL_TOKEN_REWARD_ASSASSIN
                : PVP_KILL_TOKEN_REWARD;

            // ANBU points for PvP kill (only if target is not more than 10 levels under)
            if (user.anbuId && user.level - target.level <= 10) {
              deltaAnbuPoints += PVP_KILL_ANBU_POINTS_REWARD;
            }
          }

          // Additional village tokens for killing enemies
          deltaTokens +=
            targetRelationsAll
              .filter((r) => r.status === "ENEMY")
              .filter(
                (r) =>
                  (r.villageIdA === vilId && r.villageIdB === target.villageId) ||
                  (r.villageIdA === target.villageId && r.villageIdB === vilId),
              ).length * 5;
        });
      }

      // Determine war kills bonus
      const warHealthInfo: Record<string, number> = {};
      const shrineInfo: Record<number, number> = {};
      // Track attacker and defender shrine changes separately per war
      const villageWarShrineInfo: Record<
        string,
        { attacker: number; defender: number }
      > = {};
      const villageWarShrineDisplay: Record<string, number> = {};
      const warIdToDisplayName: Record<string, string> = {};
      let warHealthChange = 0;
      let shrineChangeHp = 0;
      // Skip war updates if kill happened in war-torn sector
      const isInWarTornSectorForWar = user.sector === MAP_WAR_TORN_BATTLEGROUND_SECTOR;
      const userWars = getWarsArray(battle, user);
      if (!user.fledBattle && !isInWarTornSectorForWar) {
        targets
          .filter((t) => !t.isSummon)
          .filter((t) => t.villageId !== vilId)
          .forEach((target) => {
            // Get user and target village ids
            const userVillageId = user.villageId;
            const targetVillageId = target.villageId;
            // Get the war from the target, and also search through warAllies
            const targetWars = getWarsArray(battle, target);
            const wars = findWarsWithUser(
              targetWars,
              userWars,
              targetVillageId,
              userVillageId,
            );
            wars.forEach((war) => {
              // Determine if the user is on the attacker side (either as main attacker or ally)
              const isUserOnAttackerSide =
                war.attackerVillageId === userVillageId ||
                war.warAllies?.some(
                  (ally) =>
                    ally.villageId === userVillageId &&
                    ally.supportVillageId === war.attackerVillageId,
                );
              // Get the names of the village
              const userVillageName = isUserOnAttackerSide
                ? war?.attackerVillage?.name || ""
                : war?.defenderVillage?.name || "";
              const targetVillageName = isUserOnAttackerSide
                ? war?.defenderVillage?.name || ""
                : war?.attackerVillage?.name || "";
              // Reset to 0 if not in warHealthInfo
              if (targetVillageName && !(targetVillageName in warHealthInfo)) {
                warHealthInfo[targetVillageName] = 0;
              }
              if (userVillageName && !(userVillageName in warHealthInfo)) {
                warHealthInfo[userVillageName] = 0;
              }
              // Derived
              const isUserFactionColeader =
                user.isOutlaw && checkCoLeader(user.userId, userClan);
              const targetClan = getClan(battle, target.clanId);
              const isTargetFactionColeader =
                target.isOutlaw && checkCoLeader(target.userId, targetClan);
              const isUserAssassin =
                user.isOutlaw && checkAssassin(user.userId, userClan);
              const isTargetAssassin =
                target.isOutlaw && checkAssassin(target.userId, targetClan);

              // Village wars & raids
              if (
                ["VILLAGE_WAR", "WAR_RAID"].includes(war.type) &&
                battleType === "COMBAT"
              ) {
                const targetVillage = getVillage(battle, target.villageId);
                if (didWin) {
                  if (village?.kageId === user.userId) {
                    warHealthChange += WAR_HEALTH_KAGE_RECOVER;
                    warHealthInfo[userVillageName]! += WAR_HEALTH_KAGE_RECOVER;
                    warHealthInfo[targetVillageName]! -= WAR_HEALTH_KAGE_REMOVE;
                  } else if (user.rank === "ELDER") {
                    warHealthChange += WAR_HEALTH_ELDER_RECOVER;
                    warHealthInfo[userVillageName]! += WAR_HEALTH_ELDER_RECOVER;
                    warHealthInfo[targetVillageName]! -= WAR_HEALTH_ELDER_REMOVE;
                  } else if (isUserFactionColeader) {
                    warHealthChange += WAR_HEALTH_COLEADER_RECOVER;
                    warHealthInfo[userVillageName]! += WAR_HEALTH_COLEADER_RECOVER;
                    warHealthInfo[targetVillageName]! -= WAR_HEALTH_COLEADER_REMOVE;
                  } else if (user.anbuId) {
                    warHealthChange += WAR_HEALTH_ANBU_RECOVER;
                    warHealthInfo[userVillageName]! += WAR_HEALTH_ANBU_RECOVER;
                    warHealthInfo[targetVillageName]! -= WAR_HEALTH_ANBU_REMOVE;
                  } else if (isUserAssassin) {
                    warHealthChange += WAR_HEALTH_ASSASSIN_RECOVER;
                    warHealthInfo[userVillageName]! += WAR_HEALTH_ASSASSIN_RECOVER;
                    warHealthInfo[targetVillageName]! -= WAR_HEALTH_ASSASSIN_REMOVE;
                  } else {
                    warHealthChange += WAR_HEALTH_RECOVER;
                    warHealthInfo[userVillageName]! += WAR_HEALTH_RECOVER;
                    warHealthInfo[targetVillageName]! -= WAR_HEALTH_REMOVE;
                  }
                  if (targetVillage?.kageId === target.userId) {
                    warHealthInfo[targetVillageName]! -= WAR_HEALTH_KAGEDEATH_REMOVE;
                  }
                } else {
                  if (targetVillage?.kageId === target.userId) {
                    warHealthChange -= WAR_HEALTH_KAGE_REMOVE;
                    warHealthInfo[userVillageName]! -= WAR_HEALTH_KAGE_REMOVE;
                  } else if (target.rank === "ELDER") {
                    warHealthChange -= WAR_HEALTH_ELDER_REMOVE;
                    warHealthInfo[userVillageName]! -= WAR_HEALTH_ELDER_REMOVE;
                  } else if (isTargetFactionColeader) {
                    warHealthChange -= WAR_HEALTH_COLEADER_REMOVE;
                    warHealthInfo[userVillageName]! -= WAR_HEALTH_COLEADER_REMOVE;
                  } else if (target.anbuId) {
                    warHealthChange -= WAR_HEALTH_ANBU_REMOVE;
                    warHealthInfo[userVillageName]! -= WAR_HEALTH_ANBU_REMOVE;
                  } else if (isTargetAssassin) {
                    warHealthChange -= WAR_HEALTH_ASSASSIN_REMOVE;
                    warHealthInfo[userVillageName]! -= WAR_HEALTH_ASSASSIN_REMOVE;
                  } else {
                    warHealthChange -= WAR_HEALTH_REMOVE;
                    warHealthInfo[userVillageName]! -= WAR_HEALTH_REMOVE;
                  }
                  if (village?.kageId === user.userId) {
                    warHealthChange -= WAR_HEALTH_KAGEDEATH_REMOVE;
                    warHealthInfo[userVillageName]! -= WAR_HEALTH_KAGEDEATH_REMOVE;
                  }
                }
              }
              // Sector wars
              if (war.type === "SECTOR_WAR") {
                const sector = war.sector;
                if (!(sector in shrineInfo)) {
                  shrineInfo[sector] = 0;
                }
                if (battleType === "SHRINE_WAR") {
                  if (
                    (didWin && war.attackerVillageId === vilId) ||
                    (!didWin && war.defenderVillageId === vilId)
                  ) {
                    shrineChangeHp -= WAR_SECTORWAR_AI_SHRINE_REDUCE;
                    shrineInfo[sector]! -= WAR_SECTORWAR_AI_SHRINE_REDUCE;
                  } else {
                    shrineChangeHp += WAR_SECTORWAR_AI_SHRINE_RECOVER;
                    shrineInfo[sector]! += WAR_SECTORWAR_AI_SHRINE_RECOVER;
                  }
                }
                if (battleType === "COMBAT") {
                  if (
                    (didWin && war.attackerVillageId === vilId) ||
                    (!didWin && war.defenderVillageId === vilId)
                  ) {
                    if (didWin) shrineChangeHp -= WAR_SECTORWAR_PVP_SHRINE_REDUCE;
                    shrineInfo[sector]! -= WAR_SECTORWAR_PVP_SHRINE_REDUCE;
                  } else {
                    if (didWin) shrineChangeHp += WAR_SECTORWAR_PVP_SHRINE_RECOVER;
                    shrineInfo[sector]! += WAR_SECTORWAR_PVP_SHRINE_RECOVER;
                  }
                }
              }
              // Village wars and raids - abstract shrine HP mechanic
              // Track per-war to avoid accumulation bug when a user is in multiple wars
              // Track attacker and defender shrine changes separately
              if (["VILLAGE_WAR", "WAR_RAID"].includes(war.type)) {
                if (!(war.id in villageWarShrineInfo)) {
                  villageWarShrineInfo[war.id] = { attacker: 0, defender: 0 };
                  // Create display name for this war using village names
                  const attackerName = war.attackerVillage?.name ?? "Attacker";
                  const defenderName = war.defenderVillage?.name ?? "Defender";
                  warIdToDisplayName[war.id] = `${attackerName} vs ${defenderName}`;
                }
                const isUserOnAttackerSide =
                  war.attackerVillageId === vilId ||
                  war.warAllies?.some(
                    (ally) =>
                      ally.villageId === vilId &&
                      ally.supportVillageId === war.attackerVillageId,
                  );
                const isUserOnDefenderSide =
                  war.defenderVillageId === vilId ||
                  war.warAllies?.some(
                    (ally) =>
                      ally.villageId === vilId &&
                      ally.supportVillageId === war.defenderVillageId,
                  );

                // Determine which shrine is being targeted based on user's sector
                const atAttackerVillage = war.attackerVillage?.sector === user.sector;
                const atDefenderVillage = war.defenderVillage?.sector === user.sector;

                // AI shrine battles (SHRINE_WAR) - attacking the shrine directly
                if (battleType === "SHRINE_WAR") {
                  if (didWin) {
                    if (isUserOnAttackerSide && atDefenderVillage) {
                      // Attacker wins at defender's shrine: defender shrine HP down
                      villageWarShrineInfo[war.id]!.defender -=
                        WAR_SECTORWAR_AI_SHRINE_REDUCE;
                    } else if (isUserOnAttackerSide && atAttackerVillage) {
                      // Attacker wins defending own shrine: attacker shrine HP up
                      villageWarShrineInfo[war.id]!.attacker +=
                        WAR_SECTORWAR_AI_SHRINE_RECOVER;
                    } else if (isUserOnDefenderSide && atAttackerVillage) {
                      // Defender wins at attacker's shrine: attacker shrine HP down
                      villageWarShrineInfo[war.id]!.attacker -=
                        WAR_SECTORWAR_AI_SHRINE_REDUCE;
                    } else if (isUserOnDefenderSide && atDefenderVillage) {
                      // Defender wins defending own shrine: defender shrine HP up
                      villageWarShrineInfo[war.id]!.defender +=
                        WAR_SECTORWAR_AI_SHRINE_RECOVER;
                    }
                  }
                }

                // PvP battles (COMBAT) - affect shrine based on where battle occurred
                if (battleType === "COMBAT") {
                  if (didWin) {
                    if (atDefenderVillage) {
                      // Battle at defender village affects defender shrine
                      if (isUserOnAttackerSide) {
                        // Attacker kills defender at defender village: defender shrine HP down
                        villageWarShrineInfo[war.id]!.defender -=
                          WAR_SECTORWAR_PVP_SHRINE_REDUCE;
                      } else if (isUserOnDefenderSide) {
                        // Defender kills attacker at own village: defender shrine HP up
                        villageWarShrineInfo[war.id]!.defender +=
                          WAR_SECTORWAR_PVP_SHRINE_RECOVER;
                      }
                    } else if (atAttackerVillage) {
                      // Battle at attacker village affects attacker shrine
                      if (isUserOnDefenderSide) {
                        // Defender kills attacker at attacker village: attacker shrine HP down
                        villageWarShrineInfo[war.id]!.attacker -=
                          WAR_SECTORWAR_PVP_SHRINE_REDUCE;
                      } else if (isUserOnAttackerSide) {
                        // Attacker kills defender at own village: attacker shrine HP up
                        villageWarShrineInfo[war.id]!.attacker +=
                          WAR_SECTORWAR_PVP_SHRINE_RECOVER;
                      }
                    }
                  }
                }
              }
            });
          });

        // Handle SHRINE_WAR village wars separately for defend scenarios
        // When defending own shrine, AI target has same villageId as user, so normal
        // target loop doesn't process it. Handle this case based on user's wars directly.
        if (battleType === "SHRINE_WAR" && didWin) {
          userWars
            .filter((w) => ["VILLAGE_WAR", "WAR_RAID"].includes(w.type))
            .forEach((war) => {
              const isUserOnAttackerSide =
                war.attackerVillageId === vilId ||
                war.warAllies?.some(
                  (ally) =>
                    ally.villageId === vilId &&
                    ally.supportVillageId === war.attackerVillageId,
                );
              const isUserOnDefenderSide =
                war.defenderVillageId === vilId ||
                war.warAllies?.some(
                  (ally) =>
                    ally.villageId === vilId &&
                    ally.supportVillageId === war.defenderVillageId,
                );

              const atAttackerVillage = war.attackerVillage?.sector === user.sector;
              const atDefenderVillage = war.defenderVillage?.sector === user.sector;

              // Check if this is a defend scenario (at own village)
              const isDefendScenario =
                (isUserOnAttackerSide && atAttackerVillage) ||
                (isUserOnDefenderSide && atDefenderVillage);

              // Skip if not a defend scenario (attack scenarios are handled by target loop)
              if (!isDefendScenario) return;

              // Initialize war entry if not exists
              if (!(war.id in villageWarShrineInfo)) {
                villageWarShrineInfo[war.id] = { attacker: 0, defender: 0 };
                const attackerName = war.attackerVillage?.name ?? "Attacker";
                const defenderName = war.defenderVillage?.name ?? "Defender";
                warIdToDisplayName[war.id] = `${attackerName} vs ${defenderName}`;
              }

              // Apply shrine HP recovery for defend
              if (isUserOnAttackerSide && atAttackerVillage) {
                // Attacker wins defending own shrine: attacker shrine HP up
                villageWarShrineInfo[war.id]!.attacker +=
                  WAR_SECTORWAR_AI_SHRINE_RECOVER;
              } else if (isUserOnDefenderSide && atDefenderVillage) {
                // Defender wins defending own shrine: defender shrine HP up
                villageWarShrineInfo[war.id]!.defender +=
                  WAR_SECTORWAR_AI_SHRINE_RECOVER;
              }
            });
        }
      }

      // Scale everything based on reward scaling
      shrineChangeHp *= battle.rewardScaling;
      warHealthChange *= battle.rewardScaling;
      Object.keys(shrineInfo).forEach((sector) => {
        shrineInfo[sector as unknown as number]! *= battle.rewardScaling;
      });
      Object.keys(warHealthInfo).forEach((name) => {
        warHealthInfo[name]! *= battle.rewardScaling;
      });
      Object.keys(villageWarShrineInfo).forEach((warId) => {
        villageWarShrineInfo[warId]!.attacker *= battle.rewardScaling;
        villageWarShrineInfo[warId]!.defender *= battle.rewardScaling;
      });

      // Adjust shrine & townhall datamage based on level different
      const maxTargetLevel = Math.max(...targetUsers.map((t) => t.level), 0);
      if (Math.abs(user.level - maxTargetLevel) > STREAK_LEVEL_DIFF) {
        // Check if any kage was killed in this battle
        const targetKageLost =
          targets.some((target) => {
            const tVillage = getVillage(battle, target.villageId);
            return tVillage?.kageId === target.userId;
          }) && didWin;
        const userKageLost = village?.kageId === user.userId && !didWin;
        const kageLost = targetKageLost || userKageLost;
        const strongestWon = user.level > maxTargetLevel && didWin;
        const weakestLost = user.level < maxTargetLevel && !didWin;
        // If kage was killed, we preserve all war damage, otherwise reduce all changes to 1/abs(change) if we're the stronger player
        if (!kageLost && (strongestWon || weakestLost)) {
          if (shrineChangeHp !== 0) {
            shrineChangeHp /= Math.abs(shrineChangeHp);
          }
          if (warHealthChange !== 0) {
            warHealthChange /= Math.abs(warHealthChange);
          }
          Object.keys(shrineInfo).forEach((sector) => {
            const abs = Math.abs(shrineInfo[sector as unknown as number]!);
            if (abs !== 0) shrineInfo[sector as unknown as number]! /= abs;
          });
          Object.keys(warHealthInfo).forEach((name) => {
            const abs = Math.abs(warHealthInfo[name]!);
            if (abs !== 0) warHealthInfo[name]! /= abs;
          });
          Object.keys(villageWarShrineInfo).forEach((warId) => {
            const absAttacker = Math.abs(villageWarShrineInfo[warId]!.attacker);
            const absDefender = Math.abs(villageWarShrineInfo[warId]!.defender);
            if (absAttacker !== 0) villageWarShrineInfo[warId]!.attacker /= absAttacker;
            if (absDefender !== 0) villageWarShrineInfo[warId]!.defender /= absDefender;
          });
        }
      }

      // Convert villageWarShrineInfo to display-friendly format using war names
      // Combine attacker and defender changes for display purposes
      Object.keys(villageWarShrineInfo).forEach((warId) => {
        const displayName = warIdToDisplayName[warId] ?? warId;
        const info = villageWarShrineInfo[warId]!;
        villageWarShrineDisplay[displayName] = info.attacker + info.defender;
      });

      // Determine if pvpStreak should be adjusted
      const calculatePvpStreak = (
        battleType: string,
        user: { level: number; pvpStreak: number; isAggressor: boolean },
        targets: { level: number }[],
        didWin: boolean,
      ): number => {
        if (battleType !== "COMBAT") {
          return user.pvpStreak;
        }
        const maxTargetLevel = Math.max(...targets.map((t) => t.level), 0);
        const levelDifference = user.level - maxTargetLevel;
        if (user.isAggressor && levelDifference > STREAK_LEVEL_DIFF) {
          return user.pvpStreak;
        }
        if (didWin) {
          return user.pvpStreak + 1;
        }
        if (user.isAggressor || levelDifference > -STREAK_LEVEL_DIFF) {
          return 0;
        }
        return user.pvpStreak;
      };

      // Check if any bounties were claimed
      const bountiesClaimed: {
        bountyId: string;
        hunterId: string;
        amountRyo: number;
      }[] = [];
      if (battleType === "COMBAT" && didWin) {
        const userBountySignups = getUserBountySignups(battle, user.controllerId);
        userBountySignups.forEach((signup) => {
          targets
            .filter((t) => {
              const targetBounties = getUserBounties(battle, t.controllerId);
              return targetBounties.find((b) => b.id === signup.bountyId);
            })
            .forEach((t) => {
              const targetBounties = getUserBounties(battle, t.controllerId);
              const bounty = targetBounties.find((b) => b.id === signup.bountyId);
              if (bounty) {
                bountiesClaimed.push({
                  bountyId: bounty.id,
                  hunterId: user.userId,
                  amountRyo: bounty.amountRyo,
                });
              }
            });
        });
      }

      // Roll item drops from defeated opponents and include in result for frontend display
      const droppedItems: DroppedItem[] = [];
      if (didWin) {
        targets
          .filter((t) => !t.isSummon && t.isAi)
          .forEach((t) => {
            t.items.forEach((ui) => {
              const chance = ui.dropChancePerc ?? 0;
              if (chance > 0 && Math.random() * 100 < chance) {
                const itemData = getItem(battle, ui.itemId);
                droppedItems.push({
                  itemId: ui.itemId,
                  name: itemData?.name ?? "Item",
                  userItemId: ui.id,
                  fromUserId: t.userId,
                });
              }
            });
          });
      }

      // Result object
      const result: CombatResult = {
        outcome: outcome,
        didWin: didWin ? 1 : 0,
        eloDiff: eloDiff,
        lpDiff: lpDiff,
        experience: 0.01,
        earnedExperience: 0,
        pvpStreak: calculatePvpStreak(battleType, user, targets, didWin),
        curHealth: user.curHealth,
        curStamina: user.curStamina,
        curChakra: user.curChakra,
        strength: 0,
        intelligence: 0,
        willpower: 0,
        speed: 0,
        ninjutsuOffence: 0,
        genjutsuOffence: 0,
        taijutsuOffence: 0,
        bukijutsuOffence: 0,
        ninjutsuDefence: 0,
        genjutsuDefence: 0,
        taijutsuDefence: 0,
        bukijutsuDefence: 0,
        money: 0,
        seichiSilver: 0,
        villagePrestige: deltaPrestige,
        friendsLeft: friendsLeft.length,
        targetsLeft: targetsLeft.length,
        villageTokens: deltaTokens,
        anbuPoints: deltaAnbuPoints,
        warHealthChange: warHealthChange,
        shrineChangeHp: shrineChangeHp,
        shrineInfo: shrineInfo,
        warHealthInfo: warHealthInfo,
        villageWarShrineInfo: villageWarShrineInfo,
        villageWarShrineDisplay: villageWarShrineDisplay,
        clanPoints: clanPoints * battle.rewardScaling,
        notifications: [],
        bountiesClaimed: bountiesClaimed,
        droppedItems: droppedItems,
      };

      // Things to reward for non-spars
      const noRewardBattles = ["SPARRING", "TRAINING", "RANKED_PVP", "RANKED_SPARRING"];
      if (!noRewardBattles.includes(battleType)) {
        // Money stolen/given
        result.money = moneyDelta * battle.rewardScaling + user.moneyStolen;
        // If any stats were used, distribute exp change on stats.
        // If not, then distribute equally among all stats & generals
        const statsTotal = Object.values(user.usedStats).reduce(
          (sum, value) => sum + value,
          0,
        );
        const gensTotal = Object.values(user.usedGenerals).reduce(
          (sum, value) => sum + value,
          0,
        );
        let total = statsTotal + gensTotal;
        if (total === 0) {
          user.usedStats = {
            ninjutsuOffence: 1,
            genjutsuOffence: 1,
            taijutsuOffence: 1,
            bukijutsuOffence: 1,
            ninjutsuDefence: 1,
            genjutsuDefence: 1,
            taijutsuDefence: 1,
            bukijutsuDefence: 1,
          };
          user.usedGenerals = {
            strength: 1,
            intelligence: 1,
            willpower: 1,
            speed: 1,
          };
          total = 12;
        }
        let assignedExp = 0;
        const { stats_cap, gens_cap } = getUserCaps(user.rank);

        Object.entries(user.usedStats).forEach(([stat, value]) => {
          assignedExp += distributeExpToStat(
            user,
            stat as keyof typeof user.usedStats,
            value,
            stats_cap,
            total,
            experience,
            result,
          );
        });
        Object.entries(user.usedGenerals).forEach(([stat, value]) => {
          assignedExp += distributeExpToStat(
            user,
            stat as keyof typeof user.usedGenerals,
            value,
            gens_cap,
            total,
            experience,
            result,
          );
        });

        // Experience
        result.experience = Math.floor(assignedExp * 100) / 100;
      }

      // Ensure Ranked PvP winner rewards are applied despite noRewardBattles gating
      if (battleType === "RANKED_PVP" && didWin) {
        // Money (respect global reward scaling)
        result.money = moneyDelta * battle.rewardScaling;
        result.earnedExperience = deltaEarnedExperience * battle.rewardScaling;
        result.villageTokens = deltaTokens * battle.rewardScaling;
        result.villagePrestige = deltaPrestige * battle.rewardScaling;
      }

      // Apply 1.6x multiplier to all PvP rewards in war-torn sector
      // Allow both COMBAT and war battle types (SHRINE_WAR, etc.) in war-torn sector
      if (isCombatOrWarBattle && isInWarTornSectorForExp && didWin) {
        result.experience *= 1.6;
        result.money *= 1.6;
        result.earnedExperience *= 1.6;

        // Silver drop chance for kills in war-torn sector (using same diminishing returns as rewards)
        // Check level difference is within 10 levels
        if (targets.length > 0) {
          const maxTargetLevel = Math.max(...targets.map((t) => t.level), 0);
          const levelDifference = Math.abs(user.level - maxTargetLevel);
          if (levelDifference <= STREAK_LEVEL_DIFF) {
            const silverDropChance = 5 * battle.rewardScaling;
            if (Math.random() * 100 < silverDropChance) {
              result.seichiSilver = 1;
            }
          }
        }
      }

      // Apply money penalty for losers in war-torn sector (lose the same amount winner would gain)
      if (
        isCombatOrWarBattle &&
        isInWarTornSectorForExp &&
        !didWin &&
        outcome !== "Fled"
      ) {
        // Calculate what the user would have gotten if they won (same calculation as winner)
        const loserMoneyBoost = userClan?.ryoBoost ? 1 + userClan.ryoBoost / 100 : 1;
        let loserMoneyGain = WAR_TORN_SECTOR_BASE_MONEY * loserMoneyBoost;
        loserMoneyGain *= 1.5; // COMBAT multiplier
        loserMoneyGain *= battle.rewardScaling;
        // Apply 1.6x multiplier (same as winner gets)
        loserMoneyGain *= 1.6;
        // Deduct this amount from the loser, but don't let money go below 0
        const currentMoney = user?.money || 0;
        const moneyToLose = Math.min(loserMoneyGain, currentMoney);
        result.money = -moneyToLose;
      }

      // Return results
      return result;
    }
  }
  return null;
};

/**
 * Distributes a portion of experience to a given stat, based on usage
 * @returns The amount of experience distributed
 */
const distributeExpToStat = (
  user: BattleUserState,
  stat: keyof typeof user.usedStats | keyof typeof user.usedGenerals,
  count: number,
  cap: number,
  total: number,
  experience: number,
  result: CombatResult,
): number => {
  const expWeighted = (count / total) * experience;
  const expRounded = Math.floor(expWeighted * 100) / 100;
  const expResult = user[stat] + expRounded > cap ? cap - user[stat] : expRounded;
  result[stat] += expResult;
  return expResult;
};

/**
 * Computes change in ELO rating based on original ELO ratings
 */
const calcEloChange = (user: number, opponent: number, kFactor = 32, won: boolean) => {
  const expectedScore = 1 / (1 + 2 ** ((opponent - user) / (0.03 * (opponent + user))));
  const ratingChange = kFactor * ((won ? 1 : 0) - expectedScore);
  return Math.floor(ratingChange * 100) / 100;
};

/**
 * Evaluate whether we should forward battle to next round
 */
export const hasNoAvailableActions = (
  battle: ReturnedBattle,
  actorId: string,
  precomputedActions?: CombatAction[],
) => {
  const actor = battle.usersState.find((u) => u.userId === actorId);
  if (actor) {
    const done = actor.curHealth <= 0 || actor.fledBattle || actor.leftBattle;
    if (!done) {
      const actions =
        precomputedActions && precomputedActions.length > 0
          ? precomputedActions
          : availableUserActions(battle, actorId, !actor.isAi);
      for (const j of actions.keys()) {
        const action = actions[j];
        if (action) {
          const notWait = action.id !== "wait";
          const { canAct } = actionPointsAfterAction(actor, battle, action);
          if (canAct && notWait) {
            return false;
          }
        }
      }
    }
  }
  return true;
};

/**
 * Refill action points for all users in the battle
 */
export const refillActionPoints = (battle: ReturnedBattle) => {
  battle.usersState.forEach((u) => {
    u.actionPoints = 100;
  });
};

/** Align battle based on timestamp to update:
 * - The proper round & activeUserId
 * - The action points of all users, in case of next round */
export const alignBattle = (
  battle: CompleteBattle,
  actionRounds: number[], // Rounds present in this endpoint call
  userId?: string, // Session user ID
) => {
  const now = new Date();
  const precomputedActions = userId
    ? availableUserActions(battle as unknown as ReturnedBattle, userId)
    : undefined;
  const { actor, changedActor, progressRound } = calcActiveUser(battle, userId, 0, {
    precomputedUserId: userId,
    precomputedActions: precomputedActions,
  });
  // A variable for the current round to be used in the battle
  const actionRound = progressRound ? battle.round + 1 : battle.round;
  // Update round timer if new actor
  if (changedActor) {
    battle.roundStartAt = now;
  }
  // If we progress the battle round;
  // 1. refill action points
  // 2. update round info on battle
  // 3. update all user effect rounds
  // 4. update all updatedAt fields on items & jutsus
  if (progressRound) {
    refillActionPoints(battle);
    battle.round = actionRound;
    // console.log("Action round: ", actionRound);
    battle.usersEffects.forEach((e) => {
      if (e.rounds !== undefined) {
        if (!e.castThisRound) {
          // console.log(`Updating effect ${e.type} round ${e.rounds} -> ${e.rounds - 1}`);
          e.rounds = e.rounds - 1;
        }
        e.isNew = false;
        e.castThisRound = false;
      }
    });
    battle.groundEffects.forEach((e) => {
      if (e.rounds !== undefined) {
        if (!e.castThisRound) {
          // console.log(`Updating effect ${e.type} round ${e.rounds} -> ${e.rounds - 1}`);
          e.rounds = e.rounds - 1;
        }
        e.isNew = false;
        e.castThisRound = false;
      }
    });

    // Remove expired ground effects (including barriers) immediately
    battle.groundEffects = battle.groundEffects.filter((e) => {
      if (e.rounds !== undefined && e.rounds <= 0) {
        if (e.type === "visual" && actionRounds.includes(e.createdRound)) {
          return true;
        } else if (e.type === "summon" || e.type === "clone") {
          // Allow summon and clone effects to be processed by their tag functions
          // before being removed in the applyEffects function
          return true;
        } else {
          return false; // Remove expired effects
        }
      }
      return true; // Keep active effects
    });
  }
  // Update the active user on the battle
  battle.activeUserId = actor.userId;
  battle.updatedAt = now;
  // TOOD: Debug
  // console.log("New Actor: ", actor.username, battle.round, battle.version, Date.now());
  return { actor, progressRound, changedActor, actionRound };
};

export const calcApReduction = (
  battle?: ReturnedBattle | null,
  userId?: string | null,
) => {
  const user = battle?.usersState.find((u) => u.userId === userId);
  const stunEffects = [
    ...(battle?.usersEffects?.filter(
      (e) =>
        e.type === "stun" &&
        e.targetId === userId &&
        !e.castThisRound &&
        isEffectActive(e),
    ) ?? []),
    ...(battle?.groundEffects?.filter((e) => {
      // Basic checks for stun effect at user's location
      const locationMatch =
        e.type === "stun" &&
        e.longitude === user?.longitude &&
        e.latitude === user?.latitude &&
        !e.castThisRound &&
        isEffectActive(e);

      if (!locationMatch || !user) return false;

      // Use the existing checkFriendlyFire function to determine if effect should be applied
      return checkFriendlyFire(e, user, battle.usersState);
    }) ?? []),
  ];
  const apReduction = stunEffects?.reduce((acc, e) => {
    if (e && "apReduction" in e) {
      acc = e.apReduction > acc ? e.apReduction : acc;
    }
    return acc;
  }, 0);
  return apReduction || 0;
};

/** User fields required for initiative calculation */
type InitiativeUser = {
  level?: number | null;
  sector?: number | null;
  pvpStreak?: number | null;
};

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
      switch (i) {
        case 1:
          pvpBonus += 0.02;
          break;
        case 2:
          pvpBonus += 0.015;
          break;
        case 3:
          pvpBonus += 0.01;
          break;
        case 4:
          pvpBonus += 0.005;
          break;
        case 5:
          pvpBonus += 0.0025;
          break;
        default:
          pvpBonus += 0.0025;
          break;
      }
    }
    roll = roll * (1 + pvpBonus);
  }
  return roll;
};

/**
 * Checks if a move is valid on the battlefield
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
  const { villageId, userId } = user;
  const barrier = barriers.find(
    (b) => b.longitude === target.col && b.latitude === target.row,
  );
  if (!barrier) {
    const opponent = users.find(
      (u) =>
        u.longitude === target.col &&
        u.latitude === target.row &&
        u.curHealth > 0 &&
        !u.fledBattle,
    );
    if (action.target === "CHARACTER") {
      if (opponent) return true;
    } else if (action.target === "OPPONENT") {
      if (opponent && opponent?.villageId !== villageId) return true;
    } else if (action.target === "OTHER_USER") {
      if (opponent && opponent?.userId !== userId) return true;
    } else if (action.target === "ALLY") {
      if (opponent && opponent?.villageId === villageId) return true;
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
    if (action.effects.find((e) => ["damage", "pierce"].includes(e.type))) {
      return true;
    }
  }

  return false;
};

/**
 * Gets the affected tiles for an action
 * @param info {
 *  a: TerrainHex;
 *  b: TerrainHex;
 *  action: CombatAction;
 *  grid: Grid<TerrainHex>;
 *  restrictGrid?: Grid<TerrainHex>;
 *  users: ReturnedUserState[];
 *  ground: GroundEffect[];
 *  userId: string;
 * }
 * @returns
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
}) => {
  // Destruct & variables
  const { action, b, a, grid, restrictGrid, users, userId } = info;
  const radius = action.range;
  const green = new Set<TerrainHex>();
  const red = new Set<TerrainHex>();
  const user = users.find((u) => u.userId === userId);
  let tiles: Grid<TerrainHex> | undefined = undefined;

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

  // Handle different methods separately
  if (action.method === "SINGLE") {
    tiles = grid.traverse(fromCoordinates<TerrainHex>([b.q, b.r]));
  } else if (action.method === "AOE_CIRCLE_SPAWN") {
    tiles = grid.traverse(spiral<TerrainHex>({ start: [b.q, b.r], radius: 1 }));
  } else if (action.method === "AOE_LINE_SHOOT") {
    tiles = grid.traverse(line<TerrainHex>({ start: [b.q, b.r], stop: [a.q, a.r] }));
  } else if (action.method === "AOE_WALL_SHOOT") {
    const deltaX = Math.abs(a.q - b.q);
    const deltaY = Math.abs(a.r - b.r);
    if (deltaX >= deltaY) {
      tiles = grid.traverse([
        line<TerrainHex>({ start: [b.q, b.r], length: 2, direction: Direction.N }),
        line<TerrainHex>({ start: [b.q, b.r], length: 2, direction: Direction.S }),
      ]);
    } else {
      tiles = grid.traverse([
        line<TerrainHex>({ start: [b.q, b.r], length: 2, direction: Direction.W }),
        line<TerrainHex>({ start: [b.q, b.r], length: 2, direction: Direction.E }),
      ]);
    }
  } else if (action.method === "AOE_LARGE_WALL_SHOOT") {
    const deltaX = Math.abs(a.q - b.q);
    const deltaY = Math.abs(a.r - b.r);
    if (deltaX >= deltaY) {
      tiles = grid.traverse([
        line<TerrainHex>({ start: [b.q, b.r], length: 3, direction: Direction.N }),
        line<TerrainHex>({ start: [b.q, b.r], length: 3, direction: Direction.S }),
      ]);
    } else {
      tiles = grid.traverse([
        line<TerrainHex>({ start: [b.q, b.r], length: 3, direction: Direction.W }),
        line<TerrainHex>({ start: [b.q, b.r], length: 3, direction: Direction.E }),
      ]);
    }
  } else if (action.method === "AOE_CIRCLE_SHOOT") {
    tiles = grid.traverse(ring<TerrainHex>({ center: [a.q, a.r], radius }));
  } else if (action.method === "AOE_SPIRAL_SHOOT") {
    tiles = grid.traverse(spiral<TerrainHex>({ start: [a.q, a.r], radius }));
    if (tiles) tiles = tiles.filter((t) => t !== a);
  } else if (action.method === "ALL") {
    grid.forEach((target) => {
      if (isValidMove({ action, target, user, users, barriers, clicked: b })) {
        green.add(target);
      }
    });
  }

  // Return green for valid moves and red for unvalid moves
  tiles?.forEach((target) => {
    if (isValidMove({ action, target, user, users, barriers, clicked: b })) {
      green.add(target);
    } else {
      red.add(target);
    }
  });

  return { green, red };
};

/**
 * Calculate the hex distance between two positions using axial/cube coordinates.
 * For FLAT orientation hex grids with odd offset (-1) as used by honeycomb-grid.
 *
 * In honeycomb-grid with FLAT orientation:
 * - q = col (axial q is just the column)
 * - r = row - floor((col - (col & 1)) / 2) (offset applied to columns)
 */
export const calcHexDistance = (
  aCol: number,
  aRow: number,
  bCol: number,
  bRow: number,
): number => {
  // Convert FLAT orientation offset coordinates to axial (q, r)
  // For FLAT with odd offset: q = col, r = row - floor((col - (col & 1)) / 2)
  const aq = aCol;
  const ar = aRow - Math.floor((aCol - (aCol & 1)) / 2);

  const bq = bCol;
  const br = bRow - Math.floor((bCol - (bCol & 1)) / 2);

  // Calculate cube distance using axial coordinates
  // Cube coords: x = q, z = r, y = -x - z
  // Distance = max(|dx|, |dy|, |dz|) = max(|dq|, |dr|, |dq + dr|)
  const dq = Math.abs(aq - bq);
  const dr = Math.abs(ar - br);
  const ds = Math.abs(aq + ar - (bq + br));

  return Math.max(dq, dr, ds);
};

/**
 * Get the distance to the closest enemy from a user's position.
 * Returns null if no enemies found or user not found.
 */
export const getDistanceToClosestEnemy = (
  battle: ReturnedBattle | undefined | null,
  userId: string | undefined,
): number | null => {
  if (!battle || !userId) return null;

  const user = battle.usersState.find((u) => u.userId === userId);
  if (!user) return null;

  // Get all enemy users (different village/controller)
  const villageIds = [
    ...new Set(battle.usersState.filter(stillInBattle).map((u) => u.villageId)),
  ];
  const enemies = battle.usersState.filter((u) => {
    const isEnemy =
      villageIds.length > 1
        ? u.villageId !== user.villageId
        : u.controllerId !== user.controllerId;
    return isEnemy && stillInBattle(u);
  });

  if (enemies.length === 0) return null;

  // Calculate distance to each enemy and return the minimum
  const distances = enemies.map((enemy) =>
    calcHexDistance(user.longitude, user.latitude, enemy.longitude, enemy.latitude),
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

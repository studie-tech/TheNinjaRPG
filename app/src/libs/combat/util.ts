import { publicState, allState } from "./constants";
import { getPower } from "./tags";
import { randomInt } from "@/utils/math";
import { availableUserActions } from "./actions";
import { calcActiveUser } from "./actions";
import { stillInBattle } from "./actions";
import { checkFriendlyFire } from "./process";
import { KAGE_PRESTIGE_COST, FRIENDLY_PRESTIGE_COST } from "@/drizzle/constants";
import { KAGE_CHALLENGE_WIN_PRESTIGE } from "@/drizzle/constants";
import { CLAN_BATTLE_REWARD_POINTS } from "@/drizzle/constants";
import { USER_CAPS } from "@/drizzle/constants";
import { Orientation, Grid, rectangle } from "honeycomb-grid";
import { defineHex } from "../hexgrid";
import { actionPointsAfterAction } from "@/libs/combat/actions";
import { COMBAT_HEIGHT, COMBAT_WIDTH } from "./constants";
import { KILLING_NOTORIETY_GAIN } from "@/drizzle/constants";
import { findWarsWithUser } from "@/libs/war";
import { STREAK_LEVEL_DIFF } from "@/drizzle/constants";
import { getShrineBoost } from "@/utils/village";
import {
  SHARED_COOLDOWN_TAGS,
  WAR_TOWNHALL_HP_REMOVE,
  WAR_TOWNHALL_HP_RECOVER,
  WAR_TOWNHALL_HP_ANBU_REMOVE,
  WAR_TOWNHALL_HP_ANBU_RECOVER,
  WAR_TOWNHALL_HP_ELDER_REMOVE,
  WAR_TOWNHALL_HP_ELDER_RECOVER,
  WAR_TOWNHALL_HP_COLEADER_REMOVE,
  WAR_TOWNHALL_HP_COLEADER_RECOVER,
  WAR_TOWNHALL_HP_KAGE_REMOVE,
  WAR_TOWNHALL_HP_KAGE_RECOVER,
  WAR_TOWNHALL_HP_KAGEDEATH_REMOVE,
  WAR_SECTORWAR_AI_SHRINE_REDUCE,
  WAR_SECTORWAR_AI_SHRINE_RECOVER,
  WAR_SECTORWAR_PVP_SHRINE_REDUCE,
  WAR_SECTORWAR_PVP_SHRINE_RECOVER,
  PVP_KILL_TOKEN_REWARD,
  PVP_KILL_TOKEN_REWARD_ANBU,
  PVP_KILL_PRESTIGE_REWARD,
  PVP_KILL_PRESTIGE_REWARD_ANBU,
  PVP_KILL_ANBU_POINTS_REWARD,
} from "@/drizzle/constants";
import { calculateLpEloChange } from "@/libs/ranked_pvp";
import { checkCoLeader } from "@/validators/clan";
import type { PathCalculator } from "../hexgrid";
import type { TerrainHex } from "../hexgrid";
import type { CombatResult, CompleteBattle, ReturnedBattle } from "./types";
import type { ReturnedUserState, Consequence } from "./types";
import type { CombatAction, BattleUserState } from "./types";
import type { ZodAllTags } from "./types";
import type { GroundEffect, UserEffect, BattleEffect } from "@/libs/combat/types";
import type { Battle } from "@/drizzle/schema";
import type { DroppedItem } from "./types";

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
 * Retrieves the battle grid.
 */
export const getBattleGrid = (hexsize: number, origin?: { x: number; y: number }) => {
  const Tile = defineHex({
    dimensions: hexsize,
    origin,
    orientation: Orientation.FLAT,
  });
  const grid = new Grid(Tile, rectangle({ width: COMBAT_WIDTH, height: COMBAT_HEIGHT }))
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
    ?.map((t) => structuredClone(findBarrier(groundEffects, t.col, t.row)))
    .filter((b) => b !== undefined && b.creatorId !== userId) ?? []) as BattleEffect[];
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
 * Masks information from a battle prior to returning it to the frontend,
 * i.e. do not leak opponents stats
 */
export const maskBattle = (battle: Battle, userId: string) => {
  return {
    ...battle,
    usersState: (battle.usersState as ReturnedUserState[]).map((user) => {
      if (user.controllerId !== userId) {
        return Object.fromEntries(
          publicState.map((key) => [key, user[key]]),
        ) as unknown as ReturnedUserState;
      } else {
        return Object.fromEntries(
          allState.map((key) => [key, user[key]]),
        ) as unknown as ReturnedUserState;
      }
    }),
  };
};

/**
 * Figure out if user is still in battle, and if not whether the user won or lost
 */
export const calcBattleResult = (
  battle: CompleteBattle,
  userId: string,
): CombatResult | null => {
  const battleType = battle.battleType;
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

      // Check if we have a shrine boost, add it to reward scaling in case
      const sectors = user.village?.sectors?.length || 0;
      const shrineBoost = getShrineBoost(sectors, "PVP", user.village);
      const shrineBoostFactor = shrineBoost ? 1 + shrineBoost : 1;

      // Experience boost
      let expBoost = 1;
      if (battleType === "ARENA") {
        user.village?.structures?.forEach((s) => {
          expBoost += (s.arenaRewardPerLvl * s.level) / 100;
        });
      }
      if (user?.clan?.trainingBoost && user.clan.trainingBoost > 0) {
        expBoost += user.clan.trainingBoost / 100;
      }

      // Calculate ELO change if user had won.
      let eloDiff = Math.max(calcEloChange(uExp, oExp || 1000, maxGain, true), 0.02);

      // If killing ally, then no experience
      if (battleType === "COMBAT" && villageIds.length === 1) {
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
      const moneyBoost = user?.clan?.ryoBoost ? 1 + user.clan.ryoBoost / 100 : 1;
      let moneyDelta = didWin ? (randomInt(30, 40) + user.level) * moneyBoost : 0;

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
      if (didWin && battleType === "COMBAT" && user.isAggressor) {
        targetUsers.forEach((target) => {
          if (user.isOutlaw) {
            deltaPrestige += KILLING_NOTORIETY_GAIN;
          } else {
            // Prestige deduction for killing allies
            const isAlly = target.relations
              .filter((r) => r.status === "ALLY")
              .find(
                (r) =>
                  (r.villageIdA === vilId && r.villageIdB === target.villageId) ||
                  (r.villageIdA === target.villageId && r.villageIdB === vilId),
              );
            const sameVillage = target.villageId === vilId;
            deltaPrestige -= isAlly || sameVillage ? FRIENDLY_PRESTIGE_COST : 0;
          }

          // Base prestige for PvP kill (only for enemies)
          if (
            user.isOutlaw ||
            !target.relations.some(
              (r) =>
                (r.status === "ALLY" &&
                  ((r.villageIdA === vilId && r.villageIdB === target.villageId) ||
                    (r.villageIdA === target.villageId && r.villageIdB === vilId))) ||
                target.villageId === vilId,
            )
          ) {
            deltaPrestige += user.anbuId
              ? PVP_KILL_PRESTIGE_REWARD_ANBU
              : PVP_KILL_PRESTIGE_REWARD;

            // Base village tokens for PvP kill (only for enemies)
            deltaTokens += user.anbuId
              ? PVP_KILL_TOKEN_REWARD_ANBU
              : PVP_KILL_TOKEN_REWARD;

            // ANBU points for PvP kill (only if target is not more than 10 levels under)
            if (user.anbuId && user.level - target.level <= 10) {
              deltaAnbuPoints += PVP_KILL_ANBU_POINTS_REWARD;
            }
          }

          // Additional village tokens for killing enemies
          deltaTokens +=
            target.relations
              .filter((r) => r.status === "ENEMY")
              .filter(
                (r) =>
                  (r.villageIdA === vilId && r.villageIdB === target.villageId) ||
                  (r.villageIdA === target.villageId && r.villageIdB === vilId),
              ).length * 5;
        });
      }

      // Determine war kills bonus
      const townhallInfo: Record<string, number> = {};
      const shrineInfo: Record<number, number> = {};
      let townhallChangeHP = 0;
      let shrineChangeHp = 0;
      if (!user.fledBattle) {
        targets
          .filter((t) => !t.isSummon)
          .filter((t) => t.villageId !== vilId)
          .forEach((target) => {
            // Get user and target village ids
            const userVillageId = user.villageId;
            const targetVillageId = target.villageId;
            // Get the war from the target, and also search through warAllies
            const wars = findWarsWithUser(
              target.wars,
              user.wars,
              targetVillageId,
              userVillageId,
            );
            wars.forEach((war) => {
              // Get the names of the village
              const userVillageName =
                war.attackerVillageId === targetVillageId
                  ? war?.defenderVillage?.name || ""
                  : war?.attackerVillage?.name || "";
              const targetVillageName =
                war.attackerVillageId === targetVillageId
                  ? war?.attackerVillage?.name || ""
                  : war?.defenderVillage?.name || "";
              // Reset to 0 if not in townhallInfo
              if (targetVillageName && !(targetVillageName in townhallInfo)) {
                townhallInfo[targetVillageName] = 0;
              }
              if (userVillageName && !(userVillageName in townhallInfo)) {
                townhallInfo[userVillageName] = 0;
              }
              // Derived
              const isUserFactionColeader =
                user.isOutlaw && checkCoLeader(user.userId, user.clan);
              const isTargetFactionColeader =
                target.isOutlaw && checkCoLeader(target.userId, target.clan);

              // Village wars & raids
              if (
                ["VILLAGE_WAR", "WAR_RAID"].includes(war.type) &&
                battleType === "COMBAT"
              ) {
                if (didWin) {
                  if (user.village?.kageId === user.userId) {
                    townhallChangeHP += WAR_TOWNHALL_HP_KAGE_RECOVER;
                    townhallInfo[userVillageName]! += WAR_TOWNHALL_HP_KAGE_RECOVER;
                    townhallInfo[targetVillageName]! -= WAR_TOWNHALL_HP_KAGE_REMOVE;
                  } else if (user.rank === "ELDER") {
                    townhallChangeHP += WAR_TOWNHALL_HP_ELDER_RECOVER;
                    townhallInfo[userVillageName]! += WAR_TOWNHALL_HP_ELDER_RECOVER;
                    townhallInfo[targetVillageName]! -= WAR_TOWNHALL_HP_ELDER_REMOVE;
                  } else if (isUserFactionColeader) {
                    townhallChangeHP += WAR_TOWNHALL_HP_COLEADER_RECOVER;
                    townhallInfo[userVillageName]! += WAR_TOWNHALL_HP_COLEADER_RECOVER;
                    townhallInfo[targetVillageName]! -= WAR_TOWNHALL_HP_COLEADER_REMOVE;
                  } else if (user.anbuId) {
                    townhallChangeHP += WAR_TOWNHALL_HP_ANBU_RECOVER;
                    townhallInfo[userVillageName]! += WAR_TOWNHALL_HP_ANBU_RECOVER;
                    townhallInfo[targetVillageName]! -= WAR_TOWNHALL_HP_ANBU_REMOVE;
                  } else {
                    townhallChangeHP += WAR_TOWNHALL_HP_RECOVER;
                    townhallInfo[userVillageName]! += WAR_TOWNHALL_HP_RECOVER;
                    townhallInfo[targetVillageName]! -= WAR_TOWNHALL_HP_REMOVE;
                  }
                  if (target.village?.kageId === target.userId) {
                    townhallInfo[targetVillageName]! -=
                      WAR_TOWNHALL_HP_KAGEDEATH_REMOVE;
                  }
                } else {
                  if (target.village?.kageId === target.userId) {
                    townhallChangeHP -= WAR_TOWNHALL_HP_KAGE_REMOVE;
                    townhallInfo[userVillageName]! -= WAR_TOWNHALL_HP_KAGE_REMOVE;
                  } else if (target.rank === "ELDER") {
                    townhallChangeHP -= WAR_TOWNHALL_HP_ELDER_REMOVE;
                    townhallInfo[userVillageName]! -= WAR_TOWNHALL_HP_ELDER_REMOVE;
                  } else if (isTargetFactionColeader) {
                    townhallChangeHP -= WAR_TOWNHALL_HP_COLEADER_REMOVE;
                    townhallInfo[userVillageName]! -= WAR_TOWNHALL_HP_COLEADER_REMOVE;
                  } else if (target.anbuId) {
                    townhallChangeHP -= WAR_TOWNHALL_HP_ANBU_REMOVE;
                    townhallInfo[userVillageName]! -= WAR_TOWNHALL_HP_ANBU_REMOVE;
                  } else {
                    townhallChangeHP -= WAR_TOWNHALL_HP_REMOVE;
                    townhallInfo[userVillageName]! -= WAR_TOWNHALL_HP_REMOVE;
                  }
                  if (user.village?.kageId === user.userId) {
                    townhallChangeHP -= WAR_TOWNHALL_HP_KAGEDEATH_REMOVE;
                    townhallInfo[userVillageName]! -= WAR_TOWNHALL_HP_KAGEDEATH_REMOVE;
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
            });
          });
      }

      // Scale everything based on reward scaling
      shrineChangeHp *= battle.rewardScaling;
      townhallChangeHP *= battle.rewardScaling;
      Object.keys(shrineInfo).forEach((sector) => {
        shrineInfo[sector as unknown as number]! *= battle.rewardScaling;
      });
      Object.keys(townhallInfo).forEach((name) => {
        townhallInfo[name]! *= battle.rewardScaling;
      });

      // Adjust shrine & townhall datamage based on level different
      const maxTargetLevel = Math.max(...targetUsers.map((t) => t.level), 0);
      if (Math.abs(user.level - maxTargetLevel) > STREAK_LEVEL_DIFF) {
        // Check if any kage was killed in this battle
        const targetKageLost =
          targets.some((target) => target.village?.kageId === target.userId) && didWin;
        const userKageLost = user.village?.kageId === user.userId && !didWin;
        const kageLost = targetKageLost || userKageLost;
        const strongestWon = user.level > maxTargetLevel && didWin;
        const weakestLost = user.level < maxTargetLevel && !didWin;
        // If kage was killed, we preserve all war damage, otherwise reduce all changes to 1/abs(change) if we're the stronger player
        if (!kageLost && (strongestWon || weakestLost)) {
          if (shrineChangeHp !== 0) {
            shrineChangeHp /= Math.abs(shrineChangeHp);
          }
          if (townhallChangeHP !== 0) {
            townhallChangeHP /= Math.abs(townhallChangeHP);
          }
          Object.keys(shrineInfo).forEach((sector) => {
            const abs = Math.abs(shrineInfo[sector as unknown as number]!);
            if (abs !== 0) shrineInfo[sector as unknown as number]! /= abs;
          });
          Object.keys(townhallInfo).forEach((name) => {
            const abs = Math.abs(townhallInfo[name]!);
            if (abs !== 0) townhallInfo[name]! /= abs;
          });
        }
      }

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
        user.bountySignups?.forEach((signup) => {
          targets
            .filter((t) => t.bounties?.find((b) => b.id === signup.bountyId))
            .forEach((t) => {
              const bounty = t.bounties?.find((b) => b.id === signup.bountyId);
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
                droppedItems.push({
                  itemId: ui.itemId,
                  name: ui.item?.name ?? "Item",
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
        villagePrestige: deltaPrestige,
        friendsLeft: friendsLeft.length,
        targetsLeft: targetsLeft.length,
        villageTokens: deltaTokens,
        anbuPoints: deltaAnbuPoints,
        townhallChangeHP: townhallChangeHP,
        shrineChangeHp: shrineChangeHp,
        shrineInfo: shrineInfo,
        townhallInfo: townhallInfo,
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
        const stats_cap = USER_CAPS[user.rank].STATS_CAP;
        const gens_cap = USER_CAPS[user.rank].GENS_CAP;

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
export const alignBattle = (battle: CompleteBattle, userId?: string) => {
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
    ...(battle?.usersEffects.filter(
      (e) =>
        e.type === "stun" &&
        e.targetId === userId &&
        !e.castThisRound &&
        isEffectActive(e),
    ) || []),
    ...(battle?.groundEffects.filter((e) => {
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
    }) || []),
  ];
  const apReduction = stunEffects?.reduce((acc, e) => {
    if (e && "apReduction" in e) {
      acc = e.apReduction > acc ? e.apReduction : acc;
    }
    return acc;
  }, 0);
  return apReduction || 0;
};

export const rollInitiative = (
  user: BattleUserState,
  opponents?: BattleUserState[],
) => {
  // Get a random number between 1 and 20
  let roll = randomInt(1, 20);
  // Calculate level bonus
  if (opponents) {
    const avgLevel = opponents.reduce((a, b) => a + b.level, 0) / opponents.length;
    const levelBonus = Math.max((user.level - avgLevel) * 0.03, 0);
    roll = roll * (1 + levelBonus);
  }
  // Calculate territory bonus
  const ownTerritory = user.sector === user.village?.sector;
  const territoryBonus = ownTerritory ? 0.1 : -0.1;
  roll = roll * (1 + territoryBonus);
  // PvP bonus
  if (user.pvpStreak > 0) {
    let pvpBonus = 0;
    for (let i = 1; i <= user.pvpStreak; i++) {
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

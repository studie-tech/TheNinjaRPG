import { publicState, allState } from "./constants";
import { getPower } from "./tags";
import { randomInt } from "@/utils/math";
import { availableUserActions, getBasicActions } from "./actions";
import { calcActiveUser } from "./actions";
import { stillInBattle } from "./actions";
import { secondsPassed } from "@/utils/time";
import { realizeTag, checkFriendlyFire } from "./process";
import { KAGE_PRESTIGE_COST, FRIENDLY_PRESTIGE_COST } from "@/drizzle/constants";
import { KAGE_CHALLENGE_WIN_PRESTIGE } from "@/drizzle/constants";
import { calcIsInVillage } from "@/libs/travel/controls";
import { toOffenceStat, toDefenceStat } from "@/libs/stats";
import { structureBoost } from "@/utils/village";
import { calcActiveUserRegen } from "@/libs/profile";
import { DecreaseDamageTakenTag } from "@/libs/combat/types";
import { StatTypes, GeneralTypes } from "@/drizzle/constants";
import { CLAN_BATTLE_REWARD_POINTS } from "@/drizzle/constants";
import { findRelationship } from "@/utils/alliance";
import { canTrainJutsu, checkJutsuItems } from "@/libs/train";
import { USER_CAPS } from "@/drizzle/constants";
import { Orientation, Grid, rectangle } from "honeycomb-grid";
import { defineHex } from "../hexgrid";
import { actionPointsAfterAction } from "@/libs/combat/actions";
import { COMBAT_HEIGHT, COMBAT_WIDTH } from "./constants";
import { KILLING_NOTORIETY_GAIN } from "@/drizzle/constants";
import { findWarsWithUser } from "@/libs/war";
import { STREAK_LEVEL_DIFF } from "@/drizzle/constants";
import { getUserElements } from "@/validators/user";
import { checkJutsuElements } from "@/libs/train";
import {
  SHARED_COOLDOWN_TAGS,
  WAR_TOWNHALL_HP_REMOVE,
  WAR_TOWNHALL_HP_RECOVER,
  WAR_TOWNHALL_HP_ANBU_REMOVE,
  WAR_TOWNHALL_HP_ANBU_RECOVER,
  WAR_TOWNHALL_HP_ELDER_REMOVE,
  WAR_TOWNHALL_HP_ELDER_RECOVER,
  WAR_TOWNHALL_HP_KAGE_REMOVE,
  WAR_TOWNHALL_HP_KAGE_RECOVER,
  WAR_TOWNHALL_HP_KAGEDEATH_REMOVE,
  WAR_SECTORWAR_AI_SHRINE_REDUCE,
  WAR_SECTORWAR_AI_SHRINE_RECOVER,
  WAR_SECTORWAR_PVP_SHRINE_REDUCE,
  WAR_SECTORWAR_PVP_SHRINE_RECOVER,
} from "@/drizzle/constants";
import type { BattleWar } from "@/libs/combat/types";
import type { PathCalculator } from "../hexgrid";
import type { TerrainHex } from "../hexgrid";
import type { CombatResult, CompleteBattle, ReturnedBattle } from "./types";
import type { ReturnedUserState, Consequence } from "./types";
import type { CombatAction, BattleUserState } from "./types";
import type { ZodAllTags } from "./types";
import type { GroundEffect, UserEffect, BattleEffect } from "@/libs/combat/types";
import type { Battle, VillageAlliance, Village, GameSetting } from "@/drizzle/schema";
import type { Item, UserItem, AiProfile, War } from "@/drizzle/schema";
import type { BattleType } from "@/drizzle/constants";
import { nanoid } from "nanoid";
import { UserData, UserJutsu, RankedLoadout } from "@/drizzle/schema";

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
    "copy",
    "mirror",
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
    "absorb",
    "recoil",
    "reflect",
    "decreaseheal",
    "increaseheal",
    // End-modifiers
    "move",
    "visual",
  ];
  if (ordered.includes(a.type) && ordered.includes(b.type)) {
    return ordered.indexOf(a.type) > ordered.indexOf(b.type) ? 1 : -1;
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
      current.drain_hp = current.drain_hp ? current.drain_hp + val.drain_hp : val.drain_hp;
    }
    if (val.drain_cp) {
      current.drain_cp = current.drain_cp ? current.drain_cp + val.drain_cp : val.drain_cp;
    }
    if (val.drain_sp) {
      current.drain_sp = current.drain_sp ? current.drain_sp + val.drain_sp : val.drain_sp;
    }
    if (val.poison) {
      current.poison = current.poison ? current.poison + val.poison : val.poison;
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
    usersEffects: battle.usersEffects as UserEffect[],
    groundEffects: battle.groundEffects as GroundEffect[],
  };
};

/**
 * Figure out if user is still in battle, and if not whether the user won or lost
 */
export const calcBattleResult = (battle: CompleteBattle, userId: string) => {
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
      const maxGain = 32 * battle.rewardScaling;

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

      // Calculate Eperience gain
      let experience = didWin ? eloDiff * expBoost : 0;
      const streakBonus = 1 + user.pvpStreak * 0.05; // 5% per streak
      if (["COMBAT", "TOURNAMENT"].includes(battleType)) {
        experience *= 1.5;
        if (battleType === "COMBAT") {
          experience *= streakBonus;
          experience = Math.min(experience, 100);
        }
      } else if (
        [
          "CLAN_CHALLENGE",
          "KAGE_AI",
          "KAGE_PVP",
          "TRAINING",
          "VILLAGE_PROTECTOR",
        ].includes(battleType)
      ) {
        experience = 0;
      } else if (battleType === "ARENA") {
        experience = Math.min(experience, 20);
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

      // Tokens & prestige
      let deltaTokens = 0;
      let deltaPrestige = 0;
      let clanPoints = 0;

      // Money/ryo calculation
      const moneyBoost = user?.clan?.ryoBoost ? 1 + user.clan.ryoBoost / 100 : 1;
      const moneyDelta = didWin ? (randomInt(30, 40) + user.level) * moneyBoost : 0;

      // Include money stolen during combat
      if (battleType === "COMBAT" && user.moneyStolen) {
        if (user.moneyStolen > 0 && outcome === "Lost") {
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

          // Village tokens for killing enemies
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
      if (!allOpponentsFled && !user.fledBattle) {
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

              // Village wars & raids
              if (
                ["VILLAGE_WAR", "FACTION_RAID"].includes(war.type) &&
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
      shrineChangeHp *= battle.rewardScaling;
      townhallChangeHP *= battle.rewardScaling;

      // Adjust shrine & townhall datamage based on level different
      const maxTargetLevel = Math.max(...targets.map((t) => t.level), 0);
      if (Math.abs(user.level - maxTargetLevel) > STREAK_LEVEL_DIFF) {
        if (shrineChangeHp !== 0) shrineChangeHp /= Math.abs(shrineChangeHp);
        if (townhallChangeHP !== 0) townhallChangeHP /= Math.abs(townhallChangeHP);
        Object.keys(shrineInfo).forEach((sector) => {
          const abs = Math.abs(shrineInfo[sector as unknown as number]!);
          if (abs !== 0) shrineInfo[sector as unknown as number]! /= abs;
        });
        Object.keys(townhallInfo).forEach((name) => {
          const abs = Math.abs(townhallInfo[name]!);
          if (abs !== 0) townhallInfo[name]! /= abs;
        });
      }

      // ANBU boost to tokens
      if (user.anbuId) deltaTokens *= 2;

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

      // Result object
      const result: CombatResult = {
        outcome: outcome,
        didWin: didWin ? 1 : 0,
        eloDiff: eloDiff,
        experience: 0.01,
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
        townhallChangeHP: townhallChangeHP,
        shrineChangeHp: shrineChangeHp,
        shrineInfo: shrineInfo,
        townhallInfo: townhallInfo,
        clanPoints: clanPoints * battle.rewardScaling,
        notifications: [],
      };

      // Things to reward for non-spars
      if (battleType !== "SPARRING" && battleType !== "TRAINING") {
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
export const hasNoAvailableActions = (battle: ReturnedBattle, actorId: string) => {
  const actor = battle.usersState.find((u) => u.userId === actorId);
  if (actor) {
    const done = actor.curHealth <= 0 || actor.fledBattle || actor.leftBattle;
    if (!done) {
      const actions = availableUserActions(battle, actorId, !actor.isAi);
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
  const { actor, changedActor, progressRound } = calcActiveUser(battle, userId);
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

/**
 * Processes the users for a battle.
 *
 * @param users - An array of `BattleUserState` objects representing the users participating in the battle.
 * @param hide - A boolean indicating whether to hide user on map. Defaults to `false`.
 * @returns An object containing the processed user effects, updated user states, and all summons.
 */
export const processUsersForBattle = (info: {
  users: BattleUserState[];
  settings: GameSetting[];
  relations: VillageAlliance[];
  wars: BattleWar[];
  villages: Village[];
  defaultProfile: AiProfile;
  battleType: BattleType;
  hide: boolean;
  leftSideUserIds?: string[];
}) => {
  // Destructure
  const { users, settings, relations, battleType, hide, leftSideUserIds, wars } = info;
  // Collect user effects here
  const allSummons: string[] = [];
  const userEffects: UserEffect[] = [];
  const takenLocations: { x: number; y: number }[] = [];

  // Loop through users
  const usersState = users.map((user, i) => {
    // Set controllerID and mark this user as the original
    user.controllerId = user.userId;

    // Set direction
    user.direction = i % 2 === 0 ? "right" : "left";

    // Set the updated at to now, so that action bar starts at 0
    user.updatedAt = new Date();

    // Set all users to not be agressors by default
    user.isAggressor = false;

    // Add default AI profile if not set
    if (!user.aiProfile) user.aiProfile = info.defaultProfile;

    // Add regen to pools. Pools are not updated "live" in the database, but rather are calculated on the frontend
    // Therefore we need to calculate the current pools here, before inserting the user into battle
    const regen = calcActiveUserRegen(user, settings);
    const restored = (regen * secondsPassed(user.regenAt)) / 60;
    user.curHealth = Math.min(user.curHealth + restored, user.maxHealth);
    user.curChakra = Math.min(user.curChakra + restored, user.maxChakra);
    user.curStamina = Math.min(user.curStamina + restored, user.maxStamina);

    // For kage challenges, set health/chakra/stamina to full
    if (["KAGE_AI", "KAGE_PVP"].includes(battleType)) {
      user.curHealth = user.maxHealth;
      user.curChakra = user.maxChakra;
      user.curStamina = user.maxStamina;
    }

    if (battleType === "RANKED") {
      user.level = 100;
      user.experience = 4399880;
      user.bloodlineId = "";
      user.maxHealth = 5050;
      user.curHealth = 5050;
      user.maxChakra = 5050;
      user.curChakra = 5050;
      user.maxStamina = 5050;
      user.curStamina = 5050;
      user.strength = 200000;
      user.intelligence = 200000;
      user.willpower = 200000;
      user.speed = 200000;
      user.ninjutsuOffence = 450000;
      user.ninjutsuDefence = 450000;
      user.genjutsuOffence = 450000;
      user.genjutsuDefence = 450000;
      user.taijutsuOffence = 450000;
      user.taijutsuDefence = 450000;
      user.bukijutsuOffence = 450000;
      user.bukijutsuDefence = 450000;
      user.medicalExperience = 400000;
    }

    // Add highest offence name to user
    const offences = {
      ninjutsuOffence: user.ninjutsuOffence,
      genjutsuOffence: user.genjutsuOffence,
      taijutsuOffence: user.taijutsuOffence,
      bukijutsuOffence: user.bukijutsuOffence,
    };
    type offenceKey = keyof typeof offences;
    if (!user.preferredStat) {
      user.highestOffence = Object.keys(offences).reduce((prev, cur) =>
        offences[prev as offenceKey] > offences[cur as offenceKey] ? prev : cur,
      ) as offenceKey;
    } else {
      user.highestOffence = toOffenceStat(user.preferredStat);
    }

    // Starting round
    user.round = 0;

    // Add highest defence name to user
    const defences = {
      ninjutsuDefence: user.ninjutsuDefence,
      genjutsuDefence: user.genjutsuDefence,
      taijutsuDefence: user.taijutsuDefence,
      bukijutsuDefence: user.bukijutsuDefence,
    };
    type defenceKey = keyof typeof defences;
    if (!user.preferredStat) {
      user.highestDefence = Object.keys(defences).reduce((prev, cur) =>
        defences[prev as defenceKey] > defences[cur as defenceKey] ? prev : cur,
      ) as defenceKey;
    } else {
      user.highestDefence = toDefenceStat(user.preferredStat);
    }

    // Add highest generals to user
    const generals = {
      strength: user.strength,
      intelligence: user.intelligence,
      willpower: user.willpower,
      speed: user.speed,
    } as const;

    type generalKey = keyof typeof generals;

    if (user.preferredGeneral1 && user.preferredGeneral2) {
      // If both generals are already set, just use them
      user.highestGenerals = [
        user.preferredGeneral1.toLowerCase(),
        user.preferredGeneral2.toLowerCase(),
      ] as generalKey[];
    } else {
      // Sort generals by value
      const sortedStats = Object.entries(generals)
        .sort(([, a], [, b]) => b - a)
        .map(([stat]) => stat) as generalKey[];

      if (user.preferredGeneral1) {
        // If first general is set, find the highest from remaining
        const firstGenLower = user.preferredGeneral1.toLowerCase() as generalKey;
        const secondGeneral = sortedStats.find((stat) => stat !== firstGenLower);
        user.highestGenerals = [firstGenLower, secondGeneral!];
      } else if (user.preferredGeneral2) {
        // If second general is set, find the highest from remaining
        const secondGenLower = user.preferredGeneral2.toLowerCase() as generalKey;
        const firstGeneral = sortedStats.find((stat) => stat !== secondGenLower);
        user.highestGenerals = [firstGeneral!, secondGenLower];
      } else {
        // If no generals are set, take the two highest
        user.highestGenerals = sortedStats.slice(0, 2);
      }
    }

    // By default set iAmHere to false
    user.iAmHere = false;

    // Remember how much money this user had
    user.originalMoney = user.money;
    user.actionPoints = 100;

    // Convenience function for assigning location of user
    const assignLocation = (min: number, max: number) => {
      let x = randomInt(min, max);
      let y = randomInt(1, 3);
      do {
        x = randomInt(min, max);
        y = randomInt(1, 3);
      } while (takenLocations.some((l) => l.x === x && l.y === y));
      takenLocations.push({ x, y });
      return { x, y };
    };

    // Store original location
    user.originalLongitude = user.longitude;
    user.originalLatitude = user.latitude;

    // Default locaton
    if (hide) {
      user.longitude = 0;
      user.latitude = 0;
      user.curHealth = 0;
    } else {
      if (leftSideUserIds?.includes(user.userId)) {
        const { x, y } = assignLocation(1, 5);
        user.longitude = x;
        user.latitude = y;
      } else {
        const { x, y } = assignLocation(7, 11);
        user.longitude = x;
        user.latitude = y;
      }
    }

    // By default the ones inserted initially are original
    user.isOriginal = true;
    user.isSummon = false;

    // Set the history lists to record actions during battle
    user.usedGenerals = {
      strength: 0,
      intelligence: 0,
      willpower: 0,
      speed: 0,
    };
    user.usedStats = {
      ninjutsuOffence: 0,
      genjutsuOffence: 0,
      taijutsuOffence: 0,
      bukijutsuOffence: 0,
      ninjutsuDefence: 0,
      genjutsuDefence: 0,
      taijutsuDefence: 0,
      bukijutsuDefence: 0,
    };
    user.usedActions = [];

    // If in own village, add defence bonus
    const ownSector = user.sector === user.village?.sector;
    const inVillage = calcIsInVillage({ x: user.longitude, y: user.latitude });
    if (ownSector && inVillage && battleType !== "ARENA" && battleType !== "RANKED") {
      const boost = structureBoost("villageDefencePerLvl", user.village?.structures);
      const effect = DecreaseDamageTakenTag.parse({
        target: "SELF",
        statTypes: StatTypes,
        generalTypes: GeneralTypes,
        type: "decreasedamagetaken",
        power: boost,
        rounds: undefined,
      }) as unknown as UserEffect;
      const realized = realizeTag({
        tag: effect,
        user: user,
        actionId: "initial",
        target: user,
        level: user.level,
      });
      realized.isNew = false;
      realized.castThisRound = false;
      realized.targetId = user.userId;
      userEffects.push(realized);
    }

    // Add bloodline efects
    if (user.bloodline?.effects && battleType !== "RANKED") {
      user.bloodline.effects.forEach((effect) => {
        const realized = realizeTag({
          tag: effect as UserEffect,
          user: user,
          actionId: user?.bloodline?.id ?? "initial",
          target: user,
          level: user.level,
        });
        realized.isNew = false;
        realized.castThisRound = false;
        realized.targetId = user.userId;
        realized.fromType = "bloodline";
        userEffects.push(realized);
      });
    }

    // Add users effects to the battle
    if (user.effects.length > 0) {
      user.effects.forEach((effect) => {
        const realized = realizeTag({
          tag: effect as UserEffect,
          user: user,
          actionId: "initial",
          target: user,
          level: user.level,
        });
        realized.isNew = false;
        realized.castThisRound = false;
        realized.targetId = user.userId;
        realized.fromType = "bloodline";
        userEffects.push(realized);
      });
    }

    // Set jutsus updatedAt to now (we use it for determining usage cooldowns)
    user.jutsus = (battleType === "RANKED"
      ? user.rankedUserJutsus?.map(jutsu => ({
          ...jutsu,
          experience: 0,
        }))
      : user.jutsus)?.filter((userjutsu) => {
        // Not if no jutsu
        if (!userjutsu.jutsu) {
          return false;
        }
        // For ranked battles, only check bloodline requirements
        if (battleType === "RANKED") {
          // Not if not the right bloodline
          if (userjutsu.jutsu.bloodlineId !== "" && !user.isAi && user.bloodlineId !== userjutsu.jutsu.bloodlineId) {
            return false;
          }
          return true;
        }
        // For non-ranked battles, check all requirements
        if (!checkJutsuItems(userjutsu.jutsu, user.items) && !user.isAi) {
          return false;
        }
        if (!canTrainJutsu(userjutsu.jutsu, user) && !user.isAi) {
          return false;
        }
        // Add summons to list
        const effects = userjutsu.jutsu.effects as UserEffect[];
        effects
          .filter((e) => e.type === "summon")
          .forEach((e) => "aiId" in e && allSummons.push(e.aiId));
        // Not if not the right bloodline
        if (userjutsu.jutsu.bloodlineId !== "" && !user.isAi && user.bloodlineId !== userjutsu.jutsu.bloodlineId) {
          return false;
        }
        // Check elements
        const userElements = new Set(getUserElements(user));
        return checkJutsuElements(userjutsu.jutsu, userElements);
      }).map((userjutsu) => {
        userjutsu.lastUsedRound = -userjutsu.jutsu.cooldown;
        return userjutsu;
      });

    // Add basic actions to user for tracking cooldowns
    user.basicActions = Object.values(getBasicActions(user));

    // Sort if we have a loadout
    if (user?.loadout?.jutsuIds) {
      user.jutsus.sort((a, b) => {
        const aIndex = user?.loadout?.jutsuIds.indexOf(a.jutsuId) ?? -1;
        const bIndex = user?.loadout?.jutsuIds.indexOf(b.jutsuId) ?? -1;
        if (aIndex === -1 && bIndex === -1) return 0;
        if (aIndex === -1) return 1;
        if (bIndex === -1) return -1;
        return aIndex - bIndex;
      });
    }

    // Add item effects
    const items: (UserItem & { item: Item; lastUsedRound: number })[] = [];
    
    // Get items to process - either ranked loadout items or regular items
    const itemsToProcess = battleType === "RANKED" 
      ? [
          ...(user.rankedLoadout?.weapon ? [{ 
            item: user.rankedLoadout.weapon, 
            equipped: "WEAPON",
            userId: user.userId,
            itemId: user.rankedLoadout.weapon.id,
            quantity: 1,
            lastUsedRound: -user.rankedLoadout.weapon.cooldown
          }] : []),
          ...(user.rankedLoadout?.consumable1 ? [{ 
            item: user.rankedLoadout.consumable1, 
            equipped: "NONE",
            userId: user.userId,
            itemId: user.rankedLoadout.consumable1.id,
            quantity: 6,
            lastUsedRound: -user.rankedLoadout.consumable1.cooldown
          }] : []),
          ...(user.rankedLoadout?.consumable2 ? [{ 
            item: user.rankedLoadout.consumable2, 
            equipped: "NONE",
            userId: user.userId,
            itemId: user.rankedLoadout.consumable2.id,
            quantity: 6,
            lastUsedRound: -user.rankedLoadout.consumable2.cooldown
          }] : []),
        ] as (UserItem & { item: Item; lastUsedRound: number })[]
      : user.items;

    itemsToProcess
      .filter((useritem) => useritem.item && !useritem.item.preventBattleUsage)
      .forEach((useritem) => {
        const itemType = useritem.item.itemType;
        const effects = useritem.item.effects as UserEffect[];
        effects
          .filter((e) => e.type === "summon")
          .forEach((e) => "aiId" in e && allSummons.push(e.aiId));
        if ((itemType === "ARMOR" || itemType === "ACCESSORY") && battleType !== "RANKED") {
          if (useritem.item.effects && useritem.equipped !== "NONE") {
            effects.forEach((effect) => {
              const realized = realizeTag({
                tag: effect,
                user: user,
                actionId: useritem.item.id,
                target: user,
                level: user.level,
              });
              realized.isNew = false;
              realized.fromType = "armor";
              realized.castThisRound = false;
              realized.targetId = user.userId;
              userEffects.push(realized);
            });
          }
        } else {
          useritem.lastUsedRound = -useritem.item.cooldown;
          if (itemType !== "ARMOR" && itemType !== "ACCESSORY") {
            items.push(useritem);
          }
        }
      });
    user.items = items;

    // Base values
    user.fledBattle = false;
    user.leftBattle = false;
    user.moneyStolen = 0;

    // Roll initiative
    user.initiative = rollInitiative(user, users);

    // Add relevant relations to usersState
    user.relations = relations.filter(
      (r) => r.villageIdA === user.villageId || r.villageIdB === user.villageId,
    );

    // Add relevant wars to usersState
    user.wars = wars.filter(
      (w) =>
        w.attackerVillageId === user.villageId ||
        w.defenderVillageId === user.villageId ||
        w.warAllies.find((wa) => wa.villageId === user.villageId),
    );

    // Check if we are in ally village or not
    user.allyVillage = false;
    if (inVillage && !ownSector) {
      const sector = info.villages.find((v) => v.sector === user.sector);
      if (sector) {
        const relationship = findRelationship(relations, user.villageId, sector.id);
        if (relationship?.status === "ALLY") {
          user.allyVillage = true;
        }
      }
    }

    return user;
  });

  return { userEffects, usersState, allSummons };
};

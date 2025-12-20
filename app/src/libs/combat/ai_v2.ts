import { availableUserActions } from "@/libs/combat/actions";
import { performBattleAction } from "@/libs/combat/actions";
import { actionPointsAfterAction } from "@/libs/combat/actions";
import { stillInBattle } from "@/libs/combat/actions";
import {
  findUser,
  findBarrier,
  calcPoolCost,
  getAiProfile,
  getEffectiveCurPool,
  getEffectiveMaxPool,
} from "@/libs/combat/util";
import { PathCalculator, findHex } from "@/libs/hexgrid";
import { getBarriersBetween } from "@/libs/combat/util";
import { ActionEndTurn, getBackupRules } from "@/validators/ai";
import { enforceExtraRules } from "@/validators/ai";
import { spiral } from "honeycomb-grid";
import type { ActionEffect, BattleUserState } from "@/libs/combat/types";
import type { CombatAction, GroundEffect, UserEffect } from "@/libs/combat/types";
import type { CompleteBattle } from "@/libs/combat/types";
import type { ZodAllTags } from "@/validators/combat";
import type { TerrainHex } from "../hexgrid";
import type { ZodAllAiCondition, ZodAllAiAction } from "@/validators/ai";
import type { Grid } from "honeycomb-grid";
import type { Point2D, UserLocation } from "@/libs/hexgrid";

type ActionWithTarget = {
  action: CombatAction;
  long: number;
  lat: number;
};

// Debug flag when testing AI
const debug = false;

export const performAIaction = (
  battle: CompleteBattle,
  grid: Grid<TerrainHex>,
  aiUserId: string,
) => {
  if (debug) {
    console.log(">> performAIaction Start");
    const ai = battle.usersState.find((u) => u.userId === aiUserId);
    console.log(">> Action Points 1: ", ai?.actionPoints);
  }
  // New stats to return
  const nextActionEffects: ActionEffect[] = [];
  const aiDescriptions: string[] = [];
  let nextBattle = battle;
  const returnBattle = structuredClone(nextBattle);

  // Find AI users who are in control of themselves (i.e. not controlled by a player)
  const aiUsers = nextBattle.usersState.filter((user) => user.isAi);

  // Next action bookkeeping
  let nextAction: ActionWithTarget | undefined = undefined;

  // Path finder on grid in path lines
  let astar = new PathCalculator(updateGridWithObstacles(grid, nextBattle));

  // Find the AI user
  const user = aiUsers.find((user) => user.userId === aiUserId);
  if (user) {
    // Is it a user or an AI
    const isUser = user.userId.includes("user_");
    // Possible actions
    const allActions = availableUserActions(nextBattle, user.userId, true, true).filter(
      (action) => {
        const costs = calcPoolCost(action, nextBattle.usersEffects, user);
        if (user.curHealth < costs.hpCost) return false;
        if (user.curChakra < costs.cpCost) return false;
        if (user.curStamina < costs.spCost) return false;
        if (isUser && action.id !== "move") {
          if (
            action.effects.some((e) => "type" in e && e.type === "move") ||
            action.effects.some((e) => "type" in e && e.type === "summon")
          ) {
            return false;
          }
        }
        return true;
      },
    );
    const availActions = allActions.filter((action) => {
      const check = actionPointsAfterAction(user, nextBattle, action);
      return check.canAct;
    });
    // User hex
    const origin = findHex(grid, user);
    // Get user enemies - use nextBattle to get latest state after earlier actions
    const enemies = getEnemies(nextBattle.usersState, user.userId, nextBattle.usersEffects).map(
      (u) => mapDistancesToTarget(grid, astar, u, origin),
    );
    // Get user allies - use nextBattle to get latest state after earlier actions
    const allies = getAllies(nextBattle.usersState, user.userId, nextBattle.usersEffects).map(
      (u) => mapDistancesToTarget(grid, astar, u, origin),
    );
    // Derived for convenience
    const userWithDistance = { ...user, path: undefined, distance: 0 };
    const randomEnemy = enemies[Math.floor(Math.random() * enemies.length)];
    const closestEnemy = enemies.reduce((prev, current) =>
      prev.distance < current.distance ? prev : current,
    );
    const randomAlly = allies[Math.floor(Math.random() * allies.length)];
    const closestAlly = allies.reduce((prev, current) =>
      prev.distance < current.distance ? prev : current,
    );
    // Get barriers between user and closest enemy
    astar = new PathCalculator(resetGridFromObstacles(grid));
    const tHex = findHex(grid, closestEnemy);
    const barriers = getBarriers(astar, nextBattle.groundEffects, origin, tHex).map(
      (b) => mapDistancesToTarget(grid, astar, b, origin),
    );
    astar = new PathCalculator(updateGridWithObstacles(grid, nextBattle));

    // Get AI profile from static data - clone to avoid mutating the shared reference
    const aiProfileRef = getAiProfile(battle, user.aiProfileId);
    const aiProfile = aiProfileRef
      ? { ...aiProfileRef, rules: structuredClone(aiProfileRef.rules) }
      : undefined;

    // If this is a user AI, add the backup rules
    if (aiProfile && (isUser || aiProfile.includeDefaultRules)) {
      const backupRules = getBackupRules();
      enforceExtraRules(aiProfile.rules, backupRules);
    }

    // If we only have the last three actions (end turn, wait, and move),
    // available, but more actions in total, then add wait rule
    const nonEffectActions = ["basicHeal", "flee", "wait", "move", "cleanse", "clear"];
    if (allActions?.find((a) => !nonEffectActions.includes(a.id)) && aiProfile) {
      aiProfile.rules.push({
        conditions: [],
        action: ActionEndTurn.parse({}),
      });
    }

    // Convenience for getting path to target
    const getPath = (origin?: TerrainHex, target?: { hex?: TerrainHex }) => {
      return origin && target?.hex && astar.getShortestPath(origin, target.hex);
    };

    // Convenience for getting targetable tiles
    const getTargetableTiles = (origin?: TerrainHex, action?: CombatAction) => {
      if (!origin) return undefined;
      if (!action) return undefined;
      if (!closestEnemy) return undefined;
      const f = spiral<TerrainHex>({
        start: [origin.q, origin.r],
        radius: action.range,
      });
      const tiles = grid
        .traverse(f)
        .toArray()
        .filter(
          (hex) =>
            !findUser(nextBattle.usersState, hex.col, hex.row) &&
            !findBarrier(nextBattle.groundEffects, hex.col, hex.row),
        )
        .map((hex) => {
          const path = getPath(origin, closestEnemy);
          const distance = path?.length ? path.length : 0;
          return { hex, distance };
        })
        .sort((a, b) => b.distance - a.distance);
      return tiles;
    };

    // Convenience for getting target
    const getTarget = (
      entry: ZodAllAiCondition | ZodAllAiAction,
      action?: CombatAction,
    ) => {
      if (!("target" in entry)) return undefined;
      switch (entry?.target) {
        case "RANDOM_OPPONENT":
          return randomEnemy;
        case "CLOSEST_OPPONENT":
          return closestEnemy;
        case "RANDOM_ALLY":
          return randomAlly;
        case "CLOSEST_ALLY":
          return closestAlly;
        case "BARRIER_BLOCKING_CLOSEST_OPPONENT":
          return barriers[0];
        case "SELF":
          return userWithDistance;
        case "EMPTY_GROUND_CLOSEST_TO_OPPONENT":
          const closestTiles = getTargetableTiles(origin, action);
          const closestTarget = closestTiles?.[0];
          if (closestTarget) {
            return {
              hex: closestTarget.hex,
              distance: closestTarget.distance,
              longitude: closestTarget.hex.col,
              latitude: closestTarget.hex.row,
            };
          }
          break;
        case "EMPTY_GROUND_CLOSEST_TO_SELF":
          const furthestTiles = getTargetableTiles(origin, action);
          const furthestTarget = furthestTiles?.at(-1);
          if (furthestTarget) {
            return {
              hex: furthestTarget.hex,
              distance: furthestTarget.distance,
              longitude: furthestTarget.hex.col,
              latitude: furthestTarget.hex.row,
            };
          }
          break;
      }
      return undefined;
    };

    // Go through rules
    for (const rule of aiProfile?.rules ?? []) {
      // if (debug) console.log("Rule: ", rule);

      /** ************************ */
      /** CHECK CONDITIONS         */
      /** ************************ */
      const effects = nextBattle.usersEffects;
      const checked = rule.conditions.every((condition) => {
        const target = getTarget(condition);
        switch (condition.type) {
          case "health_below": {
            const curHealth = getEffectiveCurPool(user, effects, "Health");
            const maxHealth = getEffectiveMaxPool(user, effects, "Health");
            return (curHealth / maxHealth) * 100 < condition.value;
          }
          case "distance_higher_than":
            return target ? target.distance >= condition.value : false;
          case "distance_lower_than":
            return target ? target.distance <= condition.value : false;
          case "specific_round":
            return nextBattle.round === condition.value ? true : false;
          case "round_greater_than":
            return nextBattle.round > condition.value;
          case "round_lower_than":
            return nextBattle.round < condition.value;
          case "does_not_have_summon":
            return !nextBattle.usersState.find(
              (u) =>
                u.controllerId === user.userId &&
                u.isSummon &&
                stillInBattle(u, effects),
            );
          case "has_effect": {
            if (condition.threshold === 0) return true;
            const userEffects = nextBattle.usersEffects.filter(
              (e) => e.targetId === user.userId && e.type === condition.effectType,
            );
            if (userEffects.length === 0) return false;
            const totalUserPower = userEffects.reduce(
              (sum, effect) => sum + effect.power,
              0,
            );
            return totalUserPower >= condition.threshold;
          }
          case "target_has_effect": {
            if (condition.threshold === 0) return true;
            const targetUser = target
              ? nextBattle.usersState.find(
                  (u) =>
                    u.longitude === target.longitude && u.latitude === target.latitude,
                )
              : null;
            if (!targetUser) return false;
            const targetEffects = nextBattle.usersEffects.filter(
              (e) =>
                e.targetId === targetUser.userId && e.type === condition.effectType,
            );
            if (targetEffects.length === 0) return false;
            const totalTargetPower = targetEffects.reduce(
              (sum, effect) => sum + effect.power,
              0,
            );
            return totalTargetPower >= condition.threshold;
          }
        }
      });
      /** ************************ */
      /** PROCESS ACTION           */
      /** ************************ */
      if (checked) {
        // Convenience method for checking if rule action has a given effect
        const getHighestPowerAction = (actions: CombatAction[]) => {
          const hasEffect = (e: ZodAllTags) => {
            return "effect" in rule.action && e.type === rule.action.effect;
          };
          return actions
            .filter((a) => a.effects.find((e) => hasEffect(e)))
            .sort((a, b) => {
              const prev = a.effects.find((e) => hasEffect(e));
              const current = b.effects.find((e) => hasEffect(e));
              return prev && current ? current.power - prev.power : 0;
            })[0];
        };
        // Go through different actions
        if (rule.action.type === "move_towards_opponent") {
          const target = getTarget(rule.action);
          const move = availActions.find((a) => a.id === "move");
          if (move) {
            const path = getPath(origin, target);
            const hex = path?.[1];
            if (path && hex && path.length > 2 && hex.cost < 100) {
              nextAction = { action: move, long: hex.col, lat: hex.row };
            }
          }
        } else if (rule.action.type === "use_specific_jutsu") {
          const action = availActions.find(
            (a) => "jutsuId" in rule.action && a.id === rule.action.jutsuId,
          );
          const target = getTarget(rule.action, action);
          if (action && target) {
            nextAction = { action, long: target.longitude, lat: target.latitude };
          }
        } else if (rule.action.type === "use_specific_item") {
          const action = availActions.find(
            (a) => "itemId" in rule.action && a.id === rule.action.itemId,
          );
          const target = getTarget(rule.action, action);
          if (action && target) {
            nextAction = { action, long: target.longitude, lat: target.latitude };
          }
        } else if (rule.action.type === "use_random_jutsu") {
          const jutsus = availActions.filter((a) => a.type === "jutsu");
          const action = jutsus[Math.floor(Math.random() * jutsus.length)];
          const target = getTarget(rule.action, action);
          if (action && target) {
            nextAction = { action, long: target.longitude, lat: target.latitude };
          }
        } else if (rule.action.type === "use_random_item") {
          const items = availActions.filter((a) => a.type === "item");
          const action = items[Math.floor(Math.random() * items.length)];
          const target = getTarget(rule.action, action);
          if (action && target) {
            nextAction = { action, long: target.longitude, lat: target.latitude };
          }
        } else if (rule.action.type === "use_highest_power_action") {
          const action = getHighestPowerAction(availActions);
          const target = getTarget(rule.action, action);
          if (target && action) {
            nextAction = { action, long: target.longitude, lat: target.latitude };
          }
        } else if (rule.action.type === "use_highest_power_jutsu") {
          const action = getHighestPowerAction(
            availActions.filter((a) => a.type === "jutsu"),
          );
          const target = getTarget(rule.action, action);
          if (target && action) {
            nextAction = { action, long: target.longitude, lat: target.latitude };
          }
        } else if (rule.action.type === "use_highest_power_item") {
          const action = getHighestPowerAction(
            availActions.filter((a) => a.type === "item"),
          );
          const target = getTarget(rule.action, action);
          if (target && action) {
            nextAction = { action, long: target.longitude, lat: target.latitude };
          }
        } else if (rule.action.type === "use_combo_action") {
          const userActions = user.usedActions.map((a) => a.id);
          const { nextId } = getComboStatus(rule.action.comboIds, userActions);
          if (nextId) {
            const action = availActions.find((a) => a.id === nextId);
            const target = getTarget(rule.action, action);
            if (action && target) {
              nextAction = { action, long: target.longitude, lat: target.latitude };
            }
          }
        } else if (rule.action.type === "end_turn") {
          const wait = availActions.find((a) => a.id === "wait");
          if (wait) {
            nextAction = { action: wait, long: user.longitude, lat: user.latitude };
          }
        }
      }
      /** ************************ */
      /** CHECK IF ACTION IS VALID */
      /** ************************ */
      if (nextAction) {
        // if (debug) console.log("Action: ", nextAction.action.name);
        const check = actionPointsAfterAction(user, nextBattle, nextAction?.action);
        const result = performBattleAction({
          battle: returnBattle,
          action: nextAction.action,
          grid,
          contextUserId: user.userId,
          actorId: user.userId,
          longitude: nextAction.long,
          latitude: nextAction.lat,
        });
        const valid = check.canAct && !!result;
        if (valid) {
          nextBattle = result.newBattle;
          nextActionEffects.push(...result.actionEffects);
          aiDescriptions.push(nextAction.action.battleDescription);
          break;
        }
        nextAction = undefined;
      }
    }
    /** ******************************* */
    /** If not final action, end the AI */
    /** ******************************* */
    if (!nextAction) {
      aiDescriptions.push(`${user.username} is exhausted and has to give up`);
      user.curHealth = 0;
    }
    if (debug) {
      console.log(">> Performed action: ", nextAction);
    }
  }

  // Reset grid from obstacles
  resetGridFromObstacles(grid);

  if (debug) {
    console.log(">> performAIaction End. Had action: ");
    const ai = nextBattle.usersState.find((u) => u.userId === aiUserId);
    console.log(">> Action Points 2: ", ai?.actionPoints);
  }

  // Return the new state
  const nextActionId = nextAction?.action?.id ?? undefined;
  return { nextBattle, nextActionEffects, aiDescriptions, nextActionId };
};

/**
 * Retrieves a list of enemy users based on the current battle state.
 *
 * @param usersState - An array of `BattleUserState` representing the state of all users in the battle.
 * @param userId - The ID of the user for whom to find enemies.
 * @param effects - Optional array of user effects for calculating effective health.
 * @returns An array of `BattleUserState` representing the enemy users.
 */
const getEnemies = (
  usersState: BattleUserState[],
  userId: string,
  effects?: UserEffect[],
) => {
  const villageIds = [
    ...new Set(
      usersState.filter((u) => stillInBattle(u, effects)).map((u) => u.villageId),
    ),
  ];
  const user = usersState.find((u) => u.userId === userId);
  return usersState
    .filter((u) =>
      villageIds.length > 1
        ? u.villageId !== user?.villageId
        : u.controllerId !== user?.controllerId,
    )
    .filter((u) => stillInBattle(u, effects));
};

/**
 * Retrieves a list of allies for a given user in a battle.
 *
 * This function filters the users who are still in battle and belong to the same village or
 * have the same controller as the specified user. If there are multiple villages involved,
 * it filters by the user's village; otherwise, it filters by the user's controller.
 *
 * @param usersState - An array of `BattleUserState` objects representing the state of all users in the battle.
 * @param userId - The ID of the user for whom to find allies.
 * @param effects - Optional array of user effects for calculating effective health.
 * @returns An array of `BattleUserState` objects representing the allies of the specified user.
 */
const getAllies = (
  usersState: BattleUserState[],
  userId: string,
  effects?: UserEffect[],
) => {
  const villageIds = [
    ...new Set(
      usersState.filter((u) => stillInBattle(u, effects)).map((u) => u.villageId),
    ),
  ];
  const user = usersState.find((u) => u.userId === userId);
  return usersState
    .filter((u) =>
      villageIds.length > 1
        ? u.villageId === user?.villageId
        : u.controllerId === user?.controllerId,
    )
    .filter((u) => stillInBattle(u, effects));
};

const getBarriers = (
  aStar: PathCalculator,
  groundEffects: GroundEffect[],
  origin?: TerrainHex,
  target?: TerrainHex,
) => {
  const barrierCheck =
    origin &&
    target &&
    getBarriersBetween("no-filter", aStar, groundEffects, origin, target);
  const barriers = barrierCheck ? barrierCheck.barriers : [];
  return barriers;
};

/**
 * Maps distances to a target object from a given origin within a grid using the A* pathfinding algorithm.
 *
 * @template T - The type of the target object, which extends either Point2D or UserLocation.
 * @param origin - The starting hex from which distances are calculated.
 * @param grid - The grid containing TerrainHex objects.
 * @param astar - The A* pathfinding algorithm instance used to calculate the shortest path.
 * @param obj - The target object for which the distance is calculated.
 * @returns - The target object extended with the hex it is located in and the distance from the origin.
 */
const mapDistancesToTarget = <T extends Point2D | UserLocation>(
  grid: Grid<TerrainHex>,
  astar: PathCalculator,
  obj: T,
  origin?: TerrainHex,
) => {
  const hex = findHex(grid, obj);
  const path = hex && origin ? astar.getShortestPath(origin, hex) : undefined;
  return {
    ...obj,
    hex: hex,
    distance: path?.length ? path.length : 0,
  };
};

/**
 * Updates the given grid by marking tiles with obstacles.
 *
 * This function iterates over each tile in the provided grid and checks if the tile
 * is occupied by a user or a barrier. If an obstacle is found on the tile, the cost
 * of the tile is set to 100.
 *
 * @param grid - The grid of TerrainHex tiles to be updated.
 * @param battle - The current state of the battle, containing information about users and ground effects.
 * @returns A new grid with updated tile costs where obstacles are present.
 */
const updateGridWithObstacles = (grid: Grid<TerrainHex>, battle: CompleteBattle) => {
  return grid.map((tile) => {
    if (
      findUser(battle.usersState, tile.col, tile.row) ||
      findBarrier(battle.groundEffects, tile.col, tile.row)
    ) {
      tile.cost = 100;
    }
    return tile;
  });
};

/**
 * Resets the cost of all tiles in the given grid to 1, effectively removing any obstacles.
 *
 * @param grid - The grid of TerrainHex tiles to be reset.
 * @returns A new grid with all tile costs set to 1.
 */
const resetGridFromObstacles = (grid: Grid<TerrainHex>) => {
  return grid.map((tile) => {
    tile.cost = 1;
    return tile;
  });
};

/**
 * Determines the combo status based on the provided combo IDs and the latest actions.
 *
 * @param comboIds - An array of strings representing the sequence of combo IDs.
 * @param latestActions - An array of strings representing the latest actions performed.
 * @returns An object containing:
 *   - `inCombo`: A boolean indicating whether the latest actions are part of the combo sequence.
 *   - `nextId` (optional): The next combo ID in the sequence if the combo is in progress, otherwise undefined.
 */
export const getComboStatus = (
  comboIds: string[],
  latestActions: string[],
): { inCombo: boolean; nextId: string | undefined } => {
  const N = comboIds.length;
  const M = latestActions.length;

  if (N === 0) {
    // No combo defined
    return { inCombo: false, nextId: undefined };
  }

  let maxMatchLength = 0;

  const maxK = Math.min(N, M);
  for (let K = maxK; K >= 1; K--) {
    let match = true;
    for (let i = 0; i < K; i++) {
      if (latestActions[M - K + i] !== comboIds[i]) {
        match = false;
        break;
      }
    }
    if (match) {
      maxMatchLength = K;
      break;
    }
  }

  if (maxMatchLength > 0 && maxMatchLength < N) {
    const inCombo = true;
    const nextId = comboIds[maxMatchLength];
    return { inCombo, nextId };
  } else {
    const inCombo = false;
    const nextId = comboIds[0];
    return { inCombo, nextId };
  }
};

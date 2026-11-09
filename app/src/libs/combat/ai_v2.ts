import type { Grid } from "honeycomb-grid";
import { spiral } from "honeycomb-grid";
import {
  ActionNotPossibleError,
  actionPointsAfterAction,
  availableUserActions,
  performBattleAction,
  stillInBattle,
} from "@/libs/combat/actions";
import { areBattleAllies } from "@/libs/combat/participants";
import { applyEffects } from "@/libs/combat/process";
import { hasLiveSummon, isSummonActionCastable } from "@/libs/combat/summon";
import type {
  ActionEffect,
  CombatAction,
  CompleteBattle,
  GroundEffect,
} from "@/libs/combat/types";
import {
  calcPoolCost,
  findBarrier,
  findUser,
  getAiProfile,
  getBarriersBetween,
  getEffectiveCurPool,
  getEffectiveMaxPool,
} from "@/libs/combat/util";
import type { Point2D, TerrainHex, UserLocation } from "@/libs/hexgrid";
import { findHex, PathCalculator } from "@/libs/hexgrid";
import { getRandomElement } from "@/utils/array";
import { secureRandomInt } from "@/utils/math";
import type { ZodAllAiAction, ZodAllAiCondition } from "@/validators/ai";
import { ActionEndTurn, enforceExtraRules, getBackupRules } from "@/validators/ai";
import type { ZodAllTags } from "@/validators/combat";

type ActionWithTarget = {
  action: CombatAction;
  long: number;
  lat: number;
};

/**
 * Choose and perform an AI-driven turn using profiles preloaded into battle state.
 * Target allegiance follows fixed battlefield sides in every mode, including
 * authored NPC allies, summons and players using auto combat.
 */
export const performAIaction = (
  battle: CompleteBattle,
  grid: Grid<TerrainHex>,
  aiUserId: string,
) => {
  // New stats to return
  const nextActionEffects: ActionEffect[] = [];
  const aiDescriptions: string[] = [];
  let nextBattle = battle;
  // Catalogs and settlement snapshots are read-only during turns. Bloodlines, summon
  // templates and private wave/run state still need independent mutable copies.
  const {
    jutsus,
    items,
    userQuests,
    completedQuests,
    questData,
    settings,
    villages,
    relations,
    wars,
    anbuSquads,
    clans,
    bounties,
    bountySignups,
    jutsuReskins,
    ...mutableExtraState
  } = nextBattle.extraState;
  const clonedBattle = structuredClone({
    ...nextBattle,
    extraState: mutableExtraState,
  });
  const returnBattle: CompleteBattle = {
    ...clonedBattle,
    extraState: {
      ...clonedBattle.extraState,
      jutsus,
      items,
      userQuests,
      completedQuests,
      questData,
      settings,
      villages,
      relations,
      wars,
      anbuSquads,
      clans,
      bounties,
      bountySignups,
      jutsuReskins,
    },
  };

  // Find users whose turns are AI-driven: actual AIs, plus humans who handed
  // their turns to their own AI profile (auto combat)
  const aiUsers = nextBattle.usersState.filter(
    (user) => user.isAi || user.isAutoCombat,
  );

  // Next action bookkeeping
  let nextAction: ActionWithTarget | undefined;

  // Rule sets that only inspect pools or end the turn need no paths.
  let astar: PathCalculator | undefined;
  const getAstar = () =>
    (astar ??= new PathCalculator(updateGridWithObstacles(grid, nextBattle)));
  let hasActionGrid = false;
  const getActionAstar = () => {
    if (!hasActionGrid) {
      resetGridFromObstacles(grid);
      astar = undefined;
      hasActionGrid = true;
    }
    return getAstar();
  };
  const hasBarriers = nextBattle.groundEffects.some(
    (effect) => effect.type === "barrier",
  );

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
        // Keep guaranteed no-op summons out of the candidate list entirely.
        if (!isSummonActionCastable(action, nextBattle)) return false;
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
    // Prepare living combatants once from the state after earlier actions.
    const combatants = nextBattle.usersState
      .filter((u) => stillInBattle(u))
      .map((u) => ({ ...u, hex: findHex(grid, u) }));
    const enemies = combatants.filter((u) => !areBattleAllies(u, user));
    const allies = combatants.filter((u) => areBattleAllies(u, user));
    // Derived for convenience
    const userWithDistance = { ...user, path: undefined, distance: 0 };
    const randomEnemy = getRandomElement(enemies);
    const randomAlly = getRandomElement(allies);
    const distances = new Map<TerrainHex, number>();
    const getDistance = (target: { hex?: TerrainHex; distance?: number }) => {
      if (target.distance !== undefined) return target.distance;
      if (!origin || !target.hex) return 0;
      const cached = distances.get(target.hex);
      if (cached !== undefined) return cached;
      const distance = getAstar().getShortestPath(origin, target.hex)?.length ?? 0;
      distances.set(target.hex, distance);
      return distance;
    };
    // Length-guarded rather than bare reduces: a turn still routes through here
    // once the last opponent has fallen -- the caller settles the battle on the
    // same tick -- and reducing the now-empty list would throw instead. The
    // targeting below already treats a missing closest-* as "no target", the
    // same way it treats the random-* picks.
    const closestTarget = (candidates: typeof combatants) =>
      candidates.length
        ? candidates.reduce((prev, current) =>
            getDistance(prev) < getDistance(current) ? prev : current,
          )
        : undefined;
    let closestEnemy: (typeof enemies)[number] | undefined;
    let closestAlly: (typeof allies)[number] | undefined;
    const getClosestEnemy = () => (closestEnemy ??= closestTarget(enemies));
    const getClosestAlly = () => (closestAlly ??= closestTarget(allies));
    const metricTarget = (
      candidates: typeof allies,
      metric: "current" | "max" | "enmity",
      highest: boolean,
    ) =>
      candidates.reduce<(typeof allies)[number] | undefined>((best, candidate) => {
        const value = (target: (typeof allies)[number]) =>
          metric === "enmity"
            ? (target.enmity ?? 0)
            : metric === "max"
              ? getEffectiveMaxPool(target, nextBattle.usersEffects, "Health")
              : getEffectiveCurPool(target, "Health");
        if (!best) return candidate;
        return (
          highest
            ? value(candidate) > value(best)
            : value(candidate) < value(best)
        )
          ? candidate
          : best;
      }, undefined);
    let barriers: ReturnType<typeof mapDistancesToTarget<GroundEffect>>[] | undefined;
    const getBlockingBarriers = () => {
      if (barriers) return barriers;
      if (!hasBarriers) {
        barriers = [];
        return barriers;
      }
      const targetHex = getClosestEnemy()?.hex;
      const clearAstar = new PathCalculator(resetGridFromObstacles(grid));
      barriers = getBarriers(
        clearAstar,
        nextBattle.groundEffects,
        origin,
        targetHex,
      ).map((barrier) => mapDistancesToTarget(grid, clearAstar, barrier, origin));
      // Calculators snapshot both paths and a cost-based heuristic. Rebuild after
      // changing costs; barrier distances above deliberately use the cleared grid.
      astar = new PathCalculator(updateGridWithObstacles(grid, nextBattle));
      hasActionGrid = true;
      return barriers;
    };

    // Get AI profile from static data - clone to avoid mutating the shared reference.
    // A summon whose profile is missing from extraState (e.g. a template loaded by
    // a path that dropped its profile) falls back to the Default profile rather
    // than running no rules at all and giving up on its first turn.
    const aiProfileRef =
      getAiProfile(battle, user.aiProfileId) ??
      (user.isSummon ? getAiProfile(battle, "Default") : undefined);
    const aiProfile = aiProfileRef
      ? { ...aiProfileRef, rules: structuredClone(aiProfileRef.rules) }
      : undefined;

    // If this is a user AI, add the backup rules
    if (aiProfile && (isUser || aiProfile.includeDefaultRules)) {
      const backupRules = getBackupRules();
      enforceExtraRules(aiProfile.rules, backupRules);
    }

    // Auto-combat actors, and actors with an affordable action outside
    // nonEffectActions, get a trailing end_turn rule, so a turn that matches no
    // earlier rule ends through it (see the end_turn branch). Without it, an
    // unmatched actor reaches the give-up path below: an NPC loses all health,
    // while summons and raid-battle actors forfeit the turn.
    const nonEffectActions = [
      "basicHeal",
      "meditate",
      "flee",
      "wait",
      "move",
      "replacementTechnique",
      "cleanse",
      "clear",
    ];
    if (
      aiProfile &&
      (user.isAutoCombat || allActions?.find((a) => !nonEffectActions.includes(a.id)))
    ) {
      aiProfile.rules.push({
        conditions: [],
        action: ActionEndTurn.parse({}),
      });
    }

    // Convenience for getting path to target
    const getPath = (origin?: TerrainHex, target?: { hex?: TerrainHex }) => {
      // Movement uses the normalized combat costs, after distance-based rule
      // selection. A new calculator is required whenever costs are lowered.
      return (
        origin && target?.hex && getActionAstar().getShortestPath(origin, target.hex)
      );
    };

    // Convenience for getting targetable tiles
    const getTargetableTiles = (
      origin?: TerrainHex,
      action?: CombatAction,
      nearestSelf = false,
    ) => {
      if (!origin) return undefined;
      if (!action) return undefined;
      const targetHex = nearestSelf ? origin : getClosestEnemy()?.hex;
      if (!targetHex) return undefined;
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
          const distance = grid.distance(hex, targetHex);
          return { hex, distance };
        })
        .sort((a, b) => a.distance - b.distance);
      return tiles;
    };

    // Convenience for getting target
    const getTarget = (
      entry: ZodAllAiCondition | ZodAllAiAction,
      action?: CombatAction,
    ) => {
      if (!("target" in entry)) return undefined;
      switch (entry?.target) {
        case "COORDINATE": {
          if (!("coordinates" in entry) || !entry.coordinates) return undefined;
          const { longitude, latitude } = entry.coordinates;
          if (!Number.isInteger(longitude) || !Number.isInteger(latitude))
            return undefined;
          const hex = grid.getHex({ col: longitude, row: latitude });
          if (!hex) return undefined;
          return { longitude, latitude, hex };
        }
        case "RANDOM_OPPONENT":
          return randomEnemy;
        case "CLOSEST_OPPONENT":
          return getClosestEnemy();
        case "RANDOM_ALLY":
          return randomAlly;
        case "CLOSEST_ALLY":
          return getClosestAlly();
        case "HIGHEST_ENMITY_OPPONENT":
        case "LOWEST_ENMITY_OPPONENT":
          return metricTarget(
            enemies,
            "enmity",
            entry.target === "HIGHEST_ENMITY_OPPONENT",
          );
        case "HIGHEST_MAX_HEALTH_ALLY":
          return metricTarget(allies, "max", true);
        case "HIGHEST_MAX_HEALTH_OPPONENT":
          return metricTarget(enemies, "max", true);
        case "LOWEST_HEALTH_OPPONENT":
          return metricTarget(enemies, "current", false);
        case "LOWEST_MAX_HEALTH_ALLY":
          return metricTarget(allies, "max", false);
        case "BARRIER_BLOCKING_CLOSEST_OPPONENT":
          return getBlockingBarriers()[0];
        case "SELF":
          return userWithDistance;
        case "EMPTY_GROUND_CLOSEST_TO_OPPONENT":
        case "EMPTY_GROUND_CLOSEST_TO_SELF": {
          const target = getTargetableTiles(
            origin,
            action,
            entry.target === "EMPTY_GROUND_CLOSEST_TO_SELF",
          )?.[0];
          if (target) {
            return {
              hex: target.hex,
              distance: target.distance,
              longitude: target.hex.col,
              latitude: target.hex.row,
            };
          }
          break;
        }
      }
      return undefined;
    };

    // Go through rules
    for (const rule of aiProfile?.rules ?? []) {
      /** ************************ */
      /** CHECK CONDITIONS         */
      /** ************************ */
      const effects = nextBattle.usersEffects;
      const checked = rule.conditions.every((condition) => {
        const target = getTarget(condition);
        switch (condition.type) {
          case "health_below": {
            const curHealth = getEffectiveCurPool(user, "Health");
            const maxHealth = getEffectiveMaxPool(user, effects, "Health");
            return (curHealth / maxHealth) * 100 < condition.value;
          }
          case "distance_higher_than":
            return target ? getDistance(target) >= condition.value : false;
          case "distance_lower_than":
            return target ? getDistance(target) <= condition.value : false;
          case "player_within_range":
          case "summon_within_range":
            return (
              !!origin &&
              enemies.some((enemy) => {
                const matches =
                  condition.type === "summon_within_range"
                    ? enemy.isSummon
                    : !enemy.isAi && !enemy.isSummon;
                if (!matches || !enemy.hex) return false;
                const distance = grid.distance(origin, enemy.hex);
                return distance >= condition.minRange && distance <= condition.maxRange;
              })
            );
          case "specific_round":
            return nextBattle.round === condition.value;
          case "round_greater_than":
            return nextBattle.round > condition.value;
          case "round_lower_than":
            return nextBattle.round < condition.value;
          case "does_not_have_summon":
            // Same predicate as the one-per-controller cap in summon(), so the
            // AI's re-summon gate can never drift from what blocks the cast.
            return !hasLiveSummon(nextBattle.usersState, user.userId);
          case "has_effect":
            if (condition.threshold === 0) return true;
            return reachesEffectPower(nextBattle.usersEffects, user.userId, condition);
          case "target_has_effect": {
            if (condition.threshold === 0) return true;
            const targetUser = target
              ? nextBattle.usersState.find(
                  (u) =>
                    u.longitude === target.longitude && u.latitude === target.latitude,
                )
              : null;
            if (!targetUser) return false;
            return reachesEffectPower(
              nextBattle.usersEffects,
              targetUser.userId,
              condition,
            );
          }
          default:
            return true;
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
        // Aim a selected action at the rule's target, when both exist
        const aimAction = (action?: CombatAction) => {
          const target = getTarget(rule.action, action);
          return action && target
            ? { action, long: target.longitude, lat: target.latitude }
            : undefined;
        };
        // Go through different actions
        if (rule.action.type === "move_towards_opponent") {
          const target = getTarget(rule.action);
          const move = availActions.find((a) => a.id === "move");
          if (move) {
            const path = getPath(origin, target);
            const hex = path?.[1];
            // Entity targets stop beside their tile; coordinate targets reach it.
            const minimumPathLength = rule.action.target === "COORDINATE" ? 1 : 2;
            if (path && hex && path.length > minimumPathLength && hex.cost < 100) {
              nextAction = { action: move, long: hex.col, lat: hex.row };
            }
          }
        } else if (rule.action.type === "use_specific_jutsu") {
          nextAction = aimAction(
            availActions.find(
              (a) => "jutsuId" in rule.action && a.id === rule.action.jutsuId,
            ),
          );
        } else if (rule.action.type === "use_specific_item") {
          nextAction = aimAction(
            availActions.find(
              (a) => "itemId" in rule.action && a.id === rule.action.itemId,
            ),
          );
        } else if (rule.action.type === "use_random_jutsu") {
          const jutsus = availActions.filter((a) => a.type === "jutsu");
          nextAction = aimAction(
            jutsus.length ? jutsus[secureRandomInt(jutsus.length)] : undefined,
          );
        } else if (rule.action.type === "use_random_item") {
          const items = availActions.filter((a) => a.type === "item");
          nextAction = aimAction(
            items.length ? items[secureRandomInt(items.length)] : undefined,
          );
        } else if (rule.action.type === "use_highest_power_action") {
          nextAction = aimAction(getHighestPowerAction(availActions));
        } else if (rule.action.type === "use_highest_power_jutsu") {
          nextAction = aimAction(
            getHighestPowerAction(availActions.filter((a) => a.type === "jutsu")),
          );
        } else if (rule.action.type === "use_highest_power_item") {
          nextAction = aimAction(
            getHighestPowerAction(availActions.filter((a) => a.type === "item")),
          );
        } else if (rule.action.type === "use_combo_action") {
          const userActions = user.usedActions.map((a) => a.id);
          const nextId = getNextComboId(rule.action.comboIds, userActions);
          if (nextId) {
            nextAction = aimAction(availActions.find((a) => a.id === nextId));
          }
        } else if (rule.action.type === "end_turn") {
          // An auto-combat human about to idle on drained pools meditates back
          // to fighting shape instead — without this, a player whose attacks
          // all became unaffordable would wait forever (any human would
          // meditate here). Strategic end-turns at healthy pools are untouched.
          const drainedPools =
            user.curStamina < 0.3 * user.maxStamina ||
            user.curChakra < 0.3 * user.maxChakra;
          const meditate =
            user.isAutoCombat && drainedPools
              ? availActions.find((a) => a.id === "meditate")
              : undefined;
          if (meditate) {
            nextAction = { action: meditate, long: user.longitude, lat: user.latitude };
          } else {
            const wait = availActions.find((a) => a.id === "wait");
            if (wait) {
              nextAction = { action: wait, long: user.longitude, lat: user.latitude };
            }
          }
        }
      }
      /** ************************ */
      /** CHECK IF ACTION IS VALID */
      /** ************************ */
      if (nextAction) {
        // Action insertion uses the weighted grid to determine barrier interception,
        // even when the selected rule itself needed no paths.
        if (hasBarriers) getActionAstar();
        const result = attemptBattleAction({
          battle: returnBattle,
          action: nextAction.action,
          grid,
          actorId: user.userId,
          longitude: nextAction.long,
          latitude: nextAction.lat,
        });
        if (result) {
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
    // Auto-combat humans are excluded: their turn simply times out and passes,
    // letting the player take back control rather than dying to a stuck rule set.
    // Summons and clones are a player's resource, not an opponent to defeat: one
    // that cannot act forfeits the rest of its turn instead of dying. Raid bosses
    // do the same: their HP is shared across battles, so zeroing it would credit
    // the whole remaining raid HP as damage dealt.
    if (!nextAction && !user.isPiloted && !user.isAutoCombat) {
      if (user.isSummon || battle.battleType === "RAID") {
        aiDescriptions.push(`${user.username} hesitates and ends its turn`);
        // Still resolve the effects a normal action would have ticked on this
        // actor (e.g. damage over time); applyEffects guards repeats per round.
        const ticked = applyEffects(nextBattle, user.userId);
        nextBattle = ticked.newBattle;
        nextActionEffects.push(...ticked.actionEffects);
        const stuckUser = nextBattle.usersState.find((u) => u.userId === user.userId);
        if (stuckUser) stuckUser.actionPoints = 0;
      } else {
        aiDescriptions.push(`${user.username} is exhausted and has to give up`);
        user.curHealth = 0;
      }
    }
  }

  // Reset grid from obstacles
  resetGridFromObstacles(grid);

  // Return the new state
  const nextActionId = nextAction?.action?.id ?? undefined;
  return { nextBattle, nextActionEffects, aiDescriptions, nextActionId };
};

/**
 * Perform an AI-chosen action, or return undefined when it cannot be carried out.
 *
 * The rules pick actions without checking the target is in reach (e.g. a range-1
 * attack while every tile next to the opponent is taken). Such a pick has to fall
 * through to the next rule: letting it throw would abort the whole turn, which the
 * client then re-fires every second until the round timer passes the turn on. A
 * rejected action leaves the battle state untouched, so the next rule can reuse it.
 */
const attemptBattleAction = (props: Parameters<typeof performBattleAction>[0]) => {
  try {
    return performBattleAction(props);
  } catch (error) {
    if (error instanceof ActionNotPossibleError) return undefined;
    throw error;
  }
};

/** Whether a user's effects of one type carry at least the condition's summed power. */
const reachesEffectPower = (
  effects: CompleteBattle["usersEffects"],
  userId: string,
  { effectType, threshold }: { effectType: string; threshold: number },
) => {
  const matching = effects.filter(
    (e) => e.targetId === userId && e.type === effectType,
  );
  if (matching.length === 0) return false;
  return matching.reduce((sum, effect) => sum + effect.power, 0) >= threshold;
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
 * Sets the cost of every tile occupied by a user or a barrier to 100.
 *
 * Costs change in place on the hexes of `grid`; the returned Grid holds the same
 * hexes. Action insertion builds its barrier-interception path calculator from
 * `grid`, so it reads the costs left here.
 *
 * @param grid - The battle grid whose tile costs are updated.
 * @param battle - The current state of the battle, containing information about users and ground effects.
 * @returns A Grid of the same, updated hexes.
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
 * Resets the cost of all tiles in the given grid to 1, removing obstacle weights.
 *
 * Costs change in place on the hexes of `grid`; the returned Grid holds the same
 * hexes, so callers may ignore it.
 *
 * @param grid - The battle grid whose tile costs are reset.
 * @returns A Grid of the same, reset hexes.
 */
const resetGridFromObstacles = (grid: Grid<TerrainHex>) => {
  return grid.map((tile) => {
    tile.cost = 1;
    return tile;
  });
};

/**
 * Returns the next combo ID to use given the latest actions: the step after the
 * longest in-progress prefix of the combo, or the first step otherwise.
 *
 * @param comboIds - The sequence of combo IDs.
 * @param latestActions - The latest actions performed.
 */
export const getNextComboId = (
  comboIds: string[],
  latestActions: string[],
): string | undefined => {
  const N = comboIds.length;
  const M = latestActions.length;

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

  return comboIds[maxMatchLength > 0 && maxMatchLength < N ? maxMatchLength : 0];
};

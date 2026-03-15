import type { Grid } from "honeycomb-grid";
import { nanoid } from "nanoid";
import type { AttackTargets, ElementName, UserRank } from "@/drizzle/constants";
import {
  DURABILITY_USABILITY_THR,
  ID_ANIMATION_HEAL,
  ID_ANIMATION_HIT,
  ID_SFX_CLEANSE,
  ID_SFX_CLEAR,
  ID_SFX_HEAL,
  ID_SFX_HIT,
  ID_SFX_MOVE,
  IMG_BASIC_ATTACK,
  IMG_BASIC_CLEANSE,
  IMG_BASIC_CLEAR,
  IMG_BASIC_FLEE,
  IMG_BASIC_HEAL,
  IMG_BASIC_MOVE,
  IMG_BASIC_WAIT,
  NO_DURABILITY_LOSS_COMBATS,
  NonActionItemTypes,
  QuestBattleTypes,
} from "@/drizzle/constants";
import type { Jutsu } from "@/drizzle/schema";
import { COMBAT_SECONDS } from "@/libs/combat/constants";
import { applyEffects, checkFriendlyFire } from "@/libs/combat/process";
import { getPower, realizeTag, updateStatUsage } from "@/libs/combat/tags";
import type {
  BasicActions,
  BattleUserItem,
  BattleUserJutsu,
  BattleUserState,
  CombatAction,
  CompleteBattle,
  GroundEffect,
  ReturnedBattle,
  ReturnedUserState,
  UserEffect,
} from "@/libs/combat/types";
import {
  actionHasSharedCooldown,
  calcApReduction,
  calcPoolCost,
  getAffectedTiles,
  getBarriersBetween,
  getEffectiveCurPool,
  getItem,
  getJutsu,
  getJutsuReskin,
  getUserElementalSeal,
  hasNoAvailableActions,
  isEffectActive,
  isUserImmobilized,
  isUserStealthed,
  isUserSummonPrevented,
  tagHasSharedCooldown,
} from "@/libs/combat/util";
import type { TerrainHex } from "@/libs/hexgrid";
import { getPossibleActionTiles, PathCalculator } from "@/libs/hexgrid";
import { calcCombatHealPercentage } from "@/libs/hospital";
import {
  CleanseTag,
  ClearTag,
  DamageTag,
  DecreaseCooldownTag,
  FleeTag,
  HealTag,
  IncreaseCooldownTag,
  IncreaseRangeTag,
  InjectJutsusTag,
  MoveTag,
} from "@/validators/combat";

/**
 * Given a user, return a list of actions that the user can perform
 */
export const availableUserActions = (
  battle: ReturnedBattle | undefined | null,
  userId: string | undefined,
  basicMoves = true,
  hideCooldowned = false,
): CombatAction[] => {
  const usersState = battle?.usersState;
  const user = usersState?.find((u) => u.userId === userId);
  const { availableActionPoints } = actionPointsAfterAction(user, battle);
  const isStealth = isUserStealthed(userId, battle?.usersEffects);
  const isStudent = user?.rank === "STUDENT";
  const isSummonPrevented = isUserSummonPrevented(userId, battle?.usersEffects);
  const isImmobilized = isUserImmobilized(userId, battle?.usersEffects);
  const elementalSeal = getUserElementalSeal(userId, battle?.usersEffects);
  const basicActions = getActiveBasicActions(battle, user);
  const isQuestBattle = battle ? QuestBattleTypes.includes(battle.battleType) : false;

  // Handle injected jutsus
  if (battle && user) {
    user.jutsus = handleInjectedJutsus(battle, user);
  }

  // Concatenate all actions
  let availableActions = [
    ...(basicMoves && !isStealth ? [basicActions.basicAttack] : []),
    ...(!isImmobilized ? [basicActions.basicMove] : []),
    ...(basicMoves && !isStealth && !isStudent
      ? [
          basicActions.basicHeal,
          basicActions.basicClear,
          basicActions.basicCleanse,
          basicActions.basicFlee,
        ]
      : []),
    ...(availableActionPoints && availableActionPoints > 0
      ? [
          {
            id: "wait",
            name: "End Turn",
            image: IMG_BASIC_WAIT,
            battleDescription: "%user stands and does nothing",
            type: "basic" as const,
            target: "SELF" as const,
            method: "SINGLE" as const,
            healthCost: 0,
            chakraCost: 0,
            staminaCost: 0,
            actionCostPerc: availableActionPoints,
            range: 0,
            updatedAt: Date.now(),
            cooldown: 0,
            originalCooldown: 0,
            effects: [],
          },
        ]
      : []),
    ...(user?.jutsus && battle
      ? user.jutsus
          .filter((userjutsu) => {
            const jutsu = getJutsu(battle, userjutsu.jutsuId);
            if (!jutsu) return false;

            // If quest battle, exclude PVP-only jutsus
            if (isQuestBattle && jutsu.battleUsageType === "PVP") {
              return false;
            }
            // If non-quest battle, exclude PVE-only jutsus
            if (!isQuestBattle && jutsu.battleUsageType === "PVE") {
              return false;
            }
            // Filter out jutsus with damage tag when stealthed
            if (isStealth) {
              const offensiveTags = new Set(["damage", "pierce", "drain"]);
              const hasOffensiveTag = jutsu.effects.some((e: { type: string }) =>
                offensiveTags.has(e.type),
              );
              if (hasOffensiveTag) return false;
            }
            // Filter out summon jutsu when summonPrevent is active
            if (isSummonPrevented) {
              const hasSummonTag = jutsu.effects.some(
                (e: { type: string }) => e.type === "summon",
              );
              if (hasSummonTag) return false;
            }
            // Filter out jutsus removed by elemental seal
            if (!elementalSeal?.elements?.length) return true;
            const jutsuElements = new Set<string>();
            for (const effect of jutsu.effects) {
              if ("elements" in effect && Array.isArray(effect.elements)) {
                for (const el of effect.elements) {
                  jutsuElements.add(el);
                }
              }
            }
            return (
              jutsuElements.size === 0 ||
              !elementalSeal.elements.some((e: ElementName) => jutsuElements.has(e))
            );
          })
          .map((uj) => userJutsuToAction(uj, battle))
      : []),
    ...(user?.items && !isStealth && battle
      ? user.items
          .filter((ui) => {
            if (ui.quantity <= 0) return false;
            const item = getItem(battle, ui.itemId);
            if (!item) return false;
            if (item.preventBattleUsage) return false;
            // If quest battle, exclude PVP-only items
            if (isQuestBattle && item.battleUsageType === "PVP") {
              return false;
            }
            // If non-quest battle, exclude PVE-only items
            if (!isQuestBattle && item.battleUsageType === "PVE") {
              return false;
            }
            if (NonActionItemTypes.includes(item.itemType)) return false;
            if (ui.equipped === "NONE") return false;
            if (item.itemType === "WEAPON") {
              const current = Math.min(ui.durability, item.maxDurability);
              return current > DURABILITY_USABILITY_THR;
            }
            return true;
          })
          .map((ui) => userItemToAction(ui, user, battle))
      : []),
  ];
  // If we only have move & end turn action, also add basic attack
  // If only 'move' and 'endTurn' actions are available, also add 'basicAttack'
  if (
    !isStealth &&
    availableActions.length === 2 &&
    availableActions.some((a) => a.id === "move") &&
    availableActions.some((a) => a.id === "wait")
  ) {
    availableActions.push(basicActions.basicAttack);
  }
  // If we hide cooldowns, hide then
  if (hideCooldowned) {
    availableActions = availableActions.filter((a) => {
      if (a.cooldown && a.cooldown > 0 && a.lastUsedRound) {
        const roundsPassed = (battle?.round || 0) - a.lastUsedRound;
        return roundsPassed >= a.cooldown;
      }
      return true;
    });
  }
  // If cooldowns are up, then update cooldown setting to original value
  availableActions = availableActions.map((a) => {
    if (a.cooldown && a.cooldown > 0 && a.lastUsedRound) {
      const roundsPassed = (battle?.round || 0) - a.lastUsedRound;
      if (roundsPassed >= a.cooldown) {
        a.cooldown = a.originalCooldown;
        a.lastUsedRound = -a.originalCooldown;
        if (a.type === "jutsu") {
          const entry = user?.jutsus?.find((j) => j.jutsuId === a.id);
          if (entry) {
            entry.originalCooldown = a.originalCooldown;
            entry.lastUsedRound = -a.originalCooldown;
          }
        } else if (a.type === "item") {
          const entry = user?.items?.find((i) => i.itemId === a.id);
          if (entry) {
            entry.originalCooldown = a.originalCooldown;
            entry.lastUsedRound = -a.originalCooldown;
          }
        }
      }
    }
    return a;
  });
  // Return actions
  return availableActions;
};

/**
 * Get the active basic actions for a user. This includes several overrides of the "default" basic actions
 * @param user - The user to get the active basic actions for
 * @returns The active basic actions for the user
 */
export const getActiveBasicActions = (
  battle: ReturnedBattle | undefined | null,
  user: ReturnedUserState | undefined,
): BasicActions => {
  const userId = user?.userId;
  const tracking = user?.basicActions; // Slim BattleBasicAction[] for lastUsedRound tracking
  const base = getDefaultBasicActions(user);

  // Helper to merge lastUsedRound and cooldown override from tracking data into full action
  const mergeTracking = (action: CombatAction, actionId: string): CombatAction => {
    const trackingData = tracking?.find((ba) => ba.id === actionId);
    if (trackingData) {
      return {
        ...action,
        lastUsedRound: trackingData.lastUsedRound,
        // Apply cooldown override from GCD if set, otherwise use base cooldown
        cooldown: trackingData.cooldown ?? action.cooldown,
      };
    }
    return action;
  };

  // Build active actions using base (full CombatAction) merged with tracking data
  const active: BasicActions = {
    basicAttack: mergeTracking(base.basicAttack, "basicAttack"),
    basicHeal: mergeTracking(base.basicHeal, "basicHeal"),
    basicMove: mergeTracking(base.basicMove, "move"),
    basicClear: mergeTracking(base.basicClear, "clear"),
    basicCleanse: mergeTracking(base.basicCleanse, "cleanse"),
    basicFlee: mergeTracking(base.basicFlee, "flee"),
  };

  // Collect active, targeted effects once
  const userActiveEffects =
    battle?.usersEffects?.filter((e) => e.targetId === userId && isEffectActive(e)) ??
    [];

  // Range bonuses from increaserange tags (per-action)
  const rangeBonusMap: Record<string, number> = userActiveEffects
    .filter((e) => e.type === "increaserange")
    .reduce(
      (acc, e) => {
        const parsed = IncreaseRangeTag.parse(e);
        const { power } = getPower(e);
        parsed.actionsAffected?.forEach((act) => {
          acc[act] = Math.max(acc[act] ?? 0, power);
        });
        return acc;
      },
      {} as Record<string, number>,
    );

  // Apply bonuses to relevant basic actions
  Object.entries(rangeBonusMap).forEach(([aid, bonus]) => {
    if (bonus === 0) return;
    const ba = Object.values(active).find((a) => a.id === aid);
    if (ba?.range !== undefined && ba.range > 0) {
      ba.range += bonus;
    }
  });

  // Cooldown modifications from increasecooldown/decreasecooldown tags (per-action)
  const cooldownModifierMap: Record<string, number> = userActiveEffects
    .filter((e) => e.type === "increasecooldown" || e.type === "decreasecooldown")
    .reduce(
      (acc, e) => {
        const { power } = getPower(e);
        const val = e.type === "increasecooldown" ? power : -power;
        const parsed =
          e.type === "increasecooldown"
            ? IncreaseCooldownTag.parse(e)
            : DecreaseCooldownTag.parse(e);
        parsed.actionsAffected?.forEach((act) => {
          const prev = acc[act];
          acc[act] = prev === undefined ? val : val < prev ? val : prev;
        });
        return acc;
      },
      {} as Record<string, number>,
    );

  // Apply modifiers to relevant basic actions
  Object.entries(cooldownModifierMap).forEach(([aid, mod]) => {
    if (mod === 0) return;
    const ba = Object.values(active).find((a) => a.id === aid);
    if (ba) {
      ba.cooldown = Math.max(0, ba.cooldown + mod);
    }
  });

  return active;
};

/**
 * Get the default basic actions for a user
 * @param user - The user to get the basic actions for
 * @returns The basic actions for the user
 */
export const getDefaultBasicActions = (
  user:
    | {
        level?: number;
        basicActions?: { id: string; lastUsedRound?: number }[];
        medicalExperience?: number;
        rank?: UserRank;
      }
    | undefined,
): BasicActions => {
  return {
    basicAttack: {
      id: "basicAttack",
      name: "Basic Attack",
      image: IMG_BASIC_ATTACK,
      battleDescription: "%user perform a basic physical strike against %target",
      type: "basic" as const,
      target: "OTHER_USER" as const,
      method: "SINGLE" as const,
      healthCost: 0,
      chakraCost: 0,
      staminaCost: 10,
      actionCostPerc: 40,
      range: 1,
      updatedAt: Date.now(),
      cooldown: 0,
      originalCooldown: 0,
      lastUsedRound:
        user?.basicActions?.find((ba) => ba.id === "basicAttack")?.lastUsedRound ?? 0,
      level: user?.level,
      effects: [
        DamageTag.parse({
          power: 10,
          powerPerLevel: 0.05,
          statTypes: ["Highest"],
          generalTypes: ["Highest"],
          rounds: 0,
          appearAnimation: ID_ANIMATION_HIT,
          appearSfx: ID_SFX_HIT,
        }),
      ],
    },
    basicHeal: {
      id: "basicHeal",
      name: "Basic Heal",
      image: IMG_BASIC_HEAL,
      battleDescription: "%user perform basic healing of %target",
      type: "basic" as const,
      target: "SELF" as const,
      method: "SINGLE" as const,
      healthCost: 0,
      chakraCost: 10,
      staminaCost: 0,
      actionCostPerc: 60,
      range: 0,
      updatedAt: Date.now(),
      cooldown: 5,
      originalCooldown: 5,
      lastUsedRound:
        user?.basicActions?.find((ba) => ba.id === "basicHeal")?.lastUsedRound ?? -10,
      level: user?.level,
      effects: [
        HealTag.parse({
          power: calcCombatHealPercentage(user),
          powerPerLevel: 0.0,
          calculation: "static",
          rounds: 0,
          appearAnimation: ID_ANIMATION_HEAL,
          appearSfx: ID_SFX_HEAL,
        }),
      ],
    },
    basicMove: {
      id: "move",
      name: "Move",
      image: IMG_BASIC_MOVE,
      battleDescription: "%user moves on the battlefield",
      type: "basic" as const,
      target: "EMPTY_GROUND" as const,
      method: "SINGLE" as const,
      range: 1,
      updatedAt: Date.now(),
      cooldown: 0,
      originalCooldown: 0,
      lastUsedRound:
        user?.basicActions?.find((ba) => ba.id === "move")?.lastUsedRound ?? 0,
      healthCost: 0,
      chakraCost: 0,
      staminaCost: 0,
      actionCostPerc: 30,
      effects: [MoveTag.parse({ power: 100, appearSfx: ID_SFX_MOVE })],
    },
    basicCleanse: {
      id: "cleanse",
      name: "Cleanse",
      image: IMG_BASIC_CLEANSE,
      battleDescription: "%user cleanses all negative effects from self",
      type: "basic" as const,
      target: "SELF" as const,
      method: "SINGLE" as const,
      range: 4,
      updatedAt: Date.now(),
      cooldown: 10,
      originalCooldown: 10,
      lastUsedRound:
        user?.basicActions?.find((ba) => ba.id === "cleanse")?.lastUsedRound ?? -10,
      healthCost: 0,
      chakraCost: 0,
      staminaCost: 0,
      actionCostPerc: 60,
      effects: [CleanseTag.parse({ power: 100, appearSfx: ID_SFX_CLEANSE })],
    },
    basicClear: {
      id: "clear",
      name: "Clear",
      image: IMG_BASIC_CLEAR,
      battleDescription: "%user clears all positive effects from %target",
      type: "basic" as const,
      target: "OTHER_USER" as const,
      method: "SINGLE" as const,
      range: 4,
      updatedAt: Date.now(),
      cooldown: 10,
      originalCooldown: 10,
      lastUsedRound:
        user?.basicActions?.find((ba) => ba.id === "clear")?.lastUsedRound ?? -10,
      healthCost: 0,
      chakraCost: 0,
      staminaCost: 0,
      actionCostPerc: 60,
      effects: [ClearTag.parse({ power: 100, appearSfx: ID_SFX_CLEAR })],
    },
    basicFlee: {
      id: "flee",
      name: "Flee",
      image: IMG_BASIC_FLEE,
      battleDescription: "%user attempts to flee the battle",
      type: "basic" as const,
      target: "SELF" as const,
      method: "SINGLE" as const,
      range: 0,
      updatedAt: Date.now(),
      cooldown: 0,
      originalCooldown: 0,
      lastUsedRound:
        user?.basicActions?.find((ba) => ba.id === "flee")?.lastUsedRound ?? 0,
      healthCost: 0.1,
      chakraCost: 0,
      staminaCost: 0,
      actionCostPerc: 100,
      effects: [FleeTag.parse({ power: 20, rounds: 0 })],
    },
  };
};

/**
 * Convert a user item to a combat action
 * @param useritem - The user item to convert
 * @param user - The user to convert the item for
 * @param battle - The battle for looking up item data
 * @returns The combat action
 */
export const userItemToAction = (
  useritem: BattleUserItem,
  user: ReturnedUserState,
  battle: ReturnedBattle | CompleteBattle,
) => {
  const item = getItem(battle, useritem.itemId);
  if (!item) throw new Error(`Item not found: ${useritem.itemId}`);
  return {
    id: item.id,
    name: item.name,
    image: item.image,
    battleDescription: item.battleDescription,
    type: "item" as const,
    target: item.target,
    method: item.method,
    range: item.range,
    updatedAt: Date.now(),
    cooldown: useritem.originalCooldown,
    originalCooldown: useritem.originalCooldown,
    lastUsedRound: useritem.lastUsedRound,
    level: user.level,
    healthCost: Math.max(0, item.healthCost - item.healthCostReducePerLvl * user.level),
    chakraCost: Math.max(0, item.chakraCost - item.chakraCostReducePerLvl * user.level),
    staminaCost: Math.max(
      0,
      item.staminaCost - item.staminaCostReducePerLvl * user.level,
    ),
    actionCostPerc: item.actionCostPerc,
    effects: item.effects,
    quantity: useritem.quantity,
    data: item,
    durability: useritem.durability,
    maxDurability: item.maxDurability,
  };
};

/**
 * Convert a user jutsu to a combat action
 * @param userjutsu - The user jutsu to convert
 * @param battle - The battle for looking up jutsu data
 * @returns The combat action
 */
export const userJutsuToAction = (
  userjutsu: BattleUserJutsu,
  battle: ReturnedBattle | CompleteBattle,
) => {
  const jutsu = getJutsu(battle, userjutsu.jutsuId);
  if (!jutsu) throw new Error(`Jutsu not found: ${userjutsu.jutsuId}`);

  // Apply reskin if the user has one for this jutsu
  const reskin = getJutsuReskin(battle, userjutsu.reskinId);
  const name = reskin?.name || jutsu.name;
  const image = reskin?.image || jutsu.image;
  const battleDescription = reskin?.battleDescription || jutsu.battleDescription;

  return {
    id: jutsu.id,
    name,
    image,
    battleDescription,
    type: "jutsu" as const,
    target: jutsu.target,
    method: jutsu.method,
    range: jutsu.range,
    updatedAt: Date.now(),
    cooldown: userjutsu.originalCooldown,
    originalCooldown: userjutsu.originalCooldown,
    lastUsedRound: userjutsu.lastUsedRound,
    healthCost: Math.max(
      0,
      jutsu.healthCost - jutsu.healthCostReducePerLvl * userjutsu.level,
    ),
    chakraCost: Math.max(
      0,
      jutsu.chakraCost - jutsu.chakraCostReducePerLvl * userjutsu.level,
    ),
    staminaCost: Math.max(
      0,
      jutsu.staminaCost - jutsu.staminaCostReducePerLvl * userjutsu.level,
    ),
    actionCostPerc: jutsu.actionCostPerc,
    effects: jutsu.effects,
    level: userjutsu.level,
    data: jutsu,
  };
};

/**
 * Handle injected jutsus from all active inject effects.
 * - Union of jutsus from ALL active inject effects (multiple injects stack, Bug 1).
 * - Remove only jutsus that are no longer in any active effect (expiry, Bug 3).
 * - Preserve existing injected jutsu objects so lastUsedRound/cooldown is kept (Bug 2).
 */
export const handleInjectedJutsus = (
  battle: ReturnedBattle,
  user: ReturnedUserState,
) => {
  const injectEffects = battle?.usersEffects
    ?.filter((e) => e.targetId === user.userId && isEffectActive(e))
    ?.filter((e) => e.type === "injectjutsus");

  const allJutsus = battle?.extraState.jutsus ?? {};
  const userCurrentExtraJutsuIds =
    user?.jutsus?.filter((j) => j.origin === "injected").map((j) => j.jutsuId) ?? [];

  // Union of all jutsu IDs from all active inject effects (don't remove jutsus from other effects)
  const allInjectedJutsuIdsFromEffects = new Set<string>();
  const toBeAddedJutsuPower: Record<string, number> = {};
  for (const e of injectEffects ?? []) {
    const jutsuIds = InjectJutsusTag.parse(e).jutsuIds;
    const tagJutsus = jutsuIds
      .map((id) => allJutsus[id])
      .filter((j): j is Jutsu => j !== undefined);
    for (const j of tagJutsus) {
      allInjectedJutsuIdsFromEffects.add(j.id);
      if (!userCurrentExtraJutsuIds.includes(j.id)) {
        toBeAddedJutsuPower[j.id] = e.power ?? 1;
      }
    }
  }

  // Remove only injected jutsus that are no longer granted by any active effect (e.g. effect expired)
  const toBeRemovedIds = userCurrentExtraJutsuIds.filter(
    (id) => !allInjectedJutsuIdsFromEffects.has(id),
  );
  const toBeAddedIds = [...new Set(Object.keys(toBeAddedJutsuPower))];

  // Define the user available jutsus
  const activeJutsus = [
    ...(user?.jutsus?.filter((j) => !toBeRemovedIds.includes(j.jutsuId)) ?? []),
    ...toBeAddedIds
      .map((id) => allJutsus[id])
      .filter((j): j is Jutsu => j !== undefined)
      .map((jutsu) => ({
        id: nanoid(),
        jutsuId: jutsu.id,
        level: toBeAddedJutsuPower[jutsu.id] ?? 1,
        experience: 0,
        equipped: true,
        origin: "injected" as const,
        lastUsedRound: -jutsu.cooldown,
        originalCooldown: jutsu.cooldown,
        reskinId: null,
      })),
  ];
  return activeJutsus;
};

export const insertAction = (info: {
  battle: CompleteBattle;
  grid: Grid<TerrainHex>;
  action: CombatAction;
  actorId: string;
  longitude: number;
  latitude: number;
}) => {
  // Destruct
  const { battle, grid, action, actorId, longitude, latitude } = info;
  const { usersState, usersEffects, groundEffects } = battle;

  // Convenience
  usersState.forEach((u) => {
    u.hex = grid.getHex({ col: u.longitude, row: u.latitude });
  });
  const alive = usersState.filter((u) => u.curHealth > 0);
  const user = alive.find((u) => u.userId === actorId);
  const targetTile = grid.getHex({ col: longitude, row: latitude });

  // Check if user was found
  if (!user) {
    throw new Error("User performing action not found");
  }

  // Can only perform action if battle started
  if (battle.createdAt.getTime() > Date.now()) {
    throw new Error("Battle has not started yet");
  }

  // Check if the user can perform the action
  const userHex = user.hex;
  if (userHex && targetTile) {
    // Check pools cost
    const { hpCost, cpCost, spCost } = calcPoolCost(action, usersEffects, user);
    if (user.curHealth < hpCost) throw new Error("Not enough health");
    if (user.curChakra < cpCost) throw new Error("Not enough chakra");
    if (user.curStamina < spCost) throw new Error("Not enough stamina");
    // How much time passed since last action
    const { apAvailableAfter, apAfter } = actionPointsAfterAction(user, battle, action);
    if (apAvailableAfter < 0) return false;
    // Get the possible action squares
    const highlights = getPossibleActionTiles(action, userHex, grid);
    // Given this action, get the affected tiles
    const { green: affectedTiles } = getAffectedTiles({
      a: userHex,
      b: targetTile,
      action,
      grid: grid,
      restrictGrid: highlights,
      users: alive,
      ground: groundEffects,
      userId: actorId,
    });
    // Bookkeeping
    let targetUsernames: string[] = [];
    let targetGenders: string[] = [];
    const appliedEffects = new Set<string>();
    const barrierAttacks: string[] = [];
    // Path finder on grid
    const aStar = new PathCalculator(grid);
    // For each affected tile, apply the effects
    affectedTiles.forEach((tile) => {
      // Calculate how many barriers are between origin & target
      const { barriers, totalAbsorb } = getBarriersBetween(
        actorId,
        aStar,
        groundEffects,
        userHex,
        tile,
      );

      // ADD EFFECTS
      if (action.target === "GROUND" || action.target === "EMPTY_GROUND") {
        // ADD GROUND EFFECTS
        const target = getTargetUser(alive, "CHARACTER", tile, user.userId);
        action.effects.forEach((tag) => {
          // If it is a move effect, use the target tile instead of AOE tile
          const effectTile = tag.type === "move" ? targetTile : tile;
          // Target conditions
          if (tag.target === "SELF") {
            const effect = realizeTag({
              tag: tag as UserEffect,
              user: user,
              actionId: action.id,
              target: user,
              level: action.level,
              round: battle.round,
              barrierAbsorb: totalAbsorb,
            });
            if (effect && checkFriendlyFire(effect, user, alive)) {
              const idx = `${effect.type}-${effect.creatorId}-${effect.targetId}-${effect.fromType}`;
              if (!appliedEffects.has(idx)) {
                effect.targetId = user.userId;
                usersEffects.push(effect);
                appliedEffects.add(idx);
              }
            }
          } else if (!tag.target || tag.target === "INHERIT") {
            const effect = realizeTag({
              tag: tag as GroundEffect,
              user: user,
              actionId: action.id,
              level: action.level,
              round: battle.round,
              barrierAbsorb: totalAbsorb,
            });
            effect.longitude = effectTile.col;
            effect.latitude = effectTile.row;
            groundEffects.push({ ...effect });
            if (
              target &&
              effect.type !== "move" &&
              checkFriendlyFire(effect, target, alive)
            ) {
              targetUsernames.push(target.username);
              targetGenders.push(target.gender);
            }
          }
        });
      } else {
        // ADD USER EFFECTS
        const target = getTargetUser(alive, action.target, tile, user.userId);
        action.effects.forEach((tag) => {
          const effect = realizeTag({
            tag: tag as UserEffect,
            user: user,
            actionId: action.id,
            target: target,
            level: action.level,
            round: battle.round,
            barrierAbsorb: totalAbsorb,
          });
          if (effect) {
            effect.longitude = tile.col;
            effect.latitude = tile.row;
            effect.fromType = action.type;
            if (target && (!tag.target || tag.target === "INHERIT")) {
              // Apply UserEffect to target
              if (checkFriendlyFire(effect, target, alive)) {
                targetUsernames.push(target.username);
                targetGenders.push(target.gender);
                // Check for stealth
                const isStealthed = isUserStealthed(target.userId, usersEffects);
                // Allow self-targeting abilities like basic heal even when stealthed
                if (isStealthed && target.userId !== user.userId) {
                  action.battleDescription +=
                    ". The target is stealthed and cannot be targeted";
                } else {
                  effect.targetId = target.userId;
                  usersEffects.push(effect);
                }
              }
            } else if (tag.target === "SELF") {
              const idx = `${effect.type}-${effect.creatorId}-${effect.targetId}-${effect.fromType}`;
              if (!appliedEffects.has(idx) && checkFriendlyFire(effect, user, alive)) {
                effect.targetId = user.userId;
                usersEffects.push(effect);
                appliedEffects.add(idx);
              }
            }
            // Extra: If no target, check if there is a barrier & apply damage only
            if (["damage", "pierce"].includes(tag.type)) {
              barriers.forEach((barrier) => {
                const idx = `${barrier.id}-${effect.id}`;
                if (!barrierAttacks.includes(idx)) {
                  barrierAttacks.push(idx);
                  targetUsernames.push("barrier");
                  targetGenders.push("it");
                  const barrierEffect = structuredClone(effect);
                  barrierEffect.targetType = "barrier";
                  barrierEffect.targetId = barrier.id;
                  barrierEffect.id = nanoid();
                  if ("absorbPercentage" in barrier) {
                    barrierEffect.barrierAbsorb = barrier.absorbPercentage;
                  }
                  usersEffects.push(barrierEffect);
                }
              });
            }
          }
        });
      }
    });
    // Get uniques only
    targetUsernames = [...new Set(targetUsernames)];
    targetGenders = [...new Set(targetGenders)];
    // Update local battle history in terms of usage of action, effects, etc.
    action.effects.forEach((effect) => {
      updateStatUsage(user, effect as UserEffect);
    });
    user.usedActions.push({ id: action.id, type: action.type });
    // Check if action affected anything
    if (affectedTiles.size > 0) {
      // If this was an item, check if we should destroy on use
      if (action.type === "item") {
        const useritem = user.items.find((i) => i.itemId === action.id);
        const itemData = useritem ? getItem(battle, useritem.itemId) : undefined;
        if (
          useritem &&
          itemData?.destroyOnUse &&
          battle.battleType !== "SPARRING" &&
          battle.battleType !== "RANKED_PVP" &&
          battle.battleType !== "RANKED_SPARRING"
        ) {
          useritem.quantity -= 1;
        }
      }
      // Update pools & action timer based on action
      user.curChakra -= cpCost;
      user.curChakra = Math.max(0, user.curChakra);
      user.curStamina -= spCost;
      user.curStamina = Math.max(0, user.curStamina);
      user.curHealth -= hpCost;
      user.curHealth = Math.max(0, user.curHealth);
      user.updatedAt = new Date();
      user.actionPoints = apAfter;
      if (action.battleDescription === "") {
        action.battleDescription = `%user uses ${action.name}`;
      }
      action.battleDescription = `${action.name}: ${action.battleDescription} ${targetTile?.name ? `on <b>${targetTile.name}</b>` : ""}`;
      action.battleDescription = action.battleDescription.replaceAll(
        "%user_subject",
        user.gender === "Male" ? "he" : "she",
      );
      action.battleDescription = action.battleDescription.replaceAll(
        "%user_object",
        user.gender === "Male" ? "him" : "her",
      );
      action.battleDescription = action.battleDescription.replaceAll(
        "%user_posessive",
        user.gender === "Male" ? "his" : "hers",
      );
      action.battleDescription = action.battleDescription.replaceAll(
        "%user_reflexive",
        user.gender === "Male" ? "himself" : "herself",
      );
      action.battleDescription = action.battleDescription.replaceAll(
        "%user",
        user.username,
      );
      // Update generic descriptions
      action.battleDescription = action.battleDescription.replaceAll(
        "%location",
        `[${targetTile.row}, ${targetTile.col}]`,
      );
      // Update target descriptions
      if (targetGenders.length > 0) {
        action.battleDescription = action.battleDescription.replaceAll(
          "%target_subject",
          targetGenders.length === 1 && targetGenders[0]
            ? targetGenders[0] === "Male"
              ? "himself"
              : "herself"
            : "they",
        );
        action.battleDescription = action.battleDescription.replaceAll(
          "%target_object",
          targetGenders.length === 1 && targetGenders[0]
            ? targetGenders[0] === "Male"
              ? "him"
              : "her"
            : "them",
        );
        action.battleDescription = action.battleDescription.replaceAll(
          "%target_posessive",
          targetGenders.length === 1 && targetGenders[0]
            ? targetGenders[0] === "Male"
              ? "his"
              : "hers"
            : "theirs",
        );
        action.battleDescription = action.battleDescription.replaceAll(
          "%target_reflexive",
          targetGenders.length === 1 && targetGenders[0]
            ? targetGenders[0] === "Male"
              ? "himself"
              : "herself"
            : "themselves",
        );
      }
      if (targetUsernames.length > 0) {
        action.battleDescription = action.battleDescription.replaceAll(
          "%target",
          targetUsernames.join(", "),
        );
      }
      // Successful action
      return true;
    }
  }
  return false;
};

export const getTargetUser = (
  users: BattleUserState[],
  target: (typeof AttackTargets)[number],
  tile: TerrainHex,
  userId: string,
) => {
  let result: BattleUserState | undefined;
  const user = users.find((u) => u.userId === userId);
  if (user) {
    if (target === "SELF") {
      result = users.find((u) => u.userId === user.userId && u.hex === tile);
    } else if (target === "OPPONENT") {
      result = users.find((u) => u.direction !== user.direction && u.hex === tile);
    } else if (target === "ALLY") {
      result = users.find((u) => u.villageId === user.villageId && u.hex === tile);
    } else if (target === "OTHER_USER") {
      result = users.find((u) => u.userId !== user.userId && u.hex === tile);
    } else if (target === "CHARACTER") {
      result = users.find((u) => u.hex === tile);
    }
  }
  return result;
};

export const performBattleAction = (props: {
  battle: CompleteBattle;
  action: CombatAction;
  grid: Grid<TerrainHex>;
  contextUserId: string;
  actorId: string;
  longitude: number;
  latitude: number;
}) => {
  // Destructure
  const { battle, grid, action, actorId, longitude, latitude } = props;
  // Ensure that the userId we're trying to move is valid
  const user = battle.usersState.find((u) => u.userId === actorId);
  if (!user) throw new Error("This is not your user");

  // Perform action, get latest status effects
  // Note: this mutates usersEffects, groundEffects in place
  const check = insertAction({ battle, grid, action, actorId, longitude, latitude });
  if (!check) {
    throw new Error(`Action ${action.name} no longer possible for ${user.username}`);
  }

  // Track weapon durability usage (skip for battles that don't lose durability)
  if (
    action.type === "item" &&
    !NO_DURABILITY_LOSS_COMBATS.includes(battle.battleType)
  ) {
    const used = user.items.find((i) => i.itemId === action.id);
    const usedItem = used ? getItem(battle, used.itemId) : undefined;
    if (used && usedItem?.itemType === "WEAPON") {
      const currentDurability = Math.min(used.durability, usedItem.maxDurability);
      used.durability = Math.max(0, currentDurability - 3);
      if (used.durability <= DURABILITY_USABILITY_THR) {
        used.equipped = "NONE" as const;
      }
    }
  }

  // Helper to find the performed action entry (lookup by jutsuId/itemId/id based on type)
  const findPerformedAction = () => {
    switch (action.type) {
      case "jutsu":
        return user.jutsus.find((j) => j.jutsuId === action.id);
      case "item":
        return user.items.find((i) => i.itemId === action.id);
      case "basic":
        return user.basicActions.find((ba) => ba.id === action.id);
    }
  };

  // Always update the last used round for the performed action
  const actionPerformed = findPerformedAction();
  if (actionPerformed) {
    actionPerformed.lastUsedRound = battle.round;
    // Restore originalCooldown to base cooldown when action is used (in case it was modified by GCD)
    if ("jutsuId" in actionPerformed) {
      // It's a BattleUserJutsu
      const jutsu = getJutsu(battle, actionPerformed.jutsuId);
      if (jutsu) {
        actionPerformed.originalCooldown = jutsu.cooldown;
      }
    } else if ("itemId" in actionPerformed) {
      // It's a BattleUserItem
      const item = getItem(battle, actionPerformed.itemId);
      if (item) {
        actionPerformed.originalCooldown = item.cooldown;
      }
    }
  }

  // If this action has a cooldown AND shared cooldown effects, apply GCD to related actions
  if (action.cooldown && action.cooldown > 0 && actionHasSharedCooldown(action)) {
    // Get all shared cooldown tags from the current action
    const actionSharedTags = action.effects
      .filter((effect) => tagHasSharedCooldown(effect))
      .map((effect) => effect.type);

    // Collect all actions with matching shared cooldown tags into a unified array
    // Each entry includes the state object to mutate + lookup data for cooldown calc
    const sharedActions = [
      // Jutsus
      ...user.jutsus
        .filter((uj) => {
          const jutsu = getJutsu(battle, uj.jutsuId);
          if (!jutsu) return false;
          return jutsu.effects
            .filter((e) => tagHasSharedCooldown(e))
            .some((e) => actionSharedTags.includes(e.type));
        })
        .map((uj) => ({
          type: "jutsu" as const,
          actionId: uj.jutsuId,
          state: uj,
          cooldown: getJutsu(battle, uj.jutsuId)?.cooldown ?? 0,
        })),
      // Items
      ...user.items
        .filter((ui) => {
          const item = getItem(battle, ui.itemId);
          if (!item) return false;
          return item.effects
            .filter((e) => tagHasSharedCooldown(e))
            .some((e) => actionSharedTags.includes(e.type));
        })
        .map((ui) => ({
          type: "item" as const,
          actionId: ui.itemId,
          state: ui,
          cooldown: getItem(battle, ui.itemId)?.cooldown ?? 0,
        })),
      // Basic actions - regenerate full actions from slim tracking data
      ...(() => {
        const fullBasicActions = getDefaultBasicActions(user);
        return Object.values(fullBasicActions)
          .filter((ba) =>
            ba.effects
              .filter((e) => tagHasSharedCooldown(e))
              .some((e) => actionSharedTags.includes(e.type)),
          )
          .map((ba) => {
            // Find the tracking data in user.basicActions
            const tracking = user.basicActions.find((t) => t.id === ba.id);
            return {
              type: "basic" as const,
              actionId: ba.id,
              state: tracking ?? { id: ba.id, lastUsedRound: ba.lastUsedRound ?? 0 },
              cooldown: ba.cooldown ?? 0,
            };
          });
      })(),
    ];

    // Apply GCD to all shared actions (excluding the one just used)
    sharedActions
      .filter((a) => a.actionId !== action.id)
      .forEach((a) => {
        const lastUsedRound = a.state.lastUsedRound || 0;
        const roundsSinceLastUsed = battle.round - lastUsedRound;
        const isOnCooldown = roundsSinceLastUsed < a.cooldown;
        const turnsRemaining = a.cooldown - roundsSinceLastUsed;
        if (!isOnCooldown || (isOnCooldown && turnsRemaining < 3)) {
          a.state.lastUsedRound = battle.round;
          // For basic actions, update cooldown directly; for jutsus/items, use originalCooldown
          if (a.type === "basic") {
            a.state.cooldown = 3;
          } else {
            a.state.originalCooldown = 3;
          }
        }
      });
  }

  // Apply relevant effects, and get back new state + active effects
  const { newBattle, actionEffects } = applyEffects(battle, actorId, action);

  return { newBattle, actionEffects };
};

/**
 * Calculate how many action points the user has left after performing an action
 */
export const actionPointsAfterAction = (
  user?: { userId: string; updatedAt: string | Date; actionPoints: number },
  battle?: ReturnedBattle | null,
  action?: CombatAction,
) => {
  if (!user || !battle)
    return { apAfter: 0, apAvailableAfter: 0, canAct: false, availableActionPoints: 0 };
  const stunReduction = calcApReduction(battle, user.userId);

  // Helper: count applicable temporal effects and get AP delta (10 per effect)
  const getTemporalApDelta = (type: "timecompression" | "timedilation") => {
    if (action?.id === "wait") return 0;
    // Time dilation and time compression should not affect basic actions or items
    if (action?.type === "basic" || action?.type === "item") return 0;
    const effects = battle.usersEffects.filter((e): e is UserEffect => {
      return (
        e.type === type &&
        e.targetId === user.userId &&
        !e.castThisRound &&
        isEffectActive(e)
      );
    });
    const appliesByElements = (effect: UserEffect) => {
      // No elements specified on the effect → applies to all actions
      if (!("elements" in effect) || !effect.elements || effect.elements.length === 0) {
        return true;
      }
      // For jutsu: apply only if there is an overlap with the action's elements
      if (action?.type === "jutsu" && action.data && "effects" in action.data) {
        const actionElements = new Set(
          action.data.effects.flatMap((eff) =>
            "elements" in eff && eff.elements ? eff.elements : [],
          ),
        );
        return actionElements.size === 0
          ? false
          : effect.elements.some((el: ElementName) => actionElements.has(el));
      }
      return true;
    };
    const applicable = effects.filter(appliesByElements);
    return applicable.length * 10;
  };

  const timeCompressionApIncrease = getTemporalApDelta("timecompression");
  const timeDilationApDecrease = getTemporalApDelta("timedilation");

  const availableActionPoints = Math.max(0, user.actionPoints - stunReduction);

  // If no action is provided, just return current available AP
  if (!action) {
    return {
      apAfter: user.actionPoints,
      apAvailableAfter: availableActionPoints,
      canAct: availableActionPoints > 0,
      availableActionPoints,
    };
  }

  const actionCost = Math.max(
    0,
    (action.actionCostPerc || 0) + timeCompressionApIncrease - timeDilationApDecrease,
  );
  const apAfter = Math.max(0, user.actionPoints - actionCost); // stored AP after spending
  const apAvailableAfter = availableActionPoints - actionCost; // gating with stun etc.
  return {
    apAfter,
    apAvailableAfter,
    canAct: apAvailableAfter >= 0,
    availableActionPoints,
  };
};

/**
 * Figure out if user is still live and well in battle (not fled, not dead, etc.)
 * When effects are provided, uses effective health (accounting for pool buffs/debuffs).
 * Accepts minimal shape when effects is omitted (e.g. ProcessingBattleUser in combat router).
 */
export const stillInBattle = (
  user: ReturnedUserState | Pick<ReturnedUserState, "curHealth" | "fledBattle">,
  effects?: UserEffect[],
) => {
  const health = effects
    ? getEffectiveCurPool(user as ReturnedUserState, effects, "Health")
    : user.curHealth;
  return health > 0 && !user.fledBattle;
};

/**
 * Calculate (based on current time), which user is currently the one to perform a move
 */
export const calcActiveUser = (
  battle: ReturnedBattle,
  userId?: string | null,
  timeDiff = 0,
  options?: { precomputedUserId?: string | null; precomputedActions?: CombatAction[] },
) => {
  const syncedTime = Date.now() - timeDiff;
  const mseconds = syncedTime - new Date(battle.roundStartAt).getTime();
  const secondsLeft = COMBAT_SECONDS - mseconds / 1000;
  const usersInBattle = battle.usersState.filter((u) =>
    stillInBattle(u, battle.usersEffects),
  );
  const inBattleuserIds = usersInBattle.map((u) => u.userId);
  let activeUserId = battle.activeUserId ? battle.activeUserId : userId;
  let progressRound = false;
  // Check 1: We have an active user, but the round is up
  const check1 = battle.activeUserId && secondsLeft <= 0;
  // Check 2: We have an active user, but he/she does not have any more action points
  const check2 =
    activeUserId &&
    hasNoAvailableActions(
      battle,
      activeUserId,
      options?.precomputedUserId === activeUserId
        ? options?.precomputedActions
        : undefined,
    );
  // Check 3: Current active userID is not in active user array
  const check3 = activeUserId && !inBattleuserIds.includes(activeUserId);
  // Progress to next user in case of any checks went through
  if (inBattleuserIds.length > 1 && (check1 || check2 || check3)) {
    const curIdx = inBattleuserIds.indexOf(activeUserId ?? "");
    const newIdx = (curIdx + 1) % inBattleuserIds.length;
    const curUser = usersInBattle.find((u) => u.userId === activeUserId);
    if (curUser) curUser.round = battle.round;
    if (usersInBattle.every((u) => u.round >= battle.round)) progressRound = true;
    activeUserId = inBattleuserIds[newIdx] || userId;
  } else if (inBattleuserIds.length === 1) {
    activeUserId = inBattleuserIds[0];
  }

  // Find the user in question, and return him
  const actor = battle.usersState.find((u) => u.userId === activeUserId);
  if (!actor) {
    throw new Error(`
      No active user: ${activeUserId}. 
      Initial userId: ${userId}. 
      Check 1/2/3: ${check1}/${check2}/${check3}.
      BattleRound: ${battle.round}.
      BattleType: ${battle.battleType}.
      activeUserId: ${battle.activeUserId}.
      usersInBattle: ${usersInBattle.length}.
    `);
  }
  // Check if we have a new active user
  const changedActor = actor.userId !== battle.activeUserId;
  // Return info
  return { actor, changedActor, progressRound, mseconds, secondsLeft };
};

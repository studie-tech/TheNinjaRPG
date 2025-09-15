import {
  MoveTag,
  DamageTag,
  FleeTag,
  HealTag,
  InjectJutsusTag,
} from "@/libs/combat/types";
import { ClearTag, CleanseTag } from "@/libs/combat/types";
import { nanoid } from "nanoid";
import { getAffectedTiles } from "@/libs/combat/movement";
import { COMBAT_SECONDS } from "@/libs/combat/constants";
import { checkFriendlyFire } from "@/libs/combat/process";
import { applyEffects } from "@/libs/combat/process";
import { calcPoolCost } from "@/libs/combat/util";
import { hasNoAvailableActions } from "@/libs/combat/util";
import { calcApReduction } from "@/libs/combat/util";
import { getBarriersBetween } from "@/libs/combat/util";
import {
  IncreaseRangeTag,
  IncreaseCooldownTag,
  DecreaseCooldownTag,
} from "@/libs/combat/types";
import {
  isUserStealthed,
  isUserImmobilized,
  isUserSummonPrevented,
} from "@/libs/combat/util";
import { getUserElementalSeal, isEffectActive } from "@/libs/combat/util";
import { getPower } from "@/libs/combat/tags";
import { realizeTag, updateStatUsage } from "@/libs/combat/tags";
import { getPossibleActionTiles } from "@/libs/hexgrid";
import { PathCalculator } from "@/libs/hexgrid";
import { calcCombatHealPercentage } from "@/libs/hospital/hospital";
import { actionHasSharedCooldown } from "@/libs/combat/util";
import { tagHasSharedCooldown } from "@/libs/combat/util";
import {
  IMG_BASIC_HEAL,
  IMG_BASIC_ATTACK,
  IMG_BASIC_CLEANSE,
  IMG_BASIC_CLEAR,
  IMG_BASIC_FLEE,
  IMG_BASIC_WAIT,
  IMG_BASIC_MOVE,
  ID_ANIMATION_HEAL,
  ID_ANIMATION_HIT,
  ID_SFX_HIT,
  ID_SFX_HEAL,
  ID_SFX_MOVE,
  DURABILITY_USABILITY_THR,
  NonActionItemTypes,
  ID_SFX_CLEANSE,
  ID_SFX_CLEAR,
} from "@/drizzle/constants";
import type { AttackTargets, ElementName } from "@/drizzle/constants";
import type { BattleUserState, ReturnedUserState } from "@/libs/combat/types";
import type { CompleteBattle, ReturnedBattle } from "@/libs/combat/types";
import type { Grid } from "honeycomb-grid";
import type { TerrainHex } from "@/libs/hexgrid";
import type { CombatAction, BasicActions } from "@/libs/combat/types";
import type { GroundEffect, UserEffect } from "@/libs/combat/types";
import type { UserJutsu, Jutsu, UserItem, Item } from "@/drizzle/schema";

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
  const isSummonPrevented = isUserSummonPrevented(userId, battle?.usersEffects);
  const isImmobilized = isUserImmobilized(userId, battle?.usersEffects);
  const elementalSeal = getUserElementalSeal(userId, battle?.usersEffects);
  const basicActions = getActiveBasicActions(battle, user);

  // Handle injected jutsus
  if (battle && user) {
    user.jutsus = handleInjectedJutsus(battle, user);
  }

  // Concatenate all actions
  let availableActions = [
    ...(basicMoves && !isStealth ? [basicActions.basicAttack] : []),
    ...(basicMoves ? [basicActions.basicHeal] : []),
    ...(!isImmobilized ? [basicActions.basicMove] : []),
    ...(basicMoves && !isStealth
      ? [basicActions.basicClear, basicActions.basicCleanse, basicActions.basicFlee]
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
    ...(user?.jutsus
      ? user.jutsus
          .filter((userjutsu) => {
            // Filter out jutsus with damage tag when stealthed
            if (isStealth) {
              const offensiveTags = new Set(["damage", "pierce", "drain"]);
              const hasOffensiveTag = userjutsu.jutsu.effects.some((e) =>
                offensiveTags.has(e.type),
              );
              if (hasOffensiveTag) return false;
            }
            // Filter out summon jutsu when summonPrevent is active
            if (isSummonPrevented) {
              const hasSummonTag = userjutsu.jutsu.effects.some(
                (e) => e.type === "summon",
              );
              if (hasSummonTag) return false;
            }
            // Filter out jutsus removed by elemental seal
            if (!elementalSeal?.elements?.length) return true;
            const jutsuElements = new Set(
              userjutsu.jutsu.effects.flatMap((effect) =>
                "elements" in effect ? effect.elements : [],
              ),
            );
            return (
              jutsuElements.size === 0 ||
              !elementalSeal.elements.some((e: ElementName) => jutsuElements.has(e))
            );
          })
          .map(userJutsuToAction)
      : []),
    ...(user?.items && !isStealth
      ? user.items
          .filter((ui) => {
            if (ui.quantity <= 0) return false;
            if (ui.item.preventBattleUsage) return false;
            if (NonActionItemTypes.includes(ui.item.itemType)) return false;
            if (ui.equipped === "NONE") return false;
            if (ui.item?.itemType === "WEAPON") {
              const current = Math.min(ui.durability, ui.item.maxDurability);
              return current > 20;
            }
            return true;
          })
          .map((ui) => userItemToAction(ui, user))
      : []),
  ];
  // If we only have move & end turn action, also add basic attack
  if (availableActions.length === 2 && !isStealth) {
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
          const entry = user?.jutsus?.find((j) => j.jutsu.id === a.id);
          if (entry) {
            entry.jutsu.cooldown = a.originalCooldown;
            entry.lastUsedRound = -a.originalCooldown;
          }
        } else if (a.type === "item") {
          const entry = user?.items?.find((i) => i.item.id === a.id);
          if (entry) {
            entry.item.cooldown = a.originalCooldown;
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
  const current = user?.basicActions;
  const base = getDefaultBasicActions(user);
  const active = {
    basicAttack: current?.find((ba) => ba.id == "basicAttack") || base.basicAttack,
    basicHeal: current?.find((ba) => ba.id == "basicHeal") || base.basicHeal,
    basicMove: current?.find((ba) => ba.id == "move") || base.basicMove,
    basicClear: current?.find((ba) => ba.id == "clear") || base.basicClear,
    basicCleanse: current?.find((ba) => ba.id == "cleanse") || base.basicCleanse,
    basicFlee: current?.find((ba) => ba.id == "flee") || base.basicFlee,
  };
  // Always set battleDescriptions & range back to base values
  active.basicAttack.battleDescription = base.basicAttack.battleDescription;
  active.basicHeal.battleDescription = base.basicHeal.battleDescription;
  active.basicMove.battleDescription = base.basicMove.battleDescription;
  active.basicClear.battleDescription = base.basicClear.battleDescription;
  active.basicCleanse.battleDescription = base.basicCleanse.battleDescription;
  active.basicFlee.battleDescription = base.basicFlee.battleDescription;
  active.basicMove.range = base.basicMove.range;
  active.basicClear.range = base.basicClear.range;
  active.basicCleanse.range = base.basicCleanse.range;
  active.basicAttack.range = base.basicAttack.range;
  active.basicHeal.range = base.basicHeal.range;
  active.basicMove.cooldown = base.basicMove.cooldown;
  active.basicClear.cooldown = base.basicClear.cooldown;
  active.basicCleanse.cooldown = base.basicCleanse.cooldown;
  active.basicAttack.cooldown = base.basicAttack.cooldown;
  active.basicHeal.cooldown = base.basicHeal.cooldown;

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
  user: ReturnedUserState | undefined,
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
        user?.basicActions?.find((ba) => ba.id == "basicAttack")?.lastUsedRound ?? 0,
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
        user?.basicActions?.find((ba) => ba.id == "basicHeal")?.lastUsedRound ?? -10,
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
        user?.basicActions?.find((ba) => ba.id == "move")?.lastUsedRound ?? 0,
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
        user?.basicActions?.find((ba) => ba.id == "cleanse")?.lastUsedRound ?? -10,
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
        user?.basicActions?.find((ba) => ba.id == "clear")?.lastUsedRound ?? -10,
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
        user?.basicActions?.find((ba) => ba.id == "flee")?.lastUsedRound ?? 0,
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
 * @returns The combat action
 */
export const userItemToAction = (
  useritem: UserItem & { item: Item; lastUsedRound: number; originalCooldown: number },
  user: ReturnedUserState,
): CombatAction => {
  return {
    id: useritem.item.id,
    name: useritem.item.name,
    image: useritem.item.image,
    battleDescription: useritem.item.battleDescription,
    type: "item" as const,
    target: useritem.item.target,
    method: useritem.item.method,
    range: useritem.item.range,
    updatedAt: new Date(useritem.updatedAt).getTime(),
    cooldown: useritem.item.cooldown,
    originalCooldown: useritem.originalCooldown,
    lastUsedRound: useritem.lastUsedRound,
    level: user.level,
    healthCost: Math.max(
      0,
      useritem.item.healthCost - useritem.item.healthCostReducePerLvl * user.level,
    ),
    chakraCost: Math.max(
      0,
      useritem.item.chakraCost - useritem.item.chakraCostReducePerLvl * user.level,
    ),
    staminaCost: Math.max(
      0,
      useritem.item.staminaCost - useritem.item.staminaCostReducePerLvl * user.level,
    ),
    actionCostPerc: useritem.item.actionCostPerc,
    effects: useritem.item.effects,
    quantity: useritem.quantity,
    data: useritem.item,
    durability: useritem.durability,
    maxDurability: useritem.item.maxDurability,
  };
};

/**
 * Convert a user jutsu to a combat action
 * @param userjutsu - The user jutsu to convert
 * @returns The combat action
 */
export const userJutsuToAction = (
  userjutsu: UserJutsu & {
    jutsu: Jutsu;
    lastUsedRound: number;
    originalCooldown: number;
  },
): CombatAction => {
  return {
    id: userjutsu.jutsu.id,
    name: userjutsu.jutsu.name,
    image: userjutsu.jutsu.image,
    battleDescription: userjutsu.jutsu.battleDescription,
    type: "jutsu" as const,
    target: userjutsu.jutsu.target,
    method: userjutsu.jutsu.method,
    range: userjutsu.jutsu.range,
    updatedAt: new Date(userjutsu.updatedAt).getTime(),
    cooldown: userjutsu.jutsu.cooldown,
    originalCooldown: userjutsu.originalCooldown,
    lastUsedRound: userjutsu.lastUsedRound,
    healthCost: Math.max(
      0,
      userjutsu.jutsu.healthCost -
        userjutsu.jutsu.healthCostReducePerLvl * userjutsu.level,
    ),
    chakraCost: Math.max(
      0,
      userjutsu.jutsu.chakraCost -
        userjutsu.jutsu.chakraCostReducePerLvl * userjutsu.level,
    ),
    staminaCost: Math.max(
      0,
      userjutsu.jutsu.staminaCost -
        userjutsu.jutsu.staminaCostReducePerLvl * userjutsu.level,
    ),
    actionCostPerc: userjutsu.jutsu.actionCostPerc,
    effects: userjutsu.jutsu.effects,
    level: userjutsu.level,
    data: userjutsu.jutsu,
  };
};

/**
 * Handle injected jutsus
 * @param battle - The battle to handle the injected jutsus for
 * @param user - The user to handle the injected jutsus for
 * @returns The active jutsus for the user
 */
export const handleInjectedJutsus = (
  battle: ReturnedBattle,
  user: ReturnedUserState,
) => {
  const injectEffects = battle?.usersEffects
    ?.filter((e) => e.targetId === user.userId && isEffectActive(e))
    ?.filter((e) => e.type === "injectjutsus");

  // Inject jutsus (and remove expired ones) before processing actions
  const extraJutsus = battle?.extraState.jutsus ?? [];
  const userCurrentExtraJutsuIds =
    user?.jutsus?.filter((j) => j.origin === "injected").map((j) => j.jutsu.id) ?? [];
  let toBeRemovedIds: string[] = [];
  let toBeAddedIds: string[] = [];
  const toBeAddedJutsuPower: Record<string, number> = {};
  injectEffects?.forEach((e) => {
    const jutsuIds = InjectJutsusTag.parse(e).jutsuIds;
    const tagJutsus = extraJutsus?.filter((j) => jutsuIds.includes(j.id)) ?? [];
    const tagJutsuIds = tagJutsus.map((j) => j.id);
    toBeRemovedIds.push(
      ...(userCurrentExtraJutsuIds.filter((id) => !tagJutsuIds.includes(id)) ?? []),
    );
    tagJutsus.forEach((j) => {
      if (!toBeRemovedIds.includes(j.id) && !userCurrentExtraJutsuIds.includes(j.id)) {
        toBeAddedJutsuPower[j.id] = e.power;
      }
    });
  });
  toBeRemovedIds = [...new Set(toBeRemovedIds)];
  toBeAddedIds = [...new Set(Object.keys(toBeAddedJutsuPower))];

  // Define the user available jutsus
  const activeJutsus = [
    ...(user?.jutsus?.filter((j) => !toBeRemovedIds.includes(j.jutsu.id)) ?? []),
    ...(extraJutsus
      ?.filter((j) => toBeAddedIds.includes(j.id))
      .map((jutsu) => ({
        id: nanoid(),
        userId: user.userId,
        jutsuId: jutsu.id,
        createdAt: new Date(),
        updatedAt: new Date(),
        finishTraining: null,
        level: toBeAddedJutsuPower[jutsu.id] ?? 1,
        experience: 0,
        equipped: 1,
        origin: "injected" as const,
        lastUsedRound: -jutsu.cooldown,
        originalCooldown: jutsu.cooldown,
        jutsu,
        reskinId: null,
        activeReskin: null,
      })) ?? []),
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
  usersState.map((u) => (u.hex = grid.getHex({ col: u.longitude, row: u.latitude })));
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
        const useritem = user.items.find((i) => i.item.id === action.id);
        if (
          useritem &&
          useritem.item.destroyOnUse &&
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
            ? targetGenders[0] == "Male"
              ? "himself"
              : "herself"
            : "they",
        );
        action.battleDescription = action.battleDescription.replaceAll(
          "%target_object",
          targetGenders.length === 1 && targetGenders[0]
            ? targetGenders[0] == "Male"
              ? "him"
              : "her"
            : "them",
        );
        action.battleDescription = action.battleDescription.replaceAll(
          "%target_posessive",
          targetGenders.length === 1 && targetGenders[0]
            ? targetGenders[0] == "Male"
              ? "his"
              : "hers"
            : "theirs",
        );
        action.battleDescription = action.battleDescription.replaceAll(
          "%target_reflexive",
          targetGenders.length === 1 && targetGenders[0]
            ? targetGenders[0] == "Male"
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
  let result: BattleUserState | undefined = undefined;
  const user = users.find((u) => u.userId === userId);
  if (user) {
    if (target === "SELF") {
      result = users.find((u) => u.userId === user.userId && u.hex === tile);
    } else if (target === "OPPONENT") {
      result = users.find((u) => u.villageId !== user.villageId && u.hex === tile);
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

  // Track weapon durability usage
  if (action.type === "item") {
    const used = user.items.find((i) => i.item.id === action.id);
    if (used && used.item.itemType === "WEAPON") {
      const currentDurability = Math.min(used.durability, used.item.maxDurability);
      used.durability = Math.max(0, currentDurability - 3);
      if (used.durability <= DURABILITY_USABILITY_THR) {
        used.equipped = "NONE" as const;
      }
    }
  }

  // Update the action state, so as keep state for technique cooldowns
  if (action.cooldown && action.cooldown > 0) {
    // Update the last used round for the action
    let actionPerformed;
    switch (action.type) {
      case "jutsu":
        actionPerformed = user.jutsus.find((j) => j.jutsu.id === action.id);
        break;
      case "item":
        actionPerformed = user.items.find((i) => i.item.id === action.id);
        break;
      case "basic":
        actionPerformed = user.basicActions.find((ba) => ba.id === action.id);
        break;
    }
    if (actionPerformed) actionPerformed.lastUsedRound = battle.round;

    // If this action has shared cooldown, update the rounds for all related actions
    if (actionHasSharedCooldown(action)) {
      // Get all shared cooldown tags from the current action
      const actionSharedTags = action.effects
        .filter((effect) => tagHasSharedCooldown(effect))
        .map((effect) => effect.type);

      const sharedActions = [
        ...user.jutsus.filter((jutsu) =>
          jutsu.jutsu.effects
            .filter((effect) => tagHasSharedCooldown(effect))
            .some((effect) => actionSharedTags.includes(effect.type)),
        ),
        ...user.items.filter((item) =>
          item.item.effects
            .filter((effect) => tagHasSharedCooldown(effect))
            .some((effect) => actionSharedTags.includes(effect.type)),
        ),
        ...user.basicActions.filter((basic) =>
          basic.effects
            .filter((effect) => tagHasSharedCooldown(effect))
            .some((effect) => actionSharedTags.includes(effect.type)),
        ),
      ];
      sharedActions
        .filter((a) => a.id !== action.id)
        .forEach((a) => {
          let cooldown = 0;
          let lastUsedRound = 0;
          if ("jutsu" in a && a.jutsu) {
            cooldown = a.jutsu.cooldown;
            lastUsedRound = a.lastUsedRound || 0;
          } else if ("item" in a && a.item) {
            cooldown = a.item.cooldown;
            lastUsedRound = a.lastUsedRound || 0;
          } else if ("cooldown" in a) {
            cooldown = a.cooldown;
            lastUsedRound = a.lastUsedRound || 0;
          }

          // Check if this action is currently on cooldown
          const roundsSinceLastUsed = battle.round - lastUsedRound;
          const isOnCooldown = roundsSinceLastUsed < cooldown;
          const turnsRemaining = cooldown - roundsSinceLastUsed;

          // Apply GCD to actions that are not on cooldown, or extend cooldown if less than 3 turns remain
          if (!isOnCooldown || (isOnCooldown && turnsRemaining < 3)) {
            // Apply GCD - set to current round and override cooldown to 3
            a.lastUsedRound = battle.round;

            // Set cooldown of shared tag to 3
            if ("jutsu" in a && a.jutsu) {
              a.jutsu.cooldown = 3;
            } else if ("item" in a && a.item) {
              a.item.cooldown = 3;
            } else if ("cooldown" in a) {
              a.cooldown = 3;
            }
          }
        });
    }
  } else {
    // For actions with no cooldown, just update the last used round without triggering shared cooldowns
    let actionPerformed;
    switch (action.type) {
      case "jutsu":
        actionPerformed = user.jutsus.find((j) => j.jutsu.id === action.id);
        break;
      case "item":
        actionPerformed = user.items.find((i) => i.item.id === action.id);
        break;
      case "basic":
        actionPerformed = user.basicActions.find((ba) => ba.id === action.id);
        break;
    }
    if (actionPerformed) actionPerformed.lastUsedRound = battle.round;
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
          : effect.elements.some((el) => actionElements.has(el));
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
 */
export const stillInBattle = (user: ReturnedUserState) => {
  return user.curHealth > 0 && !user.fledBattle;
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
  const usersInBattle = battle.usersState.filter(stillInBattle);
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

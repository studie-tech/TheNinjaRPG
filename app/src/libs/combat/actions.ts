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
  IMG_BASIC_DEFENSIVE_STANCE,
  IMG_BASIC_FLEE,
  IMG_BASIC_HEAL,
  IMG_BASIC_MEDITATE,
  IMG_BASIC_MOVE,
  IMG_BASIC_OFFENSIVE_STANCE,
  IMG_BASIC_REPLACEMENT_TECHNIQUE,
  IMG_BASIC_WAIT,
  NO_DURABILITY_LOSS_COMBATS,
  NonActionItemTypes,
  QuestBattleTypes,
  SAGE_MODE_ACTIVATION_JUTSU_ID,
  SAGE_MODE_DISABLED_BATTLES,
  SHARED_COOLDOWN_ROUNDS,
} from "@/drizzle/constants";
import type { Jutsu } from "@/drizzle/schema";
import { BARRIER_DAMAGE_TAG_TYPES, COMBAT_SECONDS } from "@/libs/combat/constants";
import { recordMasteryUsage } from "@/libs/combat/mastery";
import { resolvePotencyTags } from "@/libs/combat/potency";
import { applyEffects, checkFriendlyFire } from "@/libs/combat/process";
import { getPower, realizeTag, updateStatUsage } from "@/libs/combat/tags";
import type {
  BasicActions,
  BattleEffect,
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
  calcApReduction,
  calcPoolCost,
  findBarrier,
  getAffectedTiles,
  getBarriersBetween,
  getEffectiveCurPool,
  getEffectStackKey,
  getItem,
  getJutsu,
  getJutsuReskin,
  getUserElementalSeal,
  hasNoAvailableActions,
  isEffectActive,
  isUserDisarmed,
  isUserImmobilized,
  isUserStealthed,
  isUserSummonPrevented,
  tagHasSharedCooldown,
} from "@/libs/combat/util";
import type { TerrainHex } from "@/libs/hexgrid";
import { getPossibleActionTiles, PathCalculator } from "@/libs/hexgrid";
import { calcCombatHealPercentage } from "@/libs/hospital";
import { jutsuMasteryTypes } from "@/libs/jutsuMastery";
import { hasMasteryRequirements } from "@/libs/mastery";
import { getSageDailyCap, getSageModeActivationCost } from "@/libs/sageMode";
import {
  CleanseTag,
  ClearTag,
  DamageTag,
  DecreaseCooldownTag,
  DecreaseDamageTakenTag,
  FleeTag,
  HealTag,
  IncreaseCooldownTag,
  IncreaseDamageGivenTag,
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
  const isDisarmed = isUserDisarmed(userId, battle?.usersEffects);
  const isImmobilized = isUserImmobilized(userId, battle?.usersEffects);
  const elementalSeal = getUserElementalSeal(userId, battle?.usersEffects);
  const basicActions = getActiveBasicActions(battle, user);
  const isQuestBattle = battle ? QuestBattleTypes.includes(battle.battleType) : false;
  const isRankedBattle =
    battle?.battleType === "RANKED_PVP" || battle?.battleType === "RANKED_SPARRING";
  // A player-piloted summon must not hand its controller a second Clear/Cleanse
  // on an independent cooldown. Gated here so the UI and the server-side action
  // lookup in the combat router both lose it.
  const isPilotedSummon = !!user?.isSummon && !!user?.isPiloted;

  // Handle injected jutsus
  if (battle && user) {
    user.jutsus = handleInjectedJutsus(battle, user);
  }

  // Concatenate all actions
  let availableActions = [
    ...(basicMoves && !isStealth ? [basicActions.basicAttack] : []),
    ...(basicMoves && !isStealth ? [basicActions.basicMeditate] : []),
    ...(!isImmobilized ? [basicActions.basicMove] : []),
    ...(basicMoves && !isStealth && !isStudent
      ? [
          basicActions.basicHeal,
          ...(!isPilotedSummon
            ? [basicActions.basicClear, basicActions.basicCleanse]
            : []),
          basicActions.basicOffensiveStance,
          basicActions.basicDefensiveStance,
        ]
      : []),
    ...(!isImmobilized && !isStudent ? [basicActions.basicReplacementTechnique] : []),
    ...(basicMoves && !isStealth && !isStudent ? [basicActions.basicFlee] : []),
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
            // Stealth prevents all jutsu, including defensive and support actions.
            if (isStealth) return false;
            // Filter out summon jutsu when summonPrevent is active
            if (isSummonPrevented) {
              const hasSummonTag = jutsu.effects.some(
                (e: { type: string }) => e.type === "summon",
              );
              if (hasSummonTag) return false;
            }
            // Filter out weapon-required jutsu when disarmed
            if (isDisarmed && jutsu.jutsuWeapon !== "NONE") {
              return false;
            }
            // Ranked and AI loadouts bypass mastery gates even when penalties or
            // level scaling lower their battle masteries below the requirements.
            if (!user.isAi && !isRankedBattle && !hasMasteryRequirements(user, jutsu)) {
              return false;
            }
            // Filter out movement jutsu when immobilized
            if (isImmobilized) {
              const hasMoveTag = jutsu.effects.some(
                (e: { type: string }) => e.type === "move",
              );
              if (hasMoveTag) return false;
            }
            // Elemental Seal affects exactly 60 AP elemental jutsu, regardless
            // of the element lists retained in older content/battle payloads.
            if (!elementalSeal || jutsu.actionCostPerc !== 60) return true;
            const isElemental =
              (jutsu.elementClassification != null &&
                jutsu.elementClassification !== "None") ||
              jutsu.effects.some(
                (effect) =>
                  "elements" in effect &&
                  effect.elements?.some((element) => element !== "None"),
              );
            return !isElemental;
          })
          .map((uj) => {
            const action = userJutsuToAction(uj, battle);
            if (uj.jutsuId === SAGE_MODE_ACTIVATION_JUTSU_ID && user.sageModeId) {
              const mode = battle.extraState.sageModes?.[user.sageModeId];
              action.image = mode?.image ?? action.image;
              // Nullish, not ||: a low per-mode cost is legitimate, and an undefined
              // actionCostPerc would make the action free rather than fall back.
              action.actionCostPerc = mode?.actionCostPerc ?? action.actionCostPerc;
              // Per-mode activation line; blank/null falls back to the injected default.
              action.battleDescription =
                mode?.battleDescription || action.battleDescription;
            }
            return action;
          })
      : []),
    ...(user?.items && battle
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
            if (!user.isAi && !isRankedBattle && !hasMasteryRequirements(user, item)) {
              return false;
            }
            if (item.itemType === "WEAPON") {
              // Hide weapons when disarmed
              if (isDisarmed) return false;
              const current = Math.min(ui.durability, item.maxDurability);
              return current > DURABILITY_USABILITY_THR;
            }
            return true;
          })
          .map((ui) => userItemToAction(ui, user, battle))
      : []),
  ];
  // Surface the sage-mode Activation inline with the basic actions. It stays a
  // jutsu-typed action (combat lookup/processing depends on that); only its list
  // position moves — out of the jutsu tail, to the end of the basic-action region.
  const sageActivationIdx = availableActions.findIndex(
    (a) => a.id === SAGE_MODE_ACTIVATION_JUTSU_ID,
  );
  if (sageActivationIdx > -1) {
    const [sageActivation] = availableActions.splice(sageActivationIdx, 1);
    if (sageActivation) {
      // Insert right after the last basic action (i.e. before the first non-basic entry)
      // so it stays with the basics even when the user has no other jutsu/item.
      const firstNonBasicIdx = availableActions.findIndex((a) => a.type !== "basic");
      availableActions.splice(
        firstNonBasicIdx === -1 ? availableActions.length : firstNonBasicIdx,
        0,
        sageActivation,
      );
    }
  }
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
    basicOffensiveStance: mergeTracking(base.basicOffensiveStance, "offensiveStance"),
    basicDefensiveStance: mergeTracking(base.basicDefensiveStance, "defensiveStance"),
    basicHeal: mergeTracking(base.basicHeal, "basicHeal"),
    basicMeditate: mergeTracking(base.basicMeditate, "meditate"),
    basicMove: mergeTracking(base.basicMove, "move"),
    basicReplacementTechnique: mergeTracking(
      base.basicReplacementTechnique,
      "replacementTechnique",
    ),
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
      // A basic-action GCD must remain a full shared lock even under cooldown reductions.
      const hasSharedCooldown = tracking?.some(
        (action) => action.id === aid && action.cooldown !== undefined,
      );
      ba.cooldown = Math.max(
        hasSharedCooldown ? SHARED_COOLDOWN_ROUNDS : 0,
        ba.cooldown + mod,
      );
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
  const healPower = calcCombatHealPercentage(user);
  const basicAttackCooldown = user?.rank === "STUDENT" ? 0 : 1;
  const jutsuStatTypes = ["Ninjutsu", "Genjutsu", "Taijutsu", "Bukijutsu"] as const;
  const lastUsed = (id: string, def = -10) =>
    user?.basicActions?.find((ba) => ba.id === id)?.lastUsedRound ?? def;

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
      actionCostPerc: 20,
      range: 1,
      updatedAt: Date.now(),
      cooldown: basicAttackCooldown,
      originalCooldown: basicAttackCooldown,
      lastUsedRound: lastUsed("basicAttack"),
      level: user?.level,
      effects: [
        DamageTag.parse({
          power: 10,
          powerPerLevel: 0.05,
          statTypes: ["None"],
          generalTypes: ["Highest"],
          rounds: 0,
          appearAnimation: ID_ANIMATION_HIT,
          appearSfx: ID_SFX_HIT,
        }),
      ],
    },
    basicOffensiveStance: {
      id: "offensiveStance",
      name: "Offensive Stance",
      image: IMG_BASIC_OFFENSIVE_STANCE,
      battleDescription:
        "%user takes an offensive stance, increasing their offence damage",
      type: "basic" as const,
      target: "SELF" as const,
      method: "SINGLE" as const,
      healthCost: 0,
      chakraCost: 0,
      staminaCost: 0,
      actionCostPerc: 20,
      range: 0,
      updatedAt: Date.now(),
      cooldown: 1,
      originalCooldown: 1,
      lastUsedRound: lastUsed("offensiveStance"),
      level: user?.level,
      effects: [
        IncreaseDamageGivenTag.parse({
          power: 15,
          powerPerLevel: 0,
          calculation: "percentage",
          statTypes: [...jutsuStatTypes],
          rounds: 1,
        }),
      ],
    },
    basicDefensiveStance: {
      id: "defensiveStance",
      name: "Defensive Stance",
      image: IMG_BASIC_DEFENSIVE_STANCE,
      battleDescription: "%user takes a defensive stance, reducing damage taken",
      type: "basic" as const,
      target: "SELF" as const,
      method: "SINGLE" as const,
      healthCost: 0,
      chakraCost: 0,
      staminaCost: 0,
      actionCostPerc: 20,
      range: 0,
      updatedAt: Date.now(),
      cooldown: 1,
      originalCooldown: 1,
      lastUsedRound: lastUsed("defensiveStance"),
      level: user?.level,
      effects: [
        DecreaseDamageTakenTag.parse({
          power: 15,
          powerPerLevel: 0,
          calculation: "percentage",
          statTypes: [...jutsuStatTypes],
          rounds: 1,
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
      lastUsedRound: lastUsed("basicHeal"),
      level: user?.level,
      effects: [
        HealTag.parse({
          power: healPower,
          powerPerLevel: 0.0,
          calculation: "static",
          rounds: 0,
          poolsAffected: ["Health"],
          appearAnimation: ID_ANIMATION_HEAL,
          appearSfx: ID_SFX_HEAL,
        }),
      ],
    },
    basicMeditate: {
      id: "meditate",
      name: "Meditate",
      image: IMG_BASIC_MEDITATE,
      battleDescription: "%user meditates to restore their chakra and stamina",
      type: "basic" as const,
      target: "SELF" as const,
      method: "SINGLE" as const,
      healthCost: 0,
      chakraCost: 0,
      staminaCost: 0,
      actionCostPerc: 20,
      range: 0,
      updatedAt: Date.now(),
      cooldown: 4,
      originalCooldown: 4,
      lastUsedRound: lastUsed("meditate"),
      level: user?.level,
      effects: [
        HealTag.parse({
          power: 30,
          powerPerLevel: 0.0,
          calculation: "static",
          rounds: 0,
          poolsAffected: ["Chakra", "Stamina"],
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
      lastUsedRound: lastUsed("move", 0),
      healthCost: 0,
      chakraCost: 0,
      staminaCost: 0,
      actionCostPerc: 10,
      effects: [MoveTag.parse({ power: 100, appearSfx: ID_SFX_MOVE })],
    },
    basicReplacementTechnique: {
      id: "replacementTechnique",
      name: "Replacement Technique",
      image: IMG_BASIC_REPLACEMENT_TECHNIQUE,
      battleDescription:
        "%user uses the replacement technique to reposition on the battlefield",
      type: "basic" as const,
      target: "EMPTY_GROUND" as const,
      method: "SINGLE" as const,
      range: 5,
      updatedAt: Date.now(),
      cooldown: 2,
      originalCooldown: 2,
      lastUsedRound: lastUsed("replacementTechnique"),
      healthCost: 0,
      chakraCost: 0,
      staminaCost: 0,
      actionCostPerc: 20,
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
      lastUsedRound: lastUsed("cleanse"),
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
      lastUsedRound: lastUsed("clear"),
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
      lastUsedRound: lastUsed("flee", 0),
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
  // AI users can never earn item XP, so their gear keeps character-level scaling
  // (bosses stay tuned to the pre-item-level formulas). For players the item's
  // ownership level applies; legacy in-progress battles may lack it, hence ?? 1.
  const level = user.isAi ? (user.level ?? 1) : (useritem.level ?? 1);
  return {
    id: item.id,
    name: useritem.variantName ?? item.name,
    image: useritem.variantImage ?? item.image,
    battleDescription: useritem.variantBattleDescription ?? item.battleDescription,
    type: "item" as const,
    target: item.target,
    method: item.method,
    range: item.range,
    updatedAt: Date.now(),
    cooldown: useritem.originalCooldown,
    originalCooldown: useritem.originalCooldown,
    lastUsedRound: useritem.lastUsedRound,
    level,
    healthCost: Math.max(0, item.healthCost - item.healthCostReducePerLvl * level),
    chakraCost: Math.max(0, item.chakraCost - item.chakraCostReducePerLvl * level),
    staminaCost: Math.max(0, item.staminaCost - item.staminaCostReducePerLvl * level),
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
 * Handle injected jutsus from all active inject effects, plus the sage Activation
 * jutsu when the user has an equipped mode, is under the daily cap, can afford
 * the mode's CP/SP cost, and the battle type allows sage mode.
 * - Union of jutsus from ALL active inject effects (multiple injects stack).
 * - Remove only jutsus that are no longer in any active effect (expiry).
 * - Preserve existing injected jutsu objects so lastUsedRound/cooldown is kept.
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

  const sageActivationId = SAGE_MODE_ACTIVATION_JUTSU_ID;
  if (
    user.sageModeId &&
    !SAGE_MODE_DISABLED_BATTLES.includes(battle.battleType) &&
    user.sageModeUsedThisBattle !== true &&
    (user.dailySageActivations ?? 0) < getSageDailyCap(user.sageMasteryExperience) &&
    allJutsus[sageActivationId]
  ) {
    // Only offer Activation when the user can pay its chakra/stamina cost. Those pool
    // costs live on the SageMode row and are charged by the processor, so the normal
    // action-cost pipeline can't gate them — without this check a low-pool user could
    // select Activation, lose their action points, and get no activation. The mode's
    // AP cost needs no check here; it rides on the action and the pipeline gates it.
    // If the mode data is unavailable we fall back to offering it (the processor
    // still refuses).
    const equippedSageMode = battle.extraState.sageModes?.[user.sageModeId];
    const canAffordActivation = equippedSageMode
      ? (() => {
          const { cpCost, spCost } = getSageModeActivationCost(
            equippedSageMode,
            user.maxChakra,
            user.maxStamina,
          );
          return user.curChakra >= cpCost && user.curStamina >= spCost;
        })()
      : true;
    if (canAffordActivation) {
      allInjectedJutsuIdsFromEffects.add(sageActivationId);
      if (!userCurrentExtraJutsuIds.includes(sageActivationId)) {
        toBeAddedJutsuPower[sageActivationId] = 1;
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
    const enemyRecipients = new Map<string, BattleUserState>();
    const appliedEffects = new Set<string>();
    const barrierAttacks = new Set<string>();
    // Path finder on grid
    const aStar = new PathCalculator(grid);
    // Skip per-tile A* pathfinding when no barriers exist on the field
    const hasBarriers = groundEffects.some((g) => g.type === "barrier");
    const EMPTY_BARRIER_RESULT = { barriers: [] as BattleEffect[], totalAbsorb: 0 };
    // Ground projections are discarded after processing, so snapshot the caster's
    // current tile before this cast inserts any new effects.
    const groundPotency: UserEffect[] = groundEffects
      .filter(
        (effect) =>
          (effect.type === "increasepotency" || effect.type === "decreasepotency") &&
          effect.longitude === user.longitude &&
          effect.latitude === user.latitude &&
          !effect.isNew &&
          isEffectActive(effect) &&
          checkFriendlyFire(effect, user, usersState) &&
          !usersEffects.some((userEffect) => userEffect.id === effect.id),
      )
      .map((effect) => ({ ...effect, targetId: actorId, fromGround: true }));
    const castTags = resolvePotencyTags(
      action,
      [...usersEffects, ...groundPotency],
      actorId,
    );
    // For each affected tile, apply the effects
    affectedTiles.forEach((tile) => {
      // Calculate how many barriers are between origin & target
      const { barriers, totalAbsorb } = hasBarriers
        ? getBarriersBetween(actorId, aStar, groundEffects, userHex, tile)
        : EMPTY_BARRIER_RESULT;

      // ADD EFFECTS
      if (action.target === "GROUND" || action.target === "EMPTY_GROUND") {
        // ADD GROUND EFFECTS
        const target = getTargetUser(alive, "CHARACTER", tile, user.userId);
        castTags.forEach((tag) => {
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
            effect.fromType = action.type;
            effect.targetId = user.userId;
            if (checkFriendlyFire(effect, user, alive)) {
              const idx = getEffectStackKey(effect);
              if (!appliedEffects.has(idx)) {
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
            effect.fromType = action.type;
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
              if (target.direction !== user.direction) {
                enemyRecipients.set(target.userId, target);
              }
            }
          }
        });
      } else {
        // ADD USER EFFECTS
        const target = getTargetUser(
          alive,
          action.target,
          tile,
          user.userId,
          battle.battleType === "QUEST" || battle.battleType === "OVERWORLD",
        );
        castTags.forEach((tag, tagIndex) => {
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
                  if (target.direction !== user.direction) {
                    enemyRecipients.set(target.userId, target);
                  }
                }
              }
            } else if (tag.target === "SELF") {
              effect.targetId = user.userId;
              const idx = getEffectStackKey(effect);
              if (!appliedEffects.has(idx) && checkFriendlyFire(effect, user, alive)) {
                usersEffects.push(effect);
                appliedEffects.add(idx);
              }
            }
            // Extra: apply damage to barriers
            if (BARRIER_DAMAGE_TAG_TYPES.has(tag.type)) {
              if (action.method === "SINGLE") {
                // SINGLE: damage barriers on the A* path (projectile-in-path)
                barriers.forEach((barrier) => {
                  const idx = `${barrier.id}-${tagIndex}`;
                  if (!barrierAttacks.has(idx)) {
                    barrierAttacks.add(idx);
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
              } else {
                // AOE: only damage barriers directly ON this affected tile
                const barrierOnTile = findBarrier(groundEffects, tile.col, tile.row);
                if (barrierOnTile && barrierOnTile.creatorId !== actorId) {
                  const idx = `${barrierOnTile.id}-${tagIndex}`;
                  if (!barrierAttacks.has(idx)) {
                    barrierAttacks.add(idx);
                    targetUsernames.push("barrier");
                    targetGenders.push("it");
                    const barrierEffect = structuredClone(effect);
                    barrierEffect.targetType = "barrier";
                    barrierEffect.targetId = barrierOnTile.id;
                    barrierEffect.id = nanoid();
                    if ("absorbPercentage" in barrierOnTile) {
                      barrierEffect.barrierAbsorb =
                        barrierOnTile.absorbPercentage / 100;
                    }
                    usersEffects.push(barrierEffect);
                  }
                }
              }
            }
          }
        });
      }
    });
    // Trigger each passive source once per enemy reached by the accepted action.
    // Empty tiles, self actions, stealth rejections and barrier hits supply no recipient.
    for (const target of enemyRecipients.values()) {
      for (const skillId of user.enemySkillIds ?? []) {
        for (const tag of battle.extraState.enemySkills?.[skillId] ?? []) {
          const effect = realizeTag({
            tag: structuredClone(tag) as UserEffect,
            user,
            target,
            actionId: skillId,
            level: user.level,
            round: battle.round,
          });
          effect.fromType = "skill";
          effect.targetId = target.userId;
          effect.longitude = target.longitude;
          effect.latitude = target.latitude;
          if (checkFriendlyFire(effect, target, alive)) {
            usersEffects.push(effect);
          }
        }
      }
    }
    // Get uniques only
    targetUsernames = [...new Set(targetUsernames)];
    targetGenders = [...new Set(targetGenders)];
    // Update local battle history in terms of usage of action, effects, etc.
    action.effects.forEach((effect) => {
      updateStatUsage(user, effect as UserEffect);
    });
    recordMasteryUsage(user, action);
    user.usedActions.push({
      id: action.id,
      type: action.type,
      ...(action.type === "jutsu" && action.data
        ? { masteryTypes: jutsuMasteryTypes(action.data) }
        : {}),
    });
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
  useBattleTeams = false,
) => {
  let result: BattleUserState | undefined;
  const user = users.find((u) => u.userId === userId);
  if (user) {
    if (target === "SELF") {
      result = users.find((u) => u.userId === user.userId && u.hex === tile);
    } else if (target === "OPPONENT") {
      result = users.find((u) => u.direction !== user.direction && u.hex === tile);
    } else if (target === "ALLY") {
      result = users.find(
        (u) =>
          (useBattleTeams
            ? u.direction === user.direction
            : u.villageId === user.villageId) && u.hex === tile,
      );
    } else if (target === "OTHER_USER") {
      result = users.find((u) => u.userId !== user.userId && u.hex === tile);
    } else if (target === "CHARACTER") {
      result = users.find((u) => u.hex === tile);
    }
  }
  return result;
};

/**
 * Thrown by performBattleAction when the action cannot be carried out from the
 * actor's position (no valid target in reach, not enough action points). The
 * battle state is left unchanged, so callers such as the AI can try another action.
 */
export class ActionNotPossibleError extends Error {}

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
    throw new ActionNotPossibleError(
      `Action ${action.name} no longer possible for ${user.username}`,
    );
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

  applyActionCooldowns(battle, user, action);

  // Apply relevant effects, and get back new state + active effects
  const { newBattle, actionEffects } = applyEffects(battle, actorId, action);

  return { newBattle, actionEffects };
};

/**
 * Record that `user` performed `action` this round and apply the global cooldown (GCD).
 *
 * The performed action restarts its own base cooldown, dropping any GCD override it
 * carried. Every other action sharing one of its shared-cooldown tags is then locked
 * for SHARED_COOLDOWN_ROUNDS, unless it is already locked for longer. "Longer" is
 * judged against the effective cooldown, including a previous GCD override and
 * active basic-action modifiers, as availableUserActions enforces.
 */
export const applyActionCooldowns = (
  battle: CompleteBattle,
  user: BattleUserState,
  action: CombatAction,
) => {
  const { round } = battle;
  const sharedTags = new Set<string>(
    action.effects.filter((effect) => tagHasSharedCooldown(effect)).map((e) => e.type),
  );
  const sharesCooldown = (effects: { type: string }[]) =>
    effects.some((e) => sharedTags.has(e.type));
  const applyGcd = !!action.cooldown && action.cooldown > 0 && sharedTags.size > 0;
  // Mirrors availableUserActions, which treats a falsy lastUsedRound as never used
  const lockedFor = (lastUsedRound: number, cooldown: number) =>
    lastUsedRound ? lastUsedRound + cooldown - round : 0;

  user.jutsus.forEach((uj) => {
    const jutsu = getJutsu(battle, uj.jutsuId);
    if (!jutsu) return;
    if (uj.jutsuId === action.id && action.type === "jutsu") {
      uj.lastUsedRound = round;
      uj.originalCooldown = jutsu.cooldown;
    } else if (applyGcd && sharesCooldown(jutsu.effects)) {
      if (lockedFor(uj.lastUsedRound, uj.originalCooldown) < SHARED_COOLDOWN_ROUNDS) {
        uj.lastUsedRound = round;
        uj.originalCooldown = SHARED_COOLDOWN_ROUNDS;
      }
    }
  });

  user.items.forEach((ui) => {
    const item = getItem(battle, ui.itemId);
    if (!item) return;
    if (ui.itemId === action.id && action.type === "item") {
      ui.lastUsedRound = round;
      ui.originalCooldown = item.cooldown;
    } else if (applyGcd && sharesCooldown(item.effects)) {
      if (lockedFor(ui.lastUsedRound, ui.originalCooldown) < SHARED_COOLDOWN_ROUNDS) {
        ui.lastUsedRound = round;
        ui.originalCooldown = SHARED_COOLDOWN_ROUNDS;
      }
    }
  });

  Object.values(getActiveBasicActions(battle, user)).forEach((ba) => {
    let tracking = user.basicActions.find((t) => t.id === ba.id);
    if (ba.id === action.id && action.type === "basic") {
      if (!tracking) return;
      tracking.lastUsedRound = round;
      delete tracking.cooldown;
    } else if (applyGcd && sharesCooldown(ba.effects)) {
      const lastUsedRound = tracking?.lastUsedRound ?? ba.lastUsedRound ?? 0;
      const cooldown = ba.cooldown;
      if (lockedFor(lastUsedRound, cooldown) < SHARED_COOLDOWN_ROUNDS) {
        if (!tracking) {
          tracking = { id: ba.id, lastUsedRound };
          user.basicActions.push(tracking);
        }
        tracking.lastUsedRound = round;
        tracking.cooldown = SHARED_COOLDOWN_ROUNDS;
      }
    }
  });
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

  const actionCost = getActionPointCost(user.userId, battle, action);
  const apAfter = Math.max(0, user.actionPoints - actionCost); // stored AP after spending
  const apAvailableAfter = availableActionPoints - actionCost; // gating with stun etc.
  return {
    apAfter,
    apAvailableAfter,
    canAct: apAvailableAfter >= 0,
    availableActionPoints,
  };
};

const elementsFromJutsuTags = (tags: CombatAction["effects"]): ElementName[] =>
  tags.flatMap((eff) =>
    "elements" in eff && eff.elements && eff.elements.length > 0 ? eff.elements : [],
  );

/** Union of classification and tag elements, including embedded jutsu data. */
const collectJutsuActionElements = (action: CombatAction): Set<ElementName> => {
  const acc = new Set(elementsFromJutsuTags(action.effects));
  const classification =
    action.data && "elementClassification" in action.data
      ? action.data.elementClassification
      : undefined;
  if (classification && classification !== "None") {
    acc.add(classification);
  }
  if (action.data && "effects" in action.data && Array.isArray(action.data.effects)) {
    for (const el of elementsFromJutsuTags(action.data.effects)) {
      acc.add(el);
    }
  }
  return acc;
};

const getTemporalApDelta = (
  battle: ReturnedBattle,
  userId: string,
  action: CombatAction,
  type: "timecompression" | "timedilation",
) => {
  if (action.id === "wait") return 0;
  // Time dilation and time compression should not affect basic actions or items
  if (action.type === "basic" || action.type === "item") return 0;
  const effects = battle.usersEffects.filter((e): e is UserEffect => {
    return (
      e.type === type && e.targetId === userId && !e.castThisRound && isEffectActive(e)
    );
  });
  const appliesByElements = (effect: UserEffect) => {
    // No elements specified on the effect -> applies to all actions
    if (!effect.elements || effect.elements.length === 0) {
      return true;
    }
    // Element-scoped temporal effects only apply to jutsu that declare matching elements
    if (action.type !== "jutsu") {
      return true;
    }
    const actionElements = collectJutsuActionElements(action);
    if (actionElements.size === 0) {
      return false;
    }
    return effect.elements.some((el: ElementName) => actionElements.has(el));
  };
  const applicable = effects.filter(appliesByElements);
  return applicable.length * 10;
};

export const getActionPointCost = (
  userId?: string | null,
  battle?: ReturnedBattle | null,
  action?: CombatAction,
) => {
  if (!userId || !battle || !action) {
    return Math.max(0, action?.actionCostPerc || 0);
  }

  const timeCompressionApIncrease = getTemporalApDelta(
    battle,
    userId,
    action,
    "timecompression",
  );
  const timeDilationApDecrease = getTemporalApDelta(
    battle,
    userId,
    action,
    "timedilation",
  );

  return Math.max(
    0,
    (action.actionCostPerc || 0) + timeCompressionApIncrease - timeDilationApDecrease,
  );
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

import { nanoid } from "nanoid";
import {
  BATTLE_TAG_STACKING,
  DURABILITY_USABILITY_THR,
  ID_ANIMATION_SMOKE,
  NO_DURABILITY_LOSS_COMBATS,
  POST_DAMAGE_MODIFIER_TYPES,
} from "@/drizzle/constants";
import type { ShieldTagType } from "@/validators/combat";
import { VisualTag } from "@/validators/combat";
import { dmgConfig as config, damageModifierTypes } from "./constants";
import {
  absorb,
  afterburn,
  buffPrevent,
  calcDmgModifier,
  cleanse,
  cleansePrevent,
  clear,
  clearPrevent,
  clone,
  copy,
  damageBarrier,
  damageUser,
  debuffPrevent,
  decreaseCooldown,
  decreaseDamageGiven,
  decreaseDamageTaken,
  decreaseHealGiven,
  decreaseMaxPools,
  decreasepoolcost,
  decreaseStats,
  drain,
  elementalseal,
  finalStand,
  flee,
  fleePrevent,
  heal,
  healPrevent,
  immunity,
  increaseCooldown,
  increaseDamageGiven,
  increaseDamageTaken,
  increaseHealGiven,
  increaseMaxPools,
  increasepoolcost,
  increaseRange,
  increaseStats,
  injectjutsus,
  lifesteal,
  mirror,
  move,
  movePrevent,
  onehitkill,
  onehitkillPrevent,
  poison,
  recoil,
  redirection,
  reflect,
  rob,
  robPrevent,
  seal,
  sealCheck,
  sealPrevent,
  shield,
  stealth,
  stun,
  stunPrevent,
  summon,
  summonPrevent,
  timeCompression,
  timeDilation,
  updateStatUsage,
  weakness,
  wound,
} from "./tags";
import type {
  ActionEffect,
  BattleEffect,
  BattleUserState,
  CombatAction,
  CompleteBattle,
  Consequence,
  GroundEffect,
  UserEffect,
} from "./types";
import {
  applyPoolAdjustmentsToBase,
  calcApplyRatio,
  calcEffectRoundInfo,
  collapseConsequences,
  findBarrier,
  findUser,
  getEffectStage,
  getItem,
  isEffectActive,
  sortEffects,
} from "./util";

/**
 * Minimal user type for checkFriendlyFire
 */
type FriendlyFireUser = {
  userId: string;
  isSummon?: boolean;
  controllerId: string;
  direction: "left" | "right";
};

/**
 * Check whether to apply given effect to a user, based on friendly fire settings.
 * Uses the 'direction' property to determine teams - users on the same side (left/right)
 * are allies, users on opposite sides are enemies. This works for all battle types
 * because direction is set based on userIds (attackers=left) vs targetIds (defenders=right).
 */
export const checkFriendlyFire = (
  effect: BattleEffect,
  target: FriendlyFireUser,
  usersState: FriendlyFireUser[],
) => {
  // Find the creator of the effect
  const creator = usersState.find((u) => u.userId === effect.creatorId);
  if (!creator) return false;

  // For summoned units, check if they belong to the creator (same team)
  if (target.isSummon) {
    const isFriendly = target.controllerId === creator.userId;
    return effect.friendlyFire === "FRIENDLY" ? isFriendly : !isFriendly;
  }

  // Determine if target is friendly based on direction (same side = allies)
  const isFriendly = creator.direction === target.direction;

  // Check if effect should be applied based on friendly fire settings
  if (!effect.friendlyFire || effect.friendlyFire === "ALL") {
    return true; // Allow all
  }
  if (effect.friendlyFire === "FRIENDLY") {
    return isFriendly; // Only apply to friends (same direction/team)
  }
  if (effect.friendlyFire === "ENEMIES") {
    return !isFriendly; // Only apply to enemies (different direction/team)
  }
  return false;
};

/**
 * Create a visual effect with a specified appearAnimation and optional SFX
 */
const getVisualOrSound = (
  longitude: number,
  latitude: number,
  animation?: string,
  sfx?: string,
  round = 0,
): GroundEffect => {
  return {
    ...VisualTag.parse({
      type: "visual",
      rounds: 0,
      description: "N/A",
      appearAnimation: animation,
      appearSfx: sfx ?? "",
      createdAt: Date.now(),
    }),
    actionId: "visual",
    id: nanoid(),
    createdRound: round,
    creatorId: nanoid(),
    level: 0,
    barrierAbsorb: 0,
    isNew: true,
    castThisRound: true,
    longitude,
    latitude,
  };
};

/**
 * Apply effects to users
 * @param battle - Battle to apply effects to
 * @param actorId - ID of the actor
 * @param action - Action to apply effects to
 */
export const applyEffects = (
  battle: CompleteBattle,
  actorId: string,
  action?: CombatAction,
) => {
  // Destructure
  const { usersState, usersEffects, groundEffects, round } = battle;
  const actor = usersState.find((u) => u.userId === actorId);

  // Things we wish to return
  const newUsersState = structuredClone(usersState);
  const newGroundEffects: GroundEffect[] = [];
  const newUsersEffects: UserEffect[] = [];
  const actionEffects: ActionEffect[] = [];

  // Convert all ground effects to user effects on the users standing on the tile
  groundEffects.sort(sortEffects).forEach((e) => {
    // Get the round information for the effect
    const { startRound, curRound } = calcEffectRoundInfo(e, battle);
    e.castThisRound = startRound === curRound;
    // Process special effects
    let info: ActionEffect | undefined;
    if (e.type === "move") {
      move(e, usersEffects, newUsersState, newGroundEffects);
    } else {
      // Special handling of clone & summon ground-effects
      if (e.type === "clone") {
        info = clone(newUsersState, e, battle.extraState);
      } else if (e.type === "summon") {
        info = summon(newUsersState, e, newUsersEffects, battle);
      } else if (e.type === "barrier") {
        const user = findUser(newUsersState, e.longitude, e.latitude);
        if (user) e.rounds = 0;
      } else {
        // Information on what was done
        if (e.isNew && e.castThisRound && actor && e.type !== "visual" && e.rounds) {
          const txt = `${actor.username} marked the ground with ${e.type} for the next ${e.rounds} rounds`;
          if (!actionEffects.find((ae) => ae.txt === txt)) {
            actionEffects.push({ txt, color: "blue" });
          }
        }
        // Apply all other ground effects to user
        const user = findUser(newUsersState, e.longitude, e.latitude);
        if (user && e.type !== "visual") {
          if (checkFriendlyFire(e, user, newUsersState)) {
            const hasEffect = usersEffects.some((ue) => ue.id === e.id);
            const isInstant = ["damage", "heal", "pierce"].includes(e.type);
            if (!hasEffect) {
              // NOTE:
              // 1. If the effect is instant, it is applied immediately
              // 2. User effects from Ground effects are not forwarded to the next round
              usersEffects.push({
                ...e,
                rounds: isInstant ? 0 : 1,
                targetId: user.userId,
                createdRound: isInstant ? curRound : curRound - 1,
                fromGround: true,
              } as UserEffect);
            }
          }
        }
        // Forward any damage effects, which should be applied to barriers as well
        if (!user && e.type === "damage") {
          const barrier = findBarrier(groundEffects, e.longitude, e.latitude);
          if (barrier) {
            usersEffects.push({
              ...e,
              targetType: "barrier",
              targetId: barrier.id,
              fromGround: true,
            } as UserEffect);
          }
        }
      }

      // Show once appearing visual/audio
      if ((e.appearAnimation || e.appearSfx) && e.isNew && e.type !== "visual") {
        newGroundEffects.push(
          getVisualOrSound(
            e.longitude,
            e.latitude,
            e.appearAnimation,
            e.appearSfx,
            round,
          ),
        );
      }

      // Process round reduction & tag removal
      if (isEffectActive(e) || e.type === "visual") {
        e.isNew = false;
        newGroundEffects.push(e);
      } else if (e.disappearAnimation || e.disappearSfx) {
        newGroundEffects.push(
          getVisualOrSound(
            e.longitude,
            e.latitude,
            e.disappearAnimation,
            e.disappearSfx,
            round,
          ),
        );
      }
    }

    // Add info to action effects if it exists
    if (info) actionEffects.push(info);
  });

  // Book-keeping for damage and heal effects
  const consequences = new Map<string, Consequence>();

  // Remember effects applied to different users, so that we only apply effects once
  const appliedEffects = new Set<string>();

  // Apply mirror & copy tags first, so that these get added to usersEffects
  usersEffects
    .filter((e) => e.type === "mirror" || e.type === "copy")
    .forEach((effect) => {
      applySingleEffect(
        consequences,
        newUsersState,
        newUsersEffects,
        newGroundEffects,
        actionEffects,
        appliedEffects,
        battle,
        actorId,
        effect,
        action,
      );
    });

  // Separate non-damage-modifier effects from damage modifier effects
  // Note: pierce is explicitly excluded here to maintain the sortEffects ordering
  // where damage modifiers run BEFORE pierce (pierce bypasses damage reduction)
  // Note: POST_DAMAGE_MODIFIER_TYPES (wound, afterburn, reflect, recoil, lifesteal, absorb)
  // are excluded here because they must read post-mitigated damage values
  // Note: increaseheal/decreaseheal are excluded because they modify lifesteal_hp/absorb_hp
  // which are set by post-damage modifiers
  const nonDamageModifierEffects = usersEffects
    .filter((e) => e.type !== "mirror" && e.type !== "copy")
    .filter((e) => !damageModifierTypes.includes(e.type))
    .filter((e) => !POST_DAMAGE_MODIFIER_TYPES.includes(e.type))
    .filter((e) => e.type !== "pierce")
    .filter((e) => e.type !== "increaseheal" && e.type !== "decreaseheal");

  // Separate pierce effects (must run AFTER damage modifiers, BEFORE post-damage modifiers)
  const pierceEffects = usersEffects.filter((e) => e.type === "pierce");

  // Separate post-damage-modifier effects (wound, afterburn, reflect, recoil, lifesteal, absorb)
  // These depend on post-mitigated damage values, so they must run after pierce
  const postDamageModifierEffects = usersEffects.filter((e) =>
    POST_DAMAGE_MODIFIER_TYPES.includes(e.type),
  );

  // Separate heal adjustment effects (increaseheal/decreaseheal)
  // These modify lifesteal_hp/absorb_hp so they must run AFTER post-damage modifiers set those values
  const healAdjustmentEffects = usersEffects.filter(
    (e) => e.type === "increaseheal" || e.type === "decreaseheal",
  );

  // Separate damage modifier effects by stage
  const stage1DamageModifiers = usersEffects
    .filter((e) => damageModifierTypes.includes(e.type))
    .filter((e) => getEffectStage(e) === 1);

  const stage2DamageModifiers = usersEffects
    .filter((e) => damageModifierTypes.includes(e.type))
    .filter((e) => getEffectStage(e) === 2);

  // Apply non-damage-modifier effects first (maintains existing ordering)
  nonDamageModifierEffects.sort(sortEffects).forEach((effect) => {
    applySingleEffect(
      consequences,
      newUsersState,
      newUsersEffects,
      newGroundEffects,
      actionEffects,
      appliedEffects,
      battle,
      actorId,
      effect,
      action,
    );
  });

  // Apply Stage 1 damage modifiers (equipment/pre-battle effects)
  stage1DamageModifiers.sort(sortEffects).forEach((effect) => {
    applySingleEffect(
      consequences,
      newUsersState,
      newUsersEffects,
      newGroundEffects,
      actionEffects,
      appliedEffects,
      battle,
      actorId,
      effect,
      action,
    );
  });

  // Capture baseDamageAfterStage1 for all consequences with damage
  // This becomes the base for Stage 2 percentage calculations
  consequences.forEach((consequence) => {
    if (consequence.damage !== undefined) {
      consequence.baseDamageAfterStage1 = consequence.damage;
    }
  });

  // Apply Stage 2 damage modifiers (in-battle effects)
  stage2DamageModifiers.sort(sortEffects).forEach((effect) => {
    applySingleEffect(
      consequences,
      newUsersState,
      newUsersEffects,
      newGroundEffects,
      actionEffects,
      appliedEffects,
      battle,
      actorId,
      effect,
      action,
    );
  });

  // Apply pierce effects AFTER damage modifiers but BEFORE post-damage modifiers
  // Pierce adds damage that should be included in post-damage calculations (lifesteal, etc.)
  pierceEffects.sort(sortEffects).forEach((effect) => {
    applySingleEffect(
      consequences,
      newUsersState,
      newUsersEffects,
      newGroundEffects,
      actionEffects,
      appliedEffects,
      battle,
      actorId,
      effect,
      action,
    );
  });

  // Apply post-damage-modifier effects (wound, afterburn, reflect, recoil, lifesteal, absorb)
  // These read consequence.damage to calculate their effect, so they must run after pierce
  // to include pierce damage in their calculations
  postDamageModifierEffects.sort(sortEffects).forEach((effect) => {
    applySingleEffect(
      consequences,
      newUsersState,
      newUsersEffects,
      newGroundEffects,
      actionEffects,
      appliedEffects,
      battle,
      actorId,
      effect,
      action,
    );
  });

  // Apply heal adjustment effects (increaseheal/decreaseheal) AFTER post-damage modifiers
  // These modify lifesteal_hp/absorb_hp values that are set by lifesteal/absorb effects
  healAdjustmentEffects.sort(sortEffects).forEach((effect) => {
    applySingleEffect(
      consequences,
      newUsersState,
      newUsersEffects,
      newGroundEffects,
      actionEffects,
      appliedEffects,
      battle,
      actorId,
      effect,
      action,
    );
  });

  // Apply consequences to users
  Array.from(consequences.values())
    // Before collapsing consequences, we process each consequence indicidually
    .map((c) => {
      // State
      const user = newUsersState.find((u) => u.userId === c.userId);
      const target = newUsersState.find((u) => u.userId === c.targetId);
      const targetShields = newUsersEffects.filter(
        (e) => e.type === "shield" && e.targetId === c.targetId && e.power > 0,
      ) as ShieldTagType[];
      /** Convenience method for reducing shields before applying damage */
      const calcAdjustedDamage = (
        target: BattleUserState,
        originalDamage: number,
        effectTypes?: string[],
      ) => {
        // For negative changes, first reduce shields
        let remainingDamage = Math.abs(originalDamage);
        // Bypass shield absorption for pierce, reflect, and wound effects
        if (
          !effectTypes?.includes("pierce") &&
          !effectTypes?.includes("reflect") &&
          !effectTypes?.includes("wound")
        ) {
          targetShields.forEach((shield) => {
            if (remainingDamage > 0 && shield.power && shield.power > 0) {
              const absorbed = Math.min(remainingDamage, shield.power);
              shield.power -= absorbed;
              remainingDamage -= absorbed;
              if (shield.power > 0) {
                actionEffects.push({
                  txt: `${target.username}'s shield absorbs ${absorbed.toFixed(2)} damage. ${shield.power.toFixed(2)} remaining.`,
                  color: "red",
                });
              } else {
                actionEffects.push({
                  txt: `${target.username}'s shield absorbs ${absorbed.toFixed(2)} damage and is destroyed`,
                  color: "red",
                });
              }
            }
          });
        } else if (effectTypes?.includes("pierce")) {
          // Pierce effects destroy shields instead of absorbing damage
          targetShields.forEach((shield) => {
            if (shield.power && shield.power > 0) {
              actionEffects.push({
                txt: `${target.username}'s shield was pierced and destroyed!`,
                color: "red",
              });
              shield.power = 0;
              shield.rounds = 0;
            }
          });
        }

        // Apply final stand if active
        const finalStandEffect = usersEffects.find((e) => {
          if (e.type !== "finalstand" || e.targetId !== target.userId) return false;
          if (e.fromType === "bloodline") {
            e.rounds = 1;
            return true;
          }
          return (e.rounds ?? 0) > 0;
        });
        if (finalStandEffect && target.curHealth - remainingDamage < 1) {
          const preventedDamage = remainingDamage - (target.curHealth - 1);
          remainingDamage = target.curHealth - 1;
          actionEffects.push({
            txt: `${target.username}'s final stand prevents ${preventedDamage.toFixed(2)} damage`,
            color: "orange",
          });
        }

        return remainingDamage;
      };
      // Store pre-shield damage for reflect/lifesteal/absorb calculations
      const preShieldDamage = c.damage ?? 0;

      // Adjust damages and reduce shields
      if (target && user) {
        if (c.damage && c.damage > 0) {
          c.damage = calcAdjustedDamage(target, c.damage, c.types);
        }
        if (c.residual && c.residual > 0) {
          c.residual = calcAdjustedDamage(target, c.residual, c.types);
        }
        if (c.wound && c.wound > 0) {
          c.wound = calcAdjustedDamage(target, c.wound, c.types);
        }
        if (c.reflect && c.reflect > 0) {
          c.reflect = calcAdjustedDamage(user, c.reflect, c.types);
        }
        if (c.recoil && c.recoil > 0) {
          c.recoil = calcAdjustedDamage(user, c.recoil, c.types);
        }
      }

      // Store pre-shield damage for later use
      c.preShieldDamage = preShieldDamage;
      return c;
    })
    .reduce(collapseConsequences, [] as Consequence[])
    .forEach((c) => {
      // Convenience variables & methods
      const user = newUsersState.find((u) => u.userId === c.userId);
      const target = newUsersState.find((u) => u.userId === c.targetId);

      // Apply all the consequences
      if (target && user) {
        if (c.damage !== undefined && c.damage >= 0) {
          target.curHealth -= c.damage;
          target.curHealth = Math.max(0, target.curHealth);
          actionEffects.push({
            txt: `${target.username} takes ${c.damage.toFixed(2)} damage`,
            color: "red",
            types: c.types,
          });
          // Reduce armor durability by 1 when hit (skip for battles that don't lose durability)
          if (!NO_DURABILITY_LOSS_COMBATS.includes(battle.battleType)) {
            const t = newUsersState.find((u) => u.userId === target.userId);
            t?.items.forEach((ui) => {
              const item = getItem(battle, ui.itemId);
              if (item?.itemType === "ARMOR" && ui.equipped !== "NONE") {
                const currentDurability = Math.min(ui.durability, item.maxDurability);
                ui.durability = Math.max(0, currentDurability - 1);
                if (ui.durability <= DURABILITY_USABILITY_THR) {
                  ui.equipped = "NONE" as const;
                }
              }
            });
          }
        }
        if (c.residual !== undefined && c.residual >= 0) {
          target.curHealth -= c.residual;
          target.curHealth = Math.max(0, target.curHealth);
          actionEffects.push({
            txt: `${target.username} takes ${c.residual.toFixed(2)} residual damage`,
            color: "red",
            types: c.types,
          });
          // Track armor hits from residual damage as well (skip for battles that don't lose durability)
          if (!NO_DURABILITY_LOSS_COMBATS.includes(battle.battleType)) {
            const t = newUsersState.find((u) => u.userId === target.userId);
            t?.items.forEach((ui) => {
              const item = getItem(battle, ui.itemId);
              if (item?.itemType === "ARMOR" && ui.equipped !== "NONE") {
                const currentDurability = Math.min(ui.durability, item.maxDurability);
                ui.durability = Math.max(0, currentDurability - 1);
                if (ui.durability <= DURABILITY_USABILITY_THR) {
                  ui.equipped = "NONE" as const;
                }
              }
            });
          }
        }
        if (c.wound !== undefined && c.wound >= 0) {
          target.curHealth -= c.wound;
          target.curHealth = Math.max(0, target.curHealth);
          actionEffects.push({
            txt: `${target.username} takes ${c.wound.toFixed(2)} wound damage`,
            color: "red",
            types: c.types,
          });
          // Track armor hits from wound damage as well (skip for battles that don't lose durability)
          if (!NO_DURABILITY_LOSS_COMBATS.includes(battle.battleType)) {
            const t = newUsersState.find((u) => u.userId === target.userId);
            t?.items.forEach((ui) => {
              const item = getItem(battle, ui.itemId);
              if (item?.itemType === "ARMOR" && ui.equipped !== "NONE") {
                const currentDurability = Math.min(ui.durability, item.maxDurability);
                ui.durability = Math.max(0, currentDurability - 1);
                if (ui.durability <= DURABILITY_USABILITY_THR) {
                  ui.equipped = "NONE" as const;
                }
              }
            });
          }
        }
        if (c.heal_hp !== undefined && c.heal_hp >= 0 && target.curHealth > 0) {
          target.curHealth += c.heal_hp;
          target.curHealth = Math.min(target.maxHealth, target.curHealth);
          actionEffects.push({
            txt: `${target.username} heals ${c.heal_hp} HP`,
            color: "green",
          });
        }
        if (c.heal_sp !== undefined && c.heal_sp >= 0) {
          target.curStamina += c.heal_sp;
          target.curStamina = Math.min(target.maxStamina, target.curStamina);
          actionEffects.push({
            txt: `${target.username} heals ${c.heal_sp} SP`,
            color: "green",
          });
        }
        if (c.heal_cp !== undefined && c.heal_cp >= 0) {
          target.curChakra += c.heal_cp;
          target.curChakra = Math.min(target.maxChakra, target.curChakra);
          actionEffects.push({
            txt: `${target.username} heals ${c.heal_cp} CP`,
            color: "green",
          });
        }
        if (c.reflect !== undefined && c.reflect >= 0) {
          // Use pre-shield damage for the 60% cap calculation to avoid shield interference
          const preShieldDamage = c.preShieldDamage ?? 0;
          const maxReflect = preShieldDamage * 0.6;
          const finalReflect = Math.min(c.reflect, maxReflect);
          user.curHealth -= finalReflect;
          user.curHealth = Math.max(0, user.curHealth);
          actionEffects.push({
            txt: `${user.username} takes ${finalReflect.toFixed(2)} reflect damage`,
            color: "red",
          });
        }
        if (c.recoil !== undefined && c.recoil >= 0) {
          user.curHealth -= c.recoil;
          user.curHealth = Math.max(0, user.curHealth);
          actionEffects.push({
            txt: `${user.username} takes ${c.recoil.toFixed(2)} recoil damage`,
            color: "red",
          });
        }
        if (c.afterburn !== undefined && c.afterburn >= 0) {
          target.curHealth -= c.afterburn;
          target.curHealth = Math.max(0, target.curHealth);
          actionEffects.push({
            txt: `${target.username} takes ${c.afterburn.toFixed(2)} afterburn damage`,
            color: "red",
          });
        }
        if (
          c.lifesteal_hp !== undefined &&
          c.lifesteal_hp >= 0 &&
          target.curHealth > 0 &&
          user.curHealth > 0
        ) {
          // Use pre-shield damage for the 60% cap calculation to avoid shield interference
          const preShieldDamage = c.preShieldDamage ?? 0;
          const maxLifesteal = preShieldDamage * 0.6;
          const finalLifesteal = Math.min(c.lifesteal_hp, maxLifesteal);
          user.curHealth += finalLifesteal;
          user.curHealth = Math.min(user.maxHealth, user.curHealth);
          actionEffects.push({
            txt: `${user.username} steals ${finalLifesteal.toFixed(2)} damage as health`,
            color: "green",
          });
        }
        if (c.absorb_hp !== undefined && c.absorb_hp >= 0 && target.curHealth > 0) {
          // Use pre-shield damage for the 60% cap calculation to avoid shield interference
          const preShieldDamage = c.preShieldDamage ?? 0;
          const maxAbsorb = preShieldDamage * 0.6;
          const absorbAmount = Math.min(c.absorb_hp, maxAbsorb);
          target.curHealth += absorbAmount;
          target.curHealth = Math.min(target.maxHealth, target.curHealth);
          actionEffects.push({
            txt: `${target.username} absorbs ${absorbAmount.toFixed(2)} damage and converts it to health`,
            color: "green",
          });
        }
        if (c.absorb_sp !== undefined && c.absorb_sp >= 0) {
          target.curStamina += c.absorb_sp;
          target.curStamina = Math.min(target.maxHealth, target.curStamina);
          actionEffects.push({
            txt: `${target.username} absorbs ${c.absorb_sp.toFixed(2)} damage and converts it to stamina`,
            color: "green",
          });
        }
        if (c.absorb_cp !== undefined && c.absorb_cp >= 0) {
          target.curChakra += c.absorb_cp;
          target.curChakra = Math.min(target.maxHealth, target.curChakra);
          actionEffects.push({
            txt: `${target.username} absorbs ${c.absorb_cp.toFixed(2)} damage and converts it to chakra`,
            color: "green",
          });
        }
        // Handle drain effects for each pool
        if (c.drain_hp !== undefined && c.drain_hp >= 0 && target.curHealth > 0) {
          target.curHealth = Math.max(0, target.curHealth - c.drain_hp);
          actionEffects.push({
            txt: `${target.username} loses ${c.drain_hp.toFixed(2)} HP to drain`,
            color: "purple",
          });
        }
        if (c.drain_cp !== undefined && c.drain_cp >= 0 && target.curChakra > 0) {
          target.curChakra = Math.max(0, target.curChakra - c.drain_cp);
          actionEffects.push({
            txt: `${target.username} loses ${c.drain_cp.toFixed(2)} CP to drain`,
            color: "purple",
          });
        }
        if (c.drain_sp !== undefined && c.drain_sp >= 0 && target.curStamina > 0) {
          target.curStamina = Math.max(0, target.curStamina - c.drain_sp);
          actionEffects.push({
            txt: `${target.username} loses ${c.drain_sp.toFixed(2)} SP to drain`,
            color: "purple",
          });
        }
        if (c.poison !== undefined && c.poison >= 0) {
          target.curHealth = Math.max(
            0,
            Math.min(target.maxHealth, target.curHealth - c.poison),
          );
          actionEffects.push({
            txt: `${target.username} takes ${c.poison.toFixed(2)} poison damage`,
            color: "purple",
          });
        }
        // Process disappear animation of characters
        if (target.curHealth <= 0 && !target.isOriginal) {
          newGroundEffects.push(
            getVisualOrSound(
              target.longitude,
              target.latitude,
              ID_ANIMATION_SMOKE,
              undefined,
              round,
            ),
          );
        }
        if (user.curHealth <= 0 && !user.isOriginal) {
          newGroundEffects.push(
            getVisualOrSound(
              user.longitude,
              user.latitude,
              ID_ANIMATION_SMOKE,
              undefined,
              round,
            ),
          );
        }
      }
    });

  // Apply pool adjustments to base values for all users with pool effects
  newUsersState.forEach((user) => {
    const hasPoolEffects = newUsersEffects.some(
      (e) =>
        e.targetId === user.userId &&
        (e.type === "increasemaxpools" || e.type === "decreasemaxpools") &&
        isEffectActive(e),
    );
    // Check if we have tracking fields from a previous adjustment
    const hadPoolEffects =
      user._prevHealthAdj !== undefined ||
      user._prevChakraAdj !== undefined ||
      user._prevStaminaAdj !== undefined;

    // Call if we have pool effects now OR had them last round (to apply delta on expiration)
    if (hasPoolEffects || hadPoolEffects) {
      applyPoolAdjustmentsToBase(user, newUsersEffects);
    }
  });

  return {
    newBattle: {
      ...battle,
      usersState: newUsersState,
      usersEffects: newUsersEffects,
      groundEffects: newGroundEffects,
    },
    actionEffects,
  };
};

/**
 * Function for processing a single effect. Note that this function is not pure,
 * but mutates the parameters passed in.
 *
 * @param consequences - Map of consequences - mutated
 * @param newUsersState - New users state - mutated
 * @param newUsersEffects - New users effects - mutated
 * @param newGroundEffects - New ground effects - mutated
 * @param actionEffects - Action effects - mutated
 * @param appliedEffects - Applied effects - mutated
 * @param battle - Battle
 * @param actorId - Actor ID
 * @param effect - Effect to process
 * @param action - Action
 */
export const applySingleEffect = (
  // Mutated parameters
  consequences: Map<string, Consequence>,
  newUsersState: BattleUserState[],
  newUsersEffects: UserEffect[],
  newGroundEffects: GroundEffect[],
  actionEffects: ActionEffect[],
  appliedEffects: Set<string>,
  battle: CompleteBattle,
  // Not mutated parameters
  actorId: string,
  effect: UserEffect,
  action?: CombatAction,
) => {
  // Destructure
  const { usersState, usersEffects, round } = battle;
  // Get the round information for the effect
  const { startRound, curRound } = calcEffectRoundInfo(effect, battle);
  effect.castThisRound = startRound === curRound;
  // Fetch any active sealing effects
  const sealEffects = usersEffects.filter(
    (e) => e.type === "seal" && !e.isNew && isEffectActive(e),
  );
  // Bookkeeping
  let longitude: number | undefined;
  let latitude: number | undefined;
  let info: ActionEffect | undefined;
  // Get user now and next
  const curUser = usersState.find((u) => u.userId === effect.creatorId);
  const newUser = newUsersState.find((u) => u.userId === effect.creatorId);
  // Remember the effect
  const idx = `${effect.type}-${effect.creatorId}-${effect.targetId}-${effect.fromType}`;
  // Determine whether the tags should stack
  const cacheCheck = BATTLE_TAG_STACKING
    ? true
    : !appliedEffects.has(idx) ||
      effect.fromType === "bloodline" ||
      effect.fromType === "armor";
  // Special cases
  if (
    ["damage", "pierce"].includes(effect.type) &&
    effect.targetType === "barrier" &&
    curUser
  ) {
    // For barrier damage, only apply if target is the actor (not if effect is new)
    // This prevents residual damage from applying to barriers on every action
    const isTarget = effect.targetId === actorId;
    const ratio = calcApplyRatio(effect, battle, effect.targetId, isTarget);
    if (ratio > 0) {
      const result = damageBarrier(newGroundEffects, curUser, effect, config);
      if (result) {
        longitude = result.barrier.longitude;
        latitude = result.barrier.latitude;
        actionEffects.push(result.info);
      }
    }
  } else if (effect.targetType === "user" && cacheCheck) {
    // Get the user && effect details
    const curTarget = usersState.find((u) => u.userId === effect.targetId);
    const newTarget = newUsersState.find((u) => u.userId === effect.targetId);
    const isSealed = sealCheck(effect, sealEffects);
    const isTargetOrNew = effect.targetId === actorId || effect.isNew;
    if (curUser && newUser && curTarget && newTarget && !isSealed) {
      appliedEffects.add(idx);
      longitude = curTarget?.longitude;
      latitude = curTarget?.latitude;

      // Figure if tag should be applied
      const ratio = calcApplyRatio(effect, battle, effect.targetId, isTargetOrNew);
      if (ratio > 0) {
        // Tags only applied when target is user or new
        if (isTargetOrNew) {
          if (effect.type === "damage" && isTargetOrNew) {
            const modifier = calcDmgModifier(effect, curTarget, usersEffects);
            info = damageUser(
              effect,
              curUser,
              curTarget,
              consequences,
              modifier,
              config,
            );
          } else if (effect.type === "pierce" && isTargetOrNew) {
            const modifier = calcDmgModifier(effect, curTarget, usersEffects);
            info = damageUser(
              effect,
              newUser,
              newTarget,
              consequences,
              modifier,
              config,
            );
          } else if (effect.type === "heal" && isTargetOrNew) {
            info = heal(effect, newUsersEffects, curTarget, consequences, ratio);
          } else if (effect.type === "flee" && isTargetOrNew) {
            info = flee(effect, newUsersEffects, newTarget);
          } else if (effect.type === "increasepoolcost" && isTargetOrNew) {
            info = increasepoolcost(effect, curTarget);
          } else if (effect.type === "decreasepoolcost" && isTargetOrNew) {
            info = decreasepoolcost(effect, curTarget);
          } else if (effect.type === "drain" && isTargetOrNew) {
            info = drain(effect, usersEffects, consequences, curTarget);
          } else if (effect.type === "clear" && isTargetOrNew) {
            info = clear(effect, usersEffects, curTarget);
          } else if (effect.type === "cleanse" && isTargetOrNew) {
            info = cleanse(effect, usersEffects, curTarget);
          } else if (effect.type === "increasedamagegiven") {
            info = increaseDamageGiven(effect, usersEffects, consequences, curTarget);
          } else if (effect.type === "decreasedamagegiven") {
            info = decreaseDamageGiven(effect, usersEffects, consequences, curTarget);
          } else if (effect.type === "onehitkill") {
            info = onehitkill(effect, newUsersEffects, newTarget);
          } else if (effect.type === "rob") {
            info = rob(effect, newUsersEffects, newUser, newTarget, battle.battleType);
          } else if (effect.type === "seal") {
            info = seal(effect, newUsersEffects, curTarget);
          } else if (effect.type === "stun") {
            info = stun(effect, newUsersEffects, curTarget);
          } else if (effect.type === "wound") {
            info = wound(effect, usersEffects, consequences, curTarget);
          }
        }

        // Always apply
        if (effect.type === "absorb") {
          info = absorb(effect, usersEffects, consequences, curTarget);
        } else if (effect.type === "increasestat") {
          info = increaseStats(effect, newUsersEffects, curTarget);
        } else if (effect.type === "increasemaxpools") {
          info = increaseMaxPools(effect, newUsersEffects, newTarget);
        } else if (effect.type === "decreasemaxpools") {
          info = decreaseMaxPools(effect, newUsersEffects, newTarget);
        } else if (effect.type === "increasecooldown") {
          info = increaseCooldown(effect, usersEffects, curTarget);
        } else if (effect.type === "decreasecooldown") {
          info = decreaseCooldown(effect, usersEffects, curTarget);
        } else if (effect.type === "increaserange") {
          info = increaseRange(effect, usersEffects, curTarget);
        } else if (effect.type === "decreasestat") {
          info = decreaseStats(effect, newUsersEffects, curTarget);
        } else if (effect.type === "increasedamagetaken") {
          info = increaseDamageTaken(effect, usersEffects, consequences, curTarget);
        } else if (effect.type === "decreasedamagetaken") {
          info = decreaseDamageTaken(effect, usersEffects, consequences, curTarget);
        } else if (effect.type === "increaseheal") {
          info = increaseHealGiven(effect, usersEffects, consequences, curTarget);
        } else if (effect.type === "decreaseheal") {
          info = decreaseHealGiven(effect, usersEffects, consequences, curTarget);
        } else if (effect.type === "reflect") {
          info = reflect(effect, usersEffects, consequences, curTarget);
        } else if (effect.type === "recoil") {
          info = recoil(effect, usersEffects, consequences, curTarget);
        } else if (effect.type === "afterburn") {
          info = afterburn(effect, usersEffects, consequences, curTarget);
        } else if (effect.type === "lifesteal") {
          info = lifesteal(effect, usersEffects, consequences, curTarget);
        } else if (effect.type === "fleeprevent") {
          info = fleePrevent(effect, usersEffects, curTarget);
        } else if (effect.type === "healprevent") {
          info = healPrevent(effect, usersEffects, curTarget);
        } else if (effect.type === "stealth") {
          info = stealth(effect, curTarget);
        } else if (effect.type === "elementalseal") {
          info = elementalseal(effect, curTarget);
        } else if (effect.type === "buffprevent") {
          info = buffPrevent(effect, usersEffects, curTarget);
        } else if (effect.type === "debuffprevent") {
          info = debuffPrevent(effect, usersEffects, curTarget);
        } else if (effect.type === "onehitkillprevent") {
          info = onehitkillPrevent(effect, usersEffects, curTarget);
        } else if (effect.type === "robprevent") {
          info = robPrevent(effect, usersEffects, curTarget);
        } else if (effect.type === "cleanseprevent") {
          info = cleansePrevent(effect, usersEffects, curTarget);
        } else if (effect.type === "clearprevent") {
          info = clearPrevent(effect, usersEffects, curTarget);
        } else if (effect.type === "sealprevent") {
          info = sealPrevent(effect, usersEffects, curTarget);
        } else if (effect.type === "stunprevent") {
          info = stunPrevent(effect, usersEffects, curTarget);
        } else if (effect.type === "moveprevent") {
          info = movePrevent(effect, usersEffects, curTarget);
        } else if (effect.type === "summonprevent") {
          info = summonPrevent(effect, usersEffects, curTarget);
        } else if (effect.type === "weakness") {
          info = weakness(effect, curTarget);
        } else if (effect.type === "shield") {
          info = shield(effect, curTarget);
        } else if (effect.type === "immunity") {
          info = immunity(effect, curTarget);
        } else if (effect.type === "poison" && action) {
          info = poison(effect, action, actorId, consequences, curTarget, usersEffects);
        } else if (effect.type === "injectjutsus") {
          info = injectjutsus(effect, newTarget);
        } else if (effect.type === "copy") {
          info = copy(effect, usersEffects, curUser, curTarget);
        } else if (effect.type === "mirror") {
          info = mirror(effect, usersEffects, curUser, curTarget);
        } else if (effect.type === "timecompression") {
          info = timeCompression(effect, usersEffects, curTarget);
        } else if (effect.type === "timedilation") {
          info = timeDilation(effect, usersEffects, curTarget);
        } else if (effect.type === "redirection") {
          info = redirection(
            battle,
            effect,
            usersEffects,
            curTarget,
            newUsersState,
            newGroundEffects,
          );
        } else if (effect.type === "finalstand") {
          info = finalStand(effect, curTarget);
        }
        updateStatUsage(newTarget, effect, true);
      }
    }
  }

  // Show text results of actions
  if (info) {
    actionEffects.push(info);
  }

  // Show once appearing visual/audio
  if (
    (effect.appearAnimation || effect.appearSfx) &&
    effect.isNew &&
    longitude !== undefined &&
    latitude !== undefined
  ) {
    newGroundEffects.push(
      getVisualOrSound(
        longitude,
        latitude,
        effect.appearAnimation,
        effect.appearSfx,
        battle.round,
      ),
    );
  }

  if ((isEffectActive(effect) && !effect.fromGround) || effect.type === "visual") {
    effect.isNew = false;
    newUsersEffects.push(effect);
  } else if (
    (effect.disappearAnimation || effect.disappearSfx) &&
    longitude &&
    latitude
  ) {
    newGroundEffects.push(
      getVisualOrSound(
        longitude,
        latitude,
        effect.disappearAnimation,
        effect.disappearSfx,
        round,
      ),
    );
  }
};

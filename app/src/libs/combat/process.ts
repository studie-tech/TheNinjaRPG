import { dmgConfig as config } from "./constants";
import { VisualTag } from "./types";
import { findUser, findBarrier } from "./util";
import { collapseConsequences, sortEffects } from "./util";
import { calcApplyRatio } from "./util";
import { calcEffectRoundInfo, isEffectActive } from "./util";
import { nanoid } from "nanoid";
import { clone, move, heal, damageBarrier, damageUser, calcDmgModifier } from "./tags";
import {
  absorb,
  reflect,
  recoil,
  afterburn,
  lifesteal,
  drain,
  shield,
  poison,
  finalStand,
} from "./tags";
import { increaseStats, decreaseStats, copy, mirror } from "./tags";
import { increaseDamageGiven, decreaseDamageGiven } from "./tags";
import { increaseDamageTaken, decreaseDamageTaken } from "./tags";
import { increaseHealGiven, decreaseHealGiven } from "./tags";
import { increasepoolcost, decreasepoolcost } from "./tags";
import { flee, fleePrevent } from "./tags";
import { stun, stunPrevent, onehitkill, onehitkillPrevent, movePrevent } from "./tags";
import {
  seal,
  sealPrevent,
  sealCheck,
  rob,
  robPrevent,
  stealth,
  elementalseal,
} from "./tags";
import { clear, cleanse, summon, summonPrevent, buffPrevent, weakness } from "./tags";
import { cleansePrevent, clearPrevent, healPrevent, debuffPrevent } from "./tags";
import { updateStatUsage } from "./tags";
import { BATTLE_TAG_STACKING, ID_ANIMATION_SMOKE } from "@/drizzle/constants";
import type { BattleUserState, ReturnedUserState } from "./types";
import type { GroundEffect, UserEffect, ActionEffect, BattleEffect } from "./types";
import type { CompleteBattle, Consequence, CombatAction } from "./types";
import type { ShieldTagType } from "./types";
/**
 * Check whether to apply given effect to a user, based on friendly fire settings
 */
export const checkFriendlyFire = (
  effect: BattleEffect,
  target: ReturnedUserState,
  usersState: ReturnedUserState[],
) => {
  // Find the creator of the effect
  const creator = usersState.find((u) => u.userId === effect.creatorId);
  if (!creator) return false;

  // For summoned units, always check if they belong to the creator
  if (target.isSummon) {
    const isFriendly = target.controllerId === creator.userId;
    return effect.friendlyFire === "FRIENDLY" ? isFriendly : !isFriendly;
  }

  // Get unique village IDs from real (non-summoned) users
  const uniqueVillages = new Set(
    usersState.filter((u) => !u.isSummon).map((u) => u.villageId),
  );

  // If all real users are from the same village, treat them as enemies
  const isIntraVillageBattle = uniqueVillages.size === 1;

  // In same-village battles, everyone except summons is an enemy
  if (isIntraVillageBattle) {
    if (!effect.friendlyFire || effect.friendlyFire === "ALL") {
      return true; // Allow all
    }
    if (effect.friendlyFire === "FRIENDLY") {
      return false; // Block friendly-only effects in intra-village battles
    }
    if (effect.friendlyFire === "ENEMIES") {
      return effect.creatorId !== target.userId; // Only allow targeting others, not self
    }
    return false;
  }

  // In multi-village battles, players from same village are allies
  const isFriendly = creator.villageId === target.villageId;

  // Check if effect should be applied based on friendly fire settings
  if (!effect.friendlyFire || effect.friendlyFire === "ALL") {
    return true; // Allow all
  }
  if (effect.friendlyFire === "FRIENDLY") {
    return isFriendly; // Only apply to friends (same village)
  }
  if (effect.friendlyFire === "ENEMIES") {
    return !isFriendly; // Only apply to enemies (different village)
  }
  return false;
};

/**
 * Create a visual effect with a specified appearAnimation
 */
const getVisual = (
  longitude: number,
  latitude: number,
  animation?: string,
  round = 0,
): GroundEffect => {
  return {
    ...VisualTag.parse({
      type: "visual",
      rounds: 0,
      description: "N/A",
      appearAnimation: animation,
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
    let info: ActionEffect | undefined = undefined;
    if (e.type === "move") {
      move(e, usersEffects, newUsersState, newGroundEffects);
    } else {
      // Special handling of clone & summon ground-effects
      if (e.type === "clone") {
        info = clone(newUsersState, e);
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

      // Show once appearing animation
      if (e.appearAnimation && e.isNew && e.type !== "visual") {
        newGroundEffects.push(
          getVisual(e.longitude, e.latitude, e.appearAnimation, round),
        );
      }

      // Process round reduction & tag removal
      if (isEffectActive(e) || e.type === "visual") {
        e.isNew = false;
        newGroundEffects.push(e);
      } else if (e.disappearAnimation) {
        newGroundEffects.push(
          getVisual(e.longitude, e.latitude, e.disappearAnimation, round),
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

  // Apply all other user effects to their target users
  usersEffects
    .filter((e) => e.type !== "mirror" && e.type !== "copy")
    .sort(sortEffects)
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
        // Bypass shield absorption for pierce effects
        if (!effectTypes?.includes("pierce") && !effectTypes?.includes("reflect")) {
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
        }

        // Apply final stand if active
        const finalStandEffect = usersEffects.find(
          (e) =>
            e.type === "finalstand" &&
            e.targetId === target.userId &&
            (e.fromType === "bloodline" ? ((e.rounds = 1), true) : (e.rounds ?? 0) > 0),
        );
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
      // Adjust damages and reduce shields
      if (target && user) {
        if (c.damage && c.damage > 0) {
          c.damage = calcAdjustedDamage(target, c.damage, c.types);
        }
        if (c.residual && c.residual > 0) {
          c.residual = calcAdjustedDamage(target, c.residual, c.types);
        }
        if (c.reflect && c.reflect > 0) {
          c.reflect = calcAdjustedDamage(user, c.reflect, c.types);
        }
        if (c.recoil && c.recoil > 0) {
          c.recoil = calcAdjustedDamage(user, c.recoil, c.types);
        }
      }
      return c;
    })
    .reduce(collapseConsequences, [] as Consequence[])
    .forEach((c) => {
      // Convenience variables & methods
      const user = newUsersState.find((u) => u.userId === c.userId);
      const target = newUsersState.find((u) => u.userId === c.targetId);

      // Apply all the consequences
      if (target && user) {
        if (c.damage && c.damage > 0) {
          if (c.damage > 0) {
            target.curHealth -= c.damage;
            target.curHealth = Math.max(0, target.curHealth);
            actionEffects.push({
              txt: `${target.username} takes ${c.damage.toFixed(2)} damage`,
              color: "red",
              types: c.types,
            });
          }
        }
        if (c.residual && c.residual > 0) {
          if (c.residual > 0) {
            target.curHealth -= c.residual;
            target.curHealth = Math.max(0, target.curHealth);
            actionEffects.push({
              txt: `${target.username} takes ${c.residual.toFixed(2)} residual damage`,
              color: "red",
              types: c.types,
            });
          }
        }
        if (c.heal_hp && c.heal_hp > 0 && target.curHealth > 0) {
          target.curHealth += c.heal_hp;
          target.curHealth = Math.min(target.maxHealth, target.curHealth);
          actionEffects.push({
            txt: `${target.username} heals ${c.heal_hp} HP`,
            color: "green",
          });
        }
        if (c.heal_sp && c.heal_sp > 0) {
          target.curStamina += c.heal_sp;
          target.curStamina = Math.min(target.maxStamina, target.curStamina);
          actionEffects.push({
            txt: `${target.username} heals ${c.heal_sp} SP`,
            color: "green",
          });
        }
        if (c.heal_cp && c.heal_cp > 0) {
          target.curChakra += c.heal_cp;
          target.curChakra = Math.min(target.maxChakra, target.curChakra);
          actionEffects.push({
            txt: `${target.username} heals ${c.heal_cp} CP`,
            color: "green",
          });
        }
        if (c.reflect && c.reflect > 0) {
          if (c.reflect > 0) {
            // Use the actual damage dealt (damage + residual) for the 60% cap calculation
            const actualDamage = (c.damage ?? 0) + (c.residual ?? 0);
            const maxReflect = actualDamage * 0.6;
            const finalReflect = Math.min(c.reflect, maxReflect);
            user.curHealth -= finalReflect;
            user.curHealth = Math.max(0, user.curHealth);
            actionEffects.push({
              txt: `${user.username} takes ${finalReflect.toFixed(2)} reflect damage Debug: Reflect: ${c.reflect} & Total Damage: ${actualDamage}`,
              color: "red",
            });
          }
        }
        if (c.recoil && c.recoil > 0) {
          if (c.recoil > 0) {
            user.curHealth -= c.recoil;
            user.curHealth = Math.max(0, user.curHealth);
            actionEffects.push({
              txt: `${user.username} takes ${c.recoil.toFixed(2)} recoil damage`,
              color: "red",
            });
          }
        }
        if (c.afterburn && c.afterburn > 0) {
          if (c.afterburn > 0) {
            target.curHealth -= c.afterburn;
            target.curHealth = Math.max(0, target.curHealth);
            actionEffects.push({
              txt: `${target.username} takes ${c.afterburn.toFixed(2)} afterburn damage`,
              color: "red",
            });
          }
        }
        if (
          c.lifesteal_hp &&
          c.lifesteal_hp > 0 &&
          target.curHealth > 0 &&
          user.curHealth > 0
        ) {
          // Use the actual damage dealt (damage + residual) for the 60% cap calculation
          const actualDamage = (c.damage ?? 0) + (c.residual ?? 0);
          const maxLifesteal = actualDamage * 0.6;
          const finalLifesteal = Math.min(c.lifesteal_hp, maxLifesteal);
          user.curHealth += finalLifesteal;
          user.curHealth = Math.min(user.maxHealth, user.curHealth);
          actionEffects.push({
            txt: `${user.username} steals ${finalLifesteal.toFixed(2)} damage as health Debug: Lifesteal HP: ${c.lifesteal_hp} & Total Damage: ${actualDamage}`,
            color: "green",
          });
        }
        if (c.absorb_hp && c.absorb_hp > 0 && target.curHealth > 0) {
          // For absorb, use rawDamage (pre-shield) for the 60% cap calculation
          // but apply the absorb based on actual damage that got through
          const rawDamage = c.rawDamage ?? 0;
          const actualDamage = (c.damage ?? 0) + (c.residual ?? 0);
          const maxAbsorb = rawDamage * 0.6;
          const absorbAmount = Math.min(c.absorb_hp, maxAbsorb, actualDamage);
          target.curHealth += absorbAmount;
          target.curHealth = Math.min(target.maxHealth, target.curHealth);
          actionEffects.push({
            txt: `${target.username} absorbs ${absorbAmount.toFixed(
              2,
            )} damage and converts it to health Debug: Absorb HP: ${c.absorb_hp} & Raw Damage: ${rawDamage} & Actual Damage: ${actualDamage}`,
            color: "green",
          });
        }
        if (c.absorb_sp && c.absorb_sp > 0) {
          target.curStamina += c.absorb_sp;
          target.curStamina = Math.min(target.maxHealth, target.curStamina);
          actionEffects.push({
            txt: `${target.username} absorbs ${c.absorb_sp.toFixed(
              2,
            )} damage and converts it to stamina`,
            color: "green",
          });
        }
        if (c.absorb_cp && c.absorb_cp > 0) {
          target.curChakra += c.absorb_cp;
          target.curChakra = Math.min(target.maxHealth, target.curChakra);
          actionEffects.push({
            txt: `${target.username} absorbs ${c.absorb_cp.toFixed(
              2,
            )} damage and converts it to chakra`,
            color: "green",
          });
        }
        // Handle drain effects for each pool
        if (c.drain_hp && c.drain_hp > 0 && target.curHealth > 0) {
          target.curHealth = Math.max(0, target.curHealth - c.drain_hp);
          actionEffects.push({
            txt: `${target.username} loses ${c.drain_hp.toFixed(2)} HP to drain`,
            color: "purple",
          });
        }
        if (c.drain_cp && c.drain_cp > 0 && target.curChakra > 0) {
          target.curChakra = Math.max(0, target.curChakra - c.drain_cp);
          actionEffects.push({
            txt: `${target.username} loses ${c.drain_cp.toFixed(2)} CP to drain`,
            color: "purple",
          });
        }
        if (c.drain_sp && c.drain_sp > 0 && target.curStamina > 0) {
          target.curStamina = Math.max(0, target.curStamina - c.drain_sp);
          actionEffects.push({
            txt: `${target.username} loses ${c.drain_sp.toFixed(2)} SP to drain`,
            color: "purple",
          });
        }
        if (c.poison && c.poison > 0) {
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
            getVisual(target.longitude, target.latitude, ID_ANIMATION_SMOKE, round),
          );
        }
        if (user.curHealth <= 0 && !user.isOriginal) {
          newGroundEffects.push(
            getVisual(user.longitude, user.latitude, ID_ANIMATION_SMOKE, round),
          );
        }
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
  let longitude: number | undefined = undefined;
  let latitude: number | undefined = undefined;
  let info: ActionEffect | undefined = undefined;
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
          }
        }

        // Always apply
        if (effect.type === "absorb") {
          info = absorb(effect, usersEffects, consequences, curTarget);
        } else if (effect.type === "increasestat") {
          info = increaseStats(effect, newUsersEffects, curTarget);
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
          info = fleePrevent(effect, curTarget);
        } else if (effect.type === "healprevent") {
          info = healPrevent(effect, curTarget);
        } else if (effect.type === "stealth") {
          info = stealth(effect, curTarget);
        } else if (effect.type === "elementalseal") {
          info = elementalseal(effect, curTarget);
        } else if (effect.type === "buffprevent") {
          info = buffPrevent(effect, curTarget);
        } else if (effect.type === "debuffprevent") {
          info = debuffPrevent(effect, curTarget);
        } else if (effect.type === "onehitkillprevent") {
          info = onehitkillPrevent(effect, curTarget);
        } else if (effect.type === "robprevent") {
          info = robPrevent(effect, curTarget);
        } else if (effect.type === "cleanseprevent") {
          info = cleansePrevent(effect, curTarget);
        } else if (effect.type === "clearprevent") {
          info = clearPrevent(effect, curTarget);
        } else if (effect.type === "sealprevent") {
          info = sealPrevent(effect, curTarget);
        } else if (effect.type === "stunprevent") {
          info = stunPrevent(effect, curTarget);
        } else if (effect.type === "moveprevent") {
          info = movePrevent(effect, curTarget);
        } else if (effect.type === "summonprevent") {
          info = summonPrevent(effect, curTarget);
        } else if (effect.type === "weakness") {
          info = weakness(effect, curTarget);
        } else if (effect.type === "shield") {
          info = shield(effect, curTarget);
        } else if (effect.type === "poison" && action) {
          info = poison(effect, action, actorId, consequences, curTarget, usersEffects);
        } else if (effect.type === "copy") {
          info = copy(effect, usersEffects, curUser, curTarget);
        } else if (effect.type === "mirror") {
          info = mirror(effect, usersEffects, curUser, curTarget);
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

  // Show once appearing animation
  if (effect.appearAnimation && longitude && latitude) {
    newGroundEffects.push(
      getVisual(longitude, latitude, effect.appearAnimation, battle.round),
    );
  }

  // Process round reduction & tag removal
  if ((isEffectActive(effect) && !effect.fromGround) || effect.type === "visual") {
    effect.isNew = false;
    newUsersEffects.push(effect);
  } else if (effect.disappearAnimation && longitude && latitude) {
    newGroundEffects.push(
      getVisual(longitude, latitude, effect.disappearAnimation, round),
    );
  }
};

import { nanoid } from "nanoid";
import {
  BATTLE_TAG_STACKING,
  DMG_REDUCTION_CAP,
  DURABILITY_USABILITY_THR,
  ID_ANIMATION_SMOKE,
  isPreBattleGearFromType,
  isPreBattleKeystoneFromType,
  NO_DURABILITY_LOSS_COMBATS,
  OUT_OF_COMBAT_BASE_DAMAGE_INCREASE,
  OUT_OF_COMBAT_BASE_DAMAGE_REDUCTION,
  POST_DAMAGE_MODIFIER_TYPES,
  SAGE_MODE_ACTIVATION_JUTSU_ID,
  SAGE_MODE_DISABLED_BATTLES,
  SAGE_MODE_MAX_LEVEL,
  SHIELD_MAX_HEALTH,
} from "@/drizzle/constants";
import type { SageMode } from "@/drizzle/schema";
import {
  getActiveSageLevel,
  getSageDailyCap,
  getSageModeActivationCost,
} from "@/libs/sageMode";
import type { ShieldTagType } from "@/validators/combat";
import { ShieldTag, VisualTag } from "@/validators/combat";
import {
  BARRIER_DAMAGE_TAG_TYPES,
  DAMAGE_LEECH_CAP_RATIO,
  damageBoostTypes,
  damageModifierTypes,
  damageReductionTypes,
  dmgConfig as defaultDmgConfig,
} from "./constants";
import {
  absorb,
  adjustDamageGiven,
  adjustDamageTaken,
  afterburn,
  buffPrevent,
  calcDmgModifier,
  cleanse,
  cleansePrevent,
  clear,
  clearPrevent,
  clone,
  consume,
  copy,
  damageBarrier,
  damageUser,
  debuffPrevent,
  decreaseCooldown,
  decreaseDamageGiven,
  decreaseDamageTaken,
  decreaseHealGiven,
  decreaseMastery,
  decreaseMaxPools,
  decreasepoolcost,
  decreaseStats,
  disarm,
  drain,
  elementalseal,
  finalStand,
  flee,
  fleePrevent,
  getDamageModifierPreventState,
  getEfficiencyRatio,
  getPower,
  heal,
  healPrevent,
  immunity,
  increaseCooldown,
  increaseDamageGiven,
  increaseDamageTaken,
  increaseHealGiven,
  increaseMastery,
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
  realizeTag,
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
  vamp,
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
  ExtraState,
  GroundEffect,
  PreBattleGearModifiers,
  UserEffect,
} from "./types";
import {
  applyPoolAdjustmentsToBase,
  calcApplyRatio,
  calcEffectRoundInfo,
  collapseConsequences,
  creditDamageDealt,
  findBarrier,
  findUser,
  getEffectStage,
  getItem,
  isEffectActive,
  recordUsedTag,
  resolveDamageCreditUser,
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
 * Base shape of the temporary shield granted by the consume tag, parsed once at import.
 *
 * Going through ShieldTag keeps the shield contract in a single place: any field later
 * added to ShieldTag (with a default) flows through here automatically instead of
 * silently missing this call site. Everything the parse validates is static - rounds,
 * power and health are overridden per cast below - so the parse never runs on the
 * per-action combat path.
 */
const CONSUME_SHIELD_BASE = ShieldTag.parse({
  type: "shield",
  description: "Temporary shield from consume",
  rounds: 1,
  power: 1,
  powerPerLevel: 0,
  direction: "offence",
  calculation: "static",
  health: 1,
  target: "SELF",
});

/**
 * Build the temporary shield effect granted by the consume tag.
 *
 * shieldHp and rounds are clamped to the bounds ShieldTag accepts, so a very large
 * consumed hit can never produce a shield outside the schema's range.
 *
 * isNew is intentionally false: shield()'s cast-round branch rolls a
 * `Math.random() < power / 100` primary check to decide whether the shield lands, but
 * here `power` is the raw shield HP (not a 0-100 probability). Marking the effect as
 * not-new skips that roll so the consume shield is applied deterministically.
 */
const createConsumeShieldEffect = (
  user: BattleUserState,
  shieldHp: number,
  rounds: number,
  round: number,
): UserEffect => {
  const cappedHp = Math.min(shieldHp, SHIELD_MAX_HEALTH);
  return {
    ...CONSUME_SHIELD_BASE,
    rounds: Math.min(rounds, 100),
    power: cappedHp,
    health: cappedHp,
    id: nanoid(),
    creatorId: user.userId,
    targetId: user.userId,
    level: 0,
    isNew: false,
    castThisRound: true,
    createdRound: round,
    longitude: user.longitude,
    latitude: user.latitude,
    barrierAbsorb: 0,
    actionId: `consume-${user.userId}-${round}`,
    targetType: "user",
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
  // Note: increaseheal/decreaseheal are excluded because they modify lifesteal_hp/absorb_hp/vampRatio
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
  // These modify lifesteal_hp/absorb_hp/vampRatio so they must run AFTER post-damage modifiers set those values
  const healAdjustmentEffects = usersEffects.filter(
    (e) => e.type === "increaseheal" || e.type === "decreaseheal",
  );

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

  const sealEffects = getActiveSealEffects(usersEffects);
  const usersStateById = new Map(newUsersState.map((u) => [u.userId, u]));
  const damageModifierEligibilityById = buildDamageModifierEligibilityById(
    usersEffects,
    battle.round,
    usersStateById,
  );

  // Consolidated damage pipeline: multiplicative inc buckets, shared sequential % DR, static DR, BL inc
  applyDamageModifierPipelineToConsequences({
    consequences,
    usersEffects,
    extraState: battle.extraState,
    battleRound: battle.round,
    sealEffects,
    eligibilityById: damageModifierEligibilityById,
  });

  const modifierInfoConsequences = new Map<string, Consequence>();
  usersEffects
    .filter((e) => damageModifierTypes.includes(e.type))
    .filter((e) => !sealCheck(e, sealEffects))
    .sort(sortEffects)
    .forEach((effect) => {
      const targetUser = usersStateById.get(effect.targetId);
      if (!targetUser) return;

      const eligibility = damageModifierEligibilityById.get(effect.id);
      if (eligibility?.preventInfo) {
        actionEffects.push(eligibility.preventInfo);
        return;
      }

      // Record the applied damage-modifier tag for the tag_usage_win tracker. These four tags
      // bypass applySingleEffect's resolution branch (they run only in this dedicated loop), so
      // mirror that credit here: past the preventInfo guard the modifier is applied (not
      // blocked) — the same "applied, not resisted" bar the resolution branch uses. Deliberately
      // NOT gated on `info` below: that is only the cast-round display text (isNew && rounds), so
      // it would miss every later active round and any rounds:0 tag. Caster is effect.creatorId
      // (its controller for a summon/clone), matching damage_dealt attribution.
      const modifierCaster = usersStateById.get(effect.creatorId);
      if (modifierCaster) recordUsedTag(newUsersState, modifierCaster, effect.type);

      let info: ActionEffect | undefined;
      switch (effect.type) {
        case "increasedamagegiven":
          info = adjustDamageGiven(
            effect,
            usersEffects,
            modifierInfoConsequences,
            targetUser,
          );
          break;
        case "decreasedamagegiven":
          effect.power = -Math.abs(effect.power);
          effect.powerPerLevel = -Math.abs(effect.powerPerLevel);
          info = adjustDamageGiven(
            effect,
            usersEffects,
            modifierInfoConsequences,
            targetUser,
          );
          break;
        case "increasedamagetaken":
          info = adjustDamageTaken(
            effect,
            usersEffects,
            modifierInfoConsequences,
            targetUser,
          );
          break;
        case "decreasedamagetaken":
          effect.power = -Math.abs(effect.power);
          effect.powerPerLevel = -Math.abs(effect.powerPerLevel);
          info = adjustDamageTaken(
            effect,
            usersEffects,
            modifierInfoConsequences,
            targetUser,
          );
          break;
        default:
          break;
      }
      if (info) actionEffects.push(info);
    });

  // Damage modifier tags are excluded from applySingleEffect; carry them forward so they
  // persist in the outgoing snapshot (pierce / post-damage tags have dedicated passes later).
  const presentEffectIds = new Set(newUsersEffects.map((e) => e.id));
  for (const e of usersEffects) {
    if (
      !damageModifierTypes.includes(e.type) ||
      presentEffectIds.has(e.id) ||
      !((isEffectActive(e) && !e.fromGround) || e.type === "visual")
    ) {
      continue;
    }
    e.isNew = false;
    newUsersEffects.push(e);
    presentEffectIds.add(e.id);
  }

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
  // These modify lifesteal_hp/absorb_hp/vampRatio values set by lifesteal/absorb/vamp effects
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

  // Consume shields are accumulated per attacker across all collapsed consequences and
  // pushed once after the loop, so a multi-target action grants a single shield sized
  // off the whole hit rather than one shield per damaged target.
  const consumeShieldByUser = new Map<string, { hp: number; rounds: number }>();

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

      // Store pre-shield damage for later use (preserve if already set, e.g. by vamp)
      c.preShieldDamage = c.preShieldDamage ?? preShieldDamage;
      return c;
    })
    .reduce(collapseConsequences, [] as Consequence[])
    .forEach((c) => {
      // Convenience variables & methods
      const user = newUsersState.find((u) => u.userId === c.userId);
      const target = newUsersState.find((u) => u.userId === c.targetId);

      // Apply all the consequences
      if (target && user) {
        // Vamp + lifesteal share one 60%-of-damage budget per consequence. Declared
        // before the damage block because lifesteal is applied later, outside it, and
        // still needs the budget when a shield-reduced damage===0 was dropped in merge.
        const leechBudget = Math.floor(
          (c.preShieldDamage ?? c.damage ?? 0) * DAMAGE_LEECH_CAP_RATIO,
        );
        let leechConsumed = 0;
        // damage_dealt tracker credit goes to the controller when the attacker is a
        // summon/clone, matching creatures_hunted attribution (kills a summon secures
        // already count for the summoner). Summons copy the summoner's direction at
        // spawn, so the opponent predicate is evaluated from the controller too.
        const damageCreditUser = resolveDamageCreditUser(newUsersState, user);
        if (c.damage !== undefined && c.damage >= 0) {
          target.curHealth -= c.damage;
          target.curHealth = Math.max(0, target.curHealth);
          // Accumulate per-attacker damage dealt to real opponents (non-self, non-summon)
          // for the damage_dealt quest tracker. Direct damage plus DoT/drain (residual,
          // wound, afterburn, drain_hp, poison) each credit via creditDamageDealt below;
          // reflect and recoil hit the attacker's own HP and are intentionally excluded.
          creditDamageDealt(damageCreditUser, target, c.damage);
          actionEffects.push({
            txt: `${target.username} takes ${c.damage.toFixed(2)} damage`,
            color: "red",
            types: c.types,
          });
          // Vamp: heal the attacker based on the full pre-shield damage dealt (post-boost,
          // pre-shield; matches lifesteal, so a shield doesn't shrink the vamp heal).
          // Intentional: this can trigger on killing blows (no target.curHealth > 0 guard).
          // Fills the shared leech budget first; lifesteal later takes whatever remains.
          const rawVampHeal = c.vampHeal ?? 0;
          if (rawVampHeal > 0 && user.curHealth > 0) {
            const vampHeal = Math.min(
              Math.floor(rawVampHeal),
              leechBudget - leechConsumed,
            );
            if (vampHeal > 0) {
              leechConsumed += vampHeal;
              user.curHealth = Math.min(user.maxHealth, user.curHealth + vampHeal);
              actionEffects.push({
                txt: `${user.username} vamps ${vampHeal} damage as health`,
                color: "green",
              });
            }
          }
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
        // Consume: convert a % of pre-shield damage into a temporary shield on the
        // attacker. Not affected by heal modifiers and does not share the vamp/lifesteal
        // leech budget. Accumulated here and granted once after the loop. Sits outside
        // the damage block because consumeShield is only ever set from a pre-shield hit,
        // which survives a merge that drops a shield-reduced damage===0 (same reason
        // lifesteal is applied outside the block below).
        const consumeShield = c.consumeShield ?? 0;
        const consumeRounds = c.consumeRounds ?? 0;
        if (consumeShield > 0 && consumeRounds > 0 && user.curHealth > 0) {
          const prev = consumeShieldByUser.get(user.userId);
          consumeShieldByUser.set(user.userId, {
            hp: (prev?.hp ?? 0) + consumeShield,
            rounds: Math.max(prev?.rounds ?? 0, consumeRounds),
          });
        }
        if (c.residual !== undefined && c.residual >= 0) {
          target.curHealth -= c.residual;
          target.curHealth = Math.max(0, target.curHealth);
          creditDamageDealt(damageCreditUser, target, c.residual);
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
          creditDamageDealt(damageCreditUser, target, c.wound);
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
          creditDamageDealt(damageCreditUser, target, c.afterburn);
          actionEffects.push({
            txt: `${target.username} takes ${c.afterburn.toFixed(2)} afterburn damage`,
            color: "red",
          });
        }
        // Lifesteal shares the leech budget with vamp: it takes whatever vamp left unused
        // (both cap the combined heal at DAMAGE_LEECH_CAP_RATIO of the pre-shield damage).
        // Still requires the target to have survived the whole tick and the attacker alive.
        if (
          c.lifesteal_hp !== undefined &&
          c.lifesteal_hp >= 0 &&
          target.curHealth > 0 &&
          user.curHealth > 0
        ) {
          const remaining = Math.max(0, leechBudget - leechConsumed);
          const finalLifesteal = Math.min(c.lifesteal_hp, remaining);
          if (finalLifesteal > 0) {
            leechConsumed += finalLifesteal;
            user.curHealth += finalLifesteal;
            user.curHealth = Math.min(user.maxHealth, user.curHealth);
            actionEffects.push({
              txt: `${user.username} steals ${finalLifesteal.toFixed(2)} damage as health`,
              color: "green",
            });
          }
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
          creditDamageDealt(damageCreditUser, target, c.drain_hp);
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
          creditDamageDealt(damageCreditUser, target, c.poison);
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

  // Grant the accumulated consume shields: one effect and one log line per attacker,
  // sized off the total pre-shield damage the action dealt across every target.
  consumeShieldByUser.forEach(({ hp, rounds }, userId) => {
    const user = newUsersState.find((u) => u.userId === userId);
    if (!user || user.curHealth <= 0) return;
    const shieldHp = Math.floor(hp);
    if (shieldHp <= 0) return;
    newUsersEffects.push(
      createConsumeShieldEffect(user, shieldHp, rounds, battle.round),
    );
    actionEffects.push({
      txt: `${user.username} consumes ${shieldHp} damage as a shield for ${rounds} rounds`,
      color: "blue",
    });
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
  // Derive damage config from battle state (with fallback for older battles)
  const config = battle.extraState.dmgConfig ?? defaultDmgConfig;
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
      effect.fromType === "sageMode" ||
      effect.fromType === "sageModeAfter" ||
      isPreBattleGearFromType(effect.fromType);
  // Special cases
  if (
    BARRIER_DAMAGE_TAG_TYPES.has(effect.type) &&
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
        // Record the APPLIED (resolved, ratio>0) tag type for the tag_usage_win tracker.
        // The damage-modifier loop in applyEffects records the same way past its preventInfo
        // guard, so both write sites share recordUsedTag's single definition of "applied".
        recordUsedTag(newUsersState, newUser, effect.type);
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
        } else if (effect.type === "increasemastery") {
          info = increaseMastery(effect, newUsersEffects, curTarget);
        } else if (effect.type === "decreasemastery") {
          info = decreaseMastery(effect, newUsersEffects, curTarget);
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
        } else if (effect.type === "vamp") {
          info = vamp(effect, usersEffects, consequences, curTarget);
        } else if (effect.type === "consume") {
          info = consume(effect, consequences);
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
        } else if (effect.type === "disarm") {
          info = disarm(effect, usersEffects, curTarget);
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
        } else if (effect.type === "activatesagemode") {
          info = applyActivateSageMode(
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
            newTarget,
          );
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
        if (effect.type !== "activatesagemode") {
          updateStatUsage(newTarget, effect, true);
        }
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

// ─── Consolidated damage modifier pipeline (battle damage packets) ─────────────

export type { PreBattleGearModifiers };

export const emptyPreBattleGearModifiers = (): PreBattleGearModifiers => ({
  incDamageGivenFromGear: 0,
  incDamageTakenFromGear: 0,
  drTakenFromGear: 0,
  drGivenFromGear: 0,
  incDamageGivenFromKeystone: 0,
  incDamageTakenFromKeystone: 0,
  drTakenFromKeystone: 0,
  drGivenFromKeystone: 0,
});

/** Armor/accessory/keystone percentage mods fold into preBattleGearModifiers at battle start. */
export const isConsolidatedStage1PercentageModifier = (effect: UserEffect): boolean => {
  if (
    !damageBoostTypes.includes(effect.type) &&
    !damageReductionTypes.includes(effect.type)
  ) {
    return false;
  }
  if (!("fromType" in effect)) {
    return false;
  }
  const { fromType } = effect;
  if (!isPreBattleGearFromType(fromType) && !isPreBattleKeystoneFromType(fromType)) {
    return false;
  }
  return effect.calculation === "percentage";
};

/** True when percentage mods are folded into preBattleGearModifiers (not pipeline lists). */
const isPreBattleConsolidatedPercentageFromType = (
  fromType: string | undefined,
): boolean =>
  isPreBattleGearFromType(fromType) || isPreBattleKeystoneFromType(fromType);

/** Stage-1 percentage modifiers from skill/village/ranked stay in usersEffects for the pipeline. */
const isStage1NonGearPercentageModifier = (effect: UserEffect): boolean => {
  if (
    !damageBoostTypes.includes(effect.type) &&
    !damageReductionTypes.includes(effect.type)
  ) {
    return false;
  }
  if (getEffectStage(effect) !== 1 || effect.calculation !== "percentage") {
    return false;
  }
  if (
    "fromType" in effect &&
    isPreBattleConsolidatedPercentageFromType(effect.fromType)
  ) {
    return false;
  }
  return true;
};

const applyPercentageDrMultiplier = (damage: number, drFraction: number): number =>
  damage * Math.max(0, 1 - drFraction);

export const buildPreBattleGearModifiersForUser = (
  userEffects: UserEffect[],
  userId: string,
): PreBattleGearModifiers => {
  const mods = emptyPreBattleGearModifiers();

  for (const effect of userEffects) {
    if (effect.targetId !== userId) continue;
    if (!isConsolidatedStage1PercentageModifier(effect)) continue;

    const { power } = getPower(effect);
    const isKeystone =
      "fromType" in effect && isPreBattleKeystoneFromType(effect.fromType);
    if (effect.type === "increasedamagegiven") {
      if (isKeystone) mods.incDamageGivenFromKeystone += power;
      else mods.incDamageGivenFromGear += power;
    } else if (effect.type === "increasedamagetaken") {
      if (isKeystone) mods.incDamageTakenFromKeystone += power;
      else mods.incDamageTakenFromGear += power;
    } else if (effect.type === "decreasedamagetaken") {
      if (isKeystone) mods.drTakenFromKeystone += Math.abs(power);
      else mods.drTakenFromGear += Math.abs(power);
    } else if (effect.type === "decreasedamagegiven") {
      if (isKeystone) mods.drGivenFromKeystone += Math.abs(power);
      else mods.drGivenFromGear += Math.abs(power);
    }
  }

  return mods;
};

export const consolidatePreBattleDamageModifiers = (
  userEffects: UserEffect[],
  userIds: string[],
): {
  preBattleGearModifiers: Record<string, PreBattleGearModifiers>;
  filteredEffects: UserEffect[];
} => {
  const preBattleGearModifiers: Record<string, PreBattleGearModifiers> = {};
  for (const userId of userIds) {
    preBattleGearModifiers[userId] = buildPreBattleGearModifiersForUser(
      userEffects,
      userId,
    );
  }

  const filteredEffects = userEffects.filter(
    (e) => !isConsolidatedStage1PercentageModifier(e),
  );

  return { preBattleGearModifiers, filteredEffects };
};

const isBloodlineDamageMod = (effect: UserEffect): boolean =>
  "fromType" in effect && effect.fromType === "bloodline";

const getActiveSealEffects = (usersEffects: UserEffect[]) =>
  usersEffects.filter((e) => e.type === "seal" && !e.isNew && isEffectActive(e));

/** Which packet id field to compare against effect.targetId (pair-dependent). */
type DamageModifierPacketSide = "attacker" | "defender";

export type DamageModifierEligibility = {
  targetId: string;
  increaseSide: DamageModifierPacketSide | null;
  decreaseSide: DamageModifierPacketSide | null;
  /** Set when prevent RNG blocks the modifier; reused for combat log (no second roll). */
  preventInfo?: ActionEffect;
};

/** Pair-independent timing + modifier type; built once per performAction round. */
export const buildDamageModifierEligibilityById = (
  usersEffects: UserEffect[],
  battleRound: number,
  usersStateById?: Map<string, BattleUserState>,
): Map<string, DamageModifierEligibility> => {
  const eligibilityById = new Map<string, DamageModifierEligibility>();
  const roundCtx = { round: battleRound };

  for (const effect of usersEffects) {
    const isBoost = damageBoostTypes.includes(effect.type);
    const isDr = damageReductionTypes.includes(effect.type);
    if (!isBoost && !isDr) continue;
    if (!isEffectActive(effect)) continue;

    // Same condition as adjustDamageGiven / adjustDamageTaken after applySingleEffect
    // assigns `effect.castThisRound = (startRound === curRound)`.
    const { startRound, curRound } = calcEffectRoundInfo(effect, roundCtx);
    const passesTiming = !effect.isNew && startRound !== curRound;

    const targetUser = usersStateById?.get(effect.targetId);
    const preventState = targetUser
      ? getDamageModifierPreventState(effect, usersEffects, targetUser)
      : { blocked: false, info: undefined };

    let increaseSide: DamageModifierPacketSide | null = null;
    let decreaseSide: DamageModifierPacketSide | null = null;
    if (passesTiming && !preventState.blocked) {
      if (effect.type === "increasedamagegiven") increaseSide = "attacker";
      else if (effect.type === "increasedamagetaken") increaseSide = "defender";
      if (effect.type === "decreasedamagegiven") decreaseSide = "attacker";
      else if (effect.type === "decreasedamagetaken") decreaseSide = "defender";
    }

    eligibilityById.set(effect.id, {
      targetId: effect.targetId,
      increaseSide,
      decreaseSide,
      preventInfo: preventState.info,
    });
  }

  return eligibilityById;
};

const modifierAppliesToDamagePacketPair = (
  eligibility: DamageModifierEligibility | undefined,
  attackerId: string,
  defenderId: string,
  kind: "increase" | "decrease",
): boolean => {
  if (!eligibility) return false;
  const side =
    kind === "increase" ? eligibility.increaseSide : eligibility.decreaseSide;
  if (!side) return false;
  const id = side === "attacker" ? attackerId : defenderId;
  return id === eligibility.targetId;
};

const allowBloodlineDamageModifier = (
  damageEffect: UserEffect,
  modEffect: UserEffect,
  power: number,
): boolean => {
  if (!isBloodlineDamageMod(modEffect)) return true;
  if (
    !("allowBloodlineDamageIncrease" in damageEffect) ||
    !("allowBloodlineDamageDecrease" in damageEffect)
  ) {
    return true;
  }
  if (power > 0 && !damageEffect.allowBloodlineDamageIncrease) return false;
  if (power < 0 && !damageEffect.allowBloodlineDamageDecrease) return false;
  return true;
};

const getSignedDrModifierPower = (effect: UserEffect): number => {
  const { power } = getPower(effect);
  if (effect.type === "decreasedamagetaken" || effect.type === "decreasedamagegiven") {
    return -Math.abs(power);
  }
  return power;
};

export type DamagePacketModifierLists = {
  stage1PreBattleIncreases: UserEffect[];
  inBattleIncreases: UserEffect[];
  stage1PreBattleDrEffects: UserEffect[];
  inCombatDrEffects: UserEffect[];
  staticIncEffects: UserEffect[];
  staticDrEffects: UserEffect[];
  bloodlineIncreases: UserEffect[];
  bloodlineDrEffects: UserEffect[];
};

/** Bucket damage modifiers once per attacker–defender pair (reuse across consequences). */
export const buildDamagePacketModifierLists = (
  usersEffects: UserEffect[],
  attackerId: string,
  defenderId: string,
  eligibilityById: Map<string, DamageModifierEligibility>,
): DamagePacketModifierLists => {
  const applies = (effect: UserEffect, kind: "increase" | "decrease") =>
    modifierAppliesToDamagePacketPair(
      eligibilityById.get(effect.id),
      attackerId,
      defenderId,
      kind,
    );

  const stage1PreBattleIncreases: UserEffect[] = [];
  const inBattleIncreases: UserEffect[] = [];
  const stage1PreBattleDrEffects: UserEffect[] = [];
  const inCombatDrEffects: UserEffect[] = [];
  const staticIncEffects: UserEffect[] = [];
  const staticDrEffects: UserEffect[] = [];
  const bloodlineIncreases: UserEffect[] = [];
  const bloodlineDrEffects: UserEffect[] = [];

  for (const effect of usersEffects) {
    const isBoost = damageBoostTypes.includes(effect.type);
    const isDr = damageReductionTypes.includes(effect.type);
    if (!isBoost && !isDr) continue;

    const isBloodline = isBloodlineDamageMod(effect);
    const isStatic = effect.calculation === "static";
    const isPercentage = effect.calculation === "percentage";

    if (isBoost && applies(effect, "increase")) {
      if (isStatic) {
        staticIncEffects.push(effect);
      } else if (isPercentage && isBloodline) {
        bloodlineIncreases.push(effect);
      } else if (isPercentage && isStage1NonGearPercentageModifier(effect)) {
        stage1PreBattleIncreases.push(effect);
      } else if (isPercentage && getEffectStage(effect) === 2 && !isBloodline) {
        inBattleIncreases.push(effect);
      }
      continue;
    }

    if (isDr && applies(effect, "decrease")) {
      if (isStatic) {
        staticDrEffects.push(effect);
      } else if (isPercentage && isBloodline) {
        bloodlineDrEffects.push(effect);
      } else if (isPercentage && isStage1NonGearPercentageModifier(effect)) {
        stage1PreBattleDrEffects.push(effect);
      } else if (isPercentage && getEffectStage(effect) !== 1 && !isBloodline) {
        inCombatDrEffects.push(effect);
      }
    }
  }

  stage1PreBattleIncreases.sort(sortEffects);
  inBattleIncreases.sort(sortEffects);
  stage1PreBattleDrEffects.sort(sortEffects);
  inCombatDrEffects.sort(sortEffects);
  staticIncEffects.sort(sortEffects);
  staticDrEffects.sort(sortEffects);
  bloodlineIncreases.sort(sortEffects);
  bloodlineDrEffects.sort(sortEffects);

  return {
    stage1PreBattleIncreases,
    inBattleIncreases,
    stage1PreBattleDrEffects,
    inCombatDrEffects,
    staticIncEffects,
    staticDrEffects,
    bloodlineIncreases,
    bloodlineDrEffects,
  };
};

type DamagePacketComputeContext = {
  rawDamage: number;
  damageEffect: UserEffect;
  usersEffects: UserEffect[];
  attackerId: string;
  defenderId: string;
  preBattleGearModifiers: Record<string, PreBattleGearModifiers>;
  battleRound: number;
  modifierLists?: DamagePacketModifierLists;
  sealEffects?: UserEffect[];
};

export const computeDamagePacket = (
  ctx: DamagePacketComputeContext,
): { damage: number } => {
  const {
    damageEffect,
    usersEffects,
    attackerId,
    defenderId,
    preBattleGearModifiers,
    battleRound,
  } = ctx;
  const modifierLists =
    ctx.modifierLists ??
    buildDamagePacketModifierLists(
      usersEffects,
      attackerId,
      defenderId,
      buildDamageModifierEligibilityById(usersEffects, battleRound),
    );
  const sealEffects = ctx.sealEffects ?? getActiveSealEffects(usersEffects);
  const attackerGear =
    preBattleGearModifiers[attackerId] ?? emptyPreBattleGearModifiers();
  const defenderGear =
    preBattleGearModifiers[defenderId] ?? emptyPreBattleGearModifiers();

  let damage = ctx.rawDamage;

  for (const effect of modifierLists.stage1PreBattleIncreases) {
    const ratio = getEfficiencyRatio(damageEffect, effect);
    if (ratio === 0) continue;
    const { power } = getPower(effect);
    damage *= 1 + (power / 100) * ratio;
  }

  const incPoints =
    OUT_OF_COMBAT_BASE_DAMAGE_INCREASE +
    attackerGear.incDamageGivenFromGear +
    defenderGear.incDamageTakenFromGear;
  damage *= 1 + incPoints / 100;

  for (const effect of modifierLists.inBattleIncreases) {
    const ratio = getEfficiencyRatio(damageEffect, effect);
    if (ratio === 0) continue;
    const { power } = getPower(effect);
    if (!allowBloodlineDamageModifier(damageEffect, effect, power)) continue;
    damage *= 1 + (power / 100) * ratio;
  }

  const baseDamageAfterBoosts = damage;

  const drPoints =
    OUT_OF_COMBAT_BASE_DAMAGE_REDUCTION +
    defenderGear.drTakenFromGear +
    attackerGear.drGivenFromGear;
  damage = applyPercentageDrMultiplier(damage, drPoints / 100);

  for (const effect of modifierLists.stage1PreBattleDrEffects) {
    const ratio = getEfficiencyRatio(damageEffect, effect);
    if (ratio === 0) continue;
    const power = getSignedDrModifierPower(effect);
    damage = applyPercentageDrMultiplier(damage, (Math.abs(power) / 100) * ratio);
  }

  for (const effect of modifierLists.inCombatDrEffects) {
    const ratio = getEfficiencyRatio(damageEffect, effect);
    if (ratio === 0) continue;
    const power = getSignedDrModifierPower(effect);
    if (!allowBloodlineDamageModifier(damageEffect, effect, power)) continue;
    damage = applyPercentageDrMultiplier(damage, (Math.abs(power) / 100) * ratio);
  }

  const baseDamageAfterSystemDr = applyPercentageDrMultiplier(
    baseDamageAfterBoosts,
    OUT_OF_COMBAT_BASE_DAMAGE_REDUCTION / 100,
  );
  const minDamage = baseDamageAfterSystemDr * (1 - DMG_REDUCTION_CAP);
  damage = Math.max(damage, minDamage);

  let totalStaticIncrease = 0;
  for (const effect of modifierLists.staticIncEffects) {
    if (sealCheck(effect, sealEffects)) continue;
    const ratio = getEfficiencyRatio(damageEffect, effect);
    if (ratio === 0) continue;
    const { power } = getPower(effect);
    if (
      isBloodlineDamageMod(effect) &&
      !allowBloodlineDamageModifier(damageEffect, effect, power)
    ) {
      continue;
    }
    totalStaticIncrease += power * ratio;
  }
  damage += totalStaticIncrease;

  let totalStaticReduction = 0;
  for (const effect of modifierLists.staticDrEffects) {
    if (sealCheck(effect, sealEffects)) continue;
    const ratio = getEfficiencyRatio(damageEffect, effect);
    if (ratio === 0) continue;
    const { power } = getPower(effect);
    totalStaticReduction += Math.abs(power) * ratio;
  }
  damage = Math.max(minDamage, damage - totalStaticReduction);

  const keystoneIncPoints =
    (attackerGear.incDamageGivenFromKeystone ?? 0) +
    (defenderGear.incDamageTakenFromKeystone ?? 0);
  damage *= 1 + keystoneIncPoints / 100;

  const keystoneDrPoints =
    (defenderGear.drTakenFromKeystone ?? 0) + (attackerGear.drGivenFromKeystone ?? 0);
  damage = applyPercentageDrMultiplier(damage, keystoneDrPoints / 100);
  damage = Math.max(minDamage, damage);

  for (const effect of modifierLists.bloodlineIncreases) {
    if (sealCheck(effect, sealEffects)) continue;
    const ratio = getEfficiencyRatio(damageEffect, effect);
    if (ratio === 0) continue;
    const { power } = getPower(effect);
    if (!allowBloodlineDamageModifier(damageEffect, effect, power)) continue;
    damage *= 1 + (power / 100) * ratio;
  }

  for (const effect of modifierLists.bloodlineDrEffects) {
    if (sealCheck(effect, sealEffects)) continue;
    const ratio = getEfficiencyRatio(damageEffect, effect);
    if (ratio === 0) continue;
    const power = getSignedDrModifierPower(effect);
    if (!allowBloodlineDamageModifier(damageEffect, effect, power)) continue;
    damage = applyPercentageDrMultiplier(damage, (Math.abs(power) / 100) * ratio);
  }

  return { damage: Math.max(minDamage, damage) };
};

export const applyDamageModifierPipelineToConsequences = ({
  consequences,
  usersEffects,
  extraState,
  battleRound,
  sealEffects: sealEffectsInput,
  eligibilityById: eligibilityByIdInput,
  usersStateById,
}: {
  consequences: Map<string, Consequence>;
  usersEffects: UserEffect[];
  extraState: ExtraState;
  battleRound: number;
  sealEffects?: UserEffect[];
  eligibilityById?: Map<string, DamageModifierEligibility>;
  /** @deprecated Prefer passing eligibilityById from applyEffects. */
  usersStateById?: Map<string, BattleUserState>;
}) => {
  const preBattleGearModifiers = extraState.preBattleGearModifiers ?? {};
  const sealEffects = sealEffectsInput ?? getActiveSealEffects(usersEffects);
  const effectById = new Map(usersEffects.map((e) => [e.id, e]));
  const eligibilityById =
    eligibilityByIdInput ??
    buildDamageModifierEligibilityById(usersEffects, battleRound, usersStateById);
  const modifierListsByPair = new Map<string, DamagePacketModifierLists>();

  for (const [effectId, consequence] of consequences) {
    const damageKey =
      consequence.damage !== undefined
        ? "damage"
        : consequence.residual !== undefined
          ? "residual"
          : undefined;
    if (!damageKey) continue;

    const dmgEffect = effectById.get(effectId);
    if (!dmgEffect) continue;

    const pairKey = `${consequence.userId}\0${consequence.targetId}`;
    let modifierLists = modifierListsByPair.get(pairKey);
    if (!modifierLists) {
      modifierLists = buildDamagePacketModifierLists(
        usersEffects,
        consequence.userId,
        consequence.targetId,
        eligibilityById,
      );
      modifierListsByPair.set(pairKey, modifierLists);
    }

    const rawDamage = consequence[damageKey] ?? 0;
    const { damage } = computeDamagePacket({
      rawDamage,
      damageEffect: dmgEffect,
      usersEffects,
      attackerId: consequence.userId,
      defenderId: consequence.targetId,
      preBattleGearModifiers,
      battleRound,
      modifierLists,
      sealEffects,
    });

    consequence[damageKey] = damage;
    consequence.baseDamageForModifiers ??= rawDamage;
  }
};

/**
 * Realize authored sage tags for activation (`sageMode`) or exhaustion
 * (`sageModeAfter`). Lasting tags take `rounds` from the SageMode row and are
 * backdated one round so they tick on the current apply pass. `rounds === 0`
 * stays a one-shot and is not overwritten.
 *
 * @param props.tags - Catalog `effects`, `level2Effects`, or `afterEffects`.
 * @param props.user - Actor who owns the mode (also the tag target).
 * @param props.fromType - Source used by clear/copy/mirror exclusions.
 * @param props.rounds - `activationRounds` or `afterEffectRounds`.
 * @param props.actionId - Activation jutsu id, or `"sageModeAfter"`.
 * @param props.level - Combat level from `getActiveSageLevel` (scales `powerPerLevel`).
 * @param props.battle - Current battle (round + extra state).
 */
function realizeSageTags(props: {
  tags: unknown[];
  user: BattleUserState;
  fromType: "sageMode" | "sageModeAfter";
  rounds: number;
  actionId: string;
  level: number;
  battle: CompleteBattle;
}): UserEffect[] {
  const { tags, user, fromType, rounds, actionId, level, battle } = props;
  const sorted = [...tags].sort((a, b) =>
    sortEffects(a as UserEffect, b as UserEffect),
  );
  return sorted.map((raw) => {
    const tag = structuredClone(raw) as UserEffect;
    const realized = realizeTag({
      tag,
      user,
      actionId,
      target: user,
      level,
      round: battle.round,
      battle,
    });
    realized.longitude = user.longitude;
    realized.latitude = user.latitude;
    realized.fromType = fromType;
    realized.targetId = user.userId;
    if (realized.rounds !== 0) {
      realized.rounds = rounds;
      realized.timeTracker = {};
      realized.createdRound = Math.max(0, battle.round - 1);
    }
    realized.isNew = false;
    realized.castThisRound = false;
    return realized;
  });
}

/**
 * Charge activation pools and apply the equipped mode's `effects` (plus
 * `level2Effects` at combat level 2). Only the injected Activation jutsu
 * (`SAGE_MODE_ACTIVATION_JUTSU_ID`) may call this; authored jutsu/items are
 * rejected by `SuperRefineEffects` and again here.
 *
 * @returns Combat-log line, or a gray refusal if a guard fails.
 */
function applyActivateSageMode(
  consequences: Map<string, Consequence>,
  newUsersState: BattleUserState[],
  newUsersEffects: UserEffect[],
  newGroundEffects: GroundEffect[],
  actionEffects: ActionEffect[],
  appliedEffects: Set<string>,
  battle: CompleteBattle,
  actorId: string,
  effect: UserEffect,
  action: CombatAction | undefined,
  newTarget: BattleUserState,
): ActionEffect | undefined {
  if (effect.actionId !== SAGE_MODE_ACTIVATION_JUTSU_ID) {
    return {
      txt: "Sage mode can only be activated through the Activation action",
      color: "gray",
    };
  }
  if (effect.targetId !== actorId) {
    return { txt: "Sage mode can only be activated on yourself", color: "gray" };
  }
  if (SAGE_MODE_DISABLED_BATTLES.includes(battle.battleType)) {
    return { txt: "Sage mode cannot be used in this battle type", color: "gray" };
  }
  const sageModeId = newTarget.sageModeId;
  if (!sageModeId) {
    return { txt: `${newTarget.username} has no sage mode equipped`, color: "gray" };
  }
  const sageMode: SageMode | undefined = (battle.extraState.sageModes ?? {})[
    sageModeId
  ];
  if (!sageMode) {
    return { txt: "Sage mode data is missing", color: "gray" };
  }
  if (newTarget.sageModeActivated) {
    return { txt: `${newTarget.username} is already in sage mode`, color: "gray" };
  }
  if (newTarget.sageModeUsedThisBattle) {
    return { txt: "Sage mode can only be used once per battle", color: "gray" };
  }
  if (
    (newTarget.dailySageActivations ?? 0) >=
    getSageDailyCap(newTarget.sageMasteryExperience)
  ) {
    return {
      txt: "You have reached today's sage mode activation limit",
      color: "gray",
    };
  }

  // "Active Duration (rounds)" on the SageMode row (`activationRounds`) — duration for all sage effects.
  const activeDurationRounds = sageMode.activationRounds;

  const { cpCost, spCost } = getSageModeActivationCost(
    sageMode,
    newTarget.maxChakra,
    newTarget.maxStamina,
  );
  if (newTarget.curChakra < cpCost || newTarget.curStamina < spCost) {
    return {
      txt: `${newTarget.username} does not have enough chakra or stamina to enter sage mode`,
      color: "gray",
    };
  }

  newTarget.curChakra = Math.max(0, newTarget.curChakra - cpCost);
  newTarget.curStamina = Math.max(0, newTarget.curStamina - spCost);

  newTarget.sageModeActivated = true;
  newTarget.sageModeUsedThisBattle = true;
  newTarget.dailySageActivations = (newTarget.dailySageActivations ?? 0) + 1;
  newTarget.sageModeActivatedRound = battle.round;
  newTarget.sageModeExpiresRound = battle.round + activeDurationRounds;

  const activeLevel = getActiveSageLevel(newTarget.sageMasteryExperience, sageMode);
  // At level 2, level2Effects apply IN ADDITION to base effects; sort together so
  // ordering-sensitive tags (shields before damage, etc.) interleave correctly.
  const activeEffects =
    activeLevel >= SAGE_MODE_MAX_LEVEL
      ? [...sageMode.effects, ...(sageMode.level2Effects ?? [])]
      : sageMode.effects;
  for (const realized of realizeSageTags({
    tags: activeEffects,
    user: newTarget,
    fromType: "sageMode",
    rounds: activeDurationRounds,
    actionId: effect.actionId,
    level: activeLevel,
    battle,
  })) {
    applySingleEffect(
      consequences,
      newUsersState,
      newUsersEffects,
      newGroundEffects,
      actionEffects,
      appliedEffects,
      battle,
      actorId,
      realized,
      action,
    );
  }

  return {
    txt: `${newTarget.username} enters sage mode`,
    color: "green",
  };
}

/**
 * After a round advances: once `sageModeExpiresRound` (activation round +
 * `activationRounds`) has elapsed, queue lasting `afterEffects` and resolve
 * instant ones immediately. Falls back to "any lasting sage buff still active"
 * when expiry was never tracked. Also prunes spent active/exhaustion auras.
 *
 * Instant after-effects cannot wait for the next `applyEffects` actor — they
 * are queued with `isNew=false` and would be dropped if that actor is not the sage.
 *
 * @param battle - Live battle mutated in place.
 */
export function applySageModeAfterRoundTransition(battle: CompleteBattle): void {
  // Prune exhaustion-phase auras whose rounds have run out (visuals otherwise persist).
  battle.usersEffects = battle.usersEffects.filter(
    (e) =>
      !(e.type === "visual" && e.fromType === "sageModeAfter" && !isEffectActive(e)),
  );

  battle.usersState.forEach((u) => {
    if (!u.sageModeActivated) return;

    // The active window is duration-driven: honor the full `activationRounds` window via
    // `sageModeExpiresRound` even when no lasting buff remains (a mode whose active effects
    // are all instant would otherwise collapse into exhaustion the next round).
    if (u.sageModeExpiresRound != null) {
      if (battle.round < u.sageModeExpiresRound) return;
    } else {
      // Fallback for battle state activated before `sageModeExpiresRound` was tracked:
      // stay active while any lasting sage buff is still present.
      const activeSageFx = battle.usersEffects.filter(
        (e) => e.fromType === "sageMode" && e.targetId === u.userId,
      );
      if (activeSageFx.some((e) => isEffectActive(e))) return;
    }

    const sageModeId = u.sageModeId;
    const sageMode: SageMode | undefined = sageModeId
      ? (battle.extraState.sageModes ?? {})[sageModeId]
      : undefined;

    const afterRounds = sageMode?.afterEffectRounds ?? 0;

    if (afterRounds > 0 && sageMode?.afterEffects?.length) {
      const realized = realizeSageTags({
        tags: sageMode.afterEffects,
        user: u,
        fromType: "sageModeAfter",
        rounds: afterRounds,
        actionId: "sageModeAfter",
        level: getActiveSageLevel(u.sageMasteryExperience, sageMode),
        battle,
      });
      // Lasting tags stay queued for the normal apply pipeline. Instant tags
      // (rounds === 0) must resolve now: the next applyEffects actor is often
      // not the sage, and isNew=false + isTargetOrNew would drop them.
      const lasting = realized.filter((tag) => tag.rounds !== 0);
      const instant = realized.filter((tag) => tag.rounds === 0);
      battle.usersEffects.push(...lasting);
      if (instant.length > 0) {
        applyInstantSageAfterEffects(battle, u.userId, instant);
      }
    }

    // Sage mode is spent for the rest of the battle. `u` is a live element of
    // `battle.usersState` (never reassigned here), so mutate it directly.
    u.sageModeUsedThisBattle = true;
    u.sageModeActivated = false;
    u.sageModeActivatedRound = null;
    u.sageModeExpiresRound = null;

    // The active aura is a `visual` effect that bypasses normal round expiry
    // (applySingleEffect re-pushes visuals unconditionally). Remove it now that the
    // active phase is over; the exhaustion phase gets its own visual from afterEffects.
    battle.usersEffects = battle.usersEffects.filter(
      (e) =>
        !(e.type === "visual" && e.fromType === "sageMode" && e.targetId === u.userId),
    );
  });
}

/**
 * Run one-shot (`rounds === 0`) exhaustion tags through `applySingleEffect` with
 * the sage as actor, then fold heal/damage/drain onto pools. Lasting tags must
 * not be passed here — they stay queued on `usersEffects`.
 *
 * @param battle - Live battle mutated in place.
 * @param sageUserId - Actor/target for the after-effects.
 * @param instant - Realized tags whose `rounds === 0`.
 */
function applyInstantSageAfterEffects(
  battle: CompleteBattle,
  sageUserId: string,
  instant: UserEffect[],
) {
  const consequences = new Map<string, Consequence>();
  const newUsersEffects: UserEffect[] = [];
  const newGroundEffects: GroundEffect[] = [];
  const actionEffects: ActionEffect[] = [];
  const appliedEffects = new Set<string>();
  for (const tag of instant) {
    applySingleEffect(
      consequences,
      battle.usersState,
      newUsersEffects,
      newGroundEffects,
      actionEffects,
      appliedEffects,
      battle,
      sageUserId,
      tag,
    );
  }
  battle.usersEffects.push(...newUsersEffects);
  battle.groundEffects.push(...newGroundEffects);
  consequences.forEach((c) => {
    const target = battle.usersState.find((user) => user.userId === c.targetId);
    if (!target) return;
    if (c.heal_hp !== undefined && c.heal_hp >= 0 && target.curHealth > 0) {
      target.curHealth = Math.min(target.maxHealth, target.curHealth + c.heal_hp);
    }
    if (c.heal_sp !== undefined && c.heal_sp >= 0) {
      target.curStamina = Math.min(target.maxStamina, target.curStamina + c.heal_sp);
    }
    if (c.heal_cp !== undefined && c.heal_cp >= 0) {
      target.curChakra = Math.min(target.maxChakra, target.curChakra + c.heal_cp);
    }
    if (c.damage !== undefined && c.damage >= 0) {
      target.curHealth = Math.max(0, target.curHealth - c.damage);
    }
    if (c.drain_hp !== undefined && c.drain_hp >= 0) {
      target.curHealth = Math.max(0, target.curHealth - c.drain_hp);
    }
    if (c.drain_cp !== undefined && c.drain_cp >= 0) {
      target.curChakra = Math.max(0, target.curChakra - c.drain_cp);
    }
    if (c.drain_sp !== undefined && c.drain_sp >= 0) {
      target.curStamina = Math.max(0, target.curStamina - c.drain_sp);
    }
  });
}

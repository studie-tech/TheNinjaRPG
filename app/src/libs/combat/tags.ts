import { noCase } from "change-case";
import { nanoid } from "nanoid";
import type {
  BasicElement,
  BattleType,
  ElementName,
  GeneralType,
  MasteryType,
  PoolType,
  StatType,
} from "@/drizzle/constants";
import {
  COPY_MAX_TAGS,
  COPY_PRIORITY_RANK,
  COPYABLE_EFFECT_TYPES,
  ELEMENTAL_SEAL_AP_COST,
  MIRROR_EXCLUDED_EFFECT_TYPES,
  MIRROR_MAX_TAGS,
  MIRROR_PRIORITY_RANK,
  PERSISTENT_EFFECT_SOURCE_TYPES,
  SAGE_MODE_ACTIVATION_JUTSU_ID,
  TEMPORAL_AP_DELTA,
  TRANSFER_EXCLUDED_SOURCE_TYPES,
} from "@/drizzle/constants";
import type { Battle } from "@/drizzle/schema";
import {
  AFTERBURN_CAP_RATIO,
  damageDerivedTagTypes,
  damageModifierTypes,
} from "@/libs/combat/constants";
import {
  getPreferredDamageElement,
  resolveElementalDamage,
} from "@/libs/combat/elementalDamage";
import { storeMasteryBases } from "@/libs/combat/mastery";
import { getPotencyDescription } from "@/libs/combat/potency";
import { getEffectPower } from "@/libs/combat/power";
import {
  shouldPilotSummon,
  summonCastBlockedReason,
  summonsAllowedInBattle,
} from "@/libs/combat/summon";
import type { CombatAction } from "@/libs/combat/types";
import {
  applyPoolAdjustmentsToBase,
  calcPoolCost,
  canStackEffect,
  getActiveSealEffects,
  getActiveTargetEffects,
  getBaseDamageForModifier,
  getEffectiveMaxPool,
  getEffectStackKey,
  getPoolsAffected,
  getPreventTypeName,
  isEffectActive,
  isEffectEnabled,
  sealCheck,
  selectTransferEffects,
  sortEffects,
} from "@/libs/combat/util";
import { oddQHexDistance, oddQLineStep } from "@/libs/hexgrid";
import { MASTERY_TYPE_TO_STAT } from "@/libs/mastery";
import { calcHP, type StatScale, scaleUserStats } from "@/libs/profile";
import { clamp } from "@/utils/math";
import { capitalizeFirstLetter } from "@/utils/string";
import type {
  PreventTagType,
  ShieldTagType,
  WeaknessTagType,
} from "@/validators/combat";
import {
  HealTag,
  isNegativeUserEffect,
  isPositiveUserEffect,
} from "@/validators/combat";
import type { DmgConfig, GenName, GenNames } from "./constants";
import type {
  ActionEffect,
  BattleEffect,
  BattleUserState,
  Consequence,
  GroundEffect,
  ReturnedBattle,
  ReturnedUserState,
  ShieldConversionsByUser,
  UserEffect,
} from "./types";

/**
 * Minimal user type for realizeTag - only includes fields actually used
 */
type RealizeTagUser = Pick<
  ReturnedUserState,
  "userId" | "villageId" | "highestGenerals"
> & {
  preferredDamageElement?: BasicElement | null;
  primaryElement?: ElementName | null;
};

/**
 * Realize tag with information about how powerful tag is
 */
export const realizeTag = <T extends BattleEffect>(props: {
  tag: T;
  user: RealizeTagUser;
  actionId: string;
  level: number | undefined;
  round?: number;
  barrierAbsorb?: number;
}): T => {
  const { user, level, round, barrierAbsorb } = props;
  // Passive effects also enter here without passing through action selection or insertion.
  const tag = resolveElementalDamage(props.tag, user) as T;
  if ("rounds" in tag || tag.type === "increaseaggro" || tag.type === "decreaseaggro") {
    tag.timeTracker = {};
  }
  // Older catalog JSON uses Highest as an unclassified marker; it never resolves from mastery.
  if ("statTypes" in tag) {
    tag.statTypes = tag.statTypes?.map((type) =>
      (type as string) === "Highest" ? "None" : type,
    );
  }
  tag.id = nanoid();
  tag.createdRound = round || 0;
  tag.creatorId = user.userId;
  tag.villageId = user.villageId;
  tag.targetType = "user";
  tag.level = level ?? 0;
  tag.isNew = true;
  tag.castThisRound = true;
  tag.highestGenerals = user.highestGenerals;
  tag.barrierAbsorb = barrierAbsorb || 0;
  tag.actionId = props.actionId;
  if ("maxHealth" in tag && "curHealth" in tag) {
    if (tag.curHealth > tag.maxHealth) {
      tag.curHealth = tag.maxHealth;
    }
  }
  return structuredClone(tag);
};

/** Mark a realized tag as already active on its target, so processing does not recast it. */
export const markPassiveEffect = <T extends UserEffect>(
  realized: T,
  targetId: string,
  fromType: UserEffect["fromType"],
): T => {
  realized.isNew = false;
  realized.castThisRound = false;
  realized.targetId = targetId;
  realized.fromType = fromType;
  return realized;
};

/** Realize an authored tag as a passive effect, by default on the realizing user. */
export const realizePassiveEffect = ({
  targetId,
  fromType,
  ...props
}: Parameters<typeof realizeTag<UserEffect>>[0] & {
  targetId?: string;
  fromType: UserEffect["fromType"];
}) => markPassiveEffect(realizeTag(props), targetId ?? props.user.userId, fromType);

/** Consequence key suffix and maximum-pool field of each combat pool. */
const POOL_FIELDS = {
  Health: { suffix: "hp", max: "maxHealth" },
  Stamina: { suffix: "sp", max: "maxStamina" },
  Chakra: { suffix: "cp", max: "maxChakra" },
} as const;

/** Pools named by an absorb or drain tag. An authored empty list selects no pool. */
const getTagPools = (effect: UserEffect) =>
  "poolsAffected" in effect && effect.poolsAffected
    ? (effect.poolsAffected as PoolType[])
    : (["Health"] as PoolType[]);

/** Absorb damage & convert it to healing */
export const absorb = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  consequences: Map<string, Consequence>,
  target: BattleUserState,
) => {
  // Prevent?
  const { pass } = preventCheck(usersEffects, "healprevent", target, effect);
  if (!pass) return preventResponse(effect, target, "cannot absorb health");
  // Calculate absorption
  const { power, qualifier } = getPower(effect);
  // Pools that are going to be restored
  const pools = getTagPools(effect);
  const nPools = pools.length;
  // Apply the absorb effect the round after the effect is applied
  if (!effect.isNew && !effect.castThisRound) {
    consequences.forEach((consequence, effectId) => {
      const incomingDamage = consequence.diffuseImmediateDamage ?? consequence.damage;
      if (
        consequence.targetId === effect.targetId &&
        incomingDamage &&
        incomingDamage > 0
      ) {
        const damageEffect = usersEffects.find(
          (e) => e.id === (consequence.diffuseSourceEffectId ?? effectId),
        );
        if (damageEffect) {
          const ratio = getEfficiencyRatio(damageEffect, effect);
          // Calculate absorption amount for this effect
          const absorbAmount =
            effect.calculation === "percentage"
              ? incomingDamage * (power / 100)
              : Math.min(power, incomingDamage);
          const convert = Math.ceil(absorbAmount * ratio);

          // Apply absorption to each pool
          pools.forEach((pool) => {
            // Add to existing absorb value instead of overwriting
            const key = `absorb_${POOL_FIELDS[pool].suffix}` as const;
            consequence[key] = (consequence[key] || 0) + convert / nPools;
          });
        }
      }
    });
  }
  // Return info
  return getInfo(
    target,
    effect,
    `will absorb up to ${qualifier} damage and convert it to ${pools.join(", ")}`,
  );
};

/**
 * Check if an immunity effect blocks a prevent effect.
 * Only checks immunity for NEW effects being applied.
 * Returns an ActionEffect if blocked, undefined if not blocked.
 */
const checkPreventImmunity = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  target: BattleUserState,
  preventName: string,
): ActionEffect | undefined => {
  if (effect.isNew) {
    const hasImmunity = usersEffects.some(
      (e) =>
        e.type === "immunity" &&
        e.targetId === target.userId &&
        isEffectEnabled(e, usersEffects) &&
        "blocks" in e &&
        e.blocks === effect.type,
    );
    if (hasImmunity) {
      effect.rounds = 0;
      return {
        txt: `${target.username}'s immunity blocked ${preventName} prevention!`,
        color: "blue" as const,
      };
    }
  }
  return undefined;
};

/** Player-facing wording of each prevent status: immunity label, active and failed text. */
const PREVENT_TAG_TEXT: Record<
  PreventTagType,
  { label: string; active: string; failed: string }
> = {
  buffprevent: {
    label: "buff",
    active: "cannot be buffed",
    failed: "could not be prevented from buffs",
  },
  debuffprevent: {
    label: "debuff",
    active: "cannot be debuffed",
    failed: "could not be prevented from debuffs",
  },
  fleeprevent: {
    label: "flee",
    active: "cannot flee",
    failed: "could not be prevented from fleeing",
  },
  healprevent: {
    label: "heal",
    active: "cannot be healed",
    failed: "could not be prevented from healing",
  },
  moveprevent: {
    label: "movement",
    active: "cannot move",
    failed: "could not be prevented from moving",
  },
  onehitkillprevent: {
    label: "one-hit-kill",
    active: "cannot be one-hit-killed",
    failed: "could not be prevented from one-hits",
  },
  robprevent: {
    label: "rob",
    active: "cannot be robbed",
    failed: "could not be prevented from being robbed",
  },
  cleanseprevent: {
    label: "cleanse",
    active: "cannot be cleansed",
    failed: "could not be prevented from cleansing",
  },
  clearprevent: {
    label: "clear",
    active: "cannot be cleared",
    failed: "could not be prevented from being cleared",
  },
  sealprevent: {
    label: "seal",
    active: "bloodline cannot be sealed",
    failed: "could not be prevented from being sealed",
  },
  stunprevent: {
    label: "stun",
    active: "cannot be stunned",
    failed: "could not be prevented from being stunned",
  },
  summonprevent: {
    label: "summon",
    active: "cannot summon companions",
    failed: "could not be prevented from summoning",
  },
  disarm: {
    label: "disarm",
    active: "cannot use weapons",
    failed: "could not be disarmed",
  },
};

type PreventEffect = Extract<UserEffect, { type: PreventTagType }>;

/** Narrows an effect to the prevent statuses resolved by `applyPreventTag`. */
export const isPreventEffect = (effect: UserEffect): effect is PreventEffect =>
  effect.type in PREVENT_TAG_TEXT;

/**
 * Resolve a prevent status: immunity cancels a new one, a passed roll latches it at
 * full power, and a failed roll ends a new one.
 */
export const applyPreventTag = (
  effect: PreventEffect,
  usersEffects: UserEffect[],
  target: BattleUserState,
): ActionEffect | undefined => {
  const { label, active, failed } = PREVENT_TAG_TEXT[effect.type];
  const immunityBlocked = checkPreventImmunity(effect, usersEffects, target, label);
  if (immunityBlocked) return immunityBlocked;
  const { power } = getPower(effect);
  const mainCheck = Math.random() < power / 100;
  if (mainCheck) {
    const info = getInfo(target, effect, active);
    effect.power = 100;
    return info;
  } else if (effect.isNew) {
    effect.rounds = 0;
    return { txt: `${target.username} ${failed}`, color: "blue" };
  }
};

/** Type-axis predicate for the effects the `copy` tag may transfer and produce. */
const isCopyableEffect = (e: UserEffect): boolean =>
  isPositiveUserEffect(e) && COPYABLE_EFFECT_TYPES.has(e.type);

/** Type-axis predicate for the effects the `mirror` tag may transfer and produce. */
const isMirrorableEffect = (e: UserEffect): boolean =>
  isNegativeUserEffect(e) && !MIRROR_EXCLUDED_EFFECT_TYPES.has(e.type);

/**
 * Shared candidate gate for a transfer source effect: not from a passive/gear
 * origin, not ground-derived (the carry-forward pass drops `fromGround` effects at
 * end of round, so a clone would vanish while still consuming a capped slot), not
 * a source already transferred, still active, and not depleted (a fully absorbed
 * shield keeps rounds > 0 at power 0 — transferring it would burn a slot for nothing).
 */
const isTransferCandidate = (e: UserEffect, heldSourceIds: Set<string>): boolean =>
  !TRANSFER_EXCLUDED_SOURCE_TYPES.has(e.fromType || "") &&
  !e.fromGround &&
  !heldSourceIds.has(e.id) &&
  isEffectActive(e) &&
  Math.abs(getPower(e).power) > 0;

/**
 * Shared budget accounting for the copy/mirror transfer tags. Counts the caster's
 * ACTIVE transferred clones on `landingId` — the persistent, per-caster ceiling —
 * scoped by the same type predicate that gates the tag's candidates, so the budget
 * counts exactly what the tag can produce and no other tag's fromEffectId-bearing
 * effects can consume its slots. Clones always carry numeric rounds (the tag gate
 * requires effect.rounds), so undefined-rounds effects are never clones.
 */
const getTransferBudget = (
  usersEffects: UserEffect[],
  landingId: string,
  creatorId: string,
  isTransferable: (e: UserEffect) => boolean,
  cap: number,
) => {
  const active = usersEffects.filter(
    (e) =>
      e.targetId === landingId &&
      e.creatorId === creatorId &&
      e.fromEffectId &&
      isTransferable(e) &&
      e.rounds !== undefined &&
      e.rounds > 0,
  );
  return {
    heldSourceIds: new Set(active.map((e) => e.fromEffectId!)),
    remaining: cap - active.length,
  };
};

/**
 * Clones the selected transfer effects onto `landingId` as newly-cast effects
 * created by `creatorId`, pushes them into `usersEffects`, and returns a display
 * description per transferred effect.
 */
const applyTransferClones = (
  selected: UserEffect[],
  usersEffects: UserEffect[],
  tagEffect: UserEffect,
  landingId: string,
  creatorId: string,
): string[] =>
  selected.map((source) => {
    const clone = structuredClone(source);
    delete clone.curseState;
    clone.id = nanoid();
    clone.fromEffectId = source.id;
    clone.targetId = landingId;
    clone.creatorId = creatorId;
    clone.rounds = tagEffect.rounds;
    clone.isNew = true;
    clone.castThisRound = true;
    clone.createdRound = tagEffect.createdRound;
    usersEffects.push(clone);
    return `${source.type} (${getPower(source).qualifier})`;
  });

/** Copy positive effects from opponent to self (priority-ranked, capped by instance) */
export const copy = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  user: BattleUserState,
  target: BattleUserState,
): ActionEffect | undefined => {
  // Self-targeting is a degenerate no-op (copying your own buffs onto yourself).
  // It also keeps the copy/mirror budgets isolated: when caster === target the two
  // tags' clones share the same identity and would cross-count against each other's
  // ceiling, so skip it at the source — but tell the player, since the action was spent.
  if (user.userId === target.userId) {
    return {
      txt: `${user.username} cannot copy effects from themselves.`,
      color: "blue",
    };
  }

  // Check if copy is prevented
  const { pass } = preventCheck(usersEffects, "buffprevent", user, effect);
  if (!pass) return preventResponse(effect, user, "cannot copy effects");

  // Calculate chance of success
  const { power } = getPower(effect);
  const primaryCheck = Math.random() < power / 100;
  if (effect.isNew && effect.rounds && effect.castThisRound) {
    if (primaryCheck) {
      // Persistent, per-caster ceiling: count only the user's OWN active copies.
      // `creatorId` scoping keeps an opponent's mirror (which also lands on `user`
      // with a fromEffectId) out of the copy budget, and `isCopyableEffect` — the
      // same predicate that gates the candidates below — scopes the budget to
      // exactly what `copy` can produce.
      const { heldSourceIds, remaining } = getTransferBudget(
        usersEffects,
        user.userId,
        user.userId,
        isCopyableEffect,
        COPY_MAX_TAGS,
      );
      if (remaining <= 0) {
        return {
          txt: `${user.username} is already holding the maximum copied effects.`,
          color: "blue",
        };
      }

      const candidates = usersEffects.filter(
        (e) =>
          e.targetId === target.userId &&
          isCopyableEffect(e) &&
          isTransferCandidate(e, heldSourceIds),
      );

      const selected = selectTransferEffects(candidates, COPY_PRIORITY_RANK, remaining);

      if (selected.length === 0) {
        return {
          txt: `${user.username} tries to copy positive effects from ${target.username} but finds no copyable effects.`,
          color: "blue",
        };
      }

      const copiedEffects = applyTransferClones(
        selected,
        usersEffects,
        effect,
        user.userId,
        user.userId,
      );

      const effectsList = copiedEffects.join(", ");
      return {
        txt: `${user.username} copies ${selected.length} positive effect${selected.length === 1 ? "" : "s"} from ${target.username}: ${effectsList}`,
        color: "blue",
      };
    } else {
      return {
        txt: `${user.username} tries to copy positive effects from ${target.username} but fails.`,
        color: "blue",
      };
    }
  }
};

/** Mirror negative effects from self to target (priority-ranked, capped by instance) */
export const mirror = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  user: BattleUserState,
  target: BattleUserState,
): ActionEffect | undefined => {
  // Self-targeting is a degenerate no-op (reflecting your own debuffs onto yourself).
  // It also keeps the copy/mirror budgets isolated: when caster === target the two
  // tags' clones share the same identity and would cross-count against each other's
  // ceiling, so skip it at the source — but tell the player, since the action was spent.
  if (user.userId === target.userId) {
    return {
      txt: `${user.username} cannot mirror effects onto themselves.`,
      color: "blue",
    };
  }

  // Check if mirror is prevented
  const { pass } = preventCheck(usersEffects, "debuffprevent", target, effect);
  if (!pass)
    return preventResponse(effect, target, "cannot be debuffed with mirrored effects");

  // Calculate chance of success
  const { power } = getPower(effect);
  const primaryCheck = Math.random() < power / 100;
  if (effect.isNew && effect.rounds && effect.castThisRound) {
    if (primaryCheck) {
      // Persistent, per-caster ceiling: only this caster's active mirrors on the
      // target. The budget shares `isMirrorableEffect` with the candidate filter
      // below, so it counts exactly what `mirror` can produce — the same
      // construction as the copy budget's `isCopyableEffect` scope.
      const { heldSourceIds, remaining } = getTransferBudget(
        usersEffects,
        target.userId,
        user.userId,
        isMirrorableEffect,
        MIRROR_MAX_TAGS,
      );
      if (remaining <= 0) {
        return {
          txt: `${target.username} is already holding the maximum mirrored effects.`,
          color: "blue",
        };
      }

      // A mirrored drain is delivered at power / mirror-duration, so scale it
      // BEFORE selection: it must compete for a capped slot at the power it
      // actually delivers, not its source power. The level contribution is baked
      // into the scaled base power (flooring powerPerLevel separately would crush
      // fractional per-level scaling to 0). The shallow stand-in keeps the source
      // id — the clone's fromEffectId still points at the original — and is
      // deep-cloned by applyTransferClones before entering the battle state.
      const scaleDrainForMirror = (e: UserEffect): UserEffect => {
        if (e.type !== "drain") return e;
        const deliveredPower = Math.floor(
          (e.power + e.level * e.powerPerLevel) / (effect.rounds || 1),
        );
        return { ...e, power: deliveredPower, powerPerLevel: 0 };
      };

      const candidates = usersEffects
        .filter(
          (e) =>
            e.targetId === user.userId &&
            isMirrorableEffect(e) &&
            isTransferCandidate(e, heldSourceIds),
        )
        .map(scaleDrainForMirror);

      const selected = selectTransferEffects(
        candidates,
        MIRROR_PRIORITY_RANK,
        remaining,
      );

      if (selected.length === 0) {
        return {
          txt: `${user.username} tries to mirror negative effects onto ${target.username} but finds no negative effects to reflect.`,
          color: "blue",
        };
      }

      const mirroredEffects = applyTransferClones(
        selected,
        usersEffects,
        effect,
        target.userId,
        user.userId,
      );

      const effectsList = mirroredEffects.join(", ");
      return {
        txt: `${user.username} mirrors ${selected.length} negative effect${selected.length === 1 ? "" : "s"} onto ${target.username}: ${effectsList}`,
        color: "blue",
      };
    } else {
      return {
        txt: `${user.username} tries to mirror negative effects onto ${target.username} but fails.`,
        color: "blue",
      };
    }
  }
};

/** Inform user about injected jutsus */
export const injectjutsus = (
  effect: UserEffect,
  target: BattleUserState,
): ActionEffect | undefined => {
  if (effect.isNew) {
    return getInfo(target, effect, "gains temporary access to additional actions");
  }
  return undefined;
};

/**
 * Human-readable summary of what an effect affects.
 * @param effect - the effect to describe
 * Damage modifiers can match elements. Other stat tags describe unified Offence/Defence.
 */
export const getAffected = (effect: UserEffect) => {
  if (damageModifierTypes.includes(effect.type))
    return "elements" in effect && effect.elements?.length
      ? `${effect.elements.join(", ")} damage`
      : "all damage";
  const stats: string[] = [];
  if ("statTypes" in effect && effect.statTypes?.length) {
    const direction = "direction" in effect ? effect.direction : "both";
    if (direction === "offence" || direction === "both") stats.push("Offence");
    if (direction === "defence" || direction === "both") stats.push("Defence");
  }
  if ("masteryTypes" in effect && effect.masteryTypes) {
    stats.push(...effect.masteryTypes);
  }
  if ("generalTypes" in effect && effect.generalTypes) {
    effect.generalTypes.forEach((general: GeneralType) => {
      if (general === "Highest") {
        const highestGenerals = effect.highestGenerals;
        highestGenerals?.forEach((gen: (typeof GenNames)[number]) => {
          stats.push(capitalizeFirstLetter(gen));
        });
      } else {
        stats.push(general);
      }
    });
  }
  const uniqueStats = [...new Set(stats)];
  let result = `${uniqueStats.join(", ")}`;
  if ("elements" in effect && effect.elements && effect.elements.length > 0) {
    result += ` and elements ${effect.elements.join(", ")}`;
  }
  return result;
};

/**
 * Helper to apply a percentage stat modifier additively.
 * Uses baseStatsForModifiers to ensure additive stacking when multiple modifiers are applied.
 */
const applyPercentageStatModifier = (
  target: BattleUserState,
  statName: keyof NonNullable<BattleUserState["baseStatsForModifiers"]>,
  power: number,
) => {
  // Initialize baseStatsForModifiers if not present
  if (!target.baseStatsForModifiers) {
    target.baseStatsForModifiers = {};
  }
  // Store base stat value if not already stored
  if (target.baseStatsForModifiers[statName] === undefined) {
    target.baseStatsForModifiers[statName] = target[statName] as number;
  }
  // Use base stat for percentage calculation to ensure additive stacking
  const baseStat =
    target.baseStatsForModifiers[statName] ?? (target[statName] as number);
  const change = (power / 100) * baseStat;
  (target[statName] as number) = (target[statName] as number) + change;
};

/** Apply flat changes directly and stack percentage changes against saved base stats. */
const applyStatChange = (
  target: BattleUserState,
  stat: keyof NonNullable<BattleUserState["baseStatsForModifiers"]>,
  power: number,
  calculation: string,
) => {
  if (calculation === "static") {
    target[stat] += power;
  } else {
    applyPercentageStatModifier(target, stat, power);
  }
};

/** Adjust combat stats of target based on effect */
export const adjustStats = (effect: UserEffect, target: BattleUserState) => {
  const { power, adverb, qualifier } = getPower(effect);
  const affected = getAffected(effect);
  if ("statTypes" in effect || "generalTypes" in effect) {
    if (!effect.isNew && !effect.castThisRound) {
      if ("statTypes" in effect && effect.statTypes?.length) {
        if (effect.direction === "offence" || effect.direction === "both") {
          applyStatChange(target, "offence", power, effect.calculation);
        }
        if (effect.direction === "defence" || effect.direction === "both") {
          applyStatChange(target, "defence", power, effect.calculation);
        }
      }
      getLowerGenerals(effect.generalTypes, target.highestGenerals).forEach((gen) => {
        applyStatChange(target, gen as GenName, power, effect.calculation);
      });
    }
  }
  // Add direction information for increase/decrease stat effects
  let directionText = "";
  if (
    "direction" in effect &&
    effect.direction &&
    (effect.type === "increasestat" || effect.type === "decreasestat")
  ) {
    if (effect.direction === "both") {
      directionText = " [offense and defense]";
    } else {
      directionText = ` [${effect.direction}]`;
    }
  }
  return getInfo(
    target,
    effect,
    `${affected} is ${adverb} by ${qualifier}${directionText}`,
  );
};

export const increaseStats = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  target: BattleUserState,
) =>
  olderPreventResponse(effect, usersEffects, "buffprevent", target) ??
  adjustStats(effect, target);

// ---------------------------------------------
// Helper to adjust basic action attributes
// ---------------------------------------------
const adjustBasicAction = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  target: BattleUserState,
  opts: { attr: "range" | "cooldown"; isBuff: boolean },
): ActionEffect | undefined => {
  const { attr, isBuff } = opts;
  // Determine if blocked by (de)buff prevent
  const preventKind = isBuff ? "buffprevent" : "debuffprevent";
  const prevented = olderPreventResponse(effect, usersEffects, preventKind, target);
  if (prevented) return prevented;

  const { adverb, qualifier } = getPower(effect);
  const actionsAffected =
    "actionsAffected" in effect ? effect.actionsAffected : undefined;
  const affected = actionsAffected?.map((a) => noCase(a)).join(", ");

  // Compose description
  let verb: string;
  if (attr === "range") {
    verb = `range is ${adverb} by ${qualifier}`;
  } else {
    verb = isBuff
      ? `cooldown is reduced by ${qualifier}`
      : `cooldown is increased by ${qualifier}`;
  }

  return getInfo(
    target,
    effect,
    `basic action${affected ? `s [${affected}]` : ""} ${verb}`,
  );
};

/** Activate a potency buff/debuff; its power is consumed by subsequent casts. */
export const potency = (
  effect: Extract<UserEffect, { type: "increasepotency" | "decreasepotency" }>,
  usersEffects: UserEffect[],
  target: BattleUserState,
): ActionEffect | undefined => {
  if (!effect.isNew) return undefined;
  const isIncrease = effect.type === "increasepotency";
  const { pass } = preventCheck(
    usersEffects,
    isIncrease ? "buffprevent" : "debuffprevent",
    target,
    effect,
  );
  if (!pass) {
    return preventResponse(
      effect,
      target,
      isIncrease ? "cannot be buffed" : "cannot be debuffed",
    );
  }
  return {
    txt: getPotencyDescription(effect, getPower(effect).power, `${target.username}'s`),
    color: isIncrease ? "blue" : "red",
  };
};

/** Increase range of basic actions */
export const increaseRange = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  target: BattleUserState,
): ActionEffect | undefined => {
  return adjustBasicAction(effect, usersEffects, target, {
    attr: "range",
    isBuff: true,
  });
};

/** Increase cooldown of basic actions */
export const increaseCooldown = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  target: BattleUserState,
): ActionEffect | undefined => {
  return adjustBasicAction(effect, usersEffects, target, {
    attr: "cooldown",
    isBuff: false,
  });
};

/** Decrease cooldown of basic actions */
export const decreaseCooldown = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  target: BattleUserState,
): ActionEffect | undefined => {
  return adjustBasicAction(effect, usersEffects, target, {
    attr: "cooldown",
    isBuff: true,
  });
};

export const decreaseStats = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  target: BattleUserState,
) =>
  olderPreventResponse(effect, usersEffects, "debuffprevent", target) ??
  adjustStats(invertPower(effect), target);

const adjustMasteries = (effect: UserEffect, target: BattleUserState) => {
  const { power, adverb, qualifier } = getPower(effect);
  const affected = getAffected(effect);
  if ("masteryTypes" in effect && effect.masteryTypes) {
    if (!effect.isNew && !effect.castThisRound) {
      storeMasteryBases(target);
      effect.masteryTypes.forEach((mastery: MasteryType) => {
        applyStatChange(
          target,
          MASTERY_TYPE_TO_STAT[mastery],
          power,
          effect.calculation,
        );
      });
    }
  }
  return getInfo(target, effect, `${affected} mastery is ${adverb} by ${qualifier}`);
};

export const increaseMastery = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  target: BattleUserState,
) =>
  olderPreventResponse(effect, usersEffects, "buffprevent", target) ??
  adjustMasteries(effect, target);

export const decreaseMastery = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  target: BattleUserState,
) =>
  olderPreventResponse(effect, usersEffects, "debuffprevent", target) ??
  adjustMasteries(invertPower(effect), target);

/** Adjust the damage one side of a consequence deals or takes, direct or residual (DOT). */
const adjustDamage = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  consequences: Map<string, Consequence>,
  target: BattleUserState,
  side: "userId" | "targetId",
  label: "given" | "taken",
) => {
  const { power, adverb, qualifier } = getPower(effect);
  const affected = getAffected(effect);
  if (!effect.isNew && !effect.castThisRound) {
    consequences.forEach((consequence, effectId) => {
      const damageKey =
        consequence.damage !== undefined
          ? "damage"
          : consequence.residual !== undefined
            ? "residual"
            : undefined;
      if (consequence[side] === effect.targetId && damageKey !== undefined) {
        const damageEffect = usersEffects.find((e) => e.id === effectId);
        if (damageEffect) {
          const ratio = getEfficiencyRatio(damageEffect, effect);

          if (effect.fromType === "bloodline") {
            if (
              "allowBloodlineDamageIncrease" in damageEffect &&
              "allowBloodlineDamageDecrease" in damageEffect &&
              ((power > 0 && !damageEffect.allowBloodlineDamageIncrease) ||
                (power < 0 && !damageEffect.allowBloodlineDamageDecrease))
            ) {
              return;
            }
            if (effect.calculation === "static") {
              const change = power;
              consequence[damageKey] = (consequence[damageKey] ?? 0) + change * ratio;
            } else {
              const current = consequence[damageKey] ?? 0;
              const multiplier = 1 + (power / 100) * ratio;
              consequence[damageKey] = current * multiplier;
            }
            return;
          }

          const baseDamage = getBaseDamageForModifier(effect, consequence);
          const change =
            effect.calculation === "percentage" ? (power / 100) * baseDamage : power;
          consequence[damageKey] = (consequence[damageKey] ?? 0) + change * ratio;
        }
      }
    });
  }
  return getInfo(
    target,
    effect,
    `damage ${label} [${affected}] is ${adverb} by up to ${qualifier}`,
  );
};

/** Adjust damage given by target */
export const adjustDamageGiven = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  consequences: Map<string, Consequence>,
  target: BattleUserState,
) => adjustDamage(effect, usersEffects, consequences, target, "userId", "given");

export const increaseDamageGiven = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  consequences: Map<string, Consequence>,
  target: BattleUserState,
) =>
  olderPreventResponse(effect, usersEffects, "buffprevent", target) ??
  adjustDamageGiven(effect, usersEffects, consequences, target);

export const decreaseDamageGiven = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  consequences: Map<string, Consequence>,
  target: BattleUserState,
) =>
  olderPreventResponse(effect, usersEffects, "debuffprevent", target) ??
  adjustDamageGiven(invertPower(effect), usersEffects, consequences, target);

/** Adjust damage taken by user */
export const adjustDamageTaken = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  consequences: Map<string, Consequence>,
  target: BattleUserState,
) => adjustDamage(effect, usersEffects, consequences, target, "targetId", "taken");

export const increaseDamageTaken = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  consequences: Map<string, Consequence>,
  target: BattleUserState,
) =>
  olderPreventResponse(effect, usersEffects, "debuffprevent", target) ??
  adjustDamageTaken(effect, usersEffects, consequences, target);

export const decreaseDamageTaken = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  consequences: Map<string, Consequence>,
  target: BattleUserState,
) =>
  olderPreventResponse(effect, usersEffects, "buffprevent", target) ??
  adjustDamageTaken(invertPower(effect), usersEffects, consequences, target);

/** Single prevent roll for pipeline + combat log (matches increase/decreaseDamage* wrappers). */
export const getDamageModifierPreventState = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  target: BattleUserState,
): { blocked: boolean; info: ActionEffect | undefined } => {
  const preventType =
    effect.type === "increasedamagegiven" || effect.type === "decreasedamagetaken"
      ? "buffprevent"
      : effect.type === "decreasedamagegiven" || effect.type === "increasedamagetaken"
        ? "debuffprevent"
        : null;
  if (!preventType) return { blocked: false, info: undefined };

  const info = olderPreventResponse(effect, usersEffects, preventType, target);
  return { blocked: info !== undefined, info };
};

/** Adjust ability to heal other of target */
export const adjustHealGiven = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  consequences: Map<string, Consequence>,
  target: BattleUserState,
) => {
  const { power, adverb, qualifier } = getPower(effect);
  if (!effect.isNew && !effect.castThisRound) {
    const change = (value: number) =>
      effect.calculation === "percentage" ? (power / 100) * value : power;
    consequences.forEach((consequence, effectId) => {
      // Adjust healing dealt by the target
      if (
        consequence.userId === effect.targetId &&
        usersEffects.some((e) => e.id === effectId)
      ) {
        if (consequence.heal_hp) consequence.heal_hp += change(consequence.heal_hp);
        if (consequence.lifesteal_hp) {
          consequence.lifesteal_hp += change(consequence.lifesteal_hp);
        }
        if (consequence.vampRatio) {
          // vampRatio is a 0-1 ratio, so convert flat power (%) to ratio.
          consequence.vampRatio +=
            effect.calculation === "percentage"
              ? (power / 100) * consequence.vampRatio
              : power / 100;
        }
      }
      // Adjust absorb
      if (consequence.targetId === effect.targetId && consequence.absorb_hp) {
        const absorbEffect = usersEffects.find(
          (e) => e.id === (consequence.diffuseSourceEffectId ?? effectId),
        );
        if (absorbEffect) consequence.absorb_hp += change(consequence.absorb_hp);
      }
    });
  }
  return getInfo(target, effect, `healing ability is ${adverb} by ${qualifier}`);
};

export const increaseHealGiven = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  consequences: Map<string, Consequence>,
  target: BattleUserState,
) =>
  olderPreventResponse(effect, usersEffects, "buffprevent", target) ??
  adjustHealGiven(effect, usersEffects, consequences, target);

export const decreaseHealGiven = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  consequences: Map<string, Consequence>,
  target: BattleUserState,
) =>
  olderPreventResponse(effect, usersEffects, "debuffprevent", target) ??
  adjustHealGiven(invertPower(effect), usersEffects, consequences, target);

/** Expire removable statuses when Clear/Cleanse succeeds, preserving protected sources. */
const removeEffects = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  target: BattleUserState,
  type: "positive" | "negative",
  instantConsumeIds?: Set<string>,
) => {
  const { power } = getPower(effect);
  if (Math.random() < power / 100) effect.power = 100;

  if (effect.power === 100) {
    // Remove user effects
    usersEffects
      .filter((e) => e.targetId === effect.targetId)
      .filter((e) => !PERSISTENT_EFFECT_SOURCE_TYPES.has(e.fromType ?? ""))
      .filter(type === "positive" ? isPositiveUserEffect : isNegativeUserEffect)
      .forEach((e) => {
        e.rounds = 0;
        // Authored instant conversions already have zero rounds; revoke their exception.
        instantConsumeIds?.delete(e.id);
      });

    // Type guard to identify ground effects
    const isGroundEffect = (e: UserEffect | GroundEffect): e is GroundEffect =>
      !("targetId" in e);

    // Remove ground effects at the same location as the target
    usersEffects
      .filter(isGroundEffect)
      .filter((e) => e.longitude === target.longitude && e.latitude === target.latitude)
      .filter(type === "positive" ? isPositiveUserEffect : isNegativeUserEffect)
      .forEach((e) => {
        e.rounds = 0;
      });

    effect.rounds = 0;
    return {
      txt: `${target.username} was cleared of all ${type} status effects. `,
      color: "blue",
    } as ActionEffect;
  }
  const upcoming =
    effect.isNew && effect.rounds && effect.rounds > 0
      ? `All ${type} status effects may be cleared from ${target.username} during the next ${effect.rounds} rounds. `
      : "";
  return {
    txt: `${upcoming}${target.username} could not be cleared of ${type} status effects this round. `,
    color: "blue",
  } as ActionEffect;
};

/**
 * Resolve Clear prevention and remove positive statuses, including instant conversions.
 * The optional eligibility set belongs to the current applyEffects resolution.
 */
export const clear = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  target: BattleUserState,
  instantConsumeIds?: Set<string>,
) => {
  const { pass } = preventCheck(usersEffects, "clearprevent", target);
  if (!pass) return preventResponse(effect, target, "resists being cleared");
  return removeEffects(effect, usersEffects, target, "positive", instantConsumeIds);
};

export const cleanse = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  target: BattleUserState,
) => {
  const { pass } = preventCheck(usersEffects, "cleanseprevent", target);
  if (!pass) return preventResponse(effect, target, "resists being cleansed");
  return removeEffects(effect, usersEffects, target, "negative");
};

/**
 * AI rows and their summons carry AI-scale stats; players, auto-battle players and
 * clones (isOriginal false) carry player-scale ones. A clone of an AI caster is the one
 * misread, which only affects its damage to barriers.
 */
const statScaleOf = (user: BattleUserState): StatScale =>
  user.isAi && user.isOriginal ? "ai" : "player";

/**
 * An AI-driven copy of `template` standing on the effect's tile, on the caster's side
 * and at the caster's level, with combat stats scaled to `perc`. Identity and control
 * flags are set explicitly rather than inherited from the template.
 */
const spawnStandIn = (
  template: BattleUserState,
  caster: BattleUserState,
  effect: GroundEffect,
  perc: number,
  scale: StatScale,
) => {
  const standIn = structuredClone(template);
  standIn.enmity = 0;
  delete standIn.baseStatsForModifiers;
  standIn.userId = nanoid();
  standIn.isSummon = true;
  standIn.isAi = true;
  standIn.controllerId = caster.userId;
  standIn.isSummonTemplate = false; // an active entity, not a template
  standIn.hidden = undefined;
  standIn.leftBattle = false;
  standIn.longitude = effect.longitude;
  standIn.latitude = effect.latitude;
  standIn.villageId = caster.villageId;
  standIn.direction = caster.direction;
  standIn.level = caster.level;
  scaleUserStats(standIn, scale);
  standIn.offence = standIn.offence * perc;
  standIn.defence = standIn.defence * perc;
  standIn.strength = standIn.strength * perc;
  standIn.intelligence = standIn.intelligence * perc;
  standIn.willpower = standIn.willpower * perc;
  standIn.speed = standIn.speed * perc;
  return standIn;
};

/**
 * Clone the caster onto the battlefield. The clone does not inherit sage mode
 * (no `sageModeId`, Activation jutsu stripped, `sageModeUsedThisBattle` set) so
 * it cannot activate or continue the original's sage window.
 */
export const clone = (
  usersState: BattleUserState[],
  effect: GroundEffect,
  staticData?: { jutsus: Record<string, { effects: unknown[] }> },
) => {
  const { power } = getPower(effect);
  const perc = power / 100;
  const user = usersState.find((u) => u.userId === effect.creatorId);
  if (!user) {
    // creatorId points at the caster on the first pass and at the spawned clone
    // afterwards, so either can be missing if that combatant left usersState.
    // Throwing would break every later action in the battle: alignBattle keeps
    // clone effects alive past rounds<=0 so this tag function can expire them,
    // and it never gets the chance. Expire the effect here instead.
    effect.rounds = 0;
    return;
  }
  if (effect.isNew) {
    const newAi = spawnStandIn(user, user, effect, perc, statScaleOf(user));
    // Clones use their innate default independently of the controller's saved preference.
    newAi.preferredDamageElement = getPreferredDamageElement({
      primaryElement: user.primaryElement,
    });
    // A clone did not receive the original's hits and must not inherit its deferred damage.
    delete newAi.diffuseDamage;
    // Remove companion identity so clones cannot access PETS-only jutsu.
    delete newAi.petId;
    delete newAi.petSpeciesId;
    effect.creatorId = newAi.userId;
    newAi.username = `${user.username} clone`;
    newAi.isOriginal = false;
    newAi.isPiloted = undefined; // a clone is AI-driven, never piloted
    newAi.sageModeId = null;
    newAi.sageModeActivated = false;
    newAi.sageModeActivatedRound = null;
    newAi.sageModeExpiresRound = null;
    newAi.sageModeUsedThisBattle = true;
    newAi.jutsus = newAi.jutsus.filter(
      (j) => j.jutsuId !== SAGE_MODE_ACTIVATION_JUTSU_ID,
    );
    // Remove all jutsus with summon/clone (use staticData to look up jutsu effects)
    newAi.jutsus = newAi.jutsus.filter((j) => {
      const jutsu = staticData?.jutsus[j.jutsuId];
      if (!jutsu) return true; // Keep if we can't look up the jutsu
      const effects = JSON.stringify(jutsu.effects);
      return !effects.includes("summon") && !effects.includes("clone");
    });
    // Push to userState
    usersState.push(newAi);
    // ActionEffect to be shown
    return {
      txt: `${newAi.username} created a clone for ${effect.rounds} rounds!`,
      color: "blue",
    } as ActionEffect;
  } else if (effect?.rounds === 0) {
    const idx = usersState.findIndex((u) => u.userId === effect.creatorId);
    if (idx > -1) {
      usersState.splice(idx, 1);
      return {
        txt: `${user.username} disappears!`,
        color: "red",
      } as ActionEffect;
    }
  }
};

export const updateStatUsage = (
  user: BattleUserState,
  effect: UserEffect | GroundEffect,
  inverse = false,
) => {
  if ("statTypes" in effect && "direction" in effect && effect.statTypes?.length) {
    if (effect.direction === "both") {
      user.usedStats.offence += 1;
      user.usedStats.defence += 1;
    } else if (
      (effect.direction === "offence" && !inverse) ||
      (effect.direction === "defence" && inverse)
    ) {
      user.usedStats.offence += 1;
    } else {
      user.usedStats.defence += 1;
    }
  }
  if ("generalTypes" in effect) {
    getLowerGenerals(effect.generalTypes, user.highestGenerals).forEach((gen) => {
      user.usedGenerals[gen as GenName] += 1;
    });
  }
};

/** Function used for scaling damage based on stat advantage and HP-based world scaling */
const powerEffect = (
  atkPower: number,
  defPower: number,
  attackerLevel: number,
  effectPower: number,
  config: DmgConfig,
) => {
  // EP scaling (normalized around EP_NORMALIZATION as standard hit)
  const epScale = effectPower / Math.max(1, config.ep_normalization);

  // World scale - HP divided by target hits to kill
  const baseline = calcHP(attackerLevel) / Math.max(1, config.base_hits);

  // Advantage calculation - bypass for stat-less effects (both powers are 0)
  let advantageMod = 1.0;
  if (atkPower > 0 || defPower > 0) {
    const advantageRatio = atkPower / Math.max(1, defPower);
    const rawAdvantage =
      1.0 + config.amplitude * (advantageRatio ** config.curve - 1.0);
    advantageMod = Math.min(
      config.advantage_max,
      Math.max(config.advantage_min, rawAdvantage),
    );
  }

  return baseline * epScale * advantageMod;
};

/** Base damage calculation formula */
export const damageCalc = (
  effect: UserEffect,
  origin: BattleUserState | undefined,
  target: BattleUserState,
  config: DmgConfig,
) => {
  const { power } = getPower(effect);

  let dmg = power;

  if (effect.calculation === "formula" && origin) {
    // Any statTypes add one offence-versus-defence term; the listed types only matter
    // when other tags are matched against this damage.
    let atkPowerFromStats = 0;
    let defPowerFromStats = 0;

    if (effect.statTypes && effect.statTypes.length > 0) {
      atkPowerFromStats += Math.sqrt(Math.max(0, origin.offence));
      defPowerFromStats += Math.sqrt(Math.max(0, target.defence));
    }

    // Accumulate attack and defense power from generals (weighted 2x per formula)
    let atkPowerFromGens = 0;
    let defPowerFromGens = 0;

    const generals = getLowerGenerals(effect.generalTypes, origin?.highestGenerals);
    generals.forEach((gen) => {
      if (gen in origin && gen in target) {
        const left = origin[gen as keyof typeof origin] as number;
        const right = target[gen as keyof typeof target] as number;
        atkPowerFromGens += Math.sqrt(Math.max(0, left));
        defPowerFromGens += Math.sqrt(Math.max(0, right));
      }
    });

    // Combine powers: stats use stats_scaling, generals use gen_weight
    const totalAtkPower =
      config.stats_scaling * atkPowerFromStats + config.gen_weight * atkPowerFromGens;
    const totalDefPower =
      config.stats_scaling * defPowerFromStats + config.gen_weight * defPowerFromGens;

    // Calculate damage using new formula
    dmg = powerEffect(totalAtkPower, totalDefPower, origin.level, power, config);
  }

  // Apply residual modifier if applicable
  if (!effect.castThisRound && "residualModifier" in effect) {
    if (effect.residualModifier) dmg *= effect.residualModifier;
  }

  // Apply damage modifier if applicable
  if ("dmgModifier" in effect) {
    if (effect.dmgModifier) dmg *= effect.dmgModifier;
  }

  return dmg;
};

/** Calculate damage modifier, e.g. from weakness tag */
export const calcDmgModifier = (
  dmgEffect: UserEffect & { type: "damage" | "pierce" },
  target: BattleUserState,
  usersState: UserEffect[],
) => {
  const weaknesses = usersState
    .filter(
      (e) =>
        e.type === "weakness" &&
        e.targetId === target.userId &&
        isEffectEnabled(e, usersState),
    )
    .map((e) => e as UserEffect & WeaknessTagType)
    .filter((e) => {
      const check1 = e.jutsus.includes(dmgEffect.actionId);
      const check2 = e.items.includes(dmgEffect.actionId);
      const check3 = e.elements.some((we: ElementName) =>
        dmgEffect?.elements?.includes(we),
      );
      const check4 = e.statTypes.some((we: StatType) =>
        dmgEffect?.statTypes?.includes(we),
      );
      const check5 = e.generalTypes.some((we: GeneralType) =>
        dmgEffect?.generalTypes?.includes(we),
      );
      return check1 || check2 || check3 || check4 || check5;
    })
    .sort((a, v) => v.power - a.power);
  const biggestWeakness = weaknesses[0];
  return biggestWeakness?.dmgModifier || 1;
};

/** Calculate damage effect on target */
export const damageUser = (
  effect: UserEffect,
  origin: BattleUserState | undefined,
  target: BattleUserState,
  consequences: Map<string, Consequence>,
  dmgModifier: number,
  config: DmgConfig,
) => {
  // Store the raw damage before any calculations
  const rawDamage = damageCalc(effect, origin, target, config) * dmgModifier;

  // Calculate the final damage with modifiers
  const thisRound = effect.castThisRound;
  const instant = thisRound && effect.rounds === 0;
  const residual = !thisRound && (effect.rounds === undefined || effect.rounds > 0);

  // Only apply barrier absorption to instant damage, not residual damage
  const damage = instant ? rawDamage * (1 - (effect.barrierAbsorb ?? 0)) : rawDamage;

  // Fetch types to show to the user
  const types = [
    effect.type,
    ...("statTypes" in effect && effect.statTypes ? effect.statTypes : []),
    ...("generalTypes" in effect && effect.generalTypes ? effect.generalTypes : []),
    ...("elements" in effect && effect.elements ? effect.elements : []),
    ...("poolsAffected" in effect && effect.poolsAffected
      ? effect.poolsAffected.filter((pool): pool is PoolType => pool !== "Energy")
      : []),
  ].filter((type) => type !== "Energy");

  if (instant || residual) {
    consequences.set(effect.id, {
      userId: effect.creatorId,
      targetId: effect.targetId,
      types: types,
      ...(instant
        ? {
            damage: damage,
            baseDamageForModifiers: damage,
          }
        : {}),
      ...(residual
        ? {
            residual: damage,
            baseDamageForModifiers: damage,
          }
        : {}),
    });
  }
  return getInfo(target, effect, "will take damage");
};

/** Apply damage effect to barrier */
export const damageBarrier = (
  groundEffects: GroundEffect[],
  origin: BattleUserState,
  effect: UserEffect,
  config: DmgConfig,
) => {
  // Get the barrier
  const idx = groundEffects.findIndex((g) => g.id === effect.targetId);
  const barrier = groundEffects[idx];
  if (!barrier || !("curHealth" in barrier)) return undefined;

  // Apply damage for both instant and residual effects
  const thisRound = effect.castThisRound;
  const instant = thisRound && effect.rounds === 0;
  const residual = !thisRound && (effect.rounds === undefined || effect.rounds > 0);

  // Only apply damage if this is an instant effect or residual effect
  if (!instant && !residual) return undefined;

  const { power } = getPower(barrier);
  // Create barrier target user stats
  const target = structuredClone(origin);
  target.level = power;
  scaleUserStats(target, statScaleOf(origin));
  // Calculate damage
  const damage = damageCalc(effect, origin, target, config) * effect.barrierAbsorb;
  barrier.curHealth -= damage;
  // Information
  if (barrier.curHealth <= 0) {
    groundEffects.splice(idx, 1);
  }
  const info: ActionEffect = {
    txt: `Barrier takes ${damage.toFixed(2)} damage ${barrier.curHealth <= 0 ? "and is destroyed." : `and has ${barrier.curHealth.toFixed(2)} health left.`}`,
    color: "red",
  };
  return { info, barrier };
};

/** Flee from the battlefield with a given chance */
export const flee = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  target: BattleUserState,
) => {
  const { pass } = preventCheck(usersEffects, "fleeprevent", target);
  if (!pass) return preventResponse(effect, target, "is prevented from fleeing");
  // Apply flee
  const { power } = getPower(effect);
  const primaryCheck = Math.random() < power / 100;
  let text =
    effect.isNew && effect.rounds && effect.rounds > 0
      ? `${target.username} will attempt fleeing for the next ${effect.rounds} rounds. `
      : "";
  if (primaryCheck) {
    target.fledBattle = true;
    // If the player successfully flees, handle money based on whether they were robbed or robbed others
    if (target.moneyStolen < 0) {
      // This player was robbed - restore their money
      target.money -= target.moneyStolen; // Add back the stolen money (moneyStolen is negative)
      target.moneyStolen = 0;
      text = `${target.username} manages to flee the battle and recovers their stolen money!`;
    } else if (target.moneyStolen > 0) {
      // This player robbed others - they lose the stolen money when fleeing
      target.money -= target.moneyStolen;
      target.moneyStolen = 0;
      text = `${target.username} manages to flee the battle but drops all the stolen money!`;
    } else {
      text = `${target.username} manages to flee the battle!`;
    }
  } else {
    text += `${target.username} fails to flee the battle!`;
  }

  return { txt: text, color: "blue" } as ActionEffect;
};

/** Calculate healing effect on target */
export const heal = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  target: BattleUserState,
  consequences: Map<string, Consequence>,
  applyTimes: number,
) => {
  // Prevent?
  const { pass } = preventCheck(usersEffects, "healprevent", target, effect);
  if (!pass) return preventResponse(effect, target, "cannot be healed");
  // Calculate healing
  const { power } = getPower(effect);
  // Battles persisted before the counter was floored can still carry a negative round,
  // which the schema rejects. Clamp it in place so the tag parses, the pool selection
  // below keeps its Stamina/Chakra choice, and the scheduling sees a real value.
  if (effect.rounds !== undefined && effect.rounds < 0) {
    effect.rounds = 0;
  }
  const parsedEffect = HealTag.parse(effect);
  const poolsAffects = parsedEffect.poolsAffected || ["Health"];
  const poolHeal = (pool: PoolType) => {
    if (!poolsAffects.includes(pool)) return 0;
    return effect.calculation === "percentage"
      ? target[POOL_FIELDS[pool].max] * (power / 100) * applyTimes
      : power * applyTimes * 10;
  };
  // If rounds=0 apply immidiately, otherwise only on following rounds
  if (
    (effect.castThisRound && effect.rounds === 0) ||
    (!effect.castThisRound && (effect.rounds === undefined || effect.rounds > 0))
  ) {
    consequences.set(effect.id, {
      userId: effect.creatorId,
      targetId: effect.targetId,
      heal_hp: poolHeal("Health"),
      heal_sp: poolHeal("Stamina"),
      heal_cp: poolHeal("Chakra"),
    });
  }
  return getInfo(target, effect, "will heal");
};

export const pooladjust = (effect: UserEffect, target: BattleUserState) => {
  const { adverb, qualifier } = getPower(effect);
  if ("poolsAffected" in effect) {
    const affected: string[] = [];
    effect.poolsAffected?.forEach((pool) => {
      affected.push(pool);
    });
    return getInfo(
      target,
      effect,
      `${affected.join(", ")} cost is ${adverb} by ${qualifier}`,
    );
  }
};

/** Aggro changes follow target-turn timing; generation modifiers are read at HP loss. */
export const adjustAggro = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  target: BattleUserState,
): ActionEffect | undefined => {
  if (effect.type !== "increaseaggro" && effect.type !== "decreaseaggro") return;
  if (!effect.isNew && !isEffectActive(effect)) return;
  const { pass } = preventCheck(usersEffects, "buffprevent", target, effect);
  if (!pass) return preventResponse(effect, target, "cannot change enmity");
  const { power, qualifier } = getPower(effect);
  const increases = effect.type === "increaseaggro";
  if (effect.aggroMode === "GENERATION") {
    return getInfo(
      target,
      effect,
      `enmity generation is ${increases ? "increased" : "decreased"} by ${qualifier}`,
    );
  }
  const current = target.enmity ?? 0;
  const delta = effect.calculation === "percentage" ? (current * power) / 100 : power;
  target.enmity = Math.max(0, current + (increases ? delta : -delta));
  return {
    txt: `${target.username}'s enmity ${increases ? "increases" : "decreases"} by ${Math.abs(target.enmity - current).toFixed(2)}`,
    color: "blue",
  };
};

export const increasepoolcost = (effect: UserEffect, target: BattleUserState) => {
  return pooladjust(effect, target);
};

export const decreasepoolcost = (effect: UserEffect, target: BattleUserState) =>
  pooladjust(invertPower(effect), target);

/** Activate a Curse instance without granting healing on the casting action. */
export const curse = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  target: BattleUserState,
  round: number,
) => {
  if (!isEffectActive(effect) || effect.curseState) return;
  const prevented = olderPreventResponse(effect, usersEffects, "buffprevent", target);
  if (prevented) return prevented;
  effect.curseState = {
    storedHealing: 0,
    activatedRound: effect.isNew ? round : effect.createdRound,
  };
  return getInfo(
    target,
    effect,
    `will store ${getPower(effect).power / 2}% of damage dealt and received as healing and gain ${effect.type === "curse" ? (effect.damageBonusPercent ?? 0) : 0}% damage; Lifesteal, Absorb, and Vamp are disabled while Curse is active`,
  );
};

/** Consume a naturally expired Curse once, applying healing modifiers before the HP cap. */
export const settleCurse = (
  effect: UserEffect,
  target: BattleUserState,
  usersEffects: UserEffect[],
): ActionEffect | undefined => {
  const state = effect.curseState;
  if (!state || state.settled) return;
  state.settled = true;
  const stored = state.storedHealing;
  state.storedHealing = 0;
  if (stored <= 0 || target.curHealth <= 0 || target.fledBattle) return;
  if (sealCheck(effect, getActiveSealEffects(usersEffects))) return;
  if (!preventCheck(usersEffects, "healprevent", target).pass)
    return preventResponse(effect, target, "cannot receive Curse healing");
  const consequence: Consequence = {
    userId: target.userId,
    targetId: target.userId,
    heal_hp: stored,
  };
  const consequences = new Map([[effect.id, consequence]]);
  const applied = new Set<string>();
  for (const modifier of usersEffects
    .filter((e) => e.type === "increaseheal" || e.type === "decreaseheal")
    .sort(sortEffects)) {
    if (
      modifier.targetId !== target.userId ||
      !isEffectEnabled(modifier, usersEffects) ||
      !canStackEffect(modifier, applied)
    )
      continue;
    applied.add(getEffectStackKey(modifier));
    const resolved = { ...modifier };
    if (resolved.type === "increaseheal")
      increaseHealGiven(resolved, usersEffects, consequences, target);
    else decreaseHealGiven(resolved, usersEffects, consequences, target);
  }
  // Expiring maximum-pool effects change current HP before the payout cap is measured.
  applyPoolAdjustmentsToBase(target, usersEffects);
  const healing = Math.min(
    Math.max(0, consequence.heal_hp ?? 0),
    Math.max(0, getEffectiveMaxPool(target, usersEffects, "Health") - target.curHealth),
  );
  target.curHealth += healing;
  return {
    txt: `${target.username}'s Curse expires and restores ${healing.toFixed(2)} HP`,
    color: "green",
    types: ["curse"],
  };
};

/** Collect eligible Parry percentages so stacking splits each direct hit once. */
export const parry = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  consequences: Map<string, Consequence>,
  target: BattleUserState,
) => {
  const { power, qualifier } = getPower(effect);
  if (!effect.isNew && !effect.castThisRound) {
    consequences.forEach((consequence, effectId) => {
      if (
        consequence.targetId !== effect.targetId ||
        consequence.userId === effect.targetId ||
        consequence.damageSource ||
        !consequence.damage
      )
        return;
      const source = usersEffects.find((e) => e.id === effectId);
      if (!source || (source.type !== "damage" && source.type !== "elementaldamage"))
        return;
      consequence.parryPercentage =
        (consequence.parryPercentage ?? 0) +
        Math.max(0, power) * getEfficiencyRatio(source, effect);
    });
  }
  return getInfo(target, effect, `will parry ${qualifier} incoming damage`);
};

/** Reflect damage back to the opponent */
export const reflect = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  consequences: Map<string, Consequence>,
  target: BattleUserState,
) => {
  const prevented = olderPreventResponse(effect, usersEffects, "buffprevent", target);
  if (prevented) return prevented;
  const { power, qualifier } = getPower(effect);
  if (!effect.isNew && !effect.castThisRound) {
    consequences.forEach((consequence, effectId) => {
      if (consequence.targetId === effect.targetId && consequence.damage) {
        const damageEffect = usersEffects.find((e) => e.id === effectId);
        if (damageEffect) {
          const ratio = getEfficiencyRatio(damageEffect, effect);
          const dmgConvert = capConversion(effect, power, consequence.damage) * ratio;
          consequence.reflect = (consequence.reflect || 0) + dmgConvert;
        }
      }
    });
  }
  return getInfo(target, effect, `will reflect ${qualifier} damage`);
};

/** Apply wound damage over multiple turns based on damage dealt */
export const wound = (
  effect: UserEffect,
  _usersEffects: UserEffect[],
  consequences: Map<string, Consequence>,
  target: BattleUserState,
) => {
  if (effect.isNew && effect.castThisRound) {
    // A transferred clone (mirror) arrives with the source wound's recorded damage
    // in its timeTracker; recomputing from this action's consequences would zero it
    // out (a pure utility mirror deals no damage) and leave the clone inert.
    if (!effect.timeTracker?.originalDamage) {
      let original = 0;
      consequences.forEach((c) => {
        if (
          c.userId === effect.creatorId &&
          c.targetId === effect.targetId &&
          typeof c.damage === "number" &&
          c.damage > 0
        ) {
          original += c.damage;
        }
      });
      if (!effect.timeTracker) effect.timeTracker = {};
      effect.timeTracker.originalDamage = original;
    }
  }

  const shouldApply =
    !effect.isNew && !effect.castThisRound && (effect.rounds ?? 0) > 0;

  // Calculate wound damage amount for display purposes
  const originalDamage = effect.timeTracker?.originalDamage || 0;
  const { power } = getPower(effect);
  const woundDamage =
    originalDamage > 0 ? Math.floor(originalDamage * (power / 100)) : 0;

  if (shouldApply && woundDamage > 0) {
    // Find or create a consequence for this target
    let targetConsequence = Array.from(consequences.values()).find(
      (c) => c.targetId === effect.targetId && c.userId === effect.creatorId,
    );

    if (!targetConsequence) {
      targetConsequence = {
        userId: effect.creatorId,
        targetId: effect.targetId,
        types: [
          "wound",
          ...("generalTypes" in effect && effect.generalTypes
            ? effect.generalTypes
            : []),
          ...("elements" in effect && effect.elements ? effect.elements : []),
        ],
      };
      consequences.set(`wound-${effect.id}`, targetConsequence);
    }

    // Add to existing wound damage or create new
    targetConsequence.wound = (targetConsequence.wound || 0) + woundDamage;
  }

  // Only show the message when the effect is first applied
  if (effect.isNew && effect.castThisRound) {
    return getInfo(target, effect, `will take ${woundDamage.toFixed(2)} wound damage`);
  }

  return undefined;
};

/** Recoil damage back to attacker */
export const recoil = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  consequences: Map<string, Consequence>,
  target: BattleUserState,
) => {
  const prevented = olderPreventResponse(
    effect,
    usersEffects,
    "debuffprevent",
    target,
    "cannot be debuffed with recoil",
  );
  if (prevented) return prevented;
  const { power, qualifier } = getPower(effect);
  if (!effect.isNew && !effect.castThisRound) {
    consequences.forEach((consequence, effectId) => {
      if (consequence.userId === effect.targetId && consequence.damage) {
        // Skip if the damage is from a pierce effect
        if (consequence.types?.includes("pierce")) {
          return;
        }
        const damageEffect = usersEffects.find((e) => e.id === effectId);
        if (damageEffect) {
          const ratio = getEfficiencyRatio(damageEffect, effect);
          const convert = capConversion(effect, power, consequence.damage) * ratio;
          consequence.recoil = convert;
        }
      }
    });
  }
  return getInfo(target, effect, `will recoil ${qualifier} damage`);
};

/** Afterburn damage - take a percentage of damage received as self-damage */
export const afterburn = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  consequences: Map<string, Consequence>,
  target: BattleUserState,
) => {
  const { power, qualifier } = getPower(effect);
  if (!effect.isNew && !effect.castThisRound) {
    consequences.forEach((consequence, effectId) => {
      // Look for damage that the afterburn target is receiving
      if (consequence.targetId === effect.targetId && consequence.damage) {
        // Skip if the damage is from a pierce effect
        if (consequence.types?.includes("pierce")) {
          return;
        }
        const damageEffect = usersEffects.find((e) => e.id === effectId);
        if (damageEffect) {
          const ratio = getEfficiencyRatio(damageEffect, effect);
          const convert = capConversion(effect, power, consequence.damage) * ratio;

          // Add to existing afterburn damage (stacking) up to the afterburn cap
          const currentAfterburn = consequence.afterburn || 0;
          const maxAfterburn = Math.floor(consequence.damage * AFTERBURN_CAP_RATIO);
          const newAfterburn = Math.min(currentAfterburn + convert, maxAfterburn);
          consequence.afterburn = newAfterburn;
        }
      }
    });
  }

  const description =
    effect.calculation === "percentage"
      ? `will take ${qualifier} of damage received as afterburn`
      : `will take ${qualifier} afterburn damage`;

  return getInfo(target, effect, description);
};

/** Steal damage back to attacker as HP */
export const lifesteal = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  consequences: Map<string, Consequence>,
  target: BattleUserState,
) => {
  // Prevent?
  const { pass } = preventCheck(usersEffects, "healprevent", target, effect);
  if (!pass) return preventResponse(effect, target, "cannot steal health");
  // Calculate life steal
  const { power, qualifier } = getPower(effect);
  if (!effect.isNew && !effect.castThisRound) {
    consequences.forEach((consequence, effectId) => {
      if (consequence.userId === effect.targetId && consequence.damage) {
        const damageEffect = usersEffects.find((e) => e.id === effectId);
        if (damageEffect) {
          const ratio = getEfficiencyRatio(damageEffect, effect);
          const convert = Math.floor(consequence.damage * (power / 100)) * ratio;
          consequence.lifesteal_hp = consequence.lifesteal_hp
            ? consequence.lifesteal_hp + convert
            : convert;
        }
      }
    });
  }
  return getInfo(target, effect, `will steal ${qualifier} damage as health`);
};

/** Instantly heal the caster based on damage dealt by this jutsu. Shares a combined 60% cap with lifesteal. */
export const vamp = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  consequences: Map<string, Consequence>,
  target: BattleUserState,
) => {
  // Check healprevent on the caster directly (not the damage target)
  const casterHealPrevented =
    getActiveTargetEffects(usersEffects, effect.creatorId, "healprevent").length > 0;
  if (casterHealPrevented) return preventResponse(effect, target, "cannot vamp");
  const { power, qualifier } = getPower(effect);
  // Store vampRatio on each outgoing damage consequence so the application phase
  // can compute the heal from the full pre-shield damage total (post-boost, pre-shield;
  // matches lifesteal, which also heals off the full hit a shield would otherwise reduce).
  forEachOutgoingDamage(effect, consequences, (c) => {
    c.vampRatio = (c.vampRatio ?? 0) + power / 100;
  });
  return getInfo(target, effect, `will vamp ${qualifier} damage as health`);
};

/**
 * Register outgoing Consume or incoming Siphon with a shared 100% conversion budget.
 * Consume retains its longest-duration aggregation; Siphon durations stay separate.
 */
export const registerShieldConversion = (
  effect: UserEffect,
  shieldConversionsByUser: ShieldConversionsByUser,
  usersEffects: UserEffect[],
  target: BattleUserState,
): ActionEffect | undefined => {
  if (effect.type === "siphon") {
    const { pass } = preventCheck(usersEffects, "buffprevent", target, effect);
    if (!pass) return preventResponse(effect, target, "cannot siphon damage");
  }
  const { power, qualifier } = getPower(effect);
  const shieldRounds = "shieldRounds" in effect ? effect.shieldRounds : 3;
  if (effect.type !== "consume" && effect.type !== "siphon") return;
  const userId = effect.type === "siphon" ? effect.targetId : effect.creatorId;
  const conversion = shieldConversionsByUser.get(userId) ?? {
    ratio: 0,
    shields: [],
  };
  const previous = conversion.shields.find(
    (shield) =>
      shield.type === effect.type &&
      (effect.type === "consume" || shield.rounds === shieldRounds),
  );
  conversion.ratio += power / 100;
  if (previous) {
    previous.ratio += power / 100;
    previous.rounds = Math.max(previous.rounds, shieldRounds);
  } else {
    conversion.shields.push({
      type: effect.type,
      ratio: power / 100,
      hp: 0,
      rounds: shieldRounds,
    });
  }
  shieldConversionsByUser.set(userId, conversion);
  if (effect.type === "siphon") {
    // Sage auras are backdated to tick immediately; announce their first registration
    // before they enter the persisted effects without changing their combat timing.
    const isNewSageEffect =
      effect.fromType === "sageMode" &&
      !usersEffects.some((existing) => existing.id === effect.id);
    return getInfo(
      target,
      { ...effect, isNew: effect.isNew || isNewSageEffect },
      `will siphon ${qualifier} of damage taken into shields`,
    );
  }
  return undefined;
};

/** Drain target's Chakra and Stamina over time */
export const drain = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  consequences: Map<string, Consequence>,
  target: BattleUserState,
) => {
  // Check if the effect is prevented
  const { pass } = preventCheck(usersEffects, "debuffprevent", target, effect);
  if (!pass) return preventResponse(effect, target, "cannot be debuffed");

  // Calculate drain amount
  const { power, qualifier } = getPower(effect);

  // Get pools to drain from
  const pools = getTagPools(effect);

  // Apply drain effect each round
  if (
    !effect.isNew &&
    !effect.castThisRound &&
    (effect.rounds === undefined || effect.rounds > 0)
  ) {
    // Preserve the caster until damage conversions have resolved.
    const consequenceKey = `drain-${effect.creatorId}-${effect.targetId}`;
    const consequence: Consequence = consequences.get(consequenceKey) || {
      userId: effect.creatorId,
      targetId: effect.targetId,
      drain_hp: 0,
      drain_cp: 0,
      drain_sp: 0,
    };

    // Calculate drain amount for each pool
    pools.forEach((pool) => {
      const { suffix, max } = POOL_FIELDS[pool];
      const drainAmount =
        effect.calculation === "percentage"
          ? Math.floor((power / 100) * target[max])
          : power;

      // Add to existing drain value for the specific pool
      const key = `drain_${suffix}` as const;
      consequence[key] = (consequence[key] || 0) + drainAmount;
    });

    consequences.set(consequenceKey, consequence);
  }

  return getInfo(
    target,
    effect,
    `will be drained ${qualifier} of ${pools.join(", ")} for ${effect.rounds} rounds`,
  );
};

/**
 * Increase or decrease maximum pool values.
 * This effect is purely declarative - it goes on the effect stack and the actual
 * pool values are calculated dynamically using getEffectiveMaxPool/getEffectiveCurPool.
 * No mutation of base pool values occurs.
 */
const adjustMaxPools = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  target: BattleUserState,
  isIncrease: boolean,
) => {
  const preventType = isIncrease ? "buffprevent" : "debuffprevent";
  const { pass } = preventCheck(usersEffects, preventType, target, effect);
  if (!pass) {
    return preventResponse(
      effect,
      target,
      `cannot be ${isIncrease ? "buffed" : "debuffed"}`,
    );
  }

  // Only show message on first application (when effect is new)
  if (!effect.isNew) {
    return undefined;
  }

  const pools = getPoolsAffected(effect);
  const { qualifier } = getPower(effect);
  const action = isIncrease ? "increased" : "decreased";

  return getInfo(
    target,
    effect,
    `maximum and current ${pools.join(", ")} ${action} by ${qualifier}`,
  );
};

/** Increase maximum and current pool values */
export const increaseMaxPools = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  target: BattleUserState,
) => adjustMaxPools(effect, usersEffects, target, true);

/** Decrease maximum and current pool values */
export const decreaseMaxPools = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  target: BattleUserState,
) => adjustMaxPools(effect, usersEffects, target, false);

/** Deals damage based on chakra and stamina usage */
export const poison = (
  effect: UserEffect,
  action: CombatAction,
  actorId: string,
  consequences: Map<string, Consequence>,
  target: BattleUserState,
  usersEffects: UserEffect[],
) => {
  const { pass } = preventCheck(usersEffects, "debuffprevent", target, effect);
  if (!pass) return preventResponse(effect, target, "cannot be debuffed");
  const { power, qualifier } = getPower(effect);

  // If the effect is new and is being cast this round, just return an info message.
  if (effect.isNew && effect.castThisRound) {
    return getInfo(
      target,
      effect,
      `will take ${qualifier} of chakra and stamina spent as poison damage`,
    );
  }

  if (!effect.castThisRound && actorId === target.userId) {
    const { cpCost, spCost } = calcPoolCost(action, usersEffects, target);
    const dmg = Math.floor((cpCost + spCost) * (power / 100));

    consequences.set(effect.id, {
      userId: effect.creatorId,
      targetId: effect.targetId,
      poison: dmg,
    });
  }
};
/** Create a temporary HP shield that absorbs damage */
export const shield = (effect: UserEffect, target: BattleUserState) => {
  // Apply
  const { power } = getPower(effect);
  const primaryCheck = Math.random() < power / 100;
  const shieldEffect = effect as ShieldTagType;
  let info: ActionEffect | undefined;
  if (effect.isNew && effect.rounds) {
    if (primaryCheck) {
      effect.power = shieldEffect.health;
      info = getInfo(target, effect, `shield with ${effect.power.toFixed(2)} HP`);
    } else {
      effect.rounds = 0;
      info = {
        txt: `${target.username}'s shield was not created`,
        color: "blue",
      };
    }
  }
  if (effect.power <= 0) {
    info = { txt: `${target.username}'s shield was destroyed`, color: "red" };
    effect.rounds = 0;
  }
  return info;
};

/** Blocks prevent effects from being applied to the target */
export const immunity = (effect: UserEffect, target: BattleUserState) => {
  if (effect.type !== "immunity") return undefined;
  if (effect.isNew && effect.rounds) {
    const preventType = getPreventTypeName(effect.blocks);
    return getInfo(target, effect, `has immunity to ${preventType} prevention`);
  }
  return undefined;
};

/** Apply Final Stand's health floor consistently to immediate and deferred damage. */
export const applyFinalStandDamage = (
  effects: UserEffect[],
  target: BattleUserState,
  damage: number,
  messages: ActionEffect[],
): number => {
  if (target.curHealth <= 0 || target.curHealth - damage >= 1) return damage;
  const finalStandEffect = effects.find((effect) => {
    if (effect.type !== "finalstand" || effect.targetId !== target.userId) return false;
    if (effect.fromType === "bloodline") {
      if (!isEffectEnabled(effect, effects)) return false;
      // Bloodline Final Stand lasts until the next round, including debt repayment.
      effect.rounds = 1;
      return true;
    }
    return (effect.rounds ?? 0) > 0;
  });
  if (finalStandEffect) {
    const remainingDamage = Math.max(0, target.curHealth - 1);
    messages.push({
      txt: `${target.username}'s final stand prevents ${(damage - remainingDamage).toFixed(2)} damage`,
      color: "orange",
    });
    return remainingDamage;
  }
  return damage;
};

/** Prevents the user from being reduced below 1 HP */
export const finalStand = (effect: UserEffect, target: BattleUserState) => {
  const { power } = getPower(effect);
  const primaryCheck = Math.random() < power / 100;
  let info: ActionEffect | undefined;
  if (primaryCheck) {
    info = getInfo(
      target,
      effect,
      "takes a final stand and cannot be reduced below 1 HP",
    );
  } else {
    effect.rounds = 0;
    info = {
      txt: `${target.username}'s final stand failed to activate`,
      color: "blue",
    };
  }
  return info;
};

/**
 * Move user on the battlefield
 * 1. Remove user from current ground effect
 * 2. Add user to any new ground effect
 * 3. Move user
 */
export const move = (
  effect: GroundEffect,
  usersEffects: UserEffect[],
  usersState: BattleUserState[],
  groundEffects: GroundEffect[],
): void => {
  const user = usersState.find((u) => u.userId === effect.creatorId);
  if (user) {
    // Prevent?
    const { pass } = preventCheck(usersEffects, "moveprevent", user);
    if (!pass) {
      effect.rounds = 0;
      return;
    }
    relocateUser(
      user,
      effect.longitude,
      effect.latitude,
      groundEffects,
      effect.createdRound,
    );
  }
};

/** Place a user on a tile and move their ground-effect entry timers along with them. */
const relocateUser = (
  user: BattleUserState,
  longitude: number,
  latitude: number,
  groundEffects: GroundEffect[],
  round: number,
) => {
  groundEffects.forEach((g) => {
    if (g.timeTracker && user.userId in g.timeTracker) {
      delete g.timeTracker[user.userId];
    }
  });
  groundEffects.forEach((g) => {
    if (g.timeTracker && g.longitude === longitude && g.latitude === latitude) {
      g.timeTracker[user.userId] = round;
    }
  });
  user.longitude = longitude;
  user.latitude = latitude;
};

/** One-hit-kill target with a given static chance */
export const onehitkill = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  target: BattleUserState,
) => {
  // Prevent?
  const { pass } = preventCheck(usersEffects, "onehitkillprevent", target);
  if (!pass) return preventResponse(effect, target, "resisted being instantly killed");
  // Apply
  const { power } = getPower(effect);
  const primaryCheck = Math.random() < power / 100;
  let info: ActionEffect | undefined;
  if (primaryCheck) {
    target.curHealth = 0;
    info = { txt: `${target.username} was killed in one hit`, color: "red" };
  } else {
    info = {
      txt: `${target.username} was lucky not to be instantly killed!`,
      color: "blue",
    };
  }
  return info;
};

/** Rob a given user for a given amount of ryo */
export const rob = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  origin: BattleUserState,
  target: BattleUserState,
  battleType: BattleType,
): ActionEffect | undefined => {
  // No stealing from AIs
  if (target.isAi) {
    effect.rounds = 0;
    return {
      txt: `${target.username} is an AI and cannot be robbed`,
      color: "blue",
    };
  }
  if (battleType !== "COMBAT") {
    effect.rounds = 0;
    return { txt: `You can only rob in 1vs1 combat`, color: "blue" };
  }
  // Prevent?
  const { pass } = preventCheck(usersEffects, "robprevent", target);
  if (!pass) return preventResponse(effect, target, "resisted being robbed");
  // Convenience. if rounds=0, it's an instant rob, otherwise chance every active round
  const thisRound = effect.castThisRound;
  const instant = thisRound && effect.rounds === 0;
  const residual = !thisRound && (effect.rounds === undefined || effect.rounds > 0);
  // Attempt robbing
  const { power } = getPower(effect);
  if (instant || residual) {
    const primaryCheck = Math.random() < power / 100;
    if (primaryCheck && "robPercentage" in effect && effect.robPercentage) {
      // Only rob from pocket money, never from bank
      const pocketMoney = Math.max(0, target.money);
      if (pocketMoney > 0) {
        let stolen = Math.floor(pocketMoney * (effect.robPercentage / 100));
        stolen = Math.min(stolen, pocketMoney); // Ensure we don't steal more than what's in pocket
        origin.moneyStolen = (origin.moneyStolen || 0) + stolen;
        target.moneyStolen = (target.moneyStolen || 0) - stolen;
        target.money -= stolen;
        origin.money += stolen;
        return {
          txt: `${origin.username} stole ${stolen} ryo from ${target.username}'s pocket`,
          color: "blue",
        };
      } else {
        return {
          txt: `${origin.username} failed to steal ryo from ${target.username} because they have no ryo in their pocket`,
          color: "blue",
        };
      }
    } else {
      return {
        txt: `${target.username} manages not to get robbed!`,
        color: "blue",
      };
    }
  }
  return getInfo(target, effect, "will be robbed");
};

/** Seal the bloodline effects of the target with static chance */
export const seal = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  target: BattleUserState,
) => {
  const { pass } = preventCheck(usersEffects, "sealprevent", target);
  if (!pass) return preventResponse(effect, target, "resisted bloodline sealing");
  // Apply
  const { power } = getPower(effect);
  const primaryCheck = Math.random() < power / 100;
  let info: ActionEffect | undefined;
  if (effect.isNew) {
    if (primaryCheck) {
      info = getInfo(target, effect, "bloodline is sealed");
    } else {
      effect.rounds = 0;
      info = {
        txt: `${target.username} bloodline was not sealed`,
        color: "blue",
      };
    }
  }
  return info;
};

/** Go into stealth mode */
export const stealth = (effect: UserEffect, target: BattleUserState) => {
  const { power } = getPower(effect);
  const mainCheck = Math.random() < power / 100;
  if (mainCheck) {
    const info = getInfo(target, effect, "will be stealthed");
    return info;
  } else if (effect.isNew) {
    effect.rounds = 0;
  }
};

/** Seal elemental jutsu */
export const elementalseal = (effect: UserEffect, target: BattleUserState) => {
  const { power } = getPower(effect);
  const mainCheck = Math.random() < power / 100;
  if (mainCheck) {
    return getInfo(
      target,
      effect,
      `will be sealed from using elemental ${ELEMENTAL_SEAL_AP_COST} AP jutsu`,
    );
  } else if (effect.isNew) {
    effect.rounds = 0;
  }
};

/** Stun target based on static chance */
export const stun = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  target: BattleUserState,
) => {
  // Prevent?
  const { pass } = preventCheck(usersEffects, "stunprevent", target, effect);
  if (!pass) return preventResponse(effect, target, "resisted being stunned");
  // Apply
  const { power } = getPower(effect);
  const primaryCheck = Math.random() < power / 100;
  let info: ActionEffect | undefined;
  if (effect.isNew && effect.rounds) {
    if (!("apReduction" in effect)) {
      effect.rounds = 0;
      info = {
        txt: `${target.username} hit with inactive stun effect`,
        color: "blue",
      };
    } else if (primaryCheck) {
      info = getInfo(target, effect, `is stunned [-${effect.apReduction} AP]`);
    } else {
      effect.rounds = 0;
      info = {
        txt: `${target.username} manages not to get stunned!`,
        color: "blue",
      };
    }
  }
  return info;
};

/** How each temporal tag differs: what prevents it, its name and its AP cost change. */
const TEMPORAL_TAGS = {
  timecompression: {
    preventKind: "debuffprevent",
    label: "time compression",
    costChange: "more",
    color: "red",
  },
  timedilation: {
    preventKind: "buffprevent",
    label: "time dilation",
    costChange: "less",
    color: "blue",
  },
} as const;

/** Time compression and dilation raise or lower the AP cost of actions. */
export const temporalShift = (
  effect: Extract<UserEffect, { type: keyof typeof TEMPORAL_TAGS }>,
  usersEffects: UserEffect[],
  target: BattleUserState,
): ActionEffect | undefined => {
  const { preventKind, label, costChange, color } = TEMPORAL_TAGS[effect.type];
  // Check if the shift is prevented
  const { pass } = preventCheck(usersEffects, preventKind, target, effect);
  if (!pass) return preventResponse(effect, target, `cannot be affected by ${label}`);

  // Check if the same shift is already active on the target
  const existingShift = usersEffects.find(
    (e) =>
      e.type === effect.type &&
      e.targetId === target.userId &&
      e.id !== effect.id &&
      isEffectEnabled(e, usersEffects),
  );
  // Restored bloodline tags keep their duration; the overlapping jutsu is rejected.
  if (existingShift && (effect.isNew || effect.fromType !== "bloodline")) {
    effect.rounds = 0;
    return {
      txt: `${target.username} already has ${label} active`,
      color: "blue",
    };
  }

  // Calculate chance of success
  const { power } = getPower(effect);
  const primaryCheck = Math.random() < power / 100;
  if (effect.isNew && effect.rounds && effect.castThisRound) {
    if (primaryCheck) {
      const elementText = effect.elements?.length
        ? ` [${effect.elements.join(", ")} element jutsu]`
        : " [all jutsu]";
      return {
        txt: `${target.username} is affected by ${label}, actions will cost ${TEMPORAL_AP_DELTA} ${costChange} AP${elementText}`,
        color,
      };
    } else {
      effect.rounds = 0;
      return {
        txt: `${target.username} resists the ${label} effect`,
        color: "blue",
      };
    }
  }
};

/**
 * Pull target towards the user by power number of spaces
 */
export const redirection = (
  battle: ReturnedBattle,
  effect: UserEffect,
  usersEffects: UserEffect[],
  caster: BattleUserState,
  target: BattleUserState,
  usersState: BattleUserState[],
  groundEffects: GroundEffect[],
): ActionEffect | undefined => {
  // Check if redirection is prevented
  const { pass } = preventCheck(usersEffects, "moveprevent", target, effect);
  if (!pass) return preventResponse(effect, target, "cannot be redirected");

  // Get power (number of spaces to move) and direction
  const { power } = getPower(effect);
  const direction = effect.direction || "pull";

  // Only apply redirection if it's 0 rounds (instant)
  if (!(effect.rounds === 0 && effect.isNew && effect.castThisRound)) {
    return;
  }

  // Check if target and caster are at the same position
  if (target.longitude === caster.longitude && target.latitude === caster.latitude) {
    return {
      txt: `${target.username} is already at the caster's location`,
      color: "blue",
    };
  }

  // A pull stops next to the caster; a push travels its full power.
  const origin = { col: target.longitude, row: target.latitude };
  const casterTile = { col: caster.longitude, row: caster.latitude };
  const casterDistance = oddQHexDistance(
    origin.col,
    origin.row,
    casterTile.col,
    casterTile.row,
  );
  const moveDistance =
    direction === "pull" ? Math.min(power, Math.max(0, casterDistance - 1)) : power;

  if (moveDistance === 0) {
    return {
      txt: `${target.username} cannot be moved any further`,
      color: "blue",
    };
  }

  const line = oddQLineStep(
    origin,
    casterTile,
    direction === "pull" ? moveDistance : -moveDistance,
  );
  const landing = {
    col: clamp(line.col, 0, battle.width - 1),
    row: clamp(line.row, 0, battle.height - 1),
  };

  const isOpenTile = ({ col, row }: typeof origin) =>
    col >= 0 &&
    col < battle.width &&
    row >= 0 &&
    row < battle.height &&
    !(col === caster.longitude && row === caster.latitude) &&
    !usersState.some(
      (u) => u.userId !== target.userId && u.longitude === col && u.latitude === row,
    ) &&
    !groundEffects.some(
      (g) => g.longitude === col && g.latitude === row && "curHealth" in g,
    );

  // Step back from an occupied landing tile; with no open tile the target stays put.
  const landingDistance = oddQHexDistance(
    origin.col,
    origin.row,
    landing.col,
    landing.row,
  );
  const destination =
    Array.from({ length: landingDistance }, (_, steps) =>
      oddQLineStep(landing, origin, steps),
    ).find(isOpenTile) ?? origin;

  relocateUser(
    target,
    destination.col,
    destination.row,
    groundEffects,
    effect.createdRound,
  );

  const actualDistance = oddQHexDistance(
    origin.col,
    origin.row,
    destination.col,
    destination.row,
  );

  const actionText = direction === "push" ? "pushed away from" : "pulled towards";

  return {
    txt: `${target.username} is ${actionText} ${caster.username} by ${actualDistance} spaces`,
    color: "blue",
  };
};

/**
 * Summon tag. On the cast round it refuses in auto-resolved battle types,
 * resolves the template AI (controllerId === effect.aiId), applies the summon cap
 * backstop, spawns a stand-in with the effect's aiHp and the template's bloodline
 * and effects, and inserts it into usersState at its summoner's initiative. When
 * the effect expires (rounds === 0) it removes the creature recorded in
 * summonedUserId. Summon predicates and lifecycle helpers are in summon.ts.
 */
export const summon = (
  usersState: BattleUserState[],
  effect: GroundEffect,
  userEffects: UserEffect[],
  battle: Battle,
) => {
  const { power } = getPower(effect);
  const perc = power / 100;
  const user = usersState.find((u) => u.userId === effect.creatorId);
  if (!("aiId" in effect)) {
    throw new Error("Summon effect must have aiId");
  }

  if (effect.isNew && effect.castThisRound) {
    effect.isNew = false;
    // No summons in auto-resolved battle types (KAGE_AI / CLAN_CHALLENGE), where
    // there are no human turns — not even AI-cast ones.
    if (!summonsAllowedInBattle(battle)) {
      effect.rounds = 0;
      return;
    }
    if (user && "aiHp" in effect) {
      // Template AI to clone: match on controllerId, because
      // processUsersForBattle loads AI templates with controllerId = their DB
      // userId (=== effect.aiId) and a fresh nanoid as their in-battle userId.
      // effect.aiId always names the template, so a re-cast resolves it again.
      // A dungeon enemy can share the source ID after spending its loadout.
      const ai =
        usersState.find((u) => u.controllerId === effect.aiId && u.isSummonTemplate) ??
        usersState.find((u) => u.controllerId === effect.aiId);
      // Cap backstop. The router refuses a blocked cast before any pools are
      // spent, so a human never reaches this; it still guards AI casts and any
      // other path that reaches applyEffects directly.
      const wantsPilot = shouldPilotSummon(user, effect.playerControlled);
      const blocked = summonCastBlockedReason(
        usersState,
        user.userId,
        effect.aiId,
        wantsPilot,
      );
      if (blocked) {
        effect.rounds = 0;
        return { txt: blocked, color: "red" } as ActionEffect;
      }
      if (ai) {
        const newAi = spawnStandIn(ai, user, effect, perc, "ai");
        // An original creature, not a clone. Set explicitly (clones set
        // isOriginal=false) so the isClone discriminator never misreads a summon.
        newAi.isOriginal = true;
        newAi.isPiloted = wantsPilot;
        // AI exhibition rules also control summons that would normally accept player actions.
        if (battle.extraState?.tournamentAiOnly) newAi.isAutoCombat = true;
        // Remember which creature this is: controllerId is about to be rebound
        // to the summoner, so this is the only surviving link to the template.
        newAi.summonSourceId = effect.aiId;
        // Record which creature this effect spawned so teardown is exact.
        effect.summonedUserId = newAi.userId;
        // Set pools
        newAi.maxHealth = effect.aiHp;
        newAi.curHealth = newAi.maxHealth;
        // Lookup bloodline from extraState and copy bloodlineId
        const aiBloodline = ai.bloodlineId
          ? battle.extraState.bloodlines?.[ai.bloodlineId]
          : null;
        newAi.bloodlineId = ai.bloodlineId;
        const realizeOnSummon = (
          tag: BattleEffect,
          fromType: UserEffect["fromType"],
        ) => {
          const realizedEffect = realizeTag({
            tag,
            user: newAi,
            actionId: "initial",
            level: newAi.level,
            round: battle.round,
          }) as UserEffect;
          realizedEffect.targetId = newAi.userId;
          realizedEffect.fromType = fromType;
          userEffects.push(realizedEffect);
          return realizedEffect;
        };
        // Realize bloodline effects if they exist
        aiBloodline?.effects?.forEach((bloodlineEffect) => {
          realizeOnSummon(bloodlineEffect as BattleEffect, "bloodline");
        });
        // Realize and copy the AI's effects. Summon isn't a valid fromType.
        newAi.effects = ai.effects.map((aiEffect) =>
          realizeOnSummon(aiEffect as BattleEffect, "jutsu"),
        );
        // Turn order is usersState order, and initiateBattle establishes that
        // array as initiative-sorted (descending). Give the summon its
        // summoner's initiative and insert it at the matching sorted position,
        // which keeps that invariant intact instead of splicing blind. With no
        // other combatant on the summoner's initiative this lands the summon
        // directly after them, so a piloted pair still acts back to back.
        newAi.initiative = user.initiative;
        const insertAt = usersState.findIndex((u) => u.initiative < newAi.initiative);
        if (insertAt === -1) {
          usersState.push(newAi);
        } else {
          usersState.splice(insertAt, 0, newAi);
        }
        // ActionEffect to be shown
        return {
          txt: `${newAi.username} was summoned for ${effect.rounds} rounds!`,
          color: "blue",
        } as ActionEffect;
      }
    }
    // Reaching here means the template AI could not be resolved.
    effect.rounds = 0;
    return {
      txt: `${user?.username ?? "Summoner"}'s summon creature could not be found.`,
      color: "red",
    } as ActionEffect;
  } else if (effect?.rounds === 0) {
    // Remove exactly the creature this effect spawned. aiId stays pointed at the
    // clone-source template (so re-cast works), so the spawned id is carried on
    // summonedUserId instead.
    const idx = usersState.findIndex((u) => u.userId === effect.summonedUserId);
    if (idx > -1) {
      const removed = usersState[idx];
      usersState.splice(idx, 1);
      return {
        txt: `${removed?.username} was unsummoned!`,
        color: "red",
      } as ActionEffect;
    }
  }
};

/**
 * Weakness tag: rolls power% each round to report the weakness as applied, and
 * cancels a new effect whose first roll fails. calcDmgModifier reads enabled
 * weakness effects to scale matching damage.
 */
export const weakness = (effect: UserEffect, target: BattleUserState) => {
  const { power } = getPower(effect);
  const mainCheck = Math.random() < power / 100;
  if (mainCheck) {
    return getInfo(target, effect, "weaknesses applied");
  } else if (effect.isNew) {
    effect.rounds = 0;
  }
};

/**
 * ***********************************************
 *              UTILITY METHODS
 * ***********************************************
 */

/**
 * Prevention response from the target user
 */
export const preventResponse = (
  effect: UserEffect | GroundEffect,
  target: BattleUserState,
  msg: string,
) => {
  effect.rounds = 0;
  return {
    txt: `${target.username} ${msg}`,
    color: "blue",
  } as ActionEffect;
};

/** Prevention from a buff/debuff prevent tag older than the effect. */
const olderPreventResponse = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  kind: "buffprevent" | "debuffprevent",
  target: BattleUserState,
  message = kind === "buffprevent" ? "cannot be buffed" : "cannot be debuffed",
) => {
  const { pass } = preventCheck(usersEffects, kind, target, effect);
  return pass ? undefined : preventResponse(effect, target, message);
};

/**
 * Stores a decrease tag's power as negative. Persisted on the effect: AI rules read the
 * raw signed power from battle state.
 */
export const invertPower = <T extends UserEffect>(effect: T): T => {
  effect.power = -Math.abs(effect.power);
  effect.powerPerLevel = -Math.abs(effect.powerPerLevel);
  return effect;
};

/** Damage a conversion tag claims: a percentage of the hit, or flat power capped at it. */
const capConversion = (effect: UserEffect, power: number, damage: number) =>
  Math.floor(
    effect.calculation === "percentage"
      ? damage * (power / 100)
      : Math.min(power, damage),
  );

/**
 * Returns an array of lowercase generals based on the input array of generals and the user's highest generals.
 * If the input array contains the value "Highest", the function will include the user's highest generals in the result.
 *
 * @param generals - An array of GeneralType values.
 * @param highestGenerals - The user's highest generals, used for "Highest".
 * @returns An array of lowercase generals.
 */
export const getLowerGenerals = (
  generals?: GeneralType[],
  highestGenerals?: (typeof GenNames)[number][],
) => {
  return [
    ...(generals?.filter((g) => g !== "Highest").map((g) => g.toLowerCase()) || []),
    ...(generals?.find((g) => g === "Highest") ? highestGenerals || [] : []),
  ];
};

const getInfo = (
  target: BattleUserState,
  e: UserEffect,
  msg: string,
): ActionEffect | undefined => {
  if (e.isNew && e.rounds) {
    // If the effect is for pool adjustment, use purple; otherwise blue.
    const infoColor =
      e.type === "increasepoolcost" || e.type === "decreasepoolcost"
        ? "purple"
        : "blue";
    return {
      txt: `${target.username} ${msg} for the next ${e.rounds} rounds`,
      color: infoColor,
    };
  }
  return undefined;
};

/** Convenience method used by a lot of tags */
export const getPower = (effect: UserEffect | GroundEffect) => {
  const power = getEffectPower(effect);
  const adverb = power > 0 ? "increased" : "decreased";
  const value = Math.abs(power);
  const qualifier = effect.calculation === "percentage" ? `${value}%` : value;
  return { power, adverb, qualifier };
};

/**
 * Calculate ratio of user stats & elements between one user effect to another
 * Returns a ratio between 0 to 1, 0 indicating e.g. that none of the stats in LHS are
 * matched in the RHS, whereas a ratio of 1 means everything is matched by a value in RHS
 */
export const getEfficiencyRatio = (dmgEffect: UserEffect, effect: UserEffect) => {
  // Damage-derived tags (absorb, reflect, lifesteal, ...) are only limited by generals.
  // Their elements only gate who can learn the jutsu (see checkJutsuElements); they
  // never restrict which hits the tag converts.
  if (damageDerivedTagTypes.includes(effect.type)) {
    const generals = "generalTypes" in effect ? effect.generalTypes : undefined;
    if (!generals?.length || dmgEffect.type === "pierce") return 1;
    const effectGenerals = getLowerGenerals(generals, effect.highestGenerals);
    const dmgGenerals =
      "generalTypes" in dmgEffect
        ? getLowerGenerals(dmgEffect.generalTypes, dmgEffect.highestGenerals)
        : [];
    return dmgGenerals.some((general) => effectGenerals.includes(general)) ? 1 : 0;
  }
  // Damage modifiers are universal unless explicitly limited to matching elements.
  if (damageModifierTypes.includes(effect.type)) {
    if (!("elements" in effect) || !effect.elements?.length) return 1;
    const damageElements: ElementName[] =
      "elements" in dmgEffect && dmgEffect.elements?.length
        ? dmgEffect.elements
        : ["None"];
    return effect.elements.some((element) => damageElements.includes(element)) ? 1 : 0;
  }
  // Force reflect for pierce damage, bypassing tag matching
  if (dmgEffect.type === "pierce") return 1;
  // We need to get the list of dmgEffect stats/gens/elements and effect stats/gens/elements
  const getTags = (e: UserEffect) => {
    const tags: string[] = [];
    if ("statTypes" in e) {
      e.statTypes?.forEach((statType: StatType) => {
        tags.push(statType);
      });
    }
    if ("generalTypes" in e) {
      tags.push(...getLowerGenerals(e.generalTypes, e.highestGenerals));
    }
    if ("elements" in e && e.elements && e.elements.length > 0) {
      tags.push(...e.elements);
    } else {
      tags.push("None");
    }
    return tags;
  };
  const dmgTags = getTags(dmgEffect);
  const effectTags = getTags(effect);

  // Ratio for whether to apply the effect or not
  let baseRatio = false;
  dmgTags.forEach((stat) => {
    if (effectTags.includes(stat)) {
      baseRatio = true;
    }
  });
  return baseRatio ? 1 : 0;
};

/**
 * Apply a callback to each outgoing damage consequence created this cast round.
 * Used by instant damage-conversion tags such as vamp.
 */
const forEachOutgoingDamage = (
  effect: UserEffect,
  consequences: Map<string, Consequence>,
  fn: (c: Consequence) => void,
) => {
  if (!effect.isNew || !effect.castThisRound) return;
  consequences.forEach((c) => {
    if (
      c.userId === effect.creatorId &&
      c.targetId !== effect.creatorId &&
      typeof c.damage === "number" &&
      c.damage > 0
    ) {
      fn(c);
    }
  });
};

/**
 * Checks for a given prevent action, e.g. stunprevent, fleeprevent, etc.
 * if true, then the action is not prevented, if false then the check failed and the prevent is applied
 */
const preventCheck = (
  usersEffects: UserEffect[],
  type: PreventTagType,
  target: BattleUserState,
  effect?: UserEffect,
) => {
  const preventTag = getActiveTargetEffects(usersEffects, target.userId, type)[0];

  if (!preventTag) return { pass: true };
  // Only prevent if the effect being checked was created after the prevent effect
  if (effect && preventTag.createdRound >= effect.createdRound) return { pass: true };
  return { pass: Math.random() > getEffectPower(preventTag) / 100 };
};

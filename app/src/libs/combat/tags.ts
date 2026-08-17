import { noCase } from "change-case";
import { nanoid } from "nanoid";
import type {
  BattleType,
  ElementName,
  GeneralType,
  PoolType,
  StatType,
} from "@/drizzle/constants";
import {
  COPY_MAX_TAGS,
  COPY_PRIORITY_RANK,
  COPYABLE_EFFECT_TYPES,
  MIRROR_EXCLUDED_EFFECT_TYPES,
  MIRROR_MAX_TAGS,
  MIRROR_PRIORITY_RANK,
  SAGE_MODE_ACTIVATION_JUTSU_ID,
  TRANSFER_EXCLUDED_SOURCE_TYPES,
} from "@/drizzle/constants";
import type { Battle } from "@/drizzle/schema";
import {
  hasLiveSummon,
  isClone,
  isLiveSummon,
  shouldPilotSummon,
  summonsAllowedInBattle,
} from "@/libs/combat/summon";
import type { CombatAction } from "@/libs/combat/types";
import {
  getBaseDamageForModifier,
  getPoolsAffected,
  getPreventTypeName,
  isEffectActive,
  selectTransferEffects,
} from "@/libs/combat/util";
import { calcHP, scaleUserStats } from "@/libs/profile";
import { capitalizeFirstLetter } from "@/utils/sanitize";
import type {
  PreventTagType,
  ShieldTagType,
  WeaknessTagType,
} from "@/validators/combat";
import {
  DecreaseCooldownTag,
  HealTag,
  IncreaseCooldownTag,
  IncreaseRangeTag,
  isNegativeUserEffect,
  isPositiveUserEffect,
} from "@/validators/combat";
import type { DmgConfig, GenName, GenNames, StatNames } from "./constants";
import type {
  ActionEffect,
  BattleEffect,
  BattleUserState,
  Consequence,
  GroundEffect,
  ReturnedBattle,
  ReturnedUserState,
  UserEffect,
} from "./types";

/**
 * Minimal user type for realizeTag - only includes fields actually used
 */
type RealizeTagUser = Pick<
  ReturnedUserState,
  "userId" | "villageId" | "highestOffence" | "highestDefence" | "highestGenerals"
>;

/**
 * Realize tag with information about how powerful tag is
 */
export const realizeTag = <T extends BattleEffect>(props: {
  tag: T;
  user: RealizeTagUser;
  actionId: string;
  target?: RealizeTagUser | undefined;
  level: number | undefined;
  round?: number;
  barrierAbsorb?: number;
  battle?: Battle; // Make battle optional since it's not always needed
}): T => {
  const { tag, user, target, level, round, barrierAbsorb, battle } = props;
  if ("rounds" in tag) {
    tag.timeTracker = {};
  }
  tag.id = nanoid();
  tag.createdRound = round || 0;
  tag.creatorId = user.userId;
  tag.villageId = user.villageId;
  tag.targetType = "user";
  tag.level = level ?? 0;
  tag.isNew = true;
  tag.castThisRound = true;
  tag.highestOffence = user.highestOffence;
  tag.highestDefence = user.highestDefence;
  tag.highestGenerals = user.highestGenerals;
  tag.barrierAbsorb = barrierAbsorb || 0;
  tag.actionId = props.actionId;
  if ("maxHealth" in tag && "curHealth" in tag) {
    if (tag.curHealth > tag.maxHealth) {
      tag.curHealth = tag.maxHealth;
    }
  }
  if (target) {
    tag.targetHighestOffence = target.highestOffence;
    tag.targetHighestDefence = target.highestDefence;
    tag.targetHighestGenerals = target.highestGenerals;
  }
  if (battle && "rounds" in tag) {
    tag.createdRound = battle.round; // Use battle round if available
  }
  return structuredClone(tag);
};

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
  const pools =
    "poolsAffected" in effect && effect.poolsAffected
      ? effect.poolsAffected
      : ["Health" as const];
  const nPools = pools.length;
  // Apply the absorb effect the round after the effect is applied
  if (!effect.isNew && !effect.castThisRound) {
    consequences.forEach((consequence, effectId) => {
      if (
        consequence.targetId === effect.targetId &&
        consequence.damage &&
        consequence.damage > 0
      ) {
        const damageEffect = usersEffects.find((e) => e.id === effectId);
        if (damageEffect) {
          const ratio = getEfficiencyRatio(damageEffect, effect);
          // Calculate absorption amount for this effect
          const absorbAmount =
            effect.calculation === "percentage"
              ? consequence.damage * (power / 100)
              : Math.min(power, consequence.damage);
          const convert = Math.ceil(absorbAmount * ratio);

          // Apply absorption to each pool
          pools.forEach((pool: PoolType) => {
            switch (pool) {
              case "Health":
                // Add to existing absorb value instead of overwriting
                consequence.absorb_hp = (consequence.absorb_hp || 0) + convert / nPools;
                break;
              case "Stamina":
                // Add to existing absorb value instead of overwriting
                consequence.absorb_sp = (consequence.absorb_sp || 0) + convert / nPools;
                break;
              case "Chakra":
                // Add to existing absorb value instead of overwriting
                consequence.absorb_cp = (consequence.absorb_cp || 0) + convert / nPools;
                break;
            }
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
        (e.rounds === undefined || e.rounds > 0) &&
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

/** Prevent buffing */
export const buffPrevent = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  target: BattleUserState,
): ActionEffect | undefined => {
  const immunityBlocked = checkPreventImmunity(effect, usersEffects, target, "buff");
  if (immunityBlocked) return immunityBlocked;
  const { power } = getPower(effect);
  const mainCheck = Math.random() < power / 100;
  if (mainCheck) {
    const info = getInfo(target, effect, "cannot be buffed");
    effect.power = 100;
    return info;
  } else if (effect.isNew) {
    effect.rounds = 0;
    return {
      txt: `${target.username} could not be prevented from buffs`,
      color: "blue",
    };
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
 * a type already held, still active, and not depleted (a fully absorbed shield
 * keeps rounds > 0 at power 0 — transferring it would burn a slot for nothing).
 */
const isTransferCandidate = (e: UserEffect, heldTypes: Set<string>): boolean =>
  !TRANSFER_EXCLUDED_SOURCE_TYPES.has(e.fromType || "") &&
  !e.fromGround &&
  !heldTypes.has(e.type) &&
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
    heldTypes: new Set(active.map((e) => e.type)),
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

/** Copy positive effects from opponent to self (priority-ranked, capped, unique per type) */
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
      const { heldTypes, remaining } = getTransferBudget(
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
          isTransferCandidate(e, heldTypes),
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

/** Mirror negative effects from self to target (priority-ranked, capped, unique per type) */
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
      const { heldTypes, remaining } = getTransferBudget(
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
            isTransferCandidate(e, heldTypes),
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

/** Prevent debuffing */
export const debuffPrevent = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  target: BattleUserState,
): ActionEffect | undefined => {
  const immunityBlocked = checkPreventImmunity(effect, usersEffects, target, "debuff");
  if (immunityBlocked) return immunityBlocked;
  const { power } = getPower(effect);
  const mainCheck = Math.random() < power / 100;
  if (mainCheck) {
    const info = getInfo(target, effect, "cannot be debuffed");
    effect.power = 100;
    return info;
  } else if (effect.isNew) {
    effect.rounds = 0;
    return {
      txt: `${target.username} could not be prevented from debuffs`,
      color: "blue",
    };
  }
};

export const getAffected = (effect: UserEffect, type?: "offence" | "defence") => {
  const stats: string[] = [];
  if ("statTypes" in effect && effect.statTypes) {
    effect.statTypes.forEach((stat: StatType) => {
      if (stat === "Highest") {
        const highestOffence = effect.highestOffence;
        if (highestOffence && (!type || type === "offence")) {
          stats.push(getStatTypeFromStat(highestOffence));
        }
        const highestDefence = effect.highestDefence;
        if (highestDefence && (!type || type === "defence")) {
          stats.push(getStatTypeFromStat(highestDefence));
        }
      } else {
        stats.push(stat);
      }
    });
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

/** Adjust stats of target based on effect */
export const adjustStats = (effect: UserEffect, target: BattleUserState) => {
  const { power, adverb, qualifier } = getPower(effect);
  const affected = getAffected(effect);
  if ("statTypes" in effect || "generalTypes" in effect) {
    if (!effect.isNew && !effect.castThisRound) {
      effect.statTypes?.forEach((stat: StatType) => {
        if (stat === "Highest") {
          if (effect.calculation === "static") {
            if (effect.direction === "offence" || effect.direction === "both") {
              switch (target.highestOffence) {
                case "ninjutsuOffence":
                  target.ninjutsuOffence += power;
                  break;
                case "genjutsuOffence":
                  target.genjutsuOffence += power;
                  break;
                case "taijutsuOffence":
                  target.taijutsuOffence += power;
                  break;
                case "bukijutsuOffence":
                  target.bukijutsuOffence += power;
                  break;
              }
            }
            if (effect.direction === "defence" || effect.direction === "both") {
              switch (target.highestDefence) {
                case "ninjutsuDefence":
                  target.ninjutsuDefence += power;
                  break;
                case "genjutsuDefence":
                  target.genjutsuDefence += power;
                  break;
                case "taijutsuDefence":
                  target.taijutsuDefence += power;
                  break;
                case "bukijutsuDefence":
                  target.bukijutsuDefence += power;
                  break;
              }
            }
          } else {
            // Percentage calculation - use additive stacking
            if (effect.direction === "offence" || effect.direction === "both") {
              applyPercentageStatModifier(target, target.highestOffence, power);
            }
            if (effect.direction === "defence" || effect.direction === "both") {
              applyPercentageStatModifier(target, target.highestDefence, power);
            }
          }
        } else if (stat === "Ninjutsu") {
          if (effect.calculation === "static") {
            if (effect.direction === "offence" || effect.direction === "both") {
              target.ninjutsuOffence += power;
            }
            if (effect.direction === "defence" || effect.direction === "both") {
              target.ninjutsuDefence += power;
            }
          } else {
            // Percentage calculation - use additive stacking
            if (effect.direction === "offence" || effect.direction === "both") {
              applyPercentageStatModifier(target, "ninjutsuOffence", power);
            }
            if (effect.direction === "defence" || effect.direction === "both") {
              applyPercentageStatModifier(target, "ninjutsuDefence", power);
            }
          }
        } else if (stat === "Genjutsu") {
          if (effect.calculation === "static") {
            if (effect.direction === "offence" || effect.direction === "both") {
              target.genjutsuOffence += power;
            }
            if (effect.direction === "defence" || effect.direction === "both") {
              target.genjutsuDefence += power;
            }
          } else {
            // Percentage calculation - use additive stacking
            if (effect.direction === "offence" || effect.direction === "both") {
              applyPercentageStatModifier(target, "genjutsuOffence", power);
            }
            if (effect.direction === "defence" || effect.direction === "both") {
              applyPercentageStatModifier(target, "genjutsuDefence", power);
            }
          }
        } else if (stat === "Taijutsu") {
          if (effect.calculation === "static") {
            if (effect.direction === "offence" || effect.direction === "both") {
              target.taijutsuOffence += power;
            }
            if (effect.direction === "defence" || effect.direction === "both") {
              target.taijutsuDefence += power;
            }
          } else {
            // Percentage calculation - use additive stacking
            if (effect.direction === "offence" || effect.direction === "both") {
              applyPercentageStatModifier(target, "taijutsuOffence", power);
            }
            if (effect.direction === "defence" || effect.direction === "both") {
              applyPercentageStatModifier(target, "taijutsuDefence", power);
            }
          }
        } else if (stat === "Bukijutsu") {
          if (effect.calculation === "static") {
            if (effect.direction === "offence" || effect.direction === "both") {
              target.bukijutsuOffence += power;
            }
            if (effect.direction === "defence" || effect.direction === "both") {
              target.bukijutsuDefence += power;
            }
          } else {
            // Percentage calculation - use additive stacking
            if (effect.direction === "offence" || effect.direction === "both") {
              applyPercentageStatModifier(target, "bukijutsuOffence", power);
            }
            if (effect.direction === "defence" || effect.direction === "both") {
              applyPercentageStatModifier(target, "bukijutsuDefence", power);
            }
          }
        }
      });
      effect.generalTypes?.forEach((general: GeneralType) => {
        if (general === "Highest") {
          if (effect.calculation === "static") {
            target.highestGenerals.forEach((gen: (typeof GenNames)[number]) => {
              target[gen] += power;
            });
          } else if (effect.calculation === "percentage") {
            // Percentage calculation - use additive stacking
            target.highestGenerals.forEach((gen: (typeof GenNames)[number]) => {
              applyPercentageStatModifier(target, gen, power);
            });
          }
        } else if (general === "Strength") {
          if (effect.calculation === "static") {
            target.strength += power;
          } else if (effect.calculation === "percentage") {
            applyPercentageStatModifier(target, "strength", power);
          }
        } else if (general === "Intelligence") {
          if (effect.calculation === "static") {
            target.intelligence += power;
          } else if (effect.calculation === "percentage") {
            applyPercentageStatModifier(target, "intelligence", power);
          }
        } else if (general === "Willpower") {
          if (effect.calculation === "static") {
            target.willpower += power;
          } else if (effect.calculation === "percentage") {
            applyPercentageStatModifier(target, "willpower", power);
          }
        } else if (general === "Speed") {
          if (effect.calculation === "static") {
            target.speed += power;
          } else if (effect.calculation === "percentage") {
            applyPercentageStatModifier(target, "speed", power);
          }
        }
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
) => {
  const { pass, preventTag } = preventCheck(usersEffects, "buffprevent", target);
  if (preventTag && preventTag.createdRound < effect.createdRound) {
    if (!pass) return preventResponse(effect, target, "cannot be buffed");
  }
  return adjustStats(effect, target);
};

// ---------------------------------------------
// Helper to adjust basic action attributes
// ---------------------------------------------
const adjustBasicAction = (
  parsed: { actionsAffected?: string[] },
  effect: UserEffect,
  usersEffects: UserEffect[],
  target: BattleUserState,
  opts: { attr: "range" | "cooldown"; isBuff: boolean },
): ActionEffect | undefined => {
  const { attr, isBuff } = opts;
  // Determine if blocked by (de)buff prevent
  const preventKind = isBuff ? "buffprevent" : "debuffprevent";
  const { pass, preventTag } = preventCheck(usersEffects, preventKind, target);
  if (preventTag && preventTag.createdRound < effect.createdRound) {
    if (!pass)
      return preventResponse(
        effect,
        target,
        `cannot be ${isBuff ? "buffed" : "debuffed"}`,
      );
  }

  const { adverb, qualifier } = getPower(effect);
  const affected = parsed.actionsAffected?.map((a) => noCase(a)).join(", ");

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
    `basic action${affected && "s"} [${affected}] ${verb}`,
  );
};

/** Increase range of basic actions */
export const increaseRange = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  target: BattleUserState,
): ActionEffect | undefined => {
  const parsed = IncreaseRangeTag.parse(effect);
  return adjustBasicAction(parsed, effect, usersEffects, target, {
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
  const parsed = IncreaseCooldownTag.parse(effect);
  return adjustBasicAction(parsed, effect, usersEffects, target, {
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
  const parsed = DecreaseCooldownTag.parse(effect);
  return adjustBasicAction(parsed, effect, usersEffects, target, {
    attr: "cooldown",
    isBuff: true,
  });
};

export const decreaseStats = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  target: BattleUserState,
) => {
  const { pass, preventTag } = preventCheck(usersEffects, "debuffprevent", target);
  if (preventTag && preventTag.createdRound < effect.createdRound) {
    if (!pass) return preventResponse(effect, target, "cannot be debuffed");
  }
  // Make power negative to decrease stats
  effect.power = -Math.abs(effect.power);
  effect.powerPerLevel = -Math.abs(effect.powerPerLevel);
  return adjustStats(effect, target);
};

/** Adjust damage given by target. Applies to both direct and residual (DOT) damage. */
export const adjustDamageGiven = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  consequences: Map<string, Consequence>,
  target: BattleUserState,
) => {
  const { power, adverb, qualifier } = getPower(effect);
  const affected = getAffected(effect, "offence");
  if (!effect.isNew && !effect.castThisRound) {
    consequences.forEach((consequence, effectId) => {
      const damageKey =
        consequence.damage !== undefined
          ? "damage"
          : consequence.residual !== undefined
            ? "residual"
            : undefined;
      if (consequence.userId === effect.targetId && damageKey !== undefined) {
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
    `damage given [${affected}] is ${adverb} by up to ${qualifier}`,
  );
};

export const increaseDamageGiven = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  consequences: Map<string, Consequence>,
  target: BattleUserState,
) => {
  const { pass, preventTag } = preventCheck(usersEffects, "buffprevent", target);
  if (preventTag && preventTag.createdRound < effect.createdRound) {
    if (!pass) return preventResponse(effect, target, "cannot be buffed");
  }
  return adjustDamageGiven(effect, usersEffects, consequences, target);
};

export const decreaseDamageGiven = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  consequences: Map<string, Consequence>,
  target: BattleUserState,
) => {
  const { pass, preventTag } = preventCheck(usersEffects, "debuffprevent", target);
  if (preventTag && preventTag.createdRound < effect.createdRound) {
    if (!pass) return preventResponse(effect, target, "cannot be debuffed");
  }
  effect.power = -Math.abs(effect.power);
  effect.powerPerLevel = -Math.abs(effect.powerPerLevel);
  return adjustDamageGiven(effect, usersEffects, consequences, target);
};

/** Adjust damage taken by user. Applies to both direct and residual (DOT) damage. */
export const adjustDamageTaken = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  consequences: Map<string, Consequence>,
  target: BattleUserState,
) => {
  const { power, adverb, qualifier } = getPower(effect);
  const affected = getAffected(effect, "offence");
  if (!effect.isNew && !effect.castThisRound) {
    consequences.forEach((consequence, effectId) => {
      const damageKey =
        consequence.damage !== undefined
          ? "damage"
          : consequence.residual !== undefined
            ? "residual"
            : undefined;
      if (consequence.targetId === effect.targetId && damageKey !== undefined) {
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
    `damage taken [${affected}] is ${adverb} by up to ${qualifier}`,
  );
};

export const increaseDamageTaken = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  consequences: Map<string, Consequence>,
  target: BattleUserState,
) => {
  const { pass, preventTag } = preventCheck(usersEffects, "debuffprevent", target);
  if (preventTag && preventTag.createdRound < effect.createdRound) {
    if (!pass) return preventResponse(effect, target, "cannot be debuffed");
  }
  return adjustDamageTaken(effect, usersEffects, consequences, target);
};

export const decreaseDamageTaken = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  consequences: Map<string, Consequence>,
  target: BattleUserState,
) => {
  const { pass, preventTag } = preventCheck(usersEffects, "buffprevent", target);
  if (preventTag && preventTag.createdRound < effect.createdRound) {
    if (!pass) return preventResponse(effect, target, "cannot be buffed");
  }
  effect.power = -Math.abs(effect.power);
  effect.powerPerLevel = -Math.abs(effect.powerPerLevel);
  return adjustDamageTaken(effect, usersEffects, consequences, target);
};

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

  const { pass, preventTag } = preventCheck(usersEffects, preventType, target);
  if (preventTag && preventTag.createdRound < effect.createdRound && !pass) {
    const message =
      preventType === "buffprevent" ? "cannot be buffed" : "cannot be debuffed";
    return { blocked: true, info: preventResponse(effect, target, message) };
  }
  return { blocked: false, info: undefined };
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
    consequences.forEach((consequence, effectId) => {
      // Adjust heal
      if (consequence.userId === effect.targetId && consequence.heal_hp) {
        const healEffect = usersEffects.find((e) => e.id === effectId);
        if (healEffect) {
          const change =
            effect.calculation === "percentage"
              ? (power / 100) * consequence.heal_hp
              : power;
          consequence.heal_hp = consequence.heal_hp + change;
        }
      }
      // Adjust lifesteal
      if (consequence.userId === effect.targetId && consequence.lifesteal_hp) {
        const stealEffect = usersEffects.find((e) => e.id === effectId);
        if (stealEffect) {
          const change =
            effect.calculation === "percentage"
              ? (power / 100) * consequence.lifesteal_hp
              : power;
          consequence.lifesteal_hp = consequence.lifesteal_hp + change;
        }
      }
      // Adjust vamp
      if (consequence.userId === effect.targetId && consequence.vampRatio) {
        const vampEffect = usersEffects.find((e) => e.id === effectId);
        if (vampEffect) {
          const change =
            effect.calculation === "percentage"
              ? (power / 100) * consequence.vampRatio
              : // vampRatio is a 0-1 ratio, so convert flat power (%) to ratio.
                power / 100;
          consequence.vampRatio = consequence.vampRatio + change;
        }
      }
      // Adjust absorb
      if (consequence.targetId === effect.targetId && consequence.absorb_hp) {
        const absorbEffect = usersEffects.find((e) => e.id === effectId);
        if (absorbEffect) {
          const change =
            effect.calculation === "percentage"
              ? (power / 100) * consequence.absorb_hp
              : power;
          consequence.absorb_hp = consequence.absorb_hp + change;
        }
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
) => {
  const { pass, preventTag } = preventCheck(usersEffects, "buffprevent", target);
  if (preventTag && preventTag.createdRound < effect.createdRound) {
    if (!pass) return preventResponse(effect, target, "cannot be buffed");
  }
  return adjustHealGiven(effect, usersEffects, consequences, target);
};

export const decreaseHealGiven = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  consequences: Map<string, Consequence>,
  target: BattleUserState,
) => {
  const { pass, preventTag } = preventCheck(usersEffects, "debuffprevent", target);
  if (preventTag && preventTag.createdRound < effect.createdRound) {
    if (!pass) return preventResponse(effect, target, "cannot be debuffed");
  }
  effect.power = -Math.abs(effect.power);
  effect.powerPerLevel = -Math.abs(effect.powerPerLevel);
  return adjustHealGiven(effect, usersEffects, consequences, target);
};

const removeEffects = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  target: BattleUserState,
  type: "positive" | "negative",
) => {
  const { power } = getPower(effect);
  const mainCheck = Math.random() < power / 100;

  let text =
    effect.isNew && effect.rounds && effect.rounds > 0
      ? `All ${type} status effects may be cleared from ${target.username} during the next ${effect.rounds} rounds. `
      : "";

  if (mainCheck) {
    text = `${target.username} will be cleared of ${type} status effects on their next round. `;
    effect.rounds = 2;
    effect.power = 100;
  } else {
    text += `${target.username} could not be cleared of ${type} status effects this round. `;
  }

  // Note: add !effect.castThisRound && to remove effects only after the round
  if (effect.power === 100) {
    // Remove user effects
    usersEffects
      .filter((e) => e.targetId === effect.targetId)
      .filter((e) => !persistentEffectSourceTypes.has(e.fromType))
      .filter(type === "positive" ? isPositiveUserEffect : isNegativeUserEffect)
      .forEach((e) => {
        e.rounds = 0;
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

    text = `${target.username} was cleared of all ${type} status effects. `;
    effect.rounds = 0;
  }
  return { txt: text, color: "blue" } as ActionEffect;
};

/** Sources that `clear` / `cleanse` must not strip. Sage buffs and exhaustion are both protected. */
const persistentEffectSourceTypes = new Set<UserEffect["fromType"]>([
  "bloodline",
  "armor",
  "accessory",
  "keystone",
  "skill",
  "ranked",
  "village",
  "sageMode",
  "sageModeAfter",
]);

export const clear = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  target: BattleUserState,
) => {
  const { pass } = preventCheck(usersEffects, "clearprevent", target);
  if (!pass) return preventResponse(effect, target, "resists being cleared");
  return removeEffects(effect, usersEffects, target, "positive");
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
    const newAi = structuredClone(user);
    // Place on battlefield
    newAi.userId = nanoid();
    effect.creatorId = newAi.userId;
    newAi.isSummon = true;
    newAi.leftBattle = false;
    newAi.username = `${user.username} clone`;
    newAi.controllerId = user.userId;
    newAi.isOriginal = false;
    newAi.isSummonTemplate = false; // a clone is an active entity, not a template
    newAi.isPiloted = undefined; // a clone is AI-driven, never piloted
    newAi.isAi = true;
    newAi.hidden = undefined;
    newAi.sageModeId = null;
    newAi.sageModeActivated = false;
    newAi.sageModeActivatedRound = null;
    newAi.sageModeExpiresRound = null;
    newAi.sageModeUsedThisBattle = true;
    newAi.jutsus = newAi.jutsus.filter(
      (j) => j.jutsuId !== SAGE_MODE_ACTIVATION_JUTSU_ID,
    );
    newAi.longitude = effect.longitude;
    newAi.latitude = effect.latitude;
    newAi.villageId = user.villageId;
    newAi.direction = user.direction;
    // Set level to summoner level
    newAi.level = user.level;
    // Scale to level
    scaleUserStats(newAi);
    // Set stats
    newAi.ninjutsuOffence = newAi.ninjutsuOffence * perc;
    newAi.ninjutsuDefence = newAi.ninjutsuDefence * perc;
    newAi.genjutsuOffence = newAi.genjutsuOffence * perc;
    newAi.genjutsuDefence = newAi.genjutsuDefence * perc;
    newAi.taijutsuOffence = newAi.taijutsuOffence * perc;
    newAi.taijutsuDefence = newAi.taijutsuDefence * perc;
    newAi.bukijutsuOffence = newAi.bukijutsuOffence * perc;
    newAi.bukijutsuDefence = newAi.bukijutsuDefence * perc;
    newAi.strength = newAi.strength * perc;
    newAi.intelligence = newAi.intelligence * perc;
    newAi.willpower = newAi.willpower * perc;
    newAi.speed = newAi.speed * perc;
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
  if ("statTypes" in effect && "direction" in effect) {
    effect.statTypes?.forEach((statType: StatType) => {
      if (
        (effect.direction === "offence" && !inverse) ||
        (effect.direction === "defence" && inverse)
      ) {
        switch (statType) {
          case "Taijutsu":
            user.usedStats.taijutsuOffence += 1;
            break;
          case "Bukijutsu":
            user.usedStats.bukijutsuOffence += 1;
            break;
          case "Ninjutsu":
            user.usedStats.ninjutsuOffence += 1;
            break;
          case "Genjutsu":
            user.usedStats.genjutsuOffence += 1;
            break;
          case "Highest":
            user.usedStats[user.highestOffence] += 1;
            break;
        }
      } else {
        switch (statType) {
          case "Taijutsu":
            user.usedStats.taijutsuDefence += 1;
            break;
          case "Bukijutsu":
            user.usedStats.bukijutsuDefence += 1;
            break;
          case "Ninjutsu":
            user.usedStats.ninjutsuDefence += 1;
            break;
          case "Genjutsu":
            user.usedStats.genjutsuDefence += 1;
            break;
          case "Highest":
            user.usedStats[user.highestDefence] += 1;
            break;
        }
      }
    });
  }
  if ("generalTypes" in effect) {
    effect.generalTypes?.forEach((general: GeneralType) => {
      if (general === "Highest") {
        user.highestGenerals.forEach((gen: GenName) => {
          user.usedGenerals[gen] += 1;
        });
      } else {
        user.usedGenerals[general.toLowerCase() as GenName] += 1;
      }
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
    // Accumulate attack and defense power from stat types
    let atkPowerFromStats = 0;
    let defPowerFromStats = 0;

    effect.statTypes?.forEach((statType: StatType) => {
      let a = "";
      let b = "";
      if (statType === "Highest") {
        if (!effect.highestOffence || !effect.targetHighestDefence) return;
        a = effect.highestOffence;
        b = effect.targetHighestDefence;
      } else {
        const lower = statType.toLowerCase();
        a = `${lower}Offence`;
        b = `${lower}Defence`;
      }
      if (a in origin && b in target) {
        const left = origin[a as keyof typeof origin] as number;
        const right = target[b as keyof typeof target] as number;
        atkPowerFromStats += Math.sqrt(Math.max(0, left));
        defPowerFromStats += Math.sqrt(Math.max(0, right));
      }
    });

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
    .filter((e) => e.type === "weakness" && e.targetId === target.userId)
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

  // Find out if target has any weakness tag related to this damage effect
  // const weaknessTags =
  // Fetch types to show to the user
  const types = [
    effect.type,
    ...("statTypes" in effect && effect.statTypes ? effect.statTypes : []),
    ...("generalTypes" in effect && effect.generalTypes ? effect.generalTypes : []),
    ...("elements" in effect && effect.elements ? effect.elements : []),
    ...("poolsAffected" in effect && effect.poolsAffected ? effect.poolsAffected : []),
  ];

  if (instant || residual) {
    consequences.set(effect.id, {
      userId: effect.creatorId,
      targetId: effect.targetId,
      types: types,
      ...(instant
        ? {
            damage: damage,
            rawDamage: rawDamage,
            baseDamageForModifiers: damage,
          }
        : {}),
      ...(residual
        ? {
            residual: damage,
            rawResidual: rawDamage,
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
  scaleUserStats(target);
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

/** Check if flee prevent is successful depending on static chance calculation */
export const fleePrevent = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  target: BattleUserState,
): ActionEffect | undefined => {
  const immunityBlocked = checkPreventImmunity(effect, usersEffects, target, "flee");
  if (immunityBlocked) return immunityBlocked;
  const { power } = getPower(effect);
  const mainCheck = Math.random() < power / 100;
  if (mainCheck) {
    const info = getInfo(target, effect, "cannot flee");
    effect.power = 100;
    return info;
  } else if (effect.isNew) {
    effect.rounds = 0;
    return {
      txt: `${target.username} could not be prevented from fleeing`,
      color: "blue",
    };
  }
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
  const { pass, preventTag } = preventCheck(
    usersEffects,
    "healprevent",
    target,
    effect,
  );
  if (preventTag && preventTag.createdRound < effect.createdRound) {
    if (!pass) return preventResponse(effect, target, "cannot be healed");
  }
  // Calculate healing
  const { power } = getPower(effect);
  const parsedEffect = HealTag.parse(effect);
  const poolsAffects = parsedEffect.poolsAffected || ["Health"];
  const heal_hp = poolsAffects.includes("Health")
    ? effect.calculation === "percentage"
      ? target.maxHealth * (power / 100) * applyTimes
      : power * applyTimes * 10
    : 0;
  const heal_sp = poolsAffects.includes("Stamina")
    ? effect.calculation === "percentage"
      ? target.maxStamina * (power / 100) * applyTimes
      : power * applyTimes * 10
    : 0;
  const heal_cp = poolsAffects.includes("Chakra")
    ? effect.calculation === "percentage"
      ? target.maxChakra * (power / 100) * applyTimes
      : power * applyTimes * 10
    : 0;
  // If rounds=0 apply immidiately, otherwise only on following rounds
  if (
    (effect.castThisRound && effect.rounds === 0) ||
    (!effect.castThisRound && (effect.rounds === undefined || effect.rounds > 0))
  ) {
    consequences.set(effect.id, {
      userId: effect.creatorId,
      targetId: effect.targetId,
      heal_hp,
      heal_sp,
      heal_cp,
    });
  }
  return getInfo(target, effect, "will heal");
};

/** Prevent healing */
export const healPrevent = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  target: BattleUserState,
): ActionEffect | undefined => {
  const immunityBlocked = checkPreventImmunity(effect, usersEffects, target, "heal");
  if (immunityBlocked) return immunityBlocked;
  const { power } = getPower(effect);
  const mainCheck = Math.random() < power / 100;
  if (mainCheck) {
    const info = getInfo(target, effect, "cannot be healed");
    effect.power = 100;
    return info;
  } else if (effect.isNew) {
    effect.rounds = 0;
    return {
      txt: `${target.username} could not be prevented from healing`,
      color: "blue",
    };
  }
};

export const pooladjust = (effect: UserEffect, target: BattleUserState) => {
  const { adverb, qualifier } = getPower(effect);
  if ("poolsAffected" in effect) {
    const affected: string[] = [];
    effect.poolsAffected?.forEach((pool: PoolType) => {
      affected.push(pool);
    });
    return getInfo(
      target,
      effect,
      `${affected.join(", ")} cost is ${adverb} by ${qualifier}`,
    );
  }
};

export const increasepoolcost = (effect: UserEffect, target: BattleUserState) => {
  return pooladjust(effect, target);
};

export const decreasepoolcost = (effect: UserEffect, target: BattleUserState) => {
  effect.power = -Math.abs(effect.power);
  effect.powerPerLevel = -Math.abs(effect.powerPerLevel);
  return pooladjust(effect, target);
};

/** Reflect damage back to the opponent */
export const reflect = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  consequences: Map<string, Consequence>,
  target: BattleUserState,
) => {
  const { pass, preventTag } = preventCheck(usersEffects, "buffprevent", target);
  if (preventTag && preventTag.createdRound < effect.createdRound) {
    if (!pass) return preventResponse(effect, target, "cannot be buffed");
  }
  const { power, qualifier } = getPower(effect);
  if (!effect.isNew && !effect.castThisRound) {
    consequences.forEach((consequence, effectId) => {
      if (consequence.targetId === effect.targetId && consequence.damage) {
        const damageEffect = usersEffects.find((e) => e.id === effectId);
        if (damageEffect) {
          const ratio = getEfficiencyRatio(damageEffect, effect);
          const dmgConvert =
            Math.floor(
              effect.calculation === "percentage"
                ? consequence.damage * (power / 100)
                : power > consequence.damage
                  ? consequence.damage
                  : power,
            ) * ratio;
          // consequence.damage -= convert;
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

  if (shouldApply) {
    // Only create wound damage when the target is the one taking an action
    // This is the same logic used by other tags like residual damage
    const isTargetsTurn = target.userId === effect.targetId;

    if (isTargetsTurn) {
      if (originalDamage > 0) {
        if (woundDamage > 0) {
          // Find or create a consequence for this target
          let targetConsequence = Array.from(consequences.values()).find(
            (c) => c.targetId === effect.targetId,
          );

          if (!targetConsequence) {
            targetConsequence = {
              userId: effect.creatorId,
              targetId: effect.targetId,
              types: [
                "wound",
                ...("statTypes" in effect && effect.statTypes ? effect.statTypes : []),
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
      }
    }
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
  const { pass, preventTag } = preventCheck(usersEffects, "debuffprevent", target);
  if (preventTag && preventTag.createdRound < effect.createdRound) {
    if (!pass) return preventResponse(effect, target, "cannot be debuffed with recoil");
  }
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
          const convert =
            Math.floor(
              effect.calculation === "percentage"
                ? consequence.damage * (power / 100)
                : power > consequence.damage
                  ? consequence.damage
                  : power,
            ) * ratio;
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
          const convert =
            Math.floor(
              effect.calculation === "percentage"
                ? consequence.damage * (power / 100)
                : power > consequence.damage
                  ? consequence.damage
                  : power,
            ) * ratio;

          // Add to existing afterburn damage (stacking) with 60% limit
          const currentAfterburn = consequence.afterburn || 0;
          const maxAfterburn = Math.floor(consequence.damage * 0.6); // 60% limit
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
  const casterHealPrevented = usersEffects.some(
    (e) =>
      e.type === "healprevent" &&
      e.targetId === effect.creatorId &&
      !e.castThisRound &&
      (e.rounds === undefined || e.rounds > 0),
  );
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
 * Convert a percentage of damage dealt into a temporary shield on the caster.
 * Uses the same pre-shield damage basis as vamp, but is not affected by heal modifiers.
 * Intentionally returns no cast-round announcement; process.ts logs when the shield is created.
 */
export const consume = (
  effect: UserEffect,
  consequences: Map<string, Consequence>,
): ActionEffect | undefined => {
  const { power } = getPower(effect);
  const shieldRounds = "shieldRounds" in effect ? effect.shieldRounds : 3;
  forEachOutgoingDamage(effect, consequences, (c) => {
    c.consumeRatio = Math.min(1, (c.consumeRatio ?? 0) + power / 100);
    c.consumeRounds = Math.max(c.consumeRounds ?? 0, shieldRounds);
  });
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
  const pools =
    "poolsAffected" in effect && effect.poolsAffected
      ? effect.poolsAffected
      : ["Health" as const];

  // Apply drain effect each round
  if (
    !effect.isNew &&
    !effect.castThisRound &&
    (effect.rounds === undefined || effect.rounds > 0)
  ) {
    // Merge all drains on one target into a single consequence (keyed by targetId so
    // multiple drain effects accumulate), attributed to the caster so the drain_hp branch
    // in process.ts credits damage_dealt to the drainer like the other DoTs. Credit is
    // first-consequence-owner: if two DIFFERENT creators drain the same target in a round,
    // their ticks merge here (and again in collapseConsequences, which merges by targetId and
    // keeps the first userId), so the later drainer's share goes uncredited. Same multi-
    // attacker limitation collapseConsequences already has for damage/residual/wound/poison;
    // a per-attacker fix belongs in that shared merge, not here.
    const consequence: Consequence = consequences.get(effect.targetId) || {
      userId: effect.creatorId,
      targetId: effect.targetId,
      drain_hp: 0,
      drain_cp: 0,
      drain_sp: 0,
    };

    // Calculate drain amount for each pool
    pools.forEach((pool: PoolType) => {
      const poolValue =
        pool === "Health"
          ? target.maxHealth
          : pool === "Chakra"
            ? target.maxChakra
            : target.maxStamina;
      const drainAmount =
        effect.calculation === "percentage"
          ? Math.floor((power / 100) * poolValue)
          : power;

      // Add to existing drain value for the specific pool
      switch (pool) {
        case "Health":
          consequence.drain_hp = (consequence.drain_hp || 0) + drainAmount;
          break;
        case "Chakra":
          consequence.drain_cp = (consequence.drain_cp || 0) + drainAmount;
          break;
        case "Stamina":
          consequence.drain_sp = (consequence.drain_sp || 0) + drainAmount;
          break;
      }
    });

    consequences.set(effect.targetId, consequence);
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

  // Calculate modified costs based on pool adjustment effects.
  // Start with the base costs from the action.
  let modifiedChakraCost = action.chakraCost;
  let modifiedStaminaCost = action.staminaCost;

  if (!effect.castThisRound && actorId === target.userId) {
    // Iterate over active pool adjustment effects affecting the target.
    usersEffects.forEach((eff) => {
      if (
        (eff.type === "increasepoolcost" || eff.type === "decreasepoolcost") &&
        eff.targetId === target.userId &&
        eff.poolsAffected &&
        Array.isArray(eff.poolsAffected)
      ) {
        // For Chakra: use the multiplier (1 + eff.power/100).
        if (eff.poolsAffected.includes("Chakra")) {
          modifiedChakraCost *= 1 + eff.power / 100;
        }
        // For Stamina: use the multiplier (1 + eff.power/100).
        if (eff.poolsAffected.includes("Stamina")) {
          modifiedStaminaCost *= 1 + eff.power / 100;
        }
      }
    });
    // Sum the modified costs.
    const totalCost = modifiedChakraCost + modifiedStaminaCost;

    // Calculate poison damage using the modified total cost.
    const dmg = Math.floor(totalCost * (power / 100));

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
) => {
  const user = usersState.find((u) => u.userId === effect.creatorId);
  let info: ActionEffect | undefined;
  if (user) {
    // Prevent?
    const { pass } = preventCheck(usersEffects, "moveprevent", user);
    if (!pass) return preventResponse(effect, user, "resisted being stunned");
    // Update movement information
    info = {
      txt: `${user.username} moves to [${effect.latitude}, ${effect.longitude}]`,
      color: "blue",
    };
    // This is related to users stepping into/out of ground effects
    groundEffects.forEach((g) => {
      if (g.timeTracker && user.userId in g.timeTracker) {
        delete g.timeTracker[user.userId];
      }
    });
    groundEffects.forEach((g) => {
      if (
        g.timeTracker &&
        g.longitude === effect.longitude &&
        g.latitude === effect.latitude
      ) {
        g.timeTracker[user.userId] = effect.createdRound;
      }
    });
    // Update user location. If someone else is already standing on the spot,
    // move to the nearest available spot on the most direct line between
    // the current and target location
    user.longitude = effect.longitude;
    user.latitude = effect.latitude;
  }
  return info;
};

/** Prevent target from moving */
export const movePrevent = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  target: BattleUserState,
): ActionEffect | undefined => {
  const immunityBlocked = checkPreventImmunity(
    effect,
    usersEffects,
    target,
    "movement",
  );
  if (immunityBlocked) return immunityBlocked;
  const { power } = getPower(effect);
  const mainCheck = Math.random() < power / 100;
  if (mainCheck) {
    const info = getInfo(target, effect, "cannot move");
    effect.power = 100;
    return info;
  } else if (effect.isNew) {
    effect.rounds = 0;
    return {
      txt: `${target.username} could not be prevented from moving`,
      color: "blue",
    };
  }
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

/** Status effect to prevent OHKO */
export const onehitkillPrevent = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  target: BattleUserState,
): ActionEffect | undefined => {
  const immunityBlocked = checkPreventImmunity(
    effect,
    usersEffects,
    target,
    "one-hit-kill",
  );
  if (immunityBlocked) return immunityBlocked;
  const { power } = getPower(effect);
  const mainCheck = Math.random() < power / 100;
  if (mainCheck) {
    const info = getInfo(target, effect, "cannot be one-hit-killed");
    effect.power = 100;
    return info;
  } else if (effect.isNew) {
    effect.rounds = 0;
    return {
      txt: `${target.username} could not be prevented from one-hits`,
      color: "blue",
    };
  }
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

/** Prevent robbing */
export const robPrevent = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  target: BattleUserState,
): ActionEffect | undefined => {
  const immunityBlocked = checkPreventImmunity(effect, usersEffects, target, "rob");
  if (immunityBlocked) return immunityBlocked;
  const { power } = getPower(effect);
  const mainCheck = Math.random() < power / 100;
  if (mainCheck) {
    const info = getInfo(target, effect, "cannot be robbed");
    effect.power = 100;
    return info;
  } else if (effect.isNew) {
    effect.rounds = 0;
    return {
      txt: `${target.username} could not be prevented from being robbed`,
      color: "blue",
    };
  }
};

/** Prevent cleansing */
export const cleansePrevent = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  target: BattleUserState,
): ActionEffect | undefined => {
  const immunityBlocked = checkPreventImmunity(effect, usersEffects, target, "cleanse");
  if (immunityBlocked) return immunityBlocked;
  const { power } = getPower(effect);
  const mainCheck = Math.random() < power / 100;
  if (mainCheck) {
    const info = getInfo(target, effect, "cannot be cleansed");
    effect.power = 100;
    return info;
  } else if (effect.isNew) {
    effect.rounds = 0;
    return {
      txt: `${target.username} could not be prevented from cleansing`,
      color: "blue",
    };
  }
};

/** Prevent clearing */
export const clearPrevent = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  target: BattleUserState,
): ActionEffect | undefined => {
  const immunityBlocked = checkPreventImmunity(effect, usersEffects, target, "clear");
  if (immunityBlocked) return immunityBlocked;
  const { power } = getPower(effect);
  const mainCheck = Math.random() < power / 100;
  if (mainCheck) {
    const info = getInfo(target, effect, "cannot be cleared");
    effect.power = 100;
    return info;
  } else if (effect.isNew) {
    effect.rounds = 0;
    return {
      txt: `${target.username} could not be prevented from being cleared`,
      color: "blue",
    };
  }
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

/** Check if a given effect is sealed based on a list of pre-filtered user effects */
export const sealCheck = (effect: UserEffect, sealEffects: UserEffect[]) => {
  if (sealEffects.length > 0 && effect.fromType === "bloodline") {
    const sealEffect = sealEffects.find((e) => e.targetId === effect.targetId);
    if (sealEffect) {
      return true;
    }
  }
  return false;
};

/** Prevent sealing of bloodline effects with a static chance */
export const sealPrevent = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  target: BattleUserState,
): ActionEffect | undefined => {
  const immunityBlocked = checkPreventImmunity(effect, usersEffects, target, "seal");
  if (immunityBlocked) return immunityBlocked;
  const { power } = getPower(effect);
  const mainCheck = Math.random() < power / 100;
  if (mainCheck) {
    const info = getInfo(target, effect, "bloodline cannot be sealed");
    effect.power = 100;
    return info;
  } else if (effect.isNew) {
    effect.rounds = 0;
    return {
      txt: `${target.username} could not be prevented from being sealed`,
      color: "blue",
    };
  }
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
    // Check if effect has elements property
    if ("elements" in effect && effect.elements) {
      const elements = effect.elements.length > 0 ? effect.elements.join(", ") : "no";
      const info = getInfo(
        target,
        effect,
        `will be sealed from using ${elements} jutsu`,
      );
      return info;
    }
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

/**
 * Time compression increases the AP cost of actions by 10 AP
 */
export const timeCompression = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  target: BattleUserState,
): ActionEffect | undefined => {
  // Check if time compression is prevented
  const { pass } = preventCheck(usersEffects, "debuffprevent", target, effect);
  if (!pass)
    return preventResponse(effect, target, "cannot be affected by time compression");

  // Check if there's already an active time compression effect on the target
  const existingTimeCompression = usersEffects.find(
    (e) =>
      e.type === "timecompression" &&
      e.targetId === target.userId &&
      e.id !== effect.id &&
      isEffectActive(e),
  );
  if (existingTimeCompression) {
    effect.rounds = 0;
    return {
      txt: `${target.username} already has time compression active`,
      color: "blue",
    };
  }

  // Calculate chance of success
  const { power } = getPower(effect);
  const primaryCheck = Math.random() < power / 100;
  if (effect.isNew && effect.rounds && effect.castThisRound) {
    if (primaryCheck) {
      // Build element-specific message
      let elementText = "";
      if (effect.elements && effect.elements.length > 0) {
        elementText = ` [${effect.elements.join(", ")} element jutsu]`;
      } else {
        elementText = " [all jutsu]";
      }

      return {
        txt: `${target.username} is affected by time compression, actions will cost 10 more AP${elementText}`,
        color: "red",
      };
    } else {
      effect.rounds = 0;
      return {
        txt: `${target.username} resists the time compression effect`,
        color: "blue",
      };
    }
  }
};

/**
 * Time dilation decreases the AP cost of actions by 10 AP
 */
export const timeDilation = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  target: BattleUserState,
): ActionEffect | undefined => {
  // Check if time dilation is prevented
  const { pass } = preventCheck(usersEffects, "buffprevent", target, effect);
  if (!pass)
    return preventResponse(effect, target, "cannot be affected by time dilation");

  // Check if there's already an active time dilation effect on the target
  const existingTimeDilation = usersEffects.find(
    (e) =>
      e.type === "timedilation" &&
      e.targetId === target.userId &&
      e.id !== effect.id &&
      isEffectActive(e),
  );
  if (existingTimeDilation) {
    effect.rounds = 0;
    return {
      txt: `${target.username} already has time dilation active`,
      color: "blue",
    };
  }

  // Calculate chance of success
  const { power } = getPower(effect);
  const primaryCheck = Math.random() < power / 100;
  if (effect.isNew && effect.rounds && effect.castThisRound) {
    if (primaryCheck) {
      // Build element-specific message
      let elementText = "";
      if (effect.elements && effect.elements.length > 0) {
        elementText = ` [${effect.elements.join(", ")} element jutsu]`;
      } else {
        elementText = " [all jutsu]";
      }

      return {
        txt: `${target.username} is affected by time dilation, actions will cost 10 less AP${elementText}`,
        color: "blue",
      };
    } else {
      effect.rounds = 0;
      return {
        txt: `${target.username} resists the time dilation effect`,
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

  // Find the user who cast the effect
  const caster = usersState.find((u) => u.userId === effect.creatorId);
  if (!caster) {
    return {
      txt: `${target.username} cannot be pulled - caster not found`,
      color: "red",
    };
  }

  // Find the actual target user in the usersState array to update their position
  const actualTarget = usersState.find((u) => u.userId === target.userId);
  if (!actualTarget) {
    return {
      txt: `${target.username} cannot be redirected - target not found in battle state`,
      color: "red",
    };
  }

  // Check if target and caster are at the same position
  if (
    actualTarget.longitude === caster.longitude &&
    actualTarget.latitude === caster.latitude
  ) {
    return {
      txt: `${target.username} is already at the caster's location`,
      color: "blue",
    };
  }

  // Calculate how many spaces to move (based on power)
  let moveDistance: number;

  if (direction === "pull") {
    // For pull, ensure we don't pull the target on top of the caster
    // Calculate hex grid distance between target and caster
    const hexDistance = Math.max(
      Math.abs(actualTarget.longitude - caster.longitude),
      Math.abs(actualTarget.latitude - caster.latitude),
      Math.abs(
        actualTarget.longitude +
          actualTarget.latitude -
          caster.longitude -
          caster.latitude,
      ),
    );
    moveDistance = Math.min(power, Math.max(0, hexDistance - 1));
  } else {
    // For push, use the full power
    moveDistance = power;
  }

  if (moveDistance === 0) {
    return {
      txt: `${target.username} cannot be moved any further`,
      color: "blue",
    };
  }

  // Calculate new position using hex grid movement
  let newLongitude: number, newLatitude: number;

  if (direction === "push") {
    // Push away from caster
    // Calculate the direction vector from caster to target
    const deltaX = actualTarget.longitude - caster.longitude;
    const deltaY = actualTarget.latitude - caster.latitude;
    const deltaZ = -deltaX - deltaY; // Hex grid constraint: q + r + s = 0

    // Normalize the direction vector
    const maxDelta = Math.max(Math.abs(deltaX), Math.abs(deltaY), Math.abs(deltaZ));
    if (maxDelta === 0) {
      return {
        txt: `${target.username} cannot be pushed - no valid direction`,
        color: "red",
      };
    }

    // Move in the direction of the vector
    newLongitude =
      actualTarget.longitude + Math.round((deltaX / maxDelta) * moveDistance);
    newLatitude =
      actualTarget.latitude + Math.round((deltaY / maxDelta) * moveDistance);
  } else {
    // Pull towards caster
    // Calculate the direction vector from target to caster
    const deltaX = caster.longitude - actualTarget.longitude;
    const deltaY = caster.latitude - actualTarget.latitude;
    const deltaZ = -deltaX - deltaY; // Hex grid constraint: q + r + s = 0

    // Normalize the direction vector
    const maxDelta = Math.max(Math.abs(deltaX), Math.abs(deltaY), Math.abs(deltaZ));
    if (maxDelta === 0) {
      return {
        txt: `${target.username} cannot be pulled - no valid direction`,
        color: "red",
      };
    }

    // Move in the direction of the vector
    newLongitude =
      actualTarget.longitude + Math.round((deltaX / maxDelta) * moveDistance);
    newLatitude =
      actualTarget.latitude + Math.round((deltaY / maxDelta) * moveDistance);
  }

  // Helper function to validate and adjust position for push/pull effects
  const validateAndAdjustPosition = (
    targetLongitude: number,
    targetLatitude: number,
  ) => {
    const isOnCaster =
      targetLongitude === caster.longitude && targetLatitude === caster.latitude;
    const isOnOtherPlayer = usersState.some(
      (u) =>
        u.userId !== actualTarget.userId &&
        u.longitude === targetLongitude &&
        u.latitude === targetLatitude,
    );
    const barrierAtPosition = groundEffects.find(
      (g) =>
        g.longitude === targetLongitude &&
        g.latitude === targetLatitude &&
        "curHealth" in g,
    );

    if (isOnCaster || isOnOtherPlayer || barrierAtPosition) {
      // Keep stepping back until we find a valid position
      const deltaX = actualTarget.longitude - targetLongitude;
      const deltaY = actualTarget.latitude - targetLatitude;
      const deltaZ = -deltaX - deltaY;

      const maxDelta = Math.max(Math.abs(deltaX), Math.abs(deltaY), Math.abs(deltaZ));
      if (maxDelta > 0) {
        let stepBackCount = 0;
        const maxSteps = Math.max(Math.abs(deltaX), Math.abs(deltaY), Math.abs(deltaZ)); // Maximum possible steps

        while (stepBackCount < maxSteps) {
          stepBackCount++;
          targetLongitude = targetLongitude + Math.round((deltaX / maxDelta) * 1);
          targetLatitude = targetLatitude + Math.round((deltaY / maxDelta) * 1);

          // Check if this position is valid
          const isOnCasterAfterStep =
            targetLongitude === caster.longitude && targetLatitude === caster.latitude;
          const isOnOtherPlayerAfterStep = usersState.some(
            (u) =>
              u.userId !== actualTarget.userId &&
              u.longitude === targetLongitude &&
              u.latitude === targetLatitude,
          );
          const barrierAtPositionAfterStep = groundEffects.find(
            (g) =>
              g.longitude === targetLongitude &&
              g.latitude === targetLatitude &&
              "curHealth" in g,
          );

          // If this position is valid, we're done
          if (
            !isOnCasterAfterStep &&
            !isOnOtherPlayerAfterStep &&
            !barrierAtPositionAfterStep
          ) {
            break;
          }
        }

        // If we couldn't find a valid position after all steps, stay at original position
        if (stepBackCount >= maxSteps) {
          targetLongitude = actualTarget.longitude;
          targetLatitude = actualTarget.latitude;
        }
      } else {
        // If we can't determine direction, stay at original position
        targetLongitude = actualTarget.longitude;
        targetLatitude = actualTarget.latitude;
      }
    }

    return { longitude: targetLongitude, latitude: targetLatitude };
  };

  // Ensure we don't move the target outside the arena bounds first
  const maxLongitude = battle.width - 1;
  const maxLatitude = battle.height - 1;

  let clampedLongitude = Math.max(0, Math.min(maxLongitude, newLongitude));
  let clampedLatitude = Math.max(0, Math.min(maxLatitude, newLatitude));

  // Store original position for distance calculation
  const originalLongitude = actualTarget.longitude;
  const originalLatitude = actualTarget.latitude;

  // Apply position validation for both pull and push after bounds clamping
  if (direction === "pull" || direction === "push") {
    const validatedPosition = validateAndAdjustPosition(
      clampedLongitude,
      clampedLatitude,
    );
    clampedLongitude = validatedPosition.longitude;
    clampedLatitude = validatedPosition.latitude;
  }

  // Update the actual target's position in the battle state
  actualTarget.longitude = clampedLongitude;
  actualTarget.latitude = clampedLatitude;

  // Handle ground effect timeTracker updates (mirroring the move function logic)
  groundEffects.forEach((g) => {
    if (g.timeTracker && actualTarget.userId in g.timeTracker) {
      delete g.timeTracker[actualTarget.userId];
    }
  });
  groundEffects.forEach((g) => {
    if (
      g.timeTracker &&
      g.longitude === clampedLongitude &&
      g.latitude === clampedLatitude
    ) {
      g.timeTracker[actualTarget.userId] = effect.createdRound;
    }
  });

  // Calculate the actual distance moved (hex distance between original and final positions)
  const actualDistance = Math.max(
    Math.abs(originalLongitude - clampedLongitude),
    Math.abs(originalLatitude - clampedLatitude),
    Math.abs(
      originalLongitude - clampedLongitude + (originalLatitude - clampedLatitude),
    ),
  );

  const actionText = direction === "push" ? "pushed away from" : "pulled towards";

  return {
    txt: `${target.username} is ${actionText} ${caster.username} by ${actualDistance} spaces`,
    color: "blue",
  };
};

/** Prevent target from being stunned */
export const stunPrevent = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  target: BattleUserState,
): ActionEffect | undefined => {
  const immunityBlocked = checkPreventImmunity(effect, usersEffects, target, "stun");
  if (immunityBlocked) return immunityBlocked;
  const { power } = getPower(effect);
  const mainCheck = Math.random() < power / 100;
  if (mainCheck) {
    const info = getInfo(target, effect, "cannot be stunned");
    effect.power = 100;
    return info;
  } else if (effect.isNew) {
    effect.rounds = 0;
    return {
      txt: `${target.username} could not be prevented from being stunned`,
      color: "blue",
    };
  }
};

/** summon()/clone() live here; summon predicates and lifecycle helpers are in summon.ts */
export const summon = (
  usersState: BattleUserState[],
  effect: GroundEffect,
  userEffects: UserEffect[],
  battle: Battle, // Add battle parameter
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
      // We no longer rebind effect.aiId to the spawned summon, so it keeps
      // pointing at the template and re-cast works.
      const ai = usersState.find((u) => u.controllerId === effect.aiId);
      // One-summon-per-controller cap, keyed consistently on
      // (controllerId === user.userId && isSummon). Allows re-summon once the
      // prior summon is no longer live (so the AI does_not_have_summon gate
      // and the player re-cast both work).
      const alreadyHasSummon = hasLiveSummon(usersState, user.userId, userEffects);
      if (alreadyHasSummon) {
        effect.rounds = 0;
        return {
          txt: `${user.username} already has a summon!`,
          color: "red",
        } as ActionEffect;
      }
      if (ai) {
        const newAi = structuredClone(ai);
        // Place on battlefield
        newAi.userId = nanoid();
        // Explicitly set identity/control flags (mirror clone(), do not rely on
        // structuredClone inheritance from the template).
        newAi.isSummon = true;
        newAi.isAi = true;
        // An original creature, not a clone. Set explicitly (clones set
        // isOriginal=false) so the isClone discriminator never misreads a summon.
        newAi.isOriginal = true;
        newAi.controllerId = user.userId;
        newAi.isPiloted = shouldPilotSummon(user, effect.playerControlled);
        newAi.isSummonTemplate = false; // never inherit the template's flag
        // Record which creature this effect spawned so teardown is exact.
        effect.summonedUserId = newAi.userId;
        newAi.hidden = undefined;
        newAi.leftBattle = false;
        newAi.longitude = effect.longitude;
        newAi.latitude = effect.latitude;
        newAi.villageId = user.villageId;
        newAi.direction = user.direction;
        // Set level to summoner level
        newAi.level = user.level;
        // Scale to level
        scaleUserStats(newAi);
        // Set pools
        newAi.maxHealth = effect.aiHp;
        newAi.curHealth = newAi.maxHealth;
        // Set stats
        newAi.ninjutsuOffence = newAi.ninjutsuOffence * perc;
        newAi.ninjutsuDefence = newAi.ninjutsuDefence * perc;
        newAi.genjutsuOffence = newAi.genjutsuOffence * perc;
        newAi.genjutsuDefence = newAi.genjutsuDefence * perc;
        newAi.taijutsuOffence = newAi.taijutsuOffence * perc;
        newAi.taijutsuDefence = newAi.taijutsuDefence * perc;
        newAi.bukijutsuOffence = newAi.bukijutsuOffence * perc;
        newAi.bukijutsuDefence = newAi.bukijutsuDefence * perc;
        newAi.strength = newAi.strength * perc;
        newAi.intelligence = newAi.intelligence * perc;
        newAi.willpower = newAi.willpower * perc;
        newAi.speed = newAi.speed * perc;
        // Lookup bloodline from extraState and copy bloodlineId
        const aiBloodline = ai.bloodlineId
          ? battle.extraState.bloodlines?.[ai.bloodlineId]
          : null;
        newAi.bloodlineId = ai.bloodlineId;
        // Realize bloodline effects if they exist
        if (aiBloodline?.effects) {
          aiBloodline.effects.forEach((bloodlineEffect) => {
            const realizedEffect = realizeTag({
              tag: bloodlineEffect as BattleEffect,
              user: newAi,
              actionId: "initial",
              target: newAi,
              level: newAi.level,
              round: battle.round,
              battle,
            }) as UserEffect;
            realizedEffect.isNew = true;
            realizedEffect.castThisRound = true;
            realizedEffect.targetId = newAi.userId;
            realizedEffect.fromType = "bloodline";
            userEffects.push(realizedEffect);
          });
        }
        // Realize and copy the AI's effects
        newAi.effects = ai.effects.map((aiEffect) => {
          const realizedEffect = realizeTag({
            tag: aiEffect as BattleEffect,
            user: newAi,
            actionId: "initial",
            target: newAi,
            level: newAi.level,
            round: battle.round,
            battle,
          }) as UserEffect;
          realizedEffect.isNew = true;
          realizedEffect.castThisRound = true;
          realizedEffect.targetId = newAi.userId;
          realizedEffect.fromType = "jutsu"; // Use jutsu as fromType since summon isn't a valid type
          userEffects.push(realizedEffect);
          return realizedEffect;
        });
        // Insert the summon immediately after its summoner so it takes its turn
        // right after them (turn order follows usersState array order). Falls
        // back to appending if the summoner can't be located.
        const summonerIdx = usersState.findIndex((u) => u.userId === user.userId);
        if (summonerIdx >= 0) {
          usersState.splice(summonerIdx + 1, 0, newAi);
        } else {
          usersState.push(newAi);
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
    let idx = usersState.findIndex((u) => u.userId === effect.summonedUserId);
    if (idx === -1 && effect.summonedUserId === undefined) {
      // Battles already in flight when summonedUserId was introduced. Match on
      // controllerId and prefer a non-live summon: a re-cast inserts the new
      // live summon ahead of an older dead one, so a plain first-match could
      // remove the live one. Clones share isSummon and controllerId, so they are
      // excluded here too. Safe to delete once no pre-upgrade battles remain.
      idx = usersState.findIndex(
        (u) =>
          u.isSummon &&
          !isClone(u) &&
          u.controllerId === effect.creatorId &&
          !isLiveSummon(u, usersState, userEffects),
      );
      if (idx === -1) {
        idx = usersState.findIndex(
          (u) => u.isSummon && !isClone(u) && u.controllerId === effect.creatorId,
        );
      }
    }
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

/** Prevent target from summoning */
export const summonPrevent = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  target: BattleUserState,
): ActionEffect | undefined => {
  const immunityBlocked = checkPreventImmunity(effect, usersEffects, target, "summon");
  if (immunityBlocked) return immunityBlocked;
  const { power } = getPower(effect);
  const mainCheck = Math.random() < power / 100;
  if (mainCheck) {
    // Set the effect to be active and hide summon jutsu
    effect.power = 100;
    return getInfo(target, effect, "cannot summon companions");
  } else if (effect.isNew) {
    effect.rounds = 0;
    return {
      txt: `${target.username} could not be prevented from summoning`,
      color: "blue",
    };
  }
};

/** Prevent target from using weapons */
export const disarm = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  target: BattleUserState,
): ActionEffect | undefined => {
  const immunityBlocked = checkPreventImmunity(effect, usersEffects, target, "disarm");
  if (immunityBlocked) return immunityBlocked;
  const { power } = getPower(effect);
  const mainCheck = Math.random() < power / 100;
  if (mainCheck) {
    // Set the effect to be active and hide weapons
    effect.power = 100;
    return getInfo(target, effect, "cannot use weapons");
  } else if (effect.isNew) {
    effect.rounds = 0;
    return {
      txt: `${target.username} could not be disarmed`,
      color: "blue",
    };
  }
};

/** Prevent target from being stunned */
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

/**
 * Returns an array of lowercase generals based on the input array of generals and the user's highest generals.
 * If the input array contains the value "Highest", the function will include the user's highest generals in the result.
 *
 * @param generals - An array of GeneralType values.
 * @param user - An optional BattleUserState object.
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
  let power = effect.power + effect.level * effect.powerPerLevel;
  if (effect.calculation === "percentage") {
    power = power > 100 ? 100 : power;
  }
  const adverb = power > 0 ? "increased" : "decreased";
  const value = Math.abs(power);
  const qualifier = effect.calculation === "percentage" ? `${value}%` : value;
  return { power, adverb, qualifier };
};

/** Convert from e.g. ninjutsuOffence -> Ninjutsu */
export const getStatTypeFromStat = (stat: (typeof StatNames)[number]) => {
  switch (stat) {
    case "ninjutsuOffence":
      return "Ninjutsu";
    case "ninjutsuDefence":
      return "Ninjutsu";
    case "genjutsuOffence":
      return "Genjutsu";
    case "genjutsuDefence":
      return "Genjutsu";
    case "taijutsuOffence":
      return "Taijutsu";
    case "taijutsuDefence":
      return "Taijutsu";
    case "bukijutsuOffence":
      return "Bukijutsu";
    case "bukijutsuDefence":
      return "Bukijutsu";
    default:
      console.error("Invalid stat type", stat);
      throw Error("Invalid stat type");
  }
};
/**
 * Calculate ratio of user stats & elements between one user effect to another
 * Returns a ratio between 0 to 1, 0 indicating e.g. that none of the stats in LHS are
 * matched in the RHS, whereas a ratio of 1 means everything is matched by a value in RHS
 */
export const getEfficiencyRatio = (dmgEffect: UserEffect, effect: UserEffect) => {
  // Force reflect for pierce damage, bypassing tag matching
  if (dmgEffect.type === "pierce") return 1;
  // We need to get the list of dmgEffect stats/gens/elements and effect stats/gens/elements
  const getTags = (e: UserEffect) => {
    const tags: string[] = [];
    if ("statTypes" in e) {
      e.statTypes?.forEach((statType: StatType) => {
        tags.push(
          statType === "Highest" && e.highestOffence
            ? getStatTypeFromStat(e.highestOffence)
            : statType,
        );
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
 * Shared by vamp, consume, and other damage-conversion tags.
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
  effect?: UserEffect, // Add optional effect parameter to check creation time
) => {
  const preventTag = usersEffects.find(
    (e) => e.type === type && e.targetId === target.userId && !e.castThisRound,
  );

  if (preventTag && (preventTag.rounds === undefined || preventTag.rounds > 0)) {
    // Only prevent if the effect being checked was created after the prevent effect
    if (effect && preventTag.createdRound >= effect.createdRound) {
      return { pass: true, preventTag: preventTag };
    }
    const power = preventTag.power + preventTag.level * preventTag.powerPerLevel;
    return { pass: Math.random() > power / 100, preventTag: preventTag };
  }
  return { pass: true, preventTag: preventTag };
};

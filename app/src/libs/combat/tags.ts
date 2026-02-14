import { noCase } from "change-case";
import { nanoid } from "nanoid";
import type {
  BattleType,
  ElementName,
  GeneralType,
  PoolType,
  StatType,
} from "@/drizzle/constants";
import type { Battle } from "@/drizzle/schema";
import type { CombatAction } from "@/libs/combat/types";
import {
  getEffectStage,
  getPoolsAffected,
  getPreventTypeName,
  isEffectActive,
} from "@/libs/combat/util";
import { scaleUserStats } from "@/libs/profile";
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

/** Copy positive effects from opponent to self */
export const copy = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  user: BattleUserState,
  target: BattleUserState,
): ActionEffect | undefined => {
  // Check if copy is prevented
  const { pass } = preventCheck(usersEffects, "buffprevent", user, effect);
  if (!pass) return preventResponse(effect, user, "cannot copy effects");

  // Calculate chance of success
  const { power } = getPower(effect);
  const primaryCheck = Math.random() < power / 100;
  if (effect.isNew && effect.rounds && effect.castThisRound) {
    if (primaryCheck) {
      const excludedFromTypes = ["bloodline", "armor", "item", "village", "skill"];
      const allowedEffectTypes = [
        "increasedamagegiven",
        "increasestat",
        "decreasedamagetaken",
        "reflect",
        "shield",
      ];

      const positiveEffects = usersEffects.filter(
        (e) =>
          e.targetId === target.userId &&
          isPositiveUserEffect(e) &&
          !excludedFromTypes.includes(e.fromType || "") &&
          allowedEffectTypes.includes(e.type) &&
          (e.rounds === undefined || e.rounds > 0), // Don't copy effects that have fully expired
      );

      if (positiveEffects.length === 0) {
        return {
          txt: `${user.username} tries to copy positive effects from ${target.username} but finds no copyable effects.`,
          color: "blue",
        };
      }

      let copiedCount = 0;
      const copiedEffects: string[] = [];

      positiveEffects.forEach((posEffect) => {
        const prevCopy = usersEffects.find(
          (e) => e.fromEffectId === posEffect.id && e.rounds && e.rounds > 0,
        );
        if (!prevCopy) {
          const copiedEffect = structuredClone(posEffect);
          copiedEffect.id = nanoid();
          copiedEffect.fromEffectId = posEffect.id;
          copiedEffect.targetId = user.userId;
          copiedEffect.creatorId = user.userId;
          copiedEffect.rounds = effect.rounds;
          // Reset timing properties to make the copied effect behave as newly cast
          copiedEffect.isNew = true;
          copiedEffect.castThisRound = true;
          copiedEffect.createdRound = effect.createdRound;
          usersEffects.push(copiedEffect);
          copiedCount++;

          // Create description of the copied effect
          const effectPower =
            posEffect.power + posEffect.level * posEffect.powerPerLevel;
          const effectDesc = `${posEffect.type} (${effectPower}${posEffect.calculation === "percentage" ? "%" : ""})`;
          copiedEffects.push(effectDesc);
        }
      });

      const effectsList = copiedEffects.join(", ");
      return {
        txt: `${user.username} copies ${copiedCount} positive effects from ${target.username}: ${effectsList}`,
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

/** Copy negative effects from self to target */
export const mirror = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  user: BattleUserState,
  target: BattleUserState,
): ActionEffect | undefined => {
  // Check if mirror is prevented
  const { pass } = preventCheck(usersEffects, "debuffprevent", target, effect);
  if (!pass)
    return preventResponse(effect, target, "cannot be debuffed with mirrored effects");

  // Calculate chance of success
  const { power } = getPower(effect);
  const primaryCheck = Math.random() < power / 100;
  if (effect.isNew && effect.rounds && effect.castThisRound) {
    if (primaryCheck) {
      const excludedFromTypes = ["bloodline", "armor", "item", "village", "skill"];
      const excludedEffectTypes = [
        "damage",
        "pierce",
        "clear",
        "buffprevent",
        "cleanseprevent",
        "moveprevent",
        "healprevent",
        "wound",
        "timecompression",
      ];

      const negativeEffects = usersEffects.filter(
        (e) =>
          e.targetId === user.userId &&
          isNegativeUserEffect(e) &&
          !excludedFromTypes.includes(e.fromType || "") &&
          !excludedEffectTypes.includes(e.type) &&
          (e.rounds === undefined || e.rounds > 0), // Don't mirror effects that have fully expired
      );

      if (negativeEffects.length === 0) {
        return {
          txt: `${user.username} tries to mirror negative effects onto ${target.username} but finds no negative effects to reflect.`,
          color: "blue",
        };
      }

      let mirroredCount = 0;
      const mirroredEffects: string[] = [];

      negativeEffects.forEach((negEffect) => {
        const prevMirror = usersEffects.find(
          (e) => e.fromEffectId === negEffect.id && e.rounds && e.rounds > 0,
        );
        if (!prevMirror) {
          const mirroredEffect = structuredClone(negEffect);
          mirroredEffect.id = nanoid();
          mirroredEffect.fromEffectId = negEffect.id;
          mirroredEffect.targetId = target.userId;
          mirroredEffect.creatorId = user.userId;
          mirroredEffect.rounds = effect.rounds;
          // Reset timing properties to make the mirrored effect behave as newly cast
          mirroredEffect.isNew = true;
          mirroredEffect.castThisRound = true;
          mirroredEffect.createdRound = effect.createdRound;
          // Cut drain effects in half when mirrored
          if (negEffect.type === "drain") {
            mirroredEffect.power = Math.floor(
              mirroredEffect.power / (effect.rounds || 1),
            );
            mirroredEffect.powerPerLevel = Math.floor(
              mirroredEffect.powerPerLevel / (effect.rounds || 1),
            );
          }
          usersEffects.push(mirroredEffect);
          mirroredCount++;

          // Create description of the mirrored effect
          const effectPower =
            negEffect.power + negEffect.level * negEffect.powerPerLevel;
          const effectDesc = `${negEffect.type} (${effectPower}${negEffect.calculation === "percentage" ? "%" : ""})`;
          mirroredEffects.push(effectDesc);
        }
      });

      const effectsList = mirroredEffects.join(", ");
      return {
        txt: `${user.username} mirrors ${mirroredCount} negative effects onto ${target.username}: ${effectsList}`,
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

/** Adjust damage given by target */
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
      if (consequence.userId === effect.targetId && consequence.damage) {
        const damageEffect = usersEffects.find((e) => e.id === effectId);
        if (damageEffect) {
          const ratio = getEfficiencyRatio(damageEffect, effect);
          // Use staged base damage for percentage calculations
          // Stage 1 (equipment/pre-battle): use original baseDamageForModifiers
          // Stage 2 (in-battle): use baseDamageAfterStage1 (post-equipment damage)
          const effectStage = getEffectStage(effect);
          const baseDamage =
            effectStage === 1
              ? (consequence.baseDamageForModifiers ?? consequence.damage)
              : (consequence.baseDamageAfterStage1 ??
                consequence.baseDamageForModifiers ??
                consequence.damage);
          const change =
            effect.calculation === "percentage" ? (power / 100) * baseDamage : power;
          if (effect.fromType === "bloodline") {
            if (
              "allowBloodlineDamageIncrease" in damageEffect &&
              "allowBloodlineDamageDecrease" in damageEffect &&
              ((change > 0 && !damageEffect.allowBloodlineDamageIncrease) ||
                (change < 0 && !damageEffect.allowBloodlineDamageDecrease))
            ) {
              return;
            }
          }
          consequence.damage = consequence.damage + change * ratio;
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

/** Adjust damage taken by user */
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
      if (consequence.targetId === effect.targetId && consequence.damage) {
        const damageEffect = usersEffects.find((e) => e.id === effectId);
        if (damageEffect) {
          const ratio = getEfficiencyRatio(damageEffect, effect);
          // Use staged base damage for percentage calculations
          // Stage 1 (equipment/pre-battle): use original baseDamageForModifiers
          // Stage 2 (in-battle): use baseDamageAfterStage1 (post-equipment damage)
          const effectStage = getEffectStage(effect);
          const baseDamage =
            effectStage === 1
              ? (consequence.baseDamageForModifiers ?? consequence.damage)
              : (consequence.baseDamageAfterStage1 ??
                consequence.baseDamageForModifiers ??
                consequence.damage);
          const change =
            effect.calculation === "percentage" ? (power / 100) * baseDamage : power;
          consequence.damage = consequence.damage + change * ratio;
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
      .filter((e) => e.fromType !== "bloodline")
      .filter((e) => e.fromType !== "armor")
      .filter((e) => e.fromType !== "skill")
      .filter((e) => e.fromType !== "ranked")
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

/** Clone user on the battlefield */
export const clone = (
  usersState: BattleUserState[],
  effect: GroundEffect,
  staticData?: { jutsus: Record<string, { effects: unknown[] }> },
) => {
  const { power } = getPower(effect);
  const perc = power / 100;
  const user = usersState.find((u) => u.userId === effect.creatorId);
  if (!user) {
    throw new Error("Summoner not found");
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
    newAi.isAi = true;
    newAi.hidden = undefined;
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

/** Function used for scaling two attributes against each other, used e.g. in damage calculation */
const powerEffect = (
  attack: number,
  defence: number,
  avg_exp: number,
  config: DmgConfig,
) => {
  const statRatio = attack ** config.atk_scaling / defence ** config.def_scaling;
  return config.dmg_base + statRatio * avg_exp ** config.exp_scaling;
};

/** Base damage calculation formula */
export const damageCalc = (
  effect: UserEffect,
  origin: BattleUserState | undefined,
  target: BattleUserState,
  config: DmgConfig,
) => {
  const { power } = getPower(effect);
  const calcs: number[] = [];
  // Run battle formula to get list of calculations for each stat
  if (effect.calculation === "formula") {
    const dir = "offensive";
    effect.statTypes?.forEach((statType: StatType) => {
      let a = "";
      let b = "";
      if (statType === "Highest" && effect.highestOffence && effect.highestDefence) {
        if (dir === "offensive") {
          a = effect.highestOffence;
          b = effect.highestOffence.replace("Offence", "Defence");
        } else {
          a = effect.highestDefence;
          b = effect.highestDefence.replace("Defence", "Offence");
        }
      } else {
        const lower = statType.toLowerCase();
        a = `${lower}${dir ? "Offence" : "Defence"}`;
        b = `${lower}${dir ? "Defence" : "Offence"}`;
      }
      if (origin && a in origin && b in target) {
        const left = origin[a as keyof typeof origin] as number;
        const right = target[b as keyof typeof target] as number;
        const avg_exp = (origin.experience + target.experience) / 2;
        calcs.push(config.stats_scaling * powerEffect(left, right, avg_exp, config));
      }
    });
    // Apply an element of all these generals
    const generals = getLowerGenerals(effect.generalTypes, origin?.highestGenerals);
    generals.forEach((gen) => {
      if (origin && gen in origin && gen in target) {
        const left = origin[gen as keyof typeof origin] as number;
        const right = target[gen as keyof typeof target] as number;
        const avg_exp = (origin.experience + target.experience) / 2;
        calcs.push(config.gen_scaling * powerEffect(left, right, avg_exp, config));
      }
    });
  }
  // Calculate final damage
  const calcSum = calcs.reduce((a, b) => a + b, 0);
  const calcMean = calcSum / calcs.length;
  const base = 1 + power * config.power_scaling;
  let dmg =
    calcSum > 0 ? base * calcMean * config.dmg_scaling + config.dmg_base : power;
  // If residual
  if (!effect.castThisRound && "residualModifier" in effect) {
    if (effect.residualModifier) dmg *= effect.residualModifier;
  }
  // Modify damage
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
        ? { damage: damage, rawDamage: rawDamage, baseDamageForModifiers: damage }
        : {}),
      ...(residual
        ? { residual: damage, rawResidual: rawDamage, baseDamageForModifiers: damage }
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
    const consequence: Consequence = consequences.get(effect.targetId) || {
      userId: effect.targetId,
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
      info = { txt: `${target.username}'s shield was not created`, color: "blue" };
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
    return { txt: `${target.username} is an AI and cannot be robbed`, color: "blue" };
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
      return { txt: `${target.username} manages not to get robbed!`, color: "blue" };
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
      info = { txt: `${target.username} bloodline was not sealed`, color: "blue" };
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
      info = { txt: `${target.username} hit with inactive stun effect`, color: "blue" };
    } else if (primaryCheck) {
      info = getInfo(target, effect, `is stunned [-${effect.apReduction} AP]`);
    } else {
      effect.rounds = 0;
      info = { txt: `${target.username} manages not to get stunned!`, color: "blue" };
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

/** Clone user on the battlefield */
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
    if (user && "aiHp" in effect) {
      const ai = usersState.find((u) => u.controllerId === effect.aiId);
      const obj = usersState.find(
        (u) =>
          u.username === ai?.username && u.curHealth && u.controllerId === user.userId,
      );
      if (ai && !obj) {
        const newAi = structuredClone(ai);
        // Place on battlefield
        newAi.userId = nanoid();
        effect.aiId = newAi.userId;
        newAi.controllerId = user.userId;
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
        // Push to userState
        usersState.push(newAi);
        // ActionEffect to be shown
        return {
          txt: `${newAi.username} was summoned for ${effect.rounds} rounds!`,
          color: "blue",
        } as ActionEffect;
      }
    }
    // If return from here, summon failed
    effect.rounds = 0;
    return { txt: `Failed to create summon!`, color: "red" } as ActionEffect;
  } else if (effect?.rounds === 0) {
    const ai = usersState.find((u) => u.userId === effect.aiId);
    const idx = usersState.findIndex((u) => u.userId === effect.aiId);
    if (ai && idx > -1) {
      usersState.splice(idx, 1);
      return { txt: `${ai.username} was unsummoned!`, color: "red" } as ActionEffect;
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
const getEfficiencyRatio = (dmgEffect: UserEffect, effect: UserEffect) => {
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

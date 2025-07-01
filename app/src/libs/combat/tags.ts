import { scaleUserStats } from "@/libs/profile";
import { nanoid } from "nanoid";
import { isPositiveUserEffect, isNegativeUserEffect } from "./types";
import { HealTag } from "@/libs/combat/types";
import type { BattleUserState, Consequence } from "./types";
import type { GroundEffect, UserEffect, ActionEffect } from "./types";
import type { StatNames, GenNames, DmgConfig } from "./constants";
import type { WeaknessTagType } from "@/libs/combat/types";
import type { ShieldTagType } from "@/libs/combat/types";
import type { GeneralType } from "@/drizzle/constants";
import type { BattleType } from "@/drizzle/constants";
import type { CombatAction } from "@/libs/combat/types";
import { capitalizeFirstLetter } from "@/utils/sanitize";
import type { BattleEffect } from "./types";
import type { Battle } from "@/drizzle/schema";

/**
 * Realize tag with information about how powerful tag is
 */
export const realizeTag = <T extends BattleEffect>(props: {
  tag: T;
  user: BattleUserState;
  actionId: string;
  target?: BattleUserState | undefined;
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
          pools.map((pool) => {
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

/** Prevent buffing */
export const buffPrevent = (
  effect: UserEffect,
  target: BattleUserState,
): ActionEffect | undefined => {
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
  // Calcualte chance of success
  const { power } = getPower(effect);
  const primaryCheck = Math.random() < power / 100;
  if (effect.isNew && effect.rounds && effect.castThisRound) {
    if (primaryCheck) {
      return getInfo(user, effect, `copies positive effects from ${target.username}`);
    } else {
      return {
        txt: `${user.username} tries to copy positive effects from ${target.username} but fails.`,
        color: "blue",
      };
    }
  } else {
    const positiveEffects = usersEffects.filter(
      (e) => e.targetId === target.userId && isPositiveUserEffect(e),
    );
    if (positiveEffects.length === 0) {
      return {
        txt: `${user.username} tries to copy positive effects from ${target.username} but finds no positive effects to copy.`,
        color: "blue",
      };
    }
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
        copiedEffect.rounds = 1;
        usersEffects.push(copiedEffect);
      }
    });
  }
};

/** Copy negative effects from self to target */
export const mirror = (
  effect: UserEffect,
  usersEffects: UserEffect[],
  user: BattleUserState,
  target: BattleUserState,
): ActionEffect | undefined => {
  // Calculate chance of success
  const { power } = getPower(effect);
  const primaryCheck = Math.random() < power / 100;
  if (effect.isNew && effect.rounds && effect.castThisRound) {
    if (primaryCheck) {
      return getInfo(user, effect, `mirrors negative effects onto ${target.username}`);
    } else {
      return {
        txt: `${user.username} tries to mirror negative effects onto ${target.username} but fails.`,
        color: "blue",
      };
    }
  } else {
    const negativeEffects = usersEffects.filter(
      (e) => e.targetId === user.userId && isNegativeUserEffect(e),
    );
    if (negativeEffects.length === 0) {
      return {
        txt: `${user.username} tries to mirror negative effects onto ${target.username} but finds no negative effects to reflect.`,
        color: "blue",
      };
    }
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
        mirroredEffect.rounds = 1;
        usersEffects.push(mirroredEffect);
      }
    });
  }
};

/** Prevent debuffing */
export const debuffPrevent = (
  effect: UserEffect,
  target: BattleUserState,
): ActionEffect | undefined => {
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
    effect.statTypes.forEach((stat) => {
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
    effect.generalTypes.forEach((general) => {
      if (general === "Highest") {
        const highestGenerals = effect.highestGenerals;
        highestGenerals?.forEach((gen) => {
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

/** Adjust stats of target based on effect */
export const adjustStats = (effect: UserEffect, target: BattleUserState) => {
  const { power, adverb, qualifier } = getPower(effect);
  const affected = getAffected(effect);
  if ("statTypes" in effect || "generalTypes" in effect) {
    if (!effect.isNew && !effect.castThisRound) {
      effect.statTypes?.forEach((stat) => {
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
            if (effect.direction === "offence" || effect.direction === "both") {
              switch (target.highestOffence) {
                case "ninjutsuOffence":
                  target.ninjutsuOffence *= (100 + power) / 100;
                  break;
                case "genjutsuOffence":
                  target.genjutsuOffence *= (100 + power) / 100;
                  break;
                case "taijutsuOffence":
                  target.taijutsuOffence *= (100 + power) / 100;
                  break;
                case "bukijutsuOffence":
                  target.bukijutsuOffence *= (100 + power) / 100;
                  break;
              }
            }
            if (effect.direction === "defence" || effect.direction === "both") {
              switch (target.highestDefence) {
                case "ninjutsuDefence":
                  target.ninjutsuDefence *= (100 + power) / 100;
                  break;
                case "genjutsuDefence":
                  target.genjutsuDefence *= (100 + power) / 100;
                  break;
                case "taijutsuDefence":
                  target.taijutsuDefence *= (100 + power) / 100;
                  break;
                case "bukijutsuDefence":
                  target.bukijutsuDefence *= (100 + power) / 100;
                  break;
              }
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
            if (effect.direction === "offence" || effect.direction === "both") {
              target.ninjutsuOffence *= (100 + power) / 100;
            }
            if (effect.direction === "defence" || effect.direction === "both") {
              target.ninjutsuDefence *= (100 + power) / 100;
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
            if (effect.direction === "offence" || effect.direction === "both") {
              target.genjutsuOffence *= (100 + power) / 100;
            }
            if (effect.direction === "defence" || effect.direction === "both") {
              target.genjutsuDefence *= (100 + power) / 100;
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
            if (effect.direction === "offence" || effect.direction === "both") {
              target.taijutsuOffence *= (100 + power) / 100;
            }
            if (effect.direction === "defence" || effect.direction === "both") {
              target.taijutsuDefence *= (100 + power) / 100;
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
            if (effect.direction === "offence" || effect.direction === "both") {
              target.bukijutsuOffence *= (100 + power) / 100;
            }
            if (effect.direction === "defence" || effect.direction === "both") {
              target.bukijutsuDefence *= (100 + power) / 100;
            }
          }
        }
      });
      effect.generalTypes?.forEach((general) => {
        if (general === "Highest") {
          if (effect.calculation === "static") {
            target.highestGenerals.forEach((gen) => {
              target[gen] += power;
            });
          } else if (effect.calculation === "percentage") {
            target.highestGenerals.forEach((gen) => {
              target[gen] *= (100 + power) / 100;
            });
          }
        } else if (general === "Strength") {
          if (effect.calculation === "static") {
            target.strength += power;
          } else if (effect.calculation === "percentage") {
            target.strength *= (100 + power) / 100;
          }
        } else if (general === "Intelligence") {
          if (effect.calculation === "static") {
            target.intelligence += power;
          } else if (effect.calculation === "percentage") {
            target.intelligence *= (100 + power) / 100;
          }
        } else if (general === "Willpower") {
          if (effect.calculation === "static") {
            target.willpower += power;
          } else if (effect.calculation === "percentage") {
            target.willpower *= (100 + power) / 100;
          }
        } else if (general === "Speed") {
          if (effect.calculation === "static") {
            target.speed += power;
          } else if (effect.calculation === "percentage") {
            target.speed *= (100 + power) / 100;
          }
        }
      });
    }
  }
  return getInfo(target, effect, `${affected} is ${adverb} by ${qualifier}`);
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
          const change =
            effect.calculation === "percentage"
              ? (power / 100) * consequence.damage
              : power;
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
          const change =
            effect.calculation === "percentage"
              ? (power / 100) * consequence.damage
              : power;
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
      .filter(type === "positive" ? isPositiveUserEffect : isNegativeUserEffect)
      .map((e) => {
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
      .map((e) => {
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
export const clone = (usersState: BattleUserState[], effect: GroundEffect) => {
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
    // Remove all jutsus with summon/clone
    newAi.jutsus = newAi.jutsus.filter((j) => {
      const effects = JSON.stringify(j.jutsu.effects);
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
    effect.statTypes?.forEach((statType) => {
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
    effect.generalTypes?.forEach((general) => {
      if (general === "Highest") {
        user.highestGenerals.forEach((gen) => {
          user.usedGenerals[gen] += 1;
        });
      } else {
        user.usedGenerals[general.toLowerCase() as Lowercase<typeof general>] += 1;
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
  const statRatio =
    Math.pow(attack, config.atk_scaling) / Math.pow(defence, config.def_scaling);
  return config.dmg_base + statRatio * Math.pow(avg_exp, config.exp_scaling);
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
    effect.statTypes?.forEach((statType) => {
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
      const check3 = e.elements.some((we) => dmgEffect?.elements?.includes(we));
      const check4 = e.statTypes.some((we) => dmgEffect?.statTypes?.includes(we));
      const check5 = e.generalTypes.some((we) => dmgEffect?.generalTypes?.includes(we));
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
  const damage = rawDamage * (1 - (effect.barrierAbsorb ?? 0));
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
  const thisRound = effect.castThisRound;
  const instant = thisRound && effect.rounds === 0;
  const residual = !thisRound && (effect.rounds === undefined || effect.rounds > 0);
  if (instant || residual) {
    consequences.set(effect.id, {
      userId: effect.creatorId,
      targetId: effect.targetId,
      types: types,
      ...(instant ? { damage: damage, rawDamage: rawDamage } : {}),
      ...(residual ? { residual: damage, rawResidual: rawDamage } : {}),
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
    txt: `Barrier takes ${damage.toFixed(2)} damage ${
      barrier.curHealth <= 0
        ? "and is destroyed."
        : `and has ${barrier.curHealth.toFixed(2)} health left.`
    }`,
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
  target: BattleUserState,
): ActionEffect | undefined => {
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
  target: BattleUserState,
): ActionEffect | undefined => {
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
          consequence.reflect = dmgConvert;
        }
      }
    });
  }
  return getInfo(target, effect, `will reflect ${qualifier} damage`);
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
  const { pass } = preventCheck(usersEffects, "debuffprevent", target);
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
    pools.forEach((pool) => {
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

/** Deals damage based on chakra and stamina usage */
export const poison = (
  effect: UserEffect,
  action: CombatAction,
  actorId: string,
  consequences: Map<string, Consequence>,
  target: BattleUserState,
  usersEffects: UserEffect[],
) => {
  const { pass } = preventCheck(usersEffects, "debuffprevent", target);
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
  let info: ActionEffect | undefined = undefined;
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

/** Prevents the user from being reduced below 1 HP */
export const finalStand = (effect: UserEffect, target: BattleUserState) => {
  const { power } = getPower(effect);
  const primaryCheck = Math.random() < power / 100;
  let info: ActionEffect | undefined = undefined;
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
  let info: ActionEffect | undefined = undefined;
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
  target: BattleUserState,
): ActionEffect | undefined => {
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
  let info: ActionEffect | undefined = undefined;
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
  target: BattleUserState,
): ActionEffect | undefined => {
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
  target: BattleUserState,
): ActionEffect | undefined => {
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
  target: BattleUserState,
): ActionEffect | undefined => {
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
  target: BattleUserState,
): ActionEffect | undefined => {
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
  let info: ActionEffect | undefined = undefined;
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
  target: BattleUserState,
): ActionEffect | undefined => {
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
  const { pass } = preventCheck(usersEffects, "stunprevent", target);
  if (!pass) return preventResponse(effect, target, "resisted being stunned");
  // Apply
  const { power } = getPower(effect);
  const primaryCheck = Math.random() < power / 100;
  let info: ActionEffect | undefined = undefined;
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

/** Prevent target from being stunned */
export const stunPrevent = (
  effect: UserEffect,
  target: BattleUserState,
): ActionEffect | undefined => {
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
        newAi.longitude = effect.longitude;
        newAi.latitude = effect.latitude;
        newAi.villageId = user.villageId;
        newAi.village = user.village;
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
        newAi.bloodline = ai.bloodline;
        // Realize bloodline effects if they exist
        if (newAi.bloodline?.effects) {
          newAi.bloodline.effects.forEach((bloodlineEffect) => {
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

/** Prevent target from being stunned */
export const summonPrevent = (
  effect: UserEffect,
  target: BattleUserState,
): ActionEffect | undefined => {
  const { power } = getPower(effect);
  const mainCheck = Math.random() < power / 100;
  if (mainCheck) {
    const info = getInfo(target, effect, "cannot summon companions");
    effect.power = 100;
    return info;
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
      e.statTypes?.forEach((statType) =>
        tags.push(
          statType === "Highest" && e.highestOffence
            ? getStatTypeFromStat(e.highestOffence)
            : statType,
        ),
      );
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
  type: string,
  target: BattleUserState,
  effect?: UserEffect, // Add optional effect parameter to check creation time
) => {
  const preventTag = usersEffects.find(
    (e) => e.type == type && e.targetId === target.userId && !e.castThisRound,
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

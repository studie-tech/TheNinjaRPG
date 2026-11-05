import type { GroundEffect, UserEffect } from "@/libs/combat/types";

/** Level-scaled power before the percentage cap. */
const getScaledPower = (effect: UserEffect | GroundEffect) =>
  effect.power + effect.level * effect.powerPerLevel;

/** Applied combat power, including level scaling and the percentage cap. */
export const getEffectPower = (effect: UserEffect | GroundEffect) => {
  const power = getScaledPower(effect);
  return effect.calculation === "percentage" && power > 100 ? 100 : power;
};

/** Size of an effect's level-scaled power as status displays list it, uncapped. */
export const getEffectMagnitude = (effect: UserEffect | GroundEffect) =>
  Math.abs(getScaledPower(effect));

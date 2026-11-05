import type { GroundEffect, UserEffect } from "@/libs/combat/types";

/** Applied combat power, including level scaling and the percentage cap. */
export const getEffectPower = (effect: UserEffect | GroundEffect) => {
  const power = effect.power + effect.level * effect.powerPerLevel;
  return effect.calculation === "percentage" && power > 100 ? 100 : power;
};

/** Size of an effect's applied power, as status displays list it. */
export const getEffectMagnitude = (effect: UserEffect | GroundEffect) =>
  Math.abs(getEffectPower(effect));

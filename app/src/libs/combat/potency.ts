import { BATTLE_TAG_STACKING, isPreBattleGearFromType } from "@/drizzle/constants";
import type { CombatAction, UserEffect } from "@/libs/combat/types";
import { getEffectStackKey, isEffectActive } from "@/libs/combat/util";
import type { PotencyTag, PotencyTagType, ZodAllTags } from "@/validators/combat";
import { PotencyTagTypes } from "@/validators/combat";

export const POTENCY_TAG_LABELS: Record<PotencyTagType | "all", string> = {
  all: "All supported tags",
  damage: "Damage",
  increasedamagegiven: "Increase Damage Given",
  decreasedamagegiven: "Decrease Damage Given",
  increasedamagetaken: "Increase Damage Taken",
  decreasedamagetaken: "Decrease Damage Taken",
  afterburn: "Afterburn",
  lifesteal: "Lifesteal",
  reflect: "Reflect",
  increaseheal: "Increase Heal",
  heal: "Heal",
};

export const getPotencyDescription = (
  effect: PotencyTag,
  power = effect.power,
  owner = effect.target === "SELF" ? "your" : "the target's",
) => {
  const affected =
    effect.affectedTag === "all"
      ? "all supported tags"
      : `${POTENCY_TAG_LABELS[effect.affectedTag]} tags`;
  const amount = Number(power.toFixed(2));
  const units =
    effect.calculation === "percentage" ? `${amount}%` : `${amount} power points`;
  const change = effect.type === "increasepotency" ? "increased" : "decreased";
  return `The power of ${affected} on ${owner} subsequent jutsu is ${change} by ${units} for ${effect.rounds} rounds.`;
};

const supportedTags: ReadonlySet<string> = new Set(PotencyTagTypes);

/**
 * Snapshot potency once, before any effects from this cast are inserted. Bake
 * level scaling into the cloned tags so later ticks and transfers retain the
 * cast's power, without modifying the jutsu definition or applying potency twice.
 */
export const resolvePotencyTags = (
  action: Pick<CombatAction, "type" | "effects" | "level">,
  usersEffects: UserEffect[],
  casterId: string,
): ZodAllTags[] => {
  const tags = structuredClone(action.effects);
  if (action.type !== "jutsu") return tags;

  const seen = new Set<string>();
  const modifiers = new Map<string, { flat: number; percentage: number }>();
  for (const effect of usersEffects) {
    if (
      (effect.type !== "increasepotency" && effect.type !== "decreasepotency") ||
      effect.targetId !== casterId ||
      effect.isNew ||
      !isEffectActive(effect)
    ) {
      continue;
    }
    const key = getEffectStackKey(effect);
    if (
      !BATTLE_TAG_STACKING &&
      seen.has(key) &&
      effect.fromType !== "bloodline" &&
      effect.fromType !== "sageMode" &&
      effect.fromType !== "sageModeAfter" &&
      !isPreBattleGearFromType(effect.fromType)
    ) {
      continue;
    }
    seen.add(key);
    const amount = effect.power + effect.level * effect.powerPerLevel;
    const sign = effect.type === "increasepotency" ? 1 : -1;
    const modifier = modifiers.get(effect.affectedTag) ?? { flat: 0, percentage: 0 };
    if (effect.calculation === "percentage") {
      modifier.percentage += sign * Math.min(100, amount);
    } else {
      modifier.flat += sign * amount;
    }
    modifiers.set(effect.affectedTag, modifier);
  }

  for (const tag of tags) {
    if (!supportedTags.has(tag.type)) continue;
    const all = modifiers.get("all");
    const selected = modifiers.get(tag.type);
    if (!all && !selected) continue;
    const flat = (all?.flat ?? 0) + (selected?.flat ?? 0);
    const percentage = (all?.percentage ?? 0) + (selected?.percentage ?? 0);
    const base = tag.power + (action.level ?? 0) * tag.powerPerLevel;
    // Clamp each stage: two negative factors must never create positive power.
    const power = Math.max(0, base + flat) * Math.max(0, 1 + percentage / 100);
    tag.power = tag.calculation === "percentage" ? Math.min(100, power) : power;
    tag.powerPerLevel = 0;
  }
  return tags;
};

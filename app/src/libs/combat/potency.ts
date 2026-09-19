import {
  BATTLE_TAG_STACKING,
  type ElementName,
  isPreBattleGearFromType,
} from "@/drizzle/constants";
import type { CombatAction, UserEffect } from "@/libs/combat/types";
import { getEffectStackKey, isEffectActive } from "@/libs/combat/util";
import type { PotencyTag, ZodAllTags } from "@/validators/combat";
import { PotencyTagTypes } from "@/validators/combat";

export const POTENCY_TAG_LABELS: Record<PotencyTag["affectedTag"], string> = {
  none: "None",
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
  if (effect.affectedTag === "none" && !effect.affectedElements?.length) {
    return "No tags are affected. Select Affected Elements to apply potency by element.";
  }
  const affected =
    effect.affectedTag === "all" || effect.affectedTag === "none"
      ? "all supported tags"
      : `${POTENCY_TAG_LABELS[effect.affectedTag]} tags`;
  const amount = Number(power.toFixed(2));
  const units =
    effect.calculation === "percentage" ? `${amount}%` : `${amount} power points`;
  const change = effect.type === "increasepotency" ? "increased" : "decreased";
  const elements = effect.affectedElements?.length
    ? ` Affected elements (match any): ${effect.affectedElements
        .map((element) => (element === "None" ? "None (non-elemental)" : element))
        .join(", ")}.`
    : "";
  return `The power of ${affected} on ${owner} subsequent jutsu is ${change} by ${units} for ${effect.rounds} rounds.${elements}`;
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
  const modifiers: (Pick<PotencyTag, "affectedTag" | "affectedElements"> & {
    flat: number;
    percentage: number;
  })[] = [];
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
    modifiers.push({
      affectedTag: effect.affectedTag,
      affectedElements: effect.affectedElements ?? [],
      flat: effect.calculation === "static" ? sign * amount : 0,
      percentage:
        effect.calculation === "percentage" ? sign * Math.min(100, amount) : 0,
    });
  }

  for (const tag of tags) {
    if (!supportedTags.has(tag.type)) continue;
    const elements: readonly ElementName[] =
      "elements" in tag && tag.elements?.length ? tag.elements : ["None"];
    const matching = modifiers.filter((modifier) => {
      const matchesElement = modifier.affectedElements.some((element) =>
        elements.includes(element),
      );
      if (modifier.affectedTag === "none") return matchesElement;
      return (
        (modifier.affectedTag === "all" || modifier.affectedTag === tag.type) &&
        (modifier.affectedElements.length === 0 || matchesElement)
      );
    });
    if (matching.length === 0) continue;
    const flat = matching.reduce((sum, modifier) => sum + modifier.flat, 0);
    const percentage = matching.reduce((sum, modifier) => sum + modifier.percentage, 0);
    const base = tag.power + (action.level ?? 0) * tag.powerPerLevel;
    // Clamp each stage: two negative factors must never create positive power.
    const power = Math.max(0, base + flat) * Math.max(0, 1 + percentage / 100);
    tag.power = tag.calculation === "percentage" ? Math.min(100, power) : power;
    tag.powerPerLevel = 0;
  }
  return tags;
};

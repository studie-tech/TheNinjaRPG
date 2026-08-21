import type { MasteryName, MasteryType } from "@/drizzle/constants";

export const MASTERY_TYPE_TO_STAT: Record<MasteryType, MasteryName> = {
  Ninjutsu: "ninjutsuMastery",
  Genjutsu: "genjutsuMastery",
  Taijutsu: "taijutsuMastery",
  Bukijutsu: "bukijutsuMastery",
  Bloodline: "bloodlineMastery",
  Sage: "sageMastery",
};

/**
 * Requirement column on Jutsu/Item, the user stat it gates against, and its display name.
 * Single source of truth: the gating check, the content editors and every requirement list
 * in the UI derive from this, so adding a mastery is a one-line change.
 */
export const MASTERY_REQUIREMENT_FIELDS = [
  ["requiredNinjutsuMastery", "ninjutsuMastery", "Ninjutsu Mastery"],
  ["requiredGenjutsuMastery", "genjutsuMastery", "Genjutsu Mastery"],
  ["requiredTaijutsuMastery", "taijutsuMastery", "Taijutsu Mastery"],
  ["requiredBukijutsuMastery", "bukijutsuMastery", "Bukijutsu Mastery"],
  ["requiredBloodlineMastery", "bloodlineMastery", "Bloodline Mastery"],
  ["requiredSageMastery", "sageMastery", "Sage Mastery"],
] as const;

export type MasteryRequirementField = (typeof MASTERY_REQUIREMENT_FIELDS)[number][0];

export type MasteryRequirementFields = {
  [K in MasteryRequirementField]?: number | null;
};

export type MasteryStatSource = Record<MasteryName, number>;

/**
 * Whether a user meets every mastery requirement on a jutsu or item.
 * @param user - masteries of the user, may be partial for masked battle state
 * @param requirements - the jutsu/item being gated
 */
export const hasMasteryRequirements = (
  user: Partial<MasteryStatSource>,
  requirements?: MasteryRequirementFields | null,
): boolean => !missingMasteryRequirement(user, requirements);

/**
 * The first unmet mastery requirement, or null when the user meets all of them. Drives both
 * the boolean gate and the "why can't I equip this" messages, so they cannot disagree.
 * @param user - masteries of the user, may be partial for masked battle state
 * @param requirements - the jutsu/item being gated
 */
export const missingMasteryRequirement = (
  user: Partial<MasteryStatSource>,
  requirements?: MasteryRequirementFields | null,
): { label: string; required: number; current: number } | null => {
  if (!requirements) return null;
  for (const [reqKey, statKey, label] of MASTERY_REQUIREMENT_FIELDS) {
    const required = requirements[reqKey];
    if (required == null) continue;
    const current = user[statKey];
    // Masked / unknown masteries are treated as met so client-side action lists
    // for opponents (privateState stripped) do not hide gated jutsu and items.
    if (current == null) continue;
    if (current < required) return { label, required, current };
  }
  return null;
};

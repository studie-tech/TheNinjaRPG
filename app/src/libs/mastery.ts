import type { MasteryName, MasteryType } from "@/drizzle/constants";

export const MASTERY_TYPE_TO_STAT: Record<MasteryType, MasteryName> = {
  Ninjutsu: "ninjutsuMastery",
  Genjutsu: "genjutsuMastery",
  Taijutsu: "taijutsuMastery",
  Bukijutsu: "bukijutsuMastery",
  Bloodline: "bloodlineMastery",
  Sage: "sageMastery",
};

/** Requirement column on Jutsu/Item paired with the user stat it gates against */
const MASTERY_REQUIREMENT_FIELDS = [
  ["requiredNinjutsuMastery", "ninjutsuMastery"],
  ["requiredGenjutsuMastery", "genjutsuMastery"],
  ["requiredTaijutsuMastery", "taijutsuMastery"],
  ["requiredBukijutsuMastery", "bukijutsuMastery"],
  ["requiredBloodlineMastery", "bloodlineMastery"],
  ["requiredSageMastery", "sageMastery"],
] as const;

export type MasteryRequirementFields = {
  requiredNinjutsuMastery?: number | null;
  requiredGenjutsuMastery?: number | null;
  requiredTaijutsuMastery?: number | null;
  requiredBukijutsuMastery?: number | null;
  requiredBloodlineMastery?: number | null;
  requiredSageMastery?: number | null;
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
): boolean => {
  if (!requirements) return true;
  return MASTERY_REQUIREMENT_FIELDS.every(([reqKey, statKey]) => {
    const required = requirements[reqKey];
    if (required == null) return true;
    const current = user[statKey];
    // Masked / unknown masteries are treated as met so client-side action lists
    // for opponents (privateState stripped) do not hide gated jutsu and items.
    if (current == null) return true;
    return current >= required;
  });
};

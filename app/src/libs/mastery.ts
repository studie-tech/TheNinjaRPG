import type { MasteryName, MasteryType } from "@/drizzle/constants";
import { MasteryNames } from "@/drizzle/constants";

export const MASTERY_TYPE_TO_STAT: Record<MasteryType, MasteryName> = {
  Ninjutsu: "ninjutsuMastery",
  Genjutsu: "genjutsuMastery",
  Taijutsu: "taijutsuMastery",
  Bukijutsu: "bukijutsuMastery",
  Bloodline: "bloodlineMastery",
  Sage: "sageMastery",
};

export const MASTERY_REQUIREMENT_FIELDS = [
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

export const emptyMasteries = (value = 0): Record<MasteryName, number> =>
  Object.fromEntries(MasteryNames.map((name) => [name, value])) as Record<
    MasteryName,
    number
  >;

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

export const getMasteryRequirementEntries = (
  requirements?: MasteryRequirementFields | null,
): {
  key: (typeof MASTERY_REQUIREMENT_FIELDS)[number][0];
  label: string;
  value: number;
}[] => {
  if (!requirements) return [];
  const labels: Record<(typeof MASTERY_REQUIREMENT_FIELDS)[number][0], string> = {
    requiredNinjutsuMastery: "Req. Ninjutsu Mastery",
    requiredGenjutsuMastery: "Req. Genjutsu Mastery",
    requiredTaijutsuMastery: "Req. Taijutsu Mastery",
    requiredBukijutsuMastery: "Req. Bukijutsu Mastery",
    requiredBloodlineMastery: "Req. Bloodline Mastery",
    requiredSageMastery: "Req. Sage Mastery",
  };
  return MASTERY_REQUIREMENT_FIELDS.flatMap(([key]) => {
    const value = requirements[key];
    if (value == null) return [];
    return [{ key, label: labels[key], value }];
  });
};

import { MAX_GENS_CAP, MAX_MASTERY_CAP } from "@/drizzle/constants";
import { makeCappedNullableNumber } from "@/validators/base";

/** Optional earned-mastery minimums for content; null/zero leaves the discipline ungated. */
export const masteryRequirementFields = {
  requiredNinjutsuMastery: makeCappedNullableNumber(MAX_MASTERY_CAP),
  requiredGenjutsuMastery: makeCappedNullableNumber(MAX_MASTERY_CAP),
  requiredTaijutsuMastery: makeCappedNullableNumber(MAX_MASTERY_CAP),
  requiredBukijutsuMastery: makeCappedNullableNumber(MAX_MASTERY_CAP),
  requiredBloodlineMastery: makeCappedNullableNumber(MAX_MASTERY_CAP),
  requiredSageMastery: makeCappedNullableNumber(MAX_MASTERY_CAP),
};

/** Optional general-stat minimums for jutsu and items; null/zero leaves the stat ungated. */
export const generalRequirementFields = {
  requiredStrength: makeCappedNullableNumber(MAX_GENS_CAP),
  requiredSpeed: makeCappedNullableNumber(MAX_GENS_CAP),
  requiredIntelligence: makeCappedNullableNumber(MAX_GENS_CAP),
  requiredWillpower: makeCappedNullableNumber(MAX_GENS_CAP),
};

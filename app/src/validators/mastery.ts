import { MAX_MASTERY_CAP } from "@/drizzle/constants";
import { makeCappedNullableNumber } from "@/validators/base";

/** Optional earned-mastery minimums for quests; null/zero leaves the discipline ungated. */
export const masteryRequirementFields = {
  requiredNinjutsuMastery: makeCappedNullableNumber(MAX_MASTERY_CAP),
  requiredGenjutsuMastery: makeCappedNullableNumber(MAX_MASTERY_CAP),
  requiredTaijutsuMastery: makeCappedNullableNumber(MAX_MASTERY_CAP),
  requiredBukijutsuMastery: makeCappedNullableNumber(MAX_MASTERY_CAP),
  requiredBloodlineMastery: makeCappedNullableNumber(MAX_MASTERY_CAP),
  requiredSageMastery: makeCappedNullableNumber(MAX_MASTERY_CAP),
};

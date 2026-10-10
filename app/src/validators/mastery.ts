import { z } from "zod";
import { MAX_MASTERY_CAP } from "@/drizzle/constants";
export const masteryRequirementFields = {
  requiredNinjutsuMastery: z.coerce.number().min(0).max(MAX_MASTERY_CAP).nullish(),
  requiredGenjutsuMastery: z.coerce.number().min(0).max(MAX_MASTERY_CAP).nullish(),
  requiredTaijutsuMastery: z.coerce.number().min(0).max(MAX_MASTERY_CAP).nullish(),
  requiredBukijutsuMastery: z.coerce.number().min(0).max(MAX_MASTERY_CAP).nullish(),
  requiredBloodlineMastery: z.coerce.number().min(0).max(MAX_MASTERY_CAP).nullish(),
  requiredSageMastery: z.coerce.number().min(0).max(MAX_MASTERY_CAP).nullish(),
};

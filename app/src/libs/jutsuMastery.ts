import type { MasteryType } from "@/drizzle/constants";
import { MasteryTypes } from "@/drizzle/constants";
import {
  MASTERY_REQUIREMENT_FIELDS,
  type MasteryRequirementFields,
} from "@/libs/mastery";

/**
 * Distinct disciplines credited by a jutsu's classification, mastery requirements and
 * bloodline association. Uses catalog metadata only, so training and combat trackers
 * can carry the same classification without querying content during a battle action.
 * @returns Unique disciplines in classification, requirement, then bloodline order.
 */
export const jutsuMasteryTypes = (
  jutsu: MasteryRequirementFields & {
    statClassification?: string | null;
    bloodlineId?: string | null;
    jutsuType?: string;
  },
): MasteryType[] => {
  const types = new Set<MasteryType>();
  if (MasteryTypes.includes(jutsu.statClassification as MasteryType))
    types.add(jutsu.statClassification as MasteryType);
  for (const [field, , label] of MASTERY_REQUIREMENT_FIELDS)
    if ((jutsu[field] ?? 0) > 0)
      types.add(label.replace(" Mastery", "") as MasteryType);
  if (jutsu.bloodlineId || jutsu.jutsuType === "BLOODLINE") types.add("Bloodline");
  return [...types];
};

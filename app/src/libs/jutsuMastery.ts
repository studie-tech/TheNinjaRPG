import type { MasteryType } from "@/drizzle/constants";
import { MasteryTypes } from "@/drizzle/constants";
import {
  MASTERY_REQUIREMENT_FIELDS,
  type MasteryRequirementFields,
} from "@/libs/mastery";
export const jutsuMasteryTypes = (
  jutsu: MasteryRequirementFields & {
    statClassification?: string | null;
    bloodlineId?: string | null;
    jutsuType?: string;
  },
) => {
  const types = new Set<MasteryType>();
  if (MasteryTypes.includes(jutsu.statClassification as MasteryType))
    types.add(jutsu.statClassification as MasteryType);
  for (const [field, , label] of MASTERY_REQUIREMENT_FIELDS)
    if ((jutsu[field] ?? 0) > 0)
      types.add(label.replace(" Mastery", "") as MasteryType);
  if (jutsu.bloodlineId || jutsu.jutsuType === "BLOODLINE") types.add("Bloodline");
  return [...types];
};

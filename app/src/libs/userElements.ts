import type { ElementName } from "@/drizzle/constants";
import type { ZodAllTags } from "@/validators/combat";

export const getBloodlineElements = (
  user: { bloodline?: { effects: ZodAllTags[] } | null } | undefined,
) => {
  const bloodlineElements: ElementName[] = [];
  user?.bloodline?.effects.forEach((effect) => {
    if ("elements" in effect && effect.elements) {
      if (isBloodlineEffectBeneficial(effect)) {
        bloodlineElements.push(...effect.elements);
      }
    }
  });
  return bloodlineElements;
};

export const isBloodlineEffectBeneficial = (effect: ZodAllTags) => {
  // Default to beneficial, as should be true for most bloodline effects
  let isStrength = true;
  // Certains tags are negative in a bloodline context
  if (
    [
      "decreasedamagegiven",
      "increasedamagetaken",
      "decreaseheal",
      "decreasestat",
      "decreasemastery",
      "damage",
    ].includes(effect.type)
  )
    isStrength = false;
  return isStrength;
};

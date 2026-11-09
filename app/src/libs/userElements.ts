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

/** Most bloodline effects are beneficial; these tags are negative in a bloodline context. */
const NON_BENEFICIAL_BLOODLINE_TAGS: readonly string[] = [
  "decreasedamagegiven",
  "increasedamagetaken",
  "decreaseheal",
  "decreasestat",
  "decreasemastery",
  "damage",
  "elementaldamage",
];

export const isBloodlineEffectBeneficial = (effect: ZodAllTags) =>
  !NON_BENEFICIAL_BLOODLINE_TAGS.includes(effect.type);

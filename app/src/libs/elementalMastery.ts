import {
  type BasicElement,
  ELEMENTAL_MASTERY_CAP,
  type ElementName,
} from "@/drizzle/constants";
import { getBloodlineElements } from "@/libs/userElements";
import type { ZodAllTags } from "@/validators/combat";

export type ElementalMasterySource = {
  elementalMastery?: Partial<Record<BasicElement, number>>;
  activeTrainedElement?: BasicElement | null;
  primaryElement?: ElementName | null;
  secondaryElement?: ElementName | null;
  bloodline?: { effects: ZodAllTags[] } | null;
};

/**
 * Resolves supplied elements without changing stored innate rolls.
 * Bloodline grants replace both slots; without elemental grants, the innate pair
 * supplies access instead. Deduplication preserves element order.
 */
export const providedElements = (user: ElementalMasterySource): ElementName[] => {
  const bloodlineElements = getBloodlineElements(user);
  const elements =
    bloodlineElements.length > 0
      ? bloodlineElements
      : [user.primaryElement, user.secondaryElement];
  return [...new Set(elements)].filter((element): element is ElementName => !!element);
};

/** Remaining mastery capacity; currently supplied elements cannot gain mastery. */
export const elementalGainRoom = (
  user: ElementalMasterySource,
  element: BasicElement,
) =>
  providedElements(user).includes(element)
    ? 0
    : Math.max(0, ELEMENTAL_MASTERY_CAP - (user.elementalMastery?.[element] ?? 0));

/** Re-resolve against the current bloodline so swaps cannot enable a duplicate element. */
export const activeTrainedElement = (
  user: ElementalMasterySource,
): BasicElement | null => {
  const element = user.activeTrainedElement;
  return element &&
    (user.elementalMastery?.[element] ?? 0) >= ELEMENTAL_MASTERY_CAP &&
    !providedElements(user).includes(element)
    ? element
    : null;
};

/** Returns usable elements, including an optional active trained element and "None". */
export const getUserElements = (user: ElementalMasterySource | null | undefined) => {
  const finalElements = user ? providedElements(user) : [];
  const trained = user && activeTrainedElement(user);
  if (trained) finalElements.push(trained);
  finalElements.push("None");
  // A bloodline may already supply "None"; neutral access stays available only once.
  return Array.from(new Set(finalElements));
};

import type { ElementName } from "@/drizzle/constants";
import type { Bloodline, UserData } from "@/drizzle/schema";
import { getUserElements } from "@/validators/user";

export type ElementUser = Pick<
  UserData,
  "primaryElement" | "secondaryElement" | "isAi"
> & {
  bloodline: Pick<Bloodline, "effects"> | null;
};

export const matchesElementClassification = (
  elements: readonly ElementName[],
  userElements: ReadonlySet<ElementName>,
) => elements.length === 0 || elements.some((element) => userElements.has(element));

export const canUseElementalContent = (
  content: { elements?: readonly ElementName[] },
  user: ElementUser,
) =>
  user.isAi ||
  matchesElementClassification(content.elements ?? [], new Set(getUserElements(user)));

export const elementRequirementMessage = (content: {
  elements?: readonly ElementName[];
}) => `Requires ${content.elements?.join(" or ")} to equip and use in combat`;

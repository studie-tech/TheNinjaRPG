import {
  type ItemType,
  NonActionItemTypes,
  TRANSFORMATION_ACTION,
} from "@/drizzle/constants";
import { getDefaultBasicActions } from "@/libs/combat/actions";
import { spriteActionKey } from "@/libs/spriteAnimations";

/** Use catalogue IDs so reusable sheets follow equipped actions rather than inventory rows. */
export const animationActions = (ai: AnimationAi) => [
  { key: "idle", name: "Idle", group: "Default" },
  { key: TRANSFORMATION_ACTION, name: "Boss arrival", group: "Default" },
  ...Object.values(getDefaultBasicActions(ai)).map((action) => ({
    key: spriteActionKey(action),
    name: action.name,
    group: "Basic",
  })),
  { key: "basic:wait", name: "Wait / end turn", group: "Basic" },
  ...ai.jutsus
    .filter((entry) => entry.jutsu)
    .map((entry) => ({
      key: `jutsu:${entry.jutsuId}`,
      name: entry.jutsu.name,
      group: "Jutsu",
    })),
  ...ai.items
    .filter((entry) => entry.item && !NonActionItemTypes.includes(entry.item.itemType))
    .map((entry) => ({
      key: `item:${entry.itemId}`,
      name: entry.item.name,
      group: "Item",
    })),
];

/**
 * Coverage of one AI's actions by their own sprite sheets. Actions without a sheet fall
 * back to idle, so a missing idle sheet leaves the AI on its static image everywhere.
 * Boss arrival only plays for transformation targets and is left out of the count.
 */
export const summarizeAnimationCoverage = (
  ai: AnimationAi,
  boundActionKeys: readonly string[],
) => {
  const bound = new Set(boundActionKeys);
  const actions = animationActions(ai).filter(
    (action) => action.key !== TRANSFORMATION_ACTION,
  );
  const missing = actions.filter((action) => !bound.has(action.key));
  return {
    hasIdle: bound.has("idle"),
    animated: actions.length - missing.length,
    total: actions.length,
    missing: missing.map((action) => action.name),
  };
};

/** AI fields that determine its animatable actions. */
type AnimationAi = NonNullable<Parameters<typeof getDefaultBasicActions>[0]> & {
  jutsus: { jutsuId: string; jutsu: { name: string } }[];
  items: { itemId: string; item: { name: string; itemType: ItemType } }[];
};

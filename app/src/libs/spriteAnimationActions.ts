import { NonActionItemTypes } from "@/drizzle/constants";
import { getDefaultBasicActions } from "@/libs/combat/actions";
import { spriteActionKey } from "@/libs/spriteAnimations";
import type { fetchAnimationAi } from "@/queries/spriteAnimation";

/** Use catalogue IDs so reusable sheets follow equipped actions rather than inventory rows. */
export const animationActions = (ai: AnimationAi) => [
  { key: "idle", name: "Idle", group: "Default" },
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

type AnimationAi = NonNullable<Awaited<ReturnType<typeof fetchAnimationAi>>>;

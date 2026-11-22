import {
  FORTIFY_BASE_COST,
  FORTIFY_CHANCES,
  FORTIFY_CRAFTER_CHANCES,
  FORTIFY_FAILURE_BONUS,
  FORTIFY_ITEM_TYPES,
  FORTIFY_LEVEL_COST,
  FORTIFY_MAX_LEVEL,
} from "@/drizzle/constants";
import type { ZodAllTags } from "@/validators/combat";

/** Owned tag progress keyed by authored tag ID; null represents an untouched copy. */
export type Fortification = Record<
  string,
  { type: string; level: number; failures: number }
> | null;

/** Resolve only the matching authored tag; removed/replaced tags never inherit upgrades. */
export const getFortifyProgress = (
  state: Fortification | undefined,
  tag: Pick<ZodAllTags, "fortifyId" | "type">,
) => {
  const entry = tag.fortifyId ? state?.[tag.fortifyId] : undefined;
  return entry?.type === tag.type
    ? {
        level: Math.max(0, Math.min(FORTIFY_MAX_LEVEL, entry.level)),
        failures: Math.max(0, entry.failures),
      }
    : { level: 0, failures: 0 };
};

/** Apply owned upgrades to base powers before mastery scaling and before appending crystals. */
export const fortifiedEffects = (
  effects: ZodAllTags[],
  state: Fortification | undefined,
) =>
  effects.map((tag) => {
    const level = getFortifyProgress(state, tag).level;
    return level ? { ...tag, power: tag.power + level } : tag;
  });

/** Quote one attempt; failures add percentage points and success resets that tag's pity. */
export const getFortifyQuote = (
  state: Fortification | undefined,
  tag: ZodAllTags,
  crafter: boolean,
) => {
  const { level, failures } = getFortifyProgress(state, tag);
  return {
    level,
    failures,
    cost: FORTIFY_BASE_COST + FORTIFY_LEVEL_COST * level,
    chance:
      level >= FORTIFY_MAX_LEVEL
        ? 0
        : Math.min(
            100,
            (crafter ? FORTIFY_CRAFTER_CHANCES : FORTIFY_CHANCES)[level]! +
              failures * FORTIFY_FAILURE_BONUS,
          ),
  };
};

/** Resolve an attempt once; callers publish the cost and new state with a snapshot guard. */
export const rollFortify = (
  state: Fortification | undefined,
  tag: ZodAllTags,
  crafter: boolean,
  roll: number,
) => {
  const quote = getFortifyQuote(state, tag, crafter);
  const succeeded = roll * 100 < quote.chance;
  return {
    tagId: tag.fortifyId!,
    cost: quote.cost,
    succeeded,
    state: {
      ...state,
      [tag.fortifyId!]: {
        type: tag.type,
        level: quote.level + (succeeded ? 1 : 0),
        failures: succeeded
          ? 0
          : Math.min(quote.failures + 1, Math.ceil(100 / FORTIFY_FAILURE_BONUS)),
      },
    },
  };
};

/** Persist the resolved attempt so service delivery applies the recorded roll exactly once. */
export type FortifyResult = ReturnType<typeof rollFortify>;

/** Staff-controlled eligible base tags; crystals and imbuement effects are never candidates. */
export const fortifyTags = (item: {
  canBeEnhanced?: boolean;
  itemType: string;
  effects: ZodAllTags[];
}) =>
  item.canBeEnhanced && FORTIFY_ITEM_TYPES.some((type) => type === item.itemType)
    ? item.effects.filter(
        (tag) => tag.fortifyEnabled && tag.fortifyId && Number.isFinite(tag.power),
      )
    : [];

/** An enhancement belongs to one physical copy, including attempts that have only failed. */
export const hasFortification = (row: { fortification?: Fortification }) =>
  Object.keys(row.fortification ?? {}).length > 0;

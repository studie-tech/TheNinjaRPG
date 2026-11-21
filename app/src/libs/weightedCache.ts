import { CACHE_PROBABILITY_TOTAL } from "@/drizzle/constants";
import type { ZodAllTags } from "@/validators/combat";
import {
  type WeightedCache,
  weightedCacheDraftSchema,
  weightedCacheSchema,
} from "@/validators/weightedCache";

type WeightedCacheEffect = Extract<ZodAllTags, { type: "noncombatconsumereward" }> & {
  rewardMode: "weightedCache";
};

/** Select exactly one outcome; zero-weight drafts never occupy part of the interval. */
const selectWeighted = <T extends { probability: number }>(
  entries: T[],
  random: () => number,
): T => {
  const point = random() * CACHE_PROBABILITY_TOTAL;
  let boundary = 0;
  for (const entry of entries) {
    boundary += entry.probability;
    if (point < boundary) return entry;
  }
  throw new Error("Random source must return a value in [0, 1)");
};

/**
 * Overrides of one opening's draws, called after each random draw with the drawn index
 * (Kessen packs use them for pity guarantees and dupe protection). A hook returns the
 * index to use instead, which must name a selectable tier or an existing entry.
 */
export type WeightedCacheHooks = {
  tier?: (drawnTierIndex: number, rollIndex: number) => number;
  entry?: (tierIndex: number, drawnEntryIndex: number, rollIndex: number) => number;
};

/**
 * Validate, draw a roll count, then independently select a tier and uniform entry per roll.
 * Combine item quantities for delivery while retaining each selection for the audit receipt.
 */
export const resolveWeightedCache = (
  input: WeightedCache,
  random = Math.random,
  hooks: WeightedCacheHooks = {},
) => {
  const cache = weightedCacheSchema.parse(input);
  const rollCount = selectWeighted(cache.rolls, random).count;
  const quantities = new Map<string, number>();
  const selections = Array.from({ length: rollCount }, (_, rollIndex) => {
    const drawnTier = cache.tiers.indexOf(selectWeighted(cache.tiers, random));
    const tier = cache.tiers[hooks.tier?.(drawnTier, rollIndex) ?? drawnTier];
    if (!tier || tier.probability === 0 || tier.entries.length === 0)
      throw new Error("Weighted cache hooks must select a selectable tier");
    const drawnEntry = Math.floor(random() * tier.entries.length);
    const entryIndex =
      hooks.entry?.(cache.tiers.indexOf(tier), drawnEntry, rollIndex) ?? drawnEntry;
    const entry = tier.entries[entryIndex];
    if (!entry) throw new Error("Random source must return a value in [0, 1)");
    for (const item of entry.items)
      quantities.set(item.itemId, (quantities.get(item.itemId) ?? 0) + item.quantity);
    return {
      tierIndex: cache.tiers.indexOf(tier),
      tierName: tier.name,
      entryIndex,
      items: entry.items,
    };
  });
  return {
    displayName: cache.displayName,
    rollCount,
    selections,
    items: [...quantities].map(([itemId, quantity]) => ({ itemId, quantity })),
  };
};

/** Include inactive tiers so authoring checks catch references before a mode switch. */
export const cacheItemIds = (cache: WeightedCache) => [
  ...new Set(
    cache.tiers.flatMap((tier) =>
      tier.entries.flatMap((entry) => entry.items.map((item) => item.itemId)),
    ),
  ),
];

/** Chance of receiving this item at least once in an opening, including all roll counts. */
export const cacheItemChance = (cache: WeightedCache, itemId: string) => {
  const perRoll = cache.tiers.reduce(
    (sum, tier) =>
      sum +
      (tier.probability / CACHE_PROBABILITY_TOTAL) *
        (tier.entries.length === 0
          ? 0
          : tier.entries.filter((entry) =>
              entry.items.some((item) => item.itemId === itemId),
            ).length / tier.entries.length),
    0,
  );
  return Math.min(
    100,
    Math.max(
      0,
      100 *
        cache.rolls.reduce(
          (sum, roll) =>
            sum +
            (roll.probability / CACHE_PROBABILITY_TOTAL) *
              (1 - (1 - perRoll) ** roll.count),
          0,
        ),
    ),
  );
};

/** Start an editable draft that requires rewards before it can be saved in active mode. */
export const defaultWeightedCache = (): WeightedCache => ({
  version: 1,
  displayName: "Reward Cache",
  rolls: [
    { count: 1, probability: 5000 },
    { count: 2, probability: 5000 },
  ],
  tiers: [{ name: "Common", probability: CACHE_PROBABILITY_TOTAL, entries: [] }],
});

export const CACHE_RESTRICTED_REWARD_MESSAGE =
  "Weighted caches cannot reward reputation points, bloodlines, or bloodline-linked items";

/** Check actual grants; retained Standard rewards are inactive in Weighted Cache mode. */
/** Whether an effect opens a weighted cache instead of granting standard rewards. */
export const isWeightedCacheEffect = (
  effect: ZodAllTags,
): effect is WeightedCacheEffect =>
  effect.type === "noncombatconsumereward" && effect.rewardMode === "weightedCache";

export const isRestrictedCacheReward = (source: {
  bloodlineId?: string | null;
  effects: ZodAllTags[];
}): boolean =>
  !!source.bloodlineId ||
  source.effects.some(
    (effect) =>
      effect.type === "rollbloodline" ||
      (effect.type === "noncombatconsumereward" &&
        effect.rewardMode !== "weightedCache" &&
        ((effect.reward_reputation ?? 0) !== 0 ||
          (effect.reward_bloodlines?.length ?? 0) > 0)),
  );

export type CacheIssue = { path: PropertyKey[]; message: string };

/**
 * Save blockers of a cache draft: the schema (the draft one while the cache is inactive),
 * plus, once the item catalog is ready, rewards missing or restricted in its lookup.
 * Callers supply their catalog index so validation and item labels can share it.
 * Until the catalog is ready, only schema checks run and the lookup is not read.
 */
export const getWeightedCacheIssues = (
  cache: WeightedCache,
  itemById: ReadonlyMap<string, { isRestrictedCacheReward?: boolean }>,
  { isActive, catalogReady }: { isActive: boolean; catalogReady: boolean },
) => {
  const validation = (
    isActive ? weightedCacheSchema : weightedCacheDraftSchema
  ).safeParse(cache);
  const issues: CacheIssue[] = [...(validation.error?.issues ?? [])];
  const isSchemaValid = validation.success;
  if (!catalogReady) return { issues, isSchemaValid };
  cache.tiers.forEach((tier, tierIndex) => {
    tier.entries.forEach((entry, entryIndex) => {
      entry.items.forEach((reward, itemIndex) => {
        const path = ["tiers", tierIndex, "entries", entryIndex, "items", itemIndex];
        const rewardItem = itemById.get(reward.itemId);
        if (!rewardItem)
          issues.push({
            path,
            message: `Remove or replace missing item: ${reward.itemId}`,
          });
        else if (rewardItem.isRestrictedCacheReward)
          issues.push({ path, message: CACHE_RESTRICTED_REWARD_MESSAGE });
      });
    });
  });
  return { issues, isSchemaValid };
};

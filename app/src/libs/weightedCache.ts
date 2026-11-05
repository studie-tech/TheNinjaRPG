import { CACHE_PROBABILITY_TOTAL } from "@/drizzle/constants";
import type { ZodAllTags } from "@/validators/combat";
import { type WeightedCache, weightedCacheSchema } from "@/validators/weightedCache";

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
 * Validate, draw a roll count, then independently select a tier and uniform entry per roll.
 * Combine item quantities for delivery while retaining each selection for the audit receipt.
 */
export const resolveWeightedCache = (input: WeightedCache, random = Math.random) => {
  const cache = weightedCacheSchema.parse(input);
  const rollCount = selectWeighted(cache.rolls, random).count;
  const quantities = new Map<string, number>();
  const selections = Array.from({ length: rollCount }, () => {
    const tier = selectWeighted(cache.tiers, random);
    const entryIndex = Math.floor(random() * tier.entries.length);
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

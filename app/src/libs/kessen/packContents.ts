/**
 * What a Kessen card pack holds: its weighted-cache effects built from the card catalog,
 * and the slots, odds and factions read back from stored caches. Pure, so the item
 * editor builds pack contents with the same code as the seed packs.
 */
import {
  CACHE_MAX_ENTRIES,
  CACHE_PROBABILITY_TOTAL,
  type KessenPackTier,
} from "@/drizzle/constants";
import type { DeckFaction } from "@/libs/kessen/deck";
import { KESSEN_DEFAULT_PACK_SLOTS } from "@/libs/kessen/packs";
import type { KessenCard } from "@/libs/kessen/types";
import { isWeightedCacheEffect } from "@/libs/weightedCache";
import { NonCombatConsumeRewardTag, type ZodAllTags } from "@/validators/combat";
import type { KessenFaction } from "@/validators/itemCard";
import type {
  KessenPackEntry,
  KessenPackOdds,
  KessenPackSlots,
} from "@/validators/kessen";
import {
  maximumCacheItems,
  type WeightedCache,
  weightedCacheSchema,
} from "@/validators/weightedCache";

/** Pack slot tiers from worst to best; pity raises the last slot to a minimum tier. */
export const KESSEN_PACK_TIERS: readonly KessenPackTier[] = [
  "COMMON",
  "RARE",
  "EPIC",
  "LEGENDARY",
  "FORBIDDEN",
];

/** Display names of the tiers inside a pack's weighted caches. */
export const KESSEN_PACK_TIER_NAMES: Record<KessenPackTier, string> = {
  COMMON: "Common",
  RARE: "Rare",
  EPIC: "Epic",
  LEGENDARY: "Legendary",
  FORBIDDEN: "Forbidden",
};

/** A card's pack tier: its rarity, or FORBIDDEN for a Forbidden variant. */
export const kessenPackTierOf = (card: Pick<KessenCard, "rarity" | "variant">) =>
  card.variant === "FORBIDDEN" ? "FORBIDDEN" : card.rarity;

/**
 * Cards a pack can grant: collectible deck cards (never leaders or tokens) of every
 * faction, or of one faction plus Neutral; Forbidden variants follow the same filter.
 */
export const kessenPackPool = (
  cards: Iterable<KessenCard>,
  faction: DeckFaction | null,
) =>
  [...cards]
    .filter(
      (card) =>
        card.kind !== "LEADER" &&
        card.isCollectible &&
        (faction === null || card.faction === faction || card.faction === "NEUTRAL"),
    )
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/**
 * Why a pool cannot be built into a pack, or null: it needs cards, and each tier lists
 * its cards as cache entries, at most `CACHE_MAX_ENTRIES` per tier.
 */
export const kessenPackPoolProblem = (pool: readonly KessenCard[]) => {
  if (pool.length === 0) return "The card pool holds no collectible cards.";
  const crowded = KESSEN_PACK_TIERS.find(
    (tier) =>
      pool.filter((card) => kessenPackTierOf(card) === tier).length > CACHE_MAX_ENTRIES,
  );
  return crowded
    ? `The pool holds more than ${CACHE_MAX_ENTRIES} ${KESSEN_PACK_TIER_NAMES[crowded]} cards; pick one faction.`
    : null;
};

/**
 * The weighted-cache effects of a pack built from the card catalog: one cache for the
 * normal slots, then one for the last (rare) slots when the pack has any. Each tier lists
 * its pool cards as single-card entries; zero-weight tiers and tiers without cards are
 * left out.
 */
export const buildKessenPackEffects = (
  pack: KessenPackContents,
  cards: Iterable<KessenCard>,
): ZodAllTags[] => {
  const pool = kessenPackPool(cards, pack.faction);
  const slots = pack.slots ?? KESSEN_DEFAULT_PACK_SLOTS;
  const cache = (
    displayName: string,
    count: number,
    weights: Record<KessenPackTier, number>,
  ): WeightedCache => {
    const tiers = KESSEN_PACK_TIERS.flatMap((tier) => {
      const entries = pool
        .filter((card) => kessenPackTierOf(card) === tier)
        .map((card) => ({ items: [{ itemId: card.id, quantity: 1 }] }));
      return weights[tier] > 0 && entries.length > 0
        ? [{ name: KESSEN_PACK_TIER_NAMES[tier], probability: weights[tier], entries }]
        : [];
    });
    // A tier without pool cards gives its weight to the most likely tier, so the odds
    // still total 100%.
    const missing =
      CACHE_PROBABILITY_TOTAL - tiers.reduce((sum, tier) => sum + tier.probability, 0);
    const likeliest = tiers.reduce<(typeof tiers)[number] | undefined>(
      (best, tier) => (!best || tier.probability > best.probability ? tier : best),
      undefined,
    );
    if (likeliest && missing > 0) likeliest.probability += missing;
    return {
      version: 1,
      displayName,
      rolls: [{ count, probability: CACHE_PROBABILITY_TOTAL }],
      tiers,
    };
  };
  return [
    cache(pack.name, slots.normal, pack.normalWeights),
    ...(slots.rareSlot > 0
      ? [
          cache(
            rareSlotCacheName(pack.name, slots),
            slots.rareSlot,
            pack.rareSlotWeights,
          ),
        ]
      : []),
  ].map((weightedCache) =>
    NonCombatConsumeRewardTag.parse({
      type: "noncombatconsumereward",
      rewardMode: "weightedCache",
      weightedCache,
    }),
  );
};

/**
 * A pack's published slot odds, read from its stored weighted caches (the first is a
 * normal slot, the last the rare slot) so staff edits show up. Each cache tier counts
 * toward the pack tier of its cards; basis points of 10,000. Pity guarantees apply only
 * after a streak and are shown separately.
 */
export const kessenPackOdds = (
  effects: readonly ZodAllTags[],
  cards: ReadonlyMap<string, KessenCard>,
): KessenPackEntry["odds"] => {
  const caches = storedCaches(effects);
  return {
    normal: cacheOdds(caches[0], cards),
    rareSlot: cacheOdds(caches[caches.length - 1], cards),
  };
};

/**
 * Cards a pack opens per slot kind, read from its stored caches like `kessenPackOdds`:
 * every cache before the last holds normal slots and the last one the rare slot. A pack
 * with one cache has only normal slots; one without caches reads as the built layout.
 */
export const kessenPackSlots = (effects: readonly ZodAllTags[]): KessenPackSlots => {
  const counts = storedCaches(effects).map(maximumCacheItems);
  if (counts.length === 0) return KESSEN_DEFAULT_PACK_SLOTS;
  if (counts.length === 1) return { normal: counts[0] ?? 0, rareSlot: 0 };
  return {
    normal: counts.slice(0, -1).reduce((sum, count) => sum + count, 0),
    rareSlot: counts.at(-1) ?? 0,
  };
};

/** Factions of the cards a pack's stored caches can grant, in catalog order. */
export const kessenPackFactions = (
  effects: readonly ZodAllTags[],
  cards: ReadonlyMap<string, KessenCard>,
): KessenFaction[] => {
  const found = new Set<KessenFaction>();
  for (const cache of storedCaches(effects))
    for (const tier of cache.tiers)
      for (const entry of tier.entries)
        for (const reward of entry.items) {
          const card = cards.get(reward.itemId);
          if (card) found.add(card.faction);
        }
  return [...found].sort();
};

/** Tier class of a cache tier whose entries are all single non-leader cards of one tier. */
export const kessenTierClassOf = (
  tier: WeightedCache["tiers"][number],
  cards: ReadonlyMap<string, KessenCard>,
): KessenPackTier | null => {
  let found: KessenPackTier | null = null;
  for (const entry of tier.entries) {
    const reward = entry.items[0];
    const card = reward ? cards.get(reward.itemId) : undefined;
    if (entry.items.length !== 1 || reward?.quantity !== 1 || !card) return null;
    if (card.kind === "LEADER") return null;
    const tierClass = kessenPackTierOf(card);
    if (found && found !== tierClass) return null;
    found = tierClass;
  }
  return found;
};

/** Name of the rare-slot cache: "Paper Bundle: fifth card" for the default layout. */
const rareSlotCacheName = (name: string, slots: KessenPackSlots) =>
  slots.rareSlot === 1
    ? `${name}: ${ordinalWord(slots.normal + 1)} card`
    : `${name}: last ${slots.rareSlot} cards`;

const storedCaches = (effects: readonly ZodAllTags[]) =>
  effects.filter(isWeightedCacheEffect).flatMap((effect) => {
    const parsed = weightedCacheSchema.safeParse(effect.weightedCache);
    return parsed.success ? [parsed.data] : [];
  });

/** Tier odds of one cache in basis points; rounding remainders go to the likeliest tier. */
const cacheOdds = (
  cache: WeightedCache | undefined,
  cards: ReadonlyMap<string, KessenCard>,
): KessenPackOdds => {
  const odds: KessenPackOdds = {
    COMMON: 0,
    RARE: 0,
    EPIC: 0,
    LEGENDARY: 0,
    FORBIDDEN: 0,
  };
  const total = cache?.tiers.reduce((sum, tier) => sum + tier.probability, 0) ?? 0;
  if (!cache || total <= 0) return odds;
  for (const tier of cache.tiers) {
    const tierClass = kessenTierClassOf(tier, cards);
    if (tierClass) odds[tierClass] += tier.probability;
  }
  let used = 0;
  for (const tier of KESSEN_PACK_TIERS) {
    odds[tier] = Math.floor((odds[tier] * 10_000) / total);
    used += odds[tier];
  }
  const likeliest = KESSEN_PACK_TIERS.reduce((best, tier) =>
    odds[tier] > odds[best] ? tier : best,
  );
  if (odds[likeliest] > 0) odds[likeliest] += 10_000 - used;
  return odds;
};

/** "fifth" for 5; "12th", "21st" or "22nd" past the ninth. */
export function ordinalWord(position: number) {
  const words = [
    "first",
    "second",
    "third",
    "fourth",
    "fifth",
    "sixth",
    "seventh",
    "eighth",
    "ninth",
  ];
  const teen = position % 100 >= 11 && position % 100 <= 13;
  const suffix = teen ? "th" : (["th", "st", "nd", "rd"][position % 10] ?? "th");
  return words[position - 1] ?? `${position}${suffix}`;
}

/** What a pack's caches are built from: its pool, slot layout and tier weights. */
export interface KessenPackContents {
  /** Display name of the caches. */
  name: string;
  /** Draws from this faction plus Neutral; null draws from every faction. */
  faction: DeckFaction | null;
  /** Cards per slot kind; the default layout (four normal, one rare) when omitted. */
  slots?: KessenPackSlots;
  /** Tier weights of the normal slots, out of `CACHE_PROBABILITY_TOTAL`. */
  normalWeights: Record<KessenPackTier, number>;
  /** Tier weights of the rare slots, out of `CACHE_PROBABILITY_TOTAL`. */
  rareSlotWeights: Record<KessenPackTier, number>;
}

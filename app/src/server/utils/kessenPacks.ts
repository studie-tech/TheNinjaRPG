/**
 * Kessen card packs: the pack catalog and its weighted-cache effects, and the card-aware
 * hooks of a pack opening (First Bundle guarantee, epic and legendary pity, dupe
 * protection and auto-sold surplus). Packs are ordinary CONSUMABLE items with two
 * weighted-cache effects (four normal slots, then the Rare+ fifth slot); every opening,
 * from the Card Hall or the item page, runs through the item consume path, which calls
 * `prepareKessenPackOpening` for an item whose id is a Kessen pack id.
 */
import { randomUUID } from "node:crypto";
import {
  CACHE_PROBABILITY_TOTAL,
  type ItemPurchaseLimitPeriods,
  KESSEN_CARD_SELL_VALUES,
  KESSEN_COPY_LIMITS,
  KESSEN_EPIC_PITY_PACKS,
  KESSEN_FIRST_BUNDLE_ITEM_ID,
  KESSEN_LACQUER_RARE_SLOT_WEIGHTS,
  KESSEN_LEGENDARY_PITY_PACKS,
  KESSEN_PACK_NORMAL_SLOTS,
  KESSEN_PACK_RARE_SLOT_WEIGHTS,
  KESSEN_PACK_SLOT_WEIGHTS,
  KESSEN_PAPER_BUNDLE_DAILY_LIMIT,
  KESSEN_PAPER_BUNDLE_PRICE,
  KESSEN_VILLAGE_BUNDLE_PRICE,
  KESSEN_VILLAGE_BUNDLE_WEEKLY_LIMIT,
  type KessenPackTier,
} from "@/drizzle/constants";
import { kessenCatalogCards, ownedCardCounts } from "@/libs/kessen/catalog";
import { type DeckFaction, KESSEN_DECK_FACTIONS } from "@/libs/kessen/deck";
import {
  isKessenPackId,
  KESSEN_DEFAULT_PACK_SLOTS,
  KESSEN_FACTION_NAMES,
  KESSEN_PACK_IDS,
  KESSEN_PACK_NAMES,
} from "@/libs/kessen/packs";
import { createRng, type Rng } from "@/libs/kessen/rng";
import type { KessenCard } from "@/libs/kessen/types";
import {
  cacheItemIds,
  isWeightedCacheEffect,
  resolveWeightedCache,
  type WeightedCacheHooks,
} from "@/libs/weightedCache";
import {
  findKessenProgress,
  insertKessenProgressIfMissing,
  listKessenCards,
  listOwnedKessenCardCounts,
  updateKessenProgressForReservePackPity,
} from "@/queries/kessen";
import { incrementUserMoney } from "@/queries/profile";
import { errorResponse } from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { NonCombatConsumeRewardTag, type ZodAllTags } from "@/validators/combat";
import type {
  KessenPackEntry,
  KessenPackOdds,
  KessenPackSlots,
} from "@/validators/kessen";
import {
  type CardPackReveal,
  maximumCacheItems,
  type WeightedCache,
  weightedCacheSchema,
} from "@/validators/weightedCache";

/** Pack slot tiers from worst to best; pity raises the fifth slot to a minimum tier. */
export const KESSEN_PACK_TIERS: readonly KessenPackTier[] = [
  "COMMON",
  "RARE",
  "EPIC",
  "LEGENDARY",
  "FORBIDDEN",
];

/** Display names of the tiers inside a pack's weighted caches. */
const KESSEN_PACK_TIER_NAMES: Record<KessenPackTier, string> = {
  COMMON: "Common",
  RARE: "Rare",
  EPIC: "Epic",
  LEGENDARY: "Legendary",
  FORBIDDEN: "Forbidden",
};

export type KessenPackKind = "paper" | "village" | "lacquer" | "first";

/** One pack item: its pool, slot weights and Card Master stall listing. */
export interface KessenPackDefinition {
  id: string;
  name: string;
  kind: KessenPackKind;
  /** Village Bundles draw from this faction plus Neutral; null draws from every faction. */
  faction: DeckFaction | null;
  description: string;
  normalWeights: Record<KessenPackTier, number>;
  rareSlotWeights: Record<KessenPackTier, number>;
  /** Stall listing; null packs are earned only. */
  listing: {
    cost: number;
    purchaseLimit: number;
    purchaseLimitPeriod: (typeof ItemPurchaseLimitPeriods)[number];
  } | null;
}

/** Cards per pack in words ("Five") and the ordinal of its rare slot ("fifth"). */
const PACK_CARDS = numberWord(KESSEN_PACK_NORMAL_SLOTS + 1);
const LAST_CARD = ordinalWord(KESSEN_PACK_NORMAL_SLOTS + 1);

/**
 * Every Kessen pack: Paper, six Village Bundles, Lacquer Case and First Bundle. The seed
 * migration's pack caches are built from these definitions with `buildKessenPackEffects`.
 */
export const KESSEN_PACKS: readonly KessenPackDefinition[] = [
  {
    id: KESSEN_PACK_IDS.paper,
    name: KESSEN_PACK_NAMES.paper,
    kind: "paper",
    faction: null,
    description: `${PACK_CARDS} Kessen cards from every faction, wrapped in rice paper. The ${LAST_CARD} card is rare or better.`,
    normalWeights: KESSEN_PACK_SLOT_WEIGHTS,
    rareSlotWeights: KESSEN_PACK_RARE_SLOT_WEIGHTS,
    listing: {
      cost: KESSEN_PAPER_BUNDLE_PRICE,
      purchaseLimit: KESSEN_PAPER_BUNDLE_DAILY_LIMIT,
      purchaseLimitPeriod: "DAILY",
    },
  },
  ...KESSEN_DECK_FACTIONS.map(
    (faction): KessenPackDefinition => ({
      id: KESSEN_PACK_IDS.village(faction),
      name: KESSEN_PACK_NAMES.village(faction),
      kind: "village",
      faction,
      description: `${PACK_CARDS} Kessen cards of the ${KESSEN_FACTION_NAMES[faction]} and Neutral factions. The ${LAST_CARD} card is rare or better.`,
      normalWeights: KESSEN_PACK_SLOT_WEIGHTS,
      rareSlotWeights: KESSEN_PACK_RARE_SLOT_WEIGHTS,
      listing: {
        cost: KESSEN_VILLAGE_BUNDLE_PRICE,
        purchaseLimit: KESSEN_VILLAGE_BUNDLE_WEEKLY_LIMIT,
        purchaseLimitPeriod: "WEEKLY",
      },
    }),
  ),
  {
    id: KESSEN_PACK_IDS.lacquer,
    name: KESSEN_PACK_NAMES.lacquer,
    kind: "lacquer",
    faction: null,
    description: `A sealed lacquer case of ${PACK_CARDS.toLowerCase()} Kessen cards. The ${LAST_CARD} card is epic or better. Earned, never sold.`,
    normalWeights: KESSEN_PACK_SLOT_WEIGHTS,
    rareSlotWeights: KESSEN_LACQUER_RARE_SLOT_WEIGHTS,
    listing: null,
  },
  {
    id: KESSEN_PACK_IDS.first,
    name: KESSEN_PACK_NAMES.first,
    kind: "first",
    faction: null,
    description: `Lemu's welcome gift: ${PACK_CARDS.toLowerCase()} Kessen cards, the ${LAST_CARD} one epic or better. It cannot be sold or traded.`,
    normalWeights: KESSEN_PACK_SLOT_WEIGHTS,
    rareSlotWeights: KESSEN_LACQUER_RARE_SLOT_WEIGHTS,
    listing: null,
  },
];

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
 * The two weighted-cache effects of a pack built from the card catalog: four normal
 * slots, then the fifth slot. Each tier lists its pool cards as single-card entries;
 * zero-weight tiers and tiers without cards are left out.
 */
export const buildKessenPackEffects = (
  pack: KessenPackDefinition,
  cards: Iterable<KessenCard>,
): ZodAllTags[] => {
  const pool = kessenPackPool(cards, pack.faction);
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
    cache(pack.name, KESSEN_PACK_NORMAL_SLOTS, pack.normalWeights),
    cache(`${pack.name}: fifth card`, 1, pack.rareSlotWeights),
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
 * normal slot, the last the fifth slot) so staff edits show up. Each cache tier counts
 * toward the pack tier of its cards; basis points of 10,000. Pity guarantees apply only
 * after a streak and are shown separately.
 */
export const kessenPackOdds = (
  effects: readonly ZodAllTags[],
  cards: ReadonlyMap<string, KessenCard>,
): KessenPackEntry["odds"] => {
  const caches = effects.filter(isWeightedCacheEffect).flatMap((effect) => {
    const parsed = weightedCacheSchema.safeParse(effect.weightedCache);
    return parsed.success ? [parsed.data] : [];
  });
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
  const counts = effects.filter(isWeightedCacheEffect).flatMap((effect) => {
    const parsed = weightedCacheSchema.safeParse(effect.weightedCache);
    return parsed.success ? [maximumCacheItems(parsed.data)] : [];
  });
  if (counts.length === 0) return KESSEN_DEFAULT_PACK_SLOTS;
  if (counts.length === 1) return { normal: counts[0] ?? 0, rareSlot: 0 };
  return {
    normal: counts.slice(0, -1).reduce((sum, count) => sum + count, 0),
    rareSlot: counts.at(-1) ?? 0,
  };
};

/** Pity counters of `KessenProgress`. */
export interface KessenPityCounters {
  packsSinceEpic: number;
  packsSinceLegendary: number;
}

/**
 * Packs until each guarantee, counting the guaranteed pack: after `KESSEN_EPIC_PITY_PACKS`
 * packs without an epic the next fifth slot is epic, and the `KESSEN_LEGENDARY_PITY_PACKS`th
 * pack without a legendary is one.
 */
export const kessenPityCountdown = (counters: KessenPityCounters) => ({
  epicIn: Math.max(1, KESSEN_EPIC_PITY_PACKS + 1 - counters.packsSinceEpic),
  legendaryIn: Math.max(1, KESSEN_LEGENDARY_PITY_PACKS - counters.packsSinceLegendary),
});

/** The minimum tier of a pack's fifth slot, or null when no guarantee applies. */
export const kessenRareSlotMinimum = (
  counters: KessenPityCounters,
  packItemId: string,
): KessenPackTier | null => {
  const pity = kessenPityCountdown(counters);
  if (pity.legendaryIn <= 1) return "LEGENDARY";
  if (pity.epicIn <= 1 || packItemId === KESSEN_FIRST_BUNDLE_ITEM_ID) return "EPIC";
  return null;
};

export interface KessenPackPlanInput {
  packItemId: string;
  /** The pack's weighted caches in effect order; the last one is the fifth slot. */
  caches: WeightedCache[];
  /** Cards the caches reference, by item id. */
  cards: ReadonlyMap<string, KessenCard>;
  /** Owned copies per item id, auction listings included. */
  owned: Readonly<Record<string, number>>;
  counters: KessenPityCounters;
  autoSellSurplus: boolean;
  /** Seeds the re-rolls of dupe protection and the unowned-legendary pick. */
  seed: string;
  random?: () => number;
}

export type KessenPackCacheResult = ReturnType<typeof resolveWeightedCache>;

export interface KessenPackPlan {
  /** Cache results with auto-sold copies removed from `items`. */
  results: KessenPackCacheResult[];
  reveal: CardPackReveal;
  soldRyo: number;
  counters: KessenPityCounters & { firstBundleOpened: boolean };
}

/**
 * Resolves a pack's caches with the card hooks:
 * - the fifth slot is raised to EPIC for the First Bundle and after `KESSEN_EPIC_PITY_PACKS`
 *   packs without an epic, and to LEGENDARY on the `KESSEN_LEGENDARY_PITY_PACKS`th pack
 *   without a legendary, picking a standard
 *   legendary missing from the collection whenever the tier holds one;
 * - a card at its copy limit (C 3, R 2, E 1, L 1 per item id, counting auction listings;
 *   a Forbidden variant is collected once and never counts as a copy of its base) is
 *   re-rolled among the tier's non-maxed cards, and only when all are maxed is the copy
 *   granted as surplus;
 * - surplus is sold for its fixed value instead when auto-sell is on (Forbidden never).
 * Forbidden pulls never reset the pity counters, which count standard cards only.
 */
export const planKessenPackOpening = (input: KessenPackPlanInput): KessenPackPlan => {
  const rng = createRng(input.seed);
  const copies = new Map(Object.entries(input.owned));
  const minimum = kessenRareSlotMinimum(input.counters, input.packItemId);
  const legendaryPity = minimum === "LEGENDARY";
  const reveal: CardPackReveal["cards"] = [];
  const sold = new Map<string, number>();
  let soldRyo = 0;
  const results = input.caches.map((cache, cacheIndex) => {
    const isFifthSlot =
      input.caches.length > 1 && cacheIndex === input.caches.length - 1;
    const tierClasses = cache.tiers.map((tier) => tierClassOf(tier, input.cards));
    const hooks: WeightedCacheHooks = {
      tier: (drawn) => {
        if (!isFifthSlot || !minimum) return drawn;
        const drawnClass = tierClasses[drawn];
        if (drawnClass && tierRank(drawnClass) >= tierRank(minimum)) return drawn;
        const forced = cache.tiers.findIndex(
          (tier, index) =>
            tierClasses[index] === minimum &&
            tier.probability > 0 &&
            tier.entries.length > 0,
        );
        return forced === -1 ? drawn : forced;
      },
      entry: (tierIndex, drawn) => {
        const tier = cache.tiers[tierIndex];
        if (!tier || !tierClasses[tierIndex]) return drawn;
        const cardAt = (index: number) =>
          input.cards.get(tier.entries[index]?.items[0]?.itemId ?? "") as KessenCard;
        const indices = tier.entries.map((_, index) => index);
        let chosen = drawn;
        const unowned =
          isFifthSlot && legendaryPity && tierClasses[tierIndex] === "LEGENDARY"
            ? indices.filter(
                (index) =>
                  cardAt(index).variant === "STANDARD" &&
                  countOf(copies, cardAt(index)) === 0,
              )
            : [];
        if (unowned.length > 0) {
          chosen = pick(rng, unowned);
        } else if (isMaxedIn(copies, cardAt(drawn))) {
          const open = indices.filter((index) => !isMaxedIn(copies, cardAt(index)));
          if (open.length > 0) chosen = pick(rng, open);
        }
        const card = cardAt(chosen);
        const surplus = isMaxedIn(copies, card);
        const isNew = countOf(copies, card) === 0;
        const soldFor =
          surplus && input.autoSellSurplus && card.variant !== "FORBIDDEN"
            ? KESSEN_CARD_SELL_VALUES[card.rarity]
            : null;
        if (soldFor !== null) {
          soldRyo += soldFor;
          sold.set(card.id, (sold.get(card.id) ?? 0) + 1);
        } else {
          addCopy(copies, card);
        }
        reveal.push({
          itemId: card.id,
          rarity: card.rarity,
          forbidden: card.variant === "FORBIDDEN",
          isNew,
          surplus,
          soldFor,
        });
        return chosen;
      },
    };
    return resolveWeightedCache(cache, input.random, hooks);
  });
  // Auto-sold copies are paid in ryo instead of delivered; the selections keep the audit.
  for (const result of results) {
    result.items = result.items.flatMap((reward) => {
      const take = Math.min(sold.get(reward.itemId) ?? 0, reward.quantity);
      if (take > 0) sold.set(reward.itemId, (sold.get(reward.itemId) ?? 0) - take);
      return reward.quantity > take
        ? [{ itemId: reward.itemId, quantity: reward.quantity - take }]
        : [];
    });
  }
  const standard = reveal.filter((card) => !card.forbidden);
  const counters = {
    packsSinceEpic: standard.some(
      (card) => card.rarity === "EPIC" || card.rarity === "LEGENDARY",
    )
      ? 0
      : input.counters.packsSinceEpic + 1,
    packsSinceLegendary: standard.some((card) => card.rarity === "LEGENDARY")
      ? 0
      : input.counters.packsSinceLegendary + 1,
    firstBundleOpened: input.packItemId === KESSEN_FIRST_BUNDLE_ITEM_ID,
  };
  return {
    results,
    reveal: {
      packItemId: input.packItemId,
      cards: reveal,
      pity: kessenPityCountdown(counters),
    },
    soldRyo,
    counters,
  };
};

/** Thrown inside the opening transaction when another opening moved the pity counters. */
export class KessenPackRaceError extends Error {
  constructor() {
    super("Another pack was opened at the same time. Please try again.");
  }
}

/**
 * Loads what a pack opening needs (pity counters, the referenced cards and the player's
 * card stacks) and returns the plan step plus the guarded writes that run inside the
 * opening's receipt transaction. Null for items that are not Kessen packs.
 */
export const prepareKessenPackOpening = async ({
  client,
  userId,
  item,
  caches,
}: {
  client: DrizzleClient;
  userId: string;
  item: { id: string };
  caches: WeightedCache[];
}) => {
  if (!isKessenPackId(item.id) || caches.length === 0) return null;
  const ids = [...new Set(caches.flatMap(cacheItemIds))];
  // The default row must exist for the pity reservation's compare-and-set to match.
  const [[stored], cardRows, ownedRows] = await Promise.all([
    findKessenProgress(client, userId),
    listKessenCards(client, ids),
    listOwnedKessenCardCounts(client, userId),
  ]);
  if (!stored) await insertKessenProgressIfMissing(client, userId);
  const cards = new Map(kessenCatalogCards(cardRows).map((card) => [card.id, card]));
  if (ids.some((id) => cards.get(id)?.kind === "LEADER"))
    return errorResponse("This pack lists a leader card. Please contact staff.");
  const owned = ownedCardCounts(ownedRows).all;
  const counters = {
    packsSinceEpic: stored?.packsSinceEpic ?? 0,
    packsSinceLegendary: stored?.packsSinceLegendary ?? 0,
  };
  // The seed is never client-chosen, so request ids cannot steer which card a re-roll picks.
  const seed = `kessen-pack:${randomUUID()}`;
  return {
    success: true as const,
    /** Resolves the caches; run once, before the receipt transaction. */
    open: (random?: () => number) => {
      const plan = planKessenPackOpening({
        packItemId: item.id,
        caches,
        cards,
        owned,
        counters,
        autoSellSurplus: stored?.autoSellSurplus ?? false,
        seed,
        random,
      });
      return {
        ...plan,
        /** Reserves the pity counters and pays auto-sold surplus inside the transaction. */
        commit: async (tx: DrizzleClient) => {
          const reserved = await updateKessenProgressForReservePackPity(
            tx,
            userId,
            counters,
            plan.counters,
          );
          if (reserved.rowsAffected !== 1) throw new KessenPackRaceError();
          if (plan.soldRyo > 0) await incrementUserMoney(tx, plan.soldRyo, userId);
        },
        notifications:
          plan.soldRyo > 0
            ? [
                `Auto-sold ${plan.reveal.cards.filter((card) => card.soldFor !== null).length} surplus cards for ${plan.soldRyo} ryo.`,
              ]
            : [],
      };
    },
  };
};

/** Tier class of a cache tier whose entries are all single non-leader cards of one tier. */
const tierClassOf = (
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
    const tierClass = tierClassOf(tier, cards);
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

const tierRank = (tier: KessenPackTier) => KESSEN_PACK_TIERS.indexOf(tier);

const pick = (rng: Rng, indices: readonly number[]) =>
  indices[rng.int(indices.length)] as number;

/**
 * Copies held of one item id, as the collection book counts them. A Forbidden variant is
 * its own collectible, so it never counts as a copy of its base card.
 */
const countOf = (copies: ReadonlyMap<string, number>, card: KessenCard) =>
  copies.get(card.id) ?? 0;

const isMaxedIn = (copies: ReadonlyMap<string, number>, card: KessenCard) =>
  countOf(copies, card) >=
  (card.variant === "FORBIDDEN" ? 1 : KESSEN_COPY_LIMITS[card.rarity]);

const addCopy = (copies: Map<string, number>, card: KessenCard) => {
  copies.set(card.id, (copies.get(card.id) ?? 0) + 1);
};

function numberWord(count: number) {
  const words = [
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
  ];
  return words[count - 1] ?? String(count);
}

function ordinalWord(position: number) {
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
  return words[position - 1] ?? `${position}th`;
}

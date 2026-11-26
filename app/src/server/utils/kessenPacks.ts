/**
 * Kessen card packs: the seed pack catalog, the template of staff-created packs, and the
 * card-aware hooks of a pack opening (First Bundle guarantee, epic and legendary pity, dupe
 * protection and auto-sold surplus). Packs are ordinary CONSUMABLE items whose id starts
 * with `KESSEN_PACK_ID_PREFIX`, with weighted-cache effects for the normal slots and the
 * last (rare) slot, four and one by default. Every opening, from the Card Hall or the
 * item page, runs through the item consume path, which calls `prepareKessenPackOpening`
 * for an item whose id is a Kessen pack id. Pack contents are built and read by
 * `@/libs/kessen/packContents`.
 */
import { randomUUID } from "node:crypto";
import {
  IMG_KESSEN_PACKS,
  type ItemPurchaseLimitPeriods,
  KESSEN_CARD_SELL_VALUES,
  KESSEN_CARD_STACK_SIZE,
  KESSEN_COPY_LIMITS,
  KESSEN_EPIC_PITY_PACKS,
  KESSEN_FIRST_BUNDLE_ITEM_ID,
  KESSEN_LACQUER_RARE_SLOT_WEIGHTS,
  KESSEN_LEGENDARY_PITY_PACKS,
  KESSEN_PACK_ID_PREFIX,
  KESSEN_PACK_NORMAL_SLOTS,
  KESSEN_PACK_RARE_SLOT_WEIGHTS,
  KESSEN_PACK_SLOT_WEIGHTS,
  KESSEN_PAPER_BUNDLE_DAILY_LIMIT,
  KESSEN_PAPER_BUNDLE_PRICE,
  KESSEN_VILLAGE_BUNDLE_PRICE,
  KESSEN_VILLAGE_BUNDLE_WEEKLY_LIMIT,
  type KessenPackTier,
} from "@/drizzle/constants";
import type { Item } from "@/drizzle/schema";
import { kessenCatalogCards, ownedCardCounts } from "@/libs/kessen/catalog";
import { KESSEN_DECK_FACTIONS } from "@/libs/kessen/deck";
import {
  buildKessenPackEffects,
  KESSEN_PACK_TIERS,
  type KessenPackContents,
  kessenTierClassOf,
  ordinalWord,
} from "@/libs/kessen/packContents";
import {
  isKessenPackId,
  KESSEN_FACTION_NAMES,
  KESSEN_PACK_IDS,
  KESSEN_PACK_NAMES,
} from "@/libs/kessen/packs";
import { createRng, type Rng } from "@/libs/kessen/rng";
import type { KessenCard } from "@/libs/kessen/types";
import {
  cacheItemIds,
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
import type { CardPackReveal, WeightedCache } from "@/validators/weightedCache";

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

/**
 * Item fields of a pack staff create in the item manual: an unlisted, hidden consumable
 * with the Paper Bundle's pool, odds and price until staff change its contents and stall
 * listing, and valid for the item editor as created.
 */
export const kessenNewPackItem = (id: string, cards: Iterable<KessenCard>) => {
  const name = `New Kessen Pack - ${id.slice(KESSEN_PACK_ID_PREFIX.length)}`;
  return {
    id,
    name,
    description: `${PACK_CARDS} Kessen cards from every faction. The ${LAST_CARD} card is rare or better.`,
    image: IMG_KESSEN_PACKS.paper,
    itemType: "CONSUMABLE",
    rarity: "COMMON",
    slot: "NONE",
    target: "SELF",
    effects: buildKessenPackEffects(
      {
        name,
        faction: null,
        normalWeights: KESSEN_PACK_SLOT_WEIGHTS,
        rareSlotWeights: KESSEN_PACK_RARE_SLOT_WEIGHTS,
      },
      cards,
    ),
    destroyOnUse: true,
    canStack: true,
    stackSize: KESSEN_CARD_STACK_SIZE,
    preventBattleUsage: true,
    maxDurability: 100,
    canBeTraded: false,
    inShop: false,
    hidden: true,
    cost: KESSEN_PAPER_BUNDLE_PRICE,
    repsCost: 0,
    seichiSilverCost: 0,
  } satisfies Partial<Item>;
};

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

/**
 * Resolves a pack's caches with the card hooks:
 * - the last draw of the rare cache is raised to EPIC for the First Bundle and after
 *   `KESSEN_EPIC_PITY_PACKS` packs without an epic, and to LEGENDARY on the
 *   `KESSEN_LEGENDARY_PITY_PACKS`th pack
 *   without a legendary, picking a standard legendary missing from the collection
 *   whenever the tier holds one;
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
    const isRareGroup =
      input.caches.length > 1 && cacheIndex === input.caches.length - 1;
    const tierClasses = cache.tiers.map((tier) => kessenTierClassOf(tier, input.cards));
    const hooks: WeightedCacheHooks = {
      tier: (drawn, rollIndex, rollCount) => {
        if (!isRareGroup || rollIndex !== rollCount - 1 || !minimum) return drawn;
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
      entry: (tierIndex, drawn, rollIndex, rollCount) => {
        const tier = cache.tiers[tierIndex];
        if (!tier || !tierClasses[tierIndex]) return drawn;
        const cardAt = (index: number) =>
          input.cards.get(tier.entries[index]?.items[0]?.itemId ?? "") as KessenCard;
        const indices = tier.entries.map((_, index) => index);
        let chosen = drawn;
        const unowned =
          isRareGroup &&
          rollIndex === rollCount - 1 &&
          legendaryPity &&
          tierClasses[tierIndex] === "LEGENDARY"
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
  const [[stored], cardRows, ownedRows] = await Promise.all([
    findKessenProgress(client, userId),
    listKessenCards(client, ids),
    listOwnedKessenCardCounts(client, userId),
  ]);
  // The default row must exist for the pity reservation's compare-and-set to match.
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

export type KessenPackKind = "paper" | "village" | "lacquer" | "first";

/** One pack item: its pool, slot weights and Card Master stall listing. */
export interface KessenPackDefinition extends KessenPackContents {
  id: string;
  kind: KessenPackKind;
  description: string;
  /** Stall listing; null packs are earned only. */
  listing: {
    cost: number;
    purchaseLimit: number;
    purchaseLimitPeriod: (typeof ItemPurchaseLimitPeriods)[number];
  } | null;
}

/** Pity counters of `KessenProgress`. */
export interface KessenPityCounters {
  packsSinceEpic: number;
  packsSinceLegendary: number;
}

/** What `planKessenPackOpening` resolves one pack from. */
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
  /** The cache rolls' random source; `Math.random` when omitted. */
  random?: () => number;
}

export type KessenPackCacheResult = ReturnType<typeof resolveWeightedCache>;

/** One resolved pack opening: what it grants, sells and reveals, and the pity after it. */
export interface KessenPackPlan {
  /** Cache results with auto-sold copies removed from `items`. */
  results: KessenPackCacheResult[];
  reveal: CardPackReveal;
  soldRyo: number;
  counters: KessenPityCounters & { firstBundleOpened: boolean };
}

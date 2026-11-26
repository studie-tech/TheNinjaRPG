import { describe, expect, it } from "bun:test";
import {
  CACHE_MAX_ENTRIES,
  CACHE_PROBABILITY_TOTAL,
  KESSEN_CARD_SELL_VALUES,
  KESSEN_FIRST_BUNDLE_ITEM_ID,
  KESSEN_LEGENDARY_PITY_PACKS,
  KESSEN_PACK_ID_PREFIX,
  KESSEN_PACK_NORMAL_SLOTS,
  KESSEN_PAPER_BUNDLE_PRICE,
} from "@/drizzle/constants";
import {
  buildKessenPackEffects,
  kessenPackFactions,
  kessenPackOdds,
  kessenPackPool,
  kessenPackPoolProblem,
  kessenPackSlots,
} from "@/libs/kessen/packContents";
import {
  isKessenPackId,
  KESSEN_PACK_IDS,
  kessenPackSlotLabels,
} from "@/libs/kessen/packs";
import type { KessenCard } from "@/libs/kessen/types";
import { cacheItemIds, isWeightedCacheEffect } from "@/libs/weightedCache";
import {
  KESSEN_PACKS,
  kessenNewPackItem,
  kessenPityCountdown,
  kessenRareSlotMinimum,
  planKessenPackOpening,
} from "@/server/utils/kessenPacks";
import type { WeightedCache } from "@/validators/weightedCache";
import { KESSEN_SEED_CATALOG } from "../../libs/kessen/fixtures/catalog";

/** Packs without a legendary after which the next pack pays legendary pity. */
const LAST_DRY_PACK = KESSEN_LEGENDARY_PITY_PACKS - 1;

/** A plain test card; only identity, rarity, kind and variant matter to the pack hooks. */
const card = (
  id: string,
  rarity: KessenCard["rarity"],
  extra: Partial<KessenCard> = {},
): KessenCard => ({
  id,
  name: id,
  rarity,
  kind: "UNIT",
  faction: "NEUTRAL",
  row: "CLOSE",
  power: 1,
  provision: 4,
  abilities: [],
  summonGroups: [],
  leaderBonus: 0,
  variant: "STANDARD",
  baseCardId: null,
  isCollectible: true,
  ...extra,
});

const CARDS = [
  card("c1", "COMMON"),
  card("c2", "COMMON"),
  card("r1", "RARE"),
  card("e1", "EPIC"),
  card("l1", "LEGENDARY"),
  card("l2", "LEGENDARY"),
  card("f1", "LEGENDARY", { variant: "FORBIDDEN", baseCardId: "l1" }),
];
const byId = new Map(CARDS.map((entry) => [entry.id, entry]));

const tier = (name: string, probability: number, ids: string[]) => ({
  name,
  probability,
  entries: ids.map((itemId) => ({ items: [{ itemId, quantity: 1 }] })),
});
const cache = (count: number, tiers: WeightedCache["tiers"]): WeightedCache => ({
  version: 1,
  displayName: "Test Pack",
  rolls: [{ count, probability: CACHE_PROBABILITY_TOTAL }],
  tiers,
});
/** Four common slots, then a fifth slot that draws RARE unless a hook raises it. */
const testPack = (): WeightedCache[] => [
  cache(4, [tier("Common", 10_000, ["c1", "c2"])]),
  cache(1, [
    tier("Rare", 9_998, ["r1"]),
    tier("Epic", 1, ["e1"]),
    tier("Legendary", 1, ["l1", "l2"]),
  ]),
];
/** Draws that always land at the start of every interval. */
const zero = () => 0;
const plan = (overrides: Partial<Parameters<typeof planKessenPackOpening>[0]> = {}) =>
  planKessenPackOpening({
    packItemId: "kessen-pack-test",
    caches: testPack(),
    cards: byId,
    owned: {},
    counters: { packsSinceEpic: 0, packsSinceLegendary: 0 },
    autoSellSurplus: false,
    seed: "seed",
    random: zero,
    ...overrides,
  });

describe("Kessen pack catalog", () => {
  it("builds two caches per pack from collectible non-leader cards with the design odds", () => {
    for (const pack of KESSEN_PACKS) {
      const effects = buildKessenPackEffects(pack, KESSEN_SEED_CATALOG);
      expect(effects).toHaveLength(2);
      const caches = effects.flatMap((effect) =>
        isWeightedCacheEffect(effect) && effect.weightedCache
          ? [effect.weightedCache]
          : [],
      );
      expect(caches.map((entry) => entry.rolls)).toEqual([
        [{ count: 4, probability: CACHE_PROBABILITY_TOTAL }],
        [{ count: 1, probability: CACHE_PROBABILITY_TOTAL }],
      ]);
      for (const entry of caches) {
        expect(entry.tiers.reduce((sum, t) => sum + t.probability, 0)).toBe(
          CACHE_PROBABILITY_TOTAL,
        );
        for (const t of entry.tiers) expect(t.entries.length).toBeLessThanOrEqual(50);
      }
      const ids = caches.flatMap(cacheItemIds);
      const cards = ids.map((id) => KESSEN_SEED_CATALOG.find((c) => c.id === id));
      expect(cards.every((c) => c && c.kind !== "LEADER" && c.isCollectible)).toBe(
        true,
      );
      if (pack.faction)
        expect(
          cards.every((c) => c?.faction === pack.faction || c?.faction === "NEUTRAL"),
        ).toBe(true);
    }
    const paper = buildKessenPackEffects(KESSEN_PACKS[0]!, KESSEN_SEED_CATALOG);
    const [normal, fifth] = paper.map((effect) =>
      isWeightedCacheEffect(effect) ? effect.weightedCache : undefined,
    );
    expect(normal?.tiers.map((t) => [t.name, t.probability, t.entries.length])).toEqual(
      [
        ["Common", 7644, 36],
        ["Rare", 1940, 23],
        ["Epic", 400, 15],
        ["Legendary", 15, 10],
        ["Forbidden", 1, 10],
      ],
    );
    expect(fifth?.tiers.map((t) => [t.name, t.probability])).toEqual([
      ["Rare", 8447],
      ["Epic", 1500],
      ["Legendary", 49],
      ["Forbidden", 4],
    ]);
    const first = KESSEN_PACKS.find((p) => p.id === KESSEN_FIRST_BUNDLE_ITEM_ID)!;
    const firstFifth = buildKessenPackEffects(first, KESSEN_SEED_CATALOG)[1];
    expect(
      isWeightedCacheEffect(firstFifth!) &&
        firstFifth.weightedCache?.tiers.map((t) => t.name),
    ).toEqual(["Epic", "Legendary", "Forbidden"]);
    expect(KESSEN_PACKS.every((pack) => isKessenPackId(pack.id))).toBe(true);
    expect(isKessenPackId("kessen-moonprowler")).toBe(false);
  });

  it("publishes each pack's odds from its stored caches", () => {
    const cards = new Map(KESSEN_SEED_CATALOG.map((card) => [card.id, card]));
    const odds = (id: string) => {
      const pack = KESSEN_PACKS.find((entry) => entry.id === id)!;
      return kessenPackOdds(buildKessenPackEffects(pack, KESSEN_SEED_CATALOG), cards);
    };
    // The First Bundle's fifth card uses the Lacquer Case weights, not the Paper ones.
    expect(odds(KESSEN_PACK_IDS.first).rareSlot).toEqual({
      COMMON: 0,
      RARE: 0,
      EPIC: 9700,
      LEGENDARY: 290,
      FORBIDDEN: 10,
    });
    // Packs drawing from every faction hold cards of each tier, so no weight moves.
    for (const pack of KESSEN_PACKS.filter((entry) => entry.faction === null)) {
      const served = odds(pack.id);
      expect(served.normal).toEqual({ ...pack.normalWeights });
      expect(served.rareSlot).toEqual({ ...pack.rareSlotWeights });
    }
  });

  it("labels each pack's slots from its stored caches", () => {
    const paper = KESSEN_PACKS.find((entry) => entry.id === KESSEN_PACK_IDS.paper)!;
    const effects = buildKessenPackEffects(paper, KESSEN_SEED_CATALOG);
    expect(kessenPackSlots(effects)).toEqual({
      normal: KESSEN_PACK_NORMAL_SLOTS,
      rareSlot: 1,
    });
    expect(kessenPackSlotLabels(kessenPackSlots(effects))).toEqual({
      normal: `Slots 1–${KESSEN_PACK_NORMAL_SLOTS}`,
      rareSlot: `Slot ${KESSEN_PACK_NORMAL_SLOTS + 1}`,
    });
    // A staff edit to the normal cache's roll count moves the labels with it.
    const edited = effects.map((effect, index) =>
      index === 0 && isWeightedCacheEffect(effect) && effect.weightedCache
        ? {
            ...effect,
            weightedCache: {
              ...effect.weightedCache,
              rolls: [{ count: 3, probability: CACHE_PROBABILITY_TOTAL }],
            },
          }
        : effect,
    );
    expect(kessenPackSlotLabels(kessenPackSlots(edited))).toEqual({
      normal: "Slots 1–3",
      rareSlot: "Slot 4",
    });
  });

  it("builds staff packs with their own pool and slot layout", () => {
    const cards = new Map(KESSEN_SEED_CATALOG.map((entry) => [entry.id, entry]));
    const crate = {
      name: "Frost Crate",
      faction: "HYORIN" as const,
      slots: { normal: 3, rareSlot: 2 },
      normalWeights: KESSEN_PACKS[0]!.normalWeights,
      rareSlotWeights: KESSEN_PACKS[0]!.rareSlotWeights,
    };
    const effects = buildKessenPackEffects(crate, KESSEN_SEED_CATALOG);
    const caches = effects.flatMap((effect) =>
      isWeightedCacheEffect(effect) && effect.weightedCache
        ? [effect.weightedCache]
        : [],
    );
    expect(caches.map((entry) => [entry.displayName, entry.rolls[0]?.count])).toEqual([
      ["Frost Crate", 3],
      ["Frost Crate: last 2 cards", 2],
    ]);
    expect(kessenPackSlots(effects)).toEqual({ normal: 3, rareSlot: 2 });
    expect(kessenPackFactions(effects, cards)).toEqual(["HYORIN", "NEUTRAL"]);
    expect(
      kessenPackFactions(
        buildKessenPackEffects(KESSEN_PACKS[0]!, KESSEN_SEED_CATALOG),
        cards,
      ),
    ).toEqual([...new Set(KESSEN_SEED_CATALOG.map((entry) => entry.faction))].sort());

    // Without rare slots the pack is one cache of normal slots.
    const plain = buildKessenPackEffects(
      { ...crate, slots: { normal: 5, rareSlot: 0 } },
      KESSEN_SEED_CATALOG,
    );
    expect(plain).toHaveLength(1);
    expect(kessenPackSlots(plain)).toEqual({ normal: 5, rareSlot: 0 });
  });

  it("refuses pools a pack cannot list", () => {
    expect(kessenPackPoolProblem([])).toBe("The card pool holds no collectible cards.");
    expect(kessenPackPoolProblem(kessenPackPool(KESSEN_SEED_CATALOG, null))).toBeNull();
    const crowded = Array.from({ length: CACHE_MAX_ENTRIES + 1 }, (_, index) =>
      card(`common-${index}`, "COMMON"),
    );
    expect(kessenPackPoolProblem(crowded)).toContain("Common");
  });

  it("starts staff-created packs hidden and unlisted with the Paper Bundle odds", () => {
    const id = `${KESSEN_PACK_ID_PREFIX}staff1`;
    const row = kessenNewPackItem(id, KESSEN_SEED_CATALOG);
    expect(isKessenPackId(row.id)).toBe(true);
    expect(row).toMatchObject({
      name: "New Kessen Pack - staff1",
      itemType: "CONSUMABLE",
      hidden: true,
      inShop: false,
      cost: KESSEN_PAPER_BUNDLE_PRICE,
      destroyOnUse: true,
      canBeTraded: false,
    });
    const paper = KESSEN_PACKS.find((pack) => pack.id === KESSEN_PACK_IDS.paper)!;
    const cards = new Map(KESSEN_SEED_CATALOG.map((entry) => [entry.id, entry]));
    expect(kessenPackOdds(row.effects, cards)).toEqual(
      kessenPackOdds(buildKessenPackEffects(paper, KESSEN_SEED_CATALOG), cards),
    );
    expect(kessenPackSlots(row.effects)).toEqual({
      normal: KESSEN_PACK_NORMAL_SLOTS,
      rareSlot: 1,
    });
  });

  it("counts pity down to the guaranteed pack", () => {
    expect(kessenPityCountdown({ packsSinceEpic: 0, packsSinceLegendary: 0 })).toEqual({
      epicIn: 7,
      legendaryIn: KESSEN_LEGENDARY_PITY_PACKS,
    });
    expect(
      kessenPityCountdown({ packsSinceEpic: 6, packsSinceLegendary: LAST_DRY_PACK }),
    ).toEqual({
      epicIn: 1,
      legendaryIn: 1,
    });
    expect(
      kessenRareSlotMinimum({ packsSinceEpic: 5, packsSinceLegendary: 0 }, "x"),
    ).toBeNull();
    expect(
      kessenRareSlotMinimum({ packsSinceEpic: 6, packsSinceLegendary: 0 }, "x"),
    ).toBe("EPIC");
    expect(
      kessenRareSlotMinimum(
        { packsSinceEpic: 0, packsSinceLegendary: 0 },
        KESSEN_FIRST_BUNDLE_ITEM_ID,
      ),
    ).toBe("EPIC");
    expect(
      kessenRareSlotMinimum(
        { packsSinceEpic: 9, packsSinceLegendary: LAST_DRY_PACK },
        "x",
      ),
    ).toBe("LEGENDARY");
  });
});

describe("Kessen pack opening plan", () => {
  it("grants the drawn cards and counts the pack toward both pity counters", () => {
    const result = plan();
    expect(result.reveal.cards.map((c) => c.itemId)).toEqual([
      "c1",
      "c1",
      "c1",
      "c2",
      "r1",
    ]);
    // The fourth c1 would exceed the copy limit, so it was re-rolled to c2.
    expect(result.reveal.cards[0]).toMatchObject({ isNew: true, surplus: false });
    expect(result.reveal.cards[1]).toMatchObject({ isNew: false, surplus: false });
    expect(result.counters).toEqual({
      packsSinceEpic: 1,
      packsSinceLegendary: 1,
      firstBundleOpened: false,
    });
    expect(result.reveal.pity).toEqual({
      epicIn: 6,
      legendaryIn: KESSEN_LEGENDARY_PITY_PACKS - 1,
    });
    expect(result.results[0]?.items).toEqual([
      { itemId: "c1", quantity: 3 },
      { itemId: "c2", quantity: 1 },
    ]);
  });

  it("raises the fifth slot to EPIC after six packs without an epic and resets the counter", () => {
    const result = plan({ counters: { packsSinceEpic: 6, packsSinceLegendary: 3 } });
    expect(result.reveal.cards.at(-1)).toMatchObject({ itemId: "e1", rarity: "EPIC" });
    expect(result.counters).toMatchObject({
      packsSinceEpic: 0,
      packsSinceLegendary: 4,
    });
  });

  it("makes the pity pack's fifth slot a legendary the player does not own", () => {
    for (const seed of ["a", "b", "c", "d", "e"]) {
      const result = plan({
        seed,
        owned: { l1: 1 },
        counters: { packsSinceEpic: 2, packsSinceLegendary: LAST_DRY_PACK },
      });
      expect(result.reveal.cards.at(-1)).toMatchObject({ itemId: "l2", isNew: true });
      expect(result.counters).toMatchObject({
        packsSinceEpic: 0,
        packsSinceLegendary: 0,
      });
    }
  });

  it("never counts an owned Forbidden variant as a copy of its base", () => {
    for (const seed of ["a", "b", "c", "d", "e"]) {
      // Only the variant of l1 is owned: legendary pity still owes the base card.
      const result = plan({
        seed,
        owned: { f1: 1, l2: 1 },
        counters: { packsSinceEpic: 0, packsSinceLegendary: LAST_DRY_PACK },
      });
      expect(result.reveal.cards.at(-1)).toMatchObject({
        itemId: "l1",
        isNew: true,
        surplus: false,
      });
    }
    // A base card pulled outside pity is new too, not surplus of the variant.
    const caches = [cache(1, [tier("Legendary", 10_000, ["l1"])])];
    const result = plan({ caches, owned: { f1: 1 } });
    expect(result.reveal.cards).toEqual([
      expect.objectContaining({ itemId: "l1", isNew: true, surplus: false }),
    ]);
  });

  it("pays legendary pity in a missing standard legendary, never owned surplus", () => {
    const legendaries = ["l1", "l2", "l3", "l4"];
    const cards = new Map([
      ...byId,
      ...["l3", "l4"].map((id) => [id, card(id, "LEGENDARY")] as const),
    ]);
    const held = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, 1]));
    const caches = [
      cache(4, [tier("Common", 10_000, ["c1", "c2"])]),
      cache(1, [tier("Rare", 9_999, ["r1"]), tier("Legendary", 1, legendaries)]),
    ];
    for (const seed of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
      const result = plan({
        seed,
        caches,
        cards,
        owned: held(["l1", "l2", "l4", "f1"]),
        counters: { packsSinceEpic: 0, packsSinceLegendary: LAST_DRY_PACK },
      });
      expect(result.reveal.cards.at(-1)).toMatchObject({
        itemId: "l3",
        isNew: true,
        surplus: false,
      });
    }
    // With every standard legendary owned, the pity copy is surplus.
    const full = plan({
      caches,
      cards,
      owned: held(legendaries),
      counters: { packsSinceEpic: 0, packsSinceLegendary: LAST_DRY_PACK },
    });
    expect(full.reveal.cards.at(-1)).toMatchObject({
      rarity: "LEGENDARY",
      surplus: true,
    });
  });

  it("re-rolls maxed cards and grants surplus only when the whole tier is maxed", () => {
    const result = plan({ owned: { c1: 3 } });
    expect(result.reveal.cards.slice(0, 4)).toEqual([
      expect.objectContaining({ itemId: "c2", isNew: true, surplus: false }),
      expect.objectContaining({ itemId: "c2", surplus: false }),
      expect.objectContaining({ itemId: "c2", surplus: false }),
      expect.objectContaining({ itemId: "c1", surplus: true, soldFor: null }),
    ]);
    expect(result.soldRyo).toBe(0);
    expect(result.results[0]?.items).toEqual([
      { itemId: "c2", quantity: 3 },
      { itemId: "c1", quantity: 1 },
    ]);
  });

  it("auto-sells surplus at its fixed value instead of delivering it", () => {
    const result = plan({ owned: { c1: 3, c2: 3 }, autoSellSurplus: true });
    const sold = result.reveal.cards.filter((c) => c.soldFor !== null);
    expect(sold).toHaveLength(4);
    expect(result.soldRyo).toBe(4 * KESSEN_CARD_SELL_VALUES.COMMON);
    expect(result.results[0]?.items).toEqual([]);
    expect(result.results[1]?.items).toEqual([{ itemId: "r1", quantity: 1 }]);
  });

  it("never sells Forbidden surplus and keeps Forbidden pulls outside pity", () => {
    const caches = [
      cache(1, [tier("Forbidden", 10_000, ["f1"])]),
      cache(1, [tier("Rare", 10_000, ["r1"])]),
    ];
    const result = plan({
      caches,
      owned: { f1: 1 },
      autoSellSurplus: true,
      counters: { packsSinceEpic: 3, packsSinceLegendary: 3 },
    });
    expect(result.reveal.cards[0]).toMatchObject({
      itemId: "f1",
      forbidden: true,
      surplus: true,
      soldFor: null,
    });
    expect(result.counters).toMatchObject({
      packsSinceEpic: 4,
      packsSinceLegendary: 4,
    });
  });

  it("guarantees the First Bundle's fifth slot and marks it opened", () => {
    const result = plan({ packItemId: KESSEN_FIRST_BUNDLE_ITEM_ID });
    expect(result.reveal.cards.at(-1)?.rarity).toBe("EPIC");
    expect(result.counters.firstBundleOpened).toBe(true);
    expect(result.reveal.packItemId).toBe(KESSEN_FIRST_BUNDLE_ITEM_ID);
  });

  it("leaves caches without card entries to the ordinary draw", () => {
    const caches = [cache(2, [tier("Common", 10_000, ["pill", "c1"])])];
    const result = plan({ caches, owned: { c1: 3 } });
    expect(result.reveal.cards).toEqual([]);
    expect(result.results[0]?.items).toEqual([{ itemId: "pill", quantity: 2 }]);
  });
});

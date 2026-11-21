import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { ownedCardCounts } from "@/libs/kessen/catalog";
import {
  autoBuild,
  catalogById,
  collapseDeckCards,
  type DeckFaction,
  deckSize,
  expandDeckCards,
  fillWithBorrowed,
  KESSEN_ALT_LEADERS,
  KESSEN_DECK_FACTIONS,
  KESSEN_LOANER,
  KESSEN_STARTER_LEADERS,
  type KessenDeckList,
  loanerDeck,
  loanerFaction,
  loanerReserve,
  normalizeDeckCards,
  rotatingFaction,
  starterDeck,
  validateDeck,
} from "@/libs/kessen/deck";
import { createMatch } from "@/libs/kessen/engine";
import { KESSEN_NPCS } from "@/libs/kessen/npcs";
import type { KessenCard } from "@/libs/kessen/types";
import { KESSEN_SEED_CATALOG, seedCardByName } from "./fixtures/catalog";

const CATALOG = catalogById(KESSEN_SEED_CATALOG);
const cid = (name: string) => seedCardByName(name).id;
const list = (leader: string, entries: [string, number][]): KessenDeckList => ({
  leaderId: cid(leader),
  cards: entries.map(([name, count]) => ({ itemId: cid(name), count })),
});
const codes = (deck: KessenDeckList, options = {}) =>
  validateDeck(deck, CATALOG, options).errors.map((error) => error.code);

/** Starter provision, budget and unit/tactic split after the starter round-robin tuning. */
const STARTER_TABLE: Record<DeckFaction, [number, number, number, number]> = {
  SHIROHANA: [125, 162, 20, 5],
  TSUKIMORI: [139, 161, 24, 1],
  HYORIN: [132, 161, 22, 3],
  AKASUMI: [135, 161, 21, 4],
  AKIKAZE: [135, 163, 20, 5],
  SYNDICATE: [131, 162, 20, 5],
};

describe("validateDeck", () => {
  const base = starterDeck("HYORIN");

  it("accepts a starter deck and reports its stats", () => {
    const result = validateDeck(base, CATALOG);
    expect(result.ok).toBe(true);
    expect(result.stats).toEqual({
      cards: 25,
      units: 22,
      tactics: 3,
      provision: 132,
      budget: 161,
      legendaries: 0,
      infiltrators: 0,
    });
  });

  it("requires a collectible leader and keeps leaders out of the deck", () => {
    expect(codes({ ...base, leaderId: cid("Cryverin") })).toContain("leader");
    expect(codes({ ...base, leaderId: "missing" })).toContain("leader");
    const boss = { ...base, leaderId: "kessen-leader-divine-shishi" };
    expect(codes(boss)).toContain("notCollectible");
    expect(codes(boss, { boss: true })).not.toContain("notCollectible");
    const withLeader = {
      ...base,
      cards: [...base.cards, { itemId: "kessen-leader-frost-sovereign", count: 1 }],
    };
    expect(codes(withLeader)).toContain("leader");
  });

  it("rejects tokens, unknown cards and bad counts", () => {
    expect(
      codes({
        ...base,
        cards: [...base.cards, { itemId: "kessen-token-shadow-clone", count: 1 }],
      }),
    ).toContain("notCollectible");
    expect(
      codes({ ...base, cards: [...base.cards, { itemId: "nope", count: 1 }] }),
    ).toContain("unknownCard");
    expect(
      codes({ ...base, cards: [...base.cards, { itemId: cid("Colossus"), count: 0 }] }),
    ).toContain("count");
  });

  it("allows only the leader's faction and Neutral", () => {
    const deck = {
      ...base,
      cards: [...base.cards.slice(1), { itemId: cid("Moonprowler"), count: 3 }],
    };
    expect(codes(deck)).toEqual(["faction"]);
  });

  it("enforces 25 to 30 cards and at most 8 tactics", () => {
    expect(codes({ ...base, cards: base.cards.slice(1) })).toEqual(["size"]);
    const big = normalizeDeckCards([
      ...base.cards,
      { itemId: cid("Anbu Chief"), count: 1 },
      { itemId: cid("Colossus"), count: 1 },
      { itemId: cid("Kazehiko"), count: 2 },
      { itemId: cid("Lord Pengu"), count: 1 },
      { itemId: cid("Toto the Baby Dragon"), count: 2 },
    ]);
    expect(deckSize(big)).toBe(32);
    expect(codes({ ...base, cards: big })).toEqual(["size", "budget"]);
    const tactics = list("Kimiko, Frost Warden", [
      ["Cryverin", 3],
      ["Frozen Wraith", 3],
      ["Hyouga Yui Clansman", 3],
      ["Musashi Ken Swordsman", 3],
      ["Kori no Seirei", 2],
      ["Shimo no Seirei", 2],
      ["Biting Frost", 3],
      ["Howling Gale", 3],
      ["Torrential Rain", 3],
    ]);
    expect(validateDeck(tactics, CATALOG).stats.tactics).toBe(9);
    expect(codes(tactics)).toEqual(["tactics"]);
  });

  it("limits copies by name, counting a Forbidden variant as its base", () => {
    const deck = list("Kimiko, Frost Warden", [
      ["Cryverin", 4],
      ["Frozen Wraith", 3],
      ["Hyouga Yui Clansman", 3],
      ["Musashi Ken Swordsman", 3],
      ["Kori no Seirei", 3],
      ["Byakuho", 3],
      ["Lord Pengu", 2],
      ["Kawarimi", 3],
      ["Seal of Nullification", 1],
    ]);
    const errors = validateDeck(deck, CATALOG).errors.filter(
      (error) => error.code === "copies",
    );
    expect(errors.map((error) => error.itemId)).toEqual([
      cid("Byakuho"),
      cid("Cryverin"),
      cid("Lord Pengu"),
    ]);
    const both = {
      ...base,
      cards: normalizeDeckCards([
        ...base.cards.slice(1),
        { itemId: cid("Kuraokami, Kami of the Night Snow"), count: 1 },
        { itemId: "kessen-forbidden-kuraokami-kami-of-the-night-snow", count: 1 },
        { itemId: cid("Frozen Wraith"), count: 1 },
      ]),
    };
    const copyErrors = validateDeck(both, CATALOG).errors.filter(
      (error) => error.code === "copies",
    );
    expect(copyErrors.map((error) => error.itemId)).toEqual([
      cid("Kuraokami, Kami of the Night Snow"),
    ]);
  });

  it("allows at most 2 legendaries (3 for bosses) and 2 Infiltrators", () => {
    const legends = list("Kimiko, Frost Warden", [
      ["Cryverin", 3],
      ["Frozen Wraith", 3],
      ["Hyouga Yui Clansman", 3],
      ["Musashi Ken Swordsman", 3],
      ["Kori no Seirei", 3],
      ["Kawarimi", 3],
      ["Seal of Nullification", 3],
      ["Biting Frost", 1],
      ["Kuraokami, Kami of the Night Snow", 1],
      ["Kuzenbo, the Mountain God", 1],
      ["Raizhen, the Ten-Tailed", 1],
    ]);
    expect(codes(legends)).toEqual(["legendaries"]);
    expect(codes(legends, { boss: true })).toEqual([]);
    const spies = list("Amir, the Hoarder", [
      ["Thorn Ambusher", 3],
      ["Black Maw Acolyte", 3],
      ["Mei Back-Alley Enforcer", 3],
      ["Mei Cutpurse", 3],
      ["Musashi Ken Swordsman", 3],
      ["Kawarimi", 3],
      ["Seal of Nullification", 3],
      ["Oblivion Seal Bearer", 2],
      ["The Caged Sovereign", 1],
      ["Cryverin", 0],
      ["Thousand Scarlet Fangs", 1],
    ]).cards.filter((entry) => entry.count > 0);
    expect(codes({ leaderId: cid("Amir, the Hoarder"), cards: spies })).toEqual([
      "infiltrators",
    ]);
  });

  it("enforces the provision budget of 150 plus the leader bonus", () => {
    const deck = list("Kimiko, Frost Warden", [
      ["Kuraokami, Kami of the Night Snow", 1],
      ["Anbu Chief", 1],
      ["Lord Pengu", 1],
      ["Yuki Onna", 1],
      ["Colossus", 1],
      ["Byakuho", 2],
      ["Ava, the Snow Terror", 2],
      ["Kazehiko", 2],
      ["Ryouichi, Wake Islander", 2],
      ["Frozen Wraith", 3],
      ["Hyouga Yui Clansman", 3],
      ["Musashi Ken Swordsman", 3],
      ["Mosswolf", 0],
      ["Cryverin", 3],
    ]).cards.filter((entry) => entry.count > 0);
    const result = validateDeck(
      { leaderId: cid("Kimiko, Frost Warden"), cards: deck },
      CATALOG,
    );
    expect(result.stats.provision).toBe(174);
    expect(result.errors.map((error) => error.code)).toEqual(["budget"]);
  });

  it("checks ownership of the leader and every copy, minus borrowed copies", () => {
    const owned = Object.fromEntries(
      base.cards.map((entry) => [entry.itemId, entry.count]),
    );
    expect(codes(base, { owned })).toEqual(["notOwned"]);
    const withLeader = { ...owned, [base.leaderId]: 1, [cid("Cryverin")]: 2 };
    const errors = validateDeck(base, CATALOG, { owned: withLeader }).errors;
    expect(errors).toEqual([
      {
        code: "notOwned",
        message: "You own 2 of 3 copies of Cryverin.",
        itemId: cid("Cryverin"),
      },
    ]);
    expect(
      codes(base, {
        owned: withLeader,
        borrowed: [{ itemId: cid("Cryverin"), count: 1 }],
      }),
    ).toEqual([]);
  });

  it("merges duplicate entries before counting copies", () => {
    const cards = [...base.cards, { itemId: cid("Cryverin"), count: 1 }];
    expect(
      codes({
        ...base,
        cards: cards.filter((entry) => entry.itemId !== cid("Kawarimi")),
      }),
    ).toEqual(["copies"]);
  });
});

describe("starter decks", () => {
  for (const faction of KESSEN_DECK_FACTIONS) {
    it(`${faction} follows the starter formula and validates`, () => {
      const deck = starterDeck(faction);
      const result = validateDeck(deck, CATALOG);
      expect(result.errors).toEqual([]);
      const [provision, budget, units, tactics] = STARTER_TABLE[faction];
      expect(result.stats).toMatchObject({
        cards: 25,
        provision,
        budget,
        units,
        tactics,
      });
      expect(deck.leaderId).toBe(KESSEN_STARTER_LEADERS[faction]);
      expect(starterShape(faction)).toEqual({
        factionRarities: ["COMMON", "RARE"],
        neutrals: [
          "Musashi Ken Swordsman",
          "Seal of Nullification",
          "Ryouichi, Wake Islander",
        ],
        lemu: true,
        flex:
          faction === "TSUKIMORI" || faction === "AKASUMI" || faction === "AKIKAZE"
            ? "Kazehiko"
            : "Kawarimi",
      });
    });
  }

  it("returns fresh copies", () => {
    const deck = starterDeck("AKASUMI");
    (deck.cards[0] as { count: number }).count = 0;
    expect(starterDeck("AKASUMI").cards[0]?.count).toBe(3);
  });

  it("names alt leaders of each faction", () => {
    for (const faction of KESSEN_DECK_FACTIONS) {
      const alt = CATALOG[KESSEN_ALT_LEADERS[faction]] as KessenCard;
      expect([alt.kind, alt.faction, alt.rarity]).toEqual(["LEADER", faction, "EPIC"]);
    }
  });
});

describe("NPC decks", () => {
  it("validate, with the boss exception only for the two Kage bosses", () => {
    for (const npc of KESSEN_NPCS) {
      for (const variant of [npc.standard, npc.ascended]) {
        if (!variant) continue;
        const result = validateDeck(variant.deck, CATALOG, { boss: npc.boss });
        expect({ key: npc.key, errors: result.errors }).toEqual({
          key: npc.key,
          errors: [],
        });
        expect(validateDeck(variant.deck, CATALOG).ok).toBe(!npc.boss);
      }
    }
  });
});

describe("loanerDeck", () => {
  it("reserves 4 provision per open slot, or the cheapest completion when it costs more", () => {
    expect(KESSEN_LOANER.slotReserve).toBe(4);
    expect(loanerReserve(10, 30)).toBe(40);
    expect(loanerReserve(10, 52)).toBe(52);
    expect(loanerReserve(0, 0)).toBe(0);
    expect(loanerReserve(3, Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
  });

  it("is valid for 1000 seeds per faction and respects the loaner quotas", () => {
    let fallbacks = 0;
    let legendaries = 0;
    let provisionSum = 0;
    for (const faction of KESSEN_DECK_FACTIONS) {
      for (let n = 0; n < 1000; n++) {
        const deck = loanerDeck({
          userId: `user-${n}`,
          dayKey: "2026-11-15",
          faction,
          cards: KESSEN_SEED_CATALOG,
        });
        if (deck.fallback) fallbacks += 1;
        const result = validateDeck(deck, CATALOG);
        expect(result.errors).toEqual([]);
        expect(deck.borrowed).toEqual(deck.cards);
        expect(result.stats.cards).toBe(25);
        expect(result.stats.provision).toBeLessThanOrEqual(KESSEN_LOANER.budget);
        const cards = expandDeckCards(deck.cards).map(
          (id) => CATALOG[id] as KessenCard,
        );
        const count = (test: (card: KessenCard) => boolean) =>
          cards.filter(test).length;
        const has = (k: string) => (card: KessenCard) =>
          card.abilities.some((a) => a.k === k);
        const quotas = KESSEN_LOANER.quotas;
        expect(count((card) => card.kind === "TACTIC")).toBeLessThanOrEqual(
          quotas.tacticsMax,
        );
        expect(count(has("terrain"))).toBeLessThanOrEqual(quotas.terrainMax);
        expect(count(has("infiltrator"))).toBeLessThanOrEqual(quotas.infiltratorMax);
        expect(count(has("purge"))).toBeLessThanOrEqual(quotas.purgeMax);
        expect(count((card) => card.rarity === "EPIC")).toBeLessThanOrEqual(
          quotas.epicMax,
        );
        expect(count((card) => card.rarity === "LEGENDARY")).toBeLessThanOrEqual(
          quotas.legendaryMax,
        );
        expect(cards.every((card) => card.variant === "STANDARD")).toBe(true);
        legendaries += count((card) => card.rarity === "LEGENDARY");
        provisionSum += result.stats.provision;
      }
    }
    expect(fallbacks).toBe(0);
    // About 1 - 0.99^25 of loaners borrow a legendary; average provision near the budget.
    expect(legendaries).toBeGreaterThan(600);
    expect(legendaries).toBeLessThan(1900);
    expect(provisionSum / 6000).toBeGreaterThan(125);
  }, 30_000);

  it("anchors three copies of a grouped common, or the strongest common", () => {
    const anchors: Record<DeckFaction, string[]> = {
      SHIROHANA: [cid("Beta Sandworm")],
      TSUKIMORI: [cid("Moonprowler"), cid("Owlcat")],
      HYORIN: [cid("Cryverin")],
      AKASUMI: [cid("Ghost Ship Deckhand"), cid("Ghost Ship Gunner")],
      AKIKAZE: [cid("Kajioka")],
      SYNDICATE: [cid("Mei Back-Alley Enforcer")],
    };
    for (const faction of KESSEN_DECK_FACTIONS) {
      for (let n = 0; n < 20; n++) {
        const deck = loanerDeck({
          userId: `anchor-${n}`,
          dayKey: "2026-11-15",
          faction,
          cards: KESSEN_SEED_CATALOG,
        });
        const counts = Object.fromEntries(
          deck.cards.map((entry) => [entry.itemId, entry.count]),
        );
        expect(anchors[faction].some((id) => counts[id] === 3)).toBe(true);
      }
    }
  });

  it("completes Bond groups while copies, budget and slots allow", () => {
    let grouped = 0;
    let completed = 0;
    for (let n = 0; n < 300; n++) {
      const deck = loanerDeck({
        userId: `group-${n}`,
        dayKey: "2026-11-15",
        faction: "SHIROHANA",
        cards: KESSEN_SEED_CATALOG,
      });
      const counts = Object.fromEntries(
        deck.cards.map((entry) => [entry.itemId, entry.count]),
      );
      const subaku =
        (counts[cid("Subaku Princess")] ?? 0) +
        (counts[cid("Subaku Winged Captain")] ?? 0);
      if (subaku > 0) grouped += 1;
      if (subaku === 3) completed += 1;
    }
    // A lone member only stays when it was the last slot or the budget ran out.
    expect(grouped).toBeGreaterThan(150);
    expect(completed / grouped).toBeGreaterThan(0.75);
  });

  it("is deterministic per user, day and faction", () => {
    const make = (userId: string, dayKey: string, faction: DeckFaction) =>
      loanerDeck({ userId, dayKey, faction, cards: KESSEN_SEED_CATALOG });
    expect(make("a", "2026-11-15", "AKIKAZE")).toEqual(
      make("a", "2026-11-15", "AKIKAZE"),
    );
    const reversed = loanerDeck({
      userId: "a",
      dayKey: "2026-11-15",
      faction: "AKIKAZE",
      cards: [...KESSEN_SEED_CATALOG].reverse(),
    });
    expect(reversed).toEqual(make("a", "2026-11-15", "AKIKAZE"));
    const variants = new Set(
      ["a", "b", "c", "d"].map((user) =>
        JSON.stringify(make(user, "2026-11-15", "AKIKAZE")),
      ),
    );
    expect(variants.size).toBeGreaterThan(1);
    expect(JSON.stringify(make("a", "2026-11-16", "AKIKAZE"))).not.toBe(
      JSON.stringify(make("a", "2026-11-15", "AKIKAZE")),
    );
  });

  it("falls back to the starter list when the catalog cannot build a deck", () => {
    const thin = KESSEN_SEED_CATALOG.filter(
      (card) => card.kind === "LEADER" || card.faction === "HYORIN",
    );
    const deck = loanerDeck({
      userId: "u",
      dayKey: "d",
      faction: "HYORIN",
      cards: thin,
    });
    expect(deck.fallback).toBe(true);
    expect({ leaderId: deck.leaderId, cards: deck.cards }).toEqual(
      starterDeck("HYORIN"),
    );
  });

  it("starts a match", () => {
    const deck = loanerDeck({
      userId: "u",
      dayKey: "d",
      faction: "SYNDICATE",
      cards: KESSEN_SEED_CATALOG,
    });
    const state = createMatch({
      seed: "loaner",
      seats: [
        { leaderId: deck.leaderId, deck: expandDeckCards(deck.cards) },
        {
          leaderId: starterDeck("HYORIN").leaderId,
          deck: expandDeckCards(starterDeck("HYORIN").cards),
        },
      ],
      cards: KESSEN_SEED_CATALOG,
    });
    expect(state.seats[0].hand.length).toBe(10);
  });
});

describe("loaner factions", () => {
  it("uses the home faction, else the day's rotating faction", () => {
    expect(loanerFaction("HYORIN", "2026-11-15")).toBe("HYORIN");
    expect(loanerFaction(null, "2026-11-15")).toBe(rotatingFaction("2026-11-15"));
    const seen = new Set<DeckFaction>();
    for (let day = 1; day <= 28; day++) seen.add(rotatingFaction(`2026-02-${day}`));
    expect(seen.size).toBe(6);
  });
});

describe("fillWithBorrowed", () => {
  const owned = (deck: KessenDeckList) => ({
    ...Object.fromEntries(deck.cards.map((entry) => [entry.itemId, entry.count])),
    [deck.leaderId]: 1,
  });

  it("completes a short deck with borrowed cards and keeps the owned part", () => {
    const starter = starterDeck("TSUKIMORI");
    const short = { ...starter, cards: starter.cards.slice(0, 6) };
    const filled = fillWithBorrowed({
      userId: "u",
      dayKey: "2026-11-15",
      deck: short,
      owned: owned(short),
      cards: KESSEN_SEED_CATALOG,
    });
    expect(filled).not.toBeNull();
    if (!filled) return;
    expect(deckSize(filled.cards)).toBe(25);
    expect(deckSize(filled.borrowed)).toBe(25 - deckSize(short.cards));
    const result = validateDeck(filled, CATALOG, {
      owned: owned(short),
      borrowed: filled.borrowed,
    });
    expect(result.errors).toEqual([]);
    for (const entry of short.cards) {
      const count =
        filled.cards.find((card) => card.itemId === entry.itemId)?.count ?? 0;
      expect(count).toBeGreaterThanOrEqual(entry.count);
    }
  });

  it("borrows the copies the player no longer owns", () => {
    const starter = starterDeck("HYORIN");
    const have = { ...owned(starter), [cid("Cryverin")]: 1, [cid("Byakuho")]: 0 };
    const filled = fillWithBorrowed({
      userId: "u",
      dayKey: "d",
      deck: starter,
      owned: have,
      cards: KESSEN_SEED_CATALOG,
    });
    expect(filled).not.toBeNull();
    // Two missing Cryverin and both Byakuho.
    expect(deckSize(filled?.borrowed ?? [])).toBe(4);
    expect(
      validateDeck(filled as KessenDeckList, CATALOG, {
        owned: have,
        borrowed: filled?.borrowed,
      }).ok,
    ).toBe(true);
  });

  /** Copies of each card beyond the player's free copies: what a fill may lend. */
  const shortfall = (deck: KessenDeckList, have: Record<string, number>) =>
    normalizeDeckCards(
      deck.cards
        .map((entry) => ({
          itemId: entry.itemId,
          count: entry.count - Math.min(entry.count, have[entry.itemId] ?? 0),
        }))
        .filter((entry) => entry.count > 0),
    );

  it("uses owned copies outside the deck before borrowing", () => {
    const starter = starterDeck("HYORIN");
    const empty = { leaderId: starter.leaderId, cards: [] };
    // The whole starter is owned, but none of it is in the deck yet.
    const have = owned(starter);
    const filled = fillWithBorrowed({
      userId: "u",
      dayKey: "2026-11-15",
      deck: empty,
      owned: have,
      cards: KESSEN_SEED_CATALOG,
    });
    expect(filled).not.toBeNull();
    if (!filled) return;
    expect(deckSize(filled.cards)).toBe(25);
    expect(normalizeDeckCards(filled.borrowed)).toEqual(shortfall(filled, have));
    // Most of the deck is the player's own; Frozen Wraith is never lent while owned.
    expect(deckSize(filled.borrowed)).toBeLessThan(25 - 15);
    const wraith = cid("Frozen Wraith");
    expect(filled.borrowed.find((entry) => entry.itemId === wraith)).toBeUndefined();
    expect(
      validateDeck(filled, CATALOG, { owned: have, borrowed: filled.borrowed }).ok,
    ).toBe(true);
  });

  it("lends nothing to a player who owns every copy", () => {
    const have = Object.fromEntries(KESSEN_SEED_CATALOG.map((card) => [card.id, 3]));
    for (const faction of KESSEN_DECK_FACTIONS) {
      const starter = starterDeck(faction);
      const filled = fillWithBorrowed({
        userId: "u",
        dayKey: "d",
        deck: { ...starter, cards: starter.cards.slice(0, 3) },
        owned: have,
        cards: KESSEN_SEED_CATALOG,
      });
      expect(filled?.borrowed).toEqual([]);
      expect(deckSize(filled?.cards ?? [])).toBe(25);
    }
  });

  it("lends a card's copies listed in the auction house but not its free ones", () => {
    const starter = starterDeck("HYORIN");
    const wraith = cid("Frozen Wraith");
    const cryverin = cid("Cryverin");
    const rows = [
      ...starter.cards
        .filter((entry) => entry.itemId !== wraith && entry.itemId !== cryverin)
        .map((entry) => ({
          itemId: entry.itemId,
          isInAuction: false,
          quantity: entry.count,
        })),
      { itemId: starter.leaderId, isInAuction: false, quantity: 1 },
      // Frozen Wraith: one free copy and two listed; Cryverin: all three listed.
      { itemId: wraith, isInAuction: false, quantity: 1 },
      { itemId: wraith, isInAuction: true, quantity: 2 },
      { itemId: cryverin, isInAuction: true, quantity: 3 },
    ];
    const have = ownedCardCounts(rows).free;
    expect(have[wraith]).toBe(1);
    expect(have[cryverin] ?? 0).toBe(0);
    const filled = fillWithBorrowed({
      userId: "u",
      dayKey: "d",
      deck: starter,
      owned: have,
      cards: KESSEN_SEED_CATALOG,
    });
    expect(filled).not.toBeNull();
    if (!filled) return;
    expect(normalizeDeckCards(filled.borrowed)).toEqual(shortfall(filled, have));
    const countOf = (cards: KessenDeckList["cards"], id: string) =>
      cards.find((entry) => entry.itemId === id)?.count ?? 0;
    expect(countOf(filled.borrowed, wraith)).toBe(
      Math.max(0, countOf(filled.cards, wraith) - 1),
    );
    expect(countOf(filled.borrowed, cryverin)).toBe(countOf(filled.cards, cryverin));
    expect(
      validateDeck(filled, CATALOG, { owned: have, borrowed: filled.borrowed }).ok,
    ).toBe(true);
  });

  it("refuses decks broken beyond their size and unowned leaders", () => {
    const starter = starterDeck("HYORIN");
    const offFaction = {
      ...starter,
      cards: [...starter.cards.slice(0, 4), { itemId: cid("Moonprowler"), count: 1 }],
    };
    const fill = (deck: KessenDeckList, have = owned(deck)) =>
      fillWithBorrowed({
        userId: "u",
        dayKey: "d",
        deck,
        owned: have,
        cards: KESSEN_SEED_CATALOG,
      });
    expect(fill(offFaction)).toBeNull();
    expect(fill(starter, { ...owned(starter), [starter.leaderId]: 0 })).toBeNull();
  });

  it("only swaps borrowed tactics in repair", () => {
    const tactics = list("Kimiko, Frost Warden", [
      ["Biting Frost", 3],
      ["Howling Gale", 3],
      ["Kawarimi", 2],
    ]);
    const filled = fillWithBorrowed({
      userId: "u",
      dayKey: "d",
      deck: tactics,
      owned: owned(tactics),
      cards: KESSEN_SEED_CATALOG,
    });
    expect(filled).not.toBeNull();
    const result = validateDeck(filled as KessenDeckList, CATALOG);
    expect(result.stats.tactics).toBe(8);
    expect(result.ok).toBe(true);
  });
});

describe("autoBuild", () => {
  const ownedAll = (copies: number) =>
    Object.fromEntries(KESSEN_SEED_CATALOG.map((card) => [card.id, copies]));

  it("builds a valid deck over owned cards with the real budget", () => {
    for (const faction of KESSEN_DECK_FACTIONS) {
      const owned = ownedAll(3);
      const deck = autoBuild({
        userId: "u",
        faction,
        owned,
        cards: KESSEN_SEED_CATALOG,
      });
      expect(deck).not.toBeNull();
      const result = validateDeck(deck as KessenDeckList, CATALOG, { owned });
      expect(result.errors).toEqual([]);
      expect(deck?.leaderId).toBe(KESSEN_STARTER_LEADERS[faction]);
      expect(deck?.borrowed).toEqual([]);
    }
  });

  it("uses only owned copies and changes with the collection", () => {
    const starter = starterDeck("AKASUMI");
    const owned: Record<string, number> = {
      ...Object.fromEntries(starter.cards.map((entry) => [entry.itemId, entry.count])),
      [KESSEN_ALT_LEADERS.AKASUMI]: 1,
    };
    const deck = autoBuild({
      userId: "u",
      faction: "AKASUMI",
      owned,
      cards: KESSEN_SEED_CATALOG,
    });
    expect(deck?.leaderId).toBe(KESSEN_ALT_LEADERS.AKASUMI);
    expect(validateDeck(deck as KessenDeckList, CATALOG, { owned }).ok).toBe(true);
    for (const entry of deck?.cards ?? []) {
      expect(entry.count).toBeLessThanOrEqual(owned[entry.itemId] ?? 0);
    }
    const again = autoBuild({
      userId: "u",
      faction: "AKASUMI",
      owned,
      cards: KESSEN_SEED_CATALOG,
    });
    expect(again).toEqual(deck);
    const richer = { ...ownedAll(2), [KESSEN_ALT_LEADERS.AKASUMI]: 1 };
    const other = autoBuild({
      userId: "u",
      faction: "AKASUMI",
      owned: richer,
      cards: KESSEN_SEED_CATALOG,
    });
    expect(other).not.toEqual(deck);
  });

  it("returns null without a leader or enough cards", () => {
    expect(
      autoBuild({
        userId: "u",
        faction: "HYORIN",
        owned: {},
        cards: KESSEN_SEED_CATALOG,
      }),
    ).toBeNull();
    const few = { [KESSEN_STARTER_LEADERS.HYORIN]: 1, [cid("Cryverin")]: 3 };
    expect(
      autoBuild({
        userId: "u",
        faction: "HYORIN",
        owned: few,
        cards: KESSEN_SEED_CATALOG,
      }),
    ).toBeNull();
  });
});

describe("deck helpers", () => {
  it("normalizes, expands and collapses entries", () => {
    const cards = [
      { itemId: "b", count: 1 },
      { itemId: "a", count: 2 },
      { itemId: "b", count: 1 },
      { itemId: "c", count: 0 },
    ];
    expect(normalizeDeckCards(cards)).toEqual([
      { itemId: "a", count: 2 },
      { itemId: "b", count: 2 },
    ]);
    expect(expandDeckCards(normalizeDeckCards(cards))).toEqual(["a", "a", "b", "b"]);
    expect(collapseDeckCards(["b", "a", "b"])).toEqual([
      { itemId: "a", count: 1 },
      { itemId: "b", count: 2 },
    ]);
  });

  it("keeps engine-dependent maths and randomness out of the deck, NPC and reward modules", () => {
    for (const file of ["deck.ts", "npcs.ts", "rewards.ts"]) {
      const source = readFileSync(
        new URL(`../../../src/libs/kessen/${file}`, import.meta.url),
        "utf8",
      )
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
      for (const banned of [
        /Math\.random/,
        /\bDate\b/,
        /Math\.(pow|exp|sin|cos|tan|hypot|log|sqrt|round)\b/,
        /\*\*/,
        /\bparseFloat\b/,
        /\b\d+\.\d+\b/,
      ]) {
        expect({ file, banned: String(banned), found: banned.test(source) }).toEqual({
          file,
          banned: String(banned),
          found: false,
        });
      }
    }
  });
});

/** The starter formula over the catalog, independent of the stored lists. */
/**
 * What a starter is made of: faction commons and rares only, the shared
 * neutrals (Musashi Ken at three copies), Lemu and one flex neutral.
 */
const starterShape = (faction: DeckFaction) => {
  const cards = starterDeck(faction).cards.map((entry) => ({
    card: CATALOG[entry.itemId] as KessenCard,
    count: entry.count,
  }));
  const own = cards.filter((entry) => entry.card.faction === faction);
  const neutral = cards.filter((entry) => entry.card.faction === "NEUTRAL");
  const named = (name: string) => neutral.find((entry) => entry.card.name === name);
  const shared = [
    "Musashi Ken Swordsman",
    "Seal of Nullification",
    "Ryouichi, Wake Islander",
  ];
  const flex = neutral.filter(
    (entry) =>
      !shared.includes(entry.card.name) &&
      entry.card.name !== "Lemu, Academy Instructor",
  );
  return {
    factionRarities: [...new Set(own.map((entry) => entry.card.rarity))].sort(),
    neutrals: shared.filter(
      (name) => named(name)?.count === (name === shared[0] ? 3 : 1),
    ),
    lemu: Boolean(named("Lemu, Academy Instructor")),
    flex: flex.length === 1 && flex[0]?.count === 1 ? flex[0].card.name : null,
  };
};

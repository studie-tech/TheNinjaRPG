import { describe, expect, it } from "bun:test";
import { KESSEN_COPY_LIMITS } from "@/drizzle/constants";
import {
  cardBalance,
  cardBalanceChanges,
  catalogBalance,
  catalogBalanceDiff,
  KESSEN_BALANCE,
  type KessenBalanceFlag,
  kessenReferenceDecks,
} from "@/libs/kessen/balance";
import {
  gauntletJobs,
  KESSEN_BALANCE_SIM,
  leaderSpreadFlags,
  playSimGame,
  summarizeTrial,
  TRIAL_FILLER_ID,
  trialCatalog,
  trialPairs,
  trialReference,
} from "@/libs/kessen/balanceSim";
import { runKessenSims } from "@/libs/kessen/balanceSimRunner";
import { createMatch } from "@/libs/kessen/engine";
import type { KessenCard } from "@/libs/kessen/types";
import { KESSEN_SEED_CATALOG, seedCardByName } from "./fixtures/catalog";

/** The seed catalog with the named cards changed. */
const edited = (changes: Record<string, Partial<KessenCard>>) =>
  KESSEN_SEED_CATALOG.map((card) =>
    changes[card.name] ? { ...card, ...changes[card.name] } : card,
  );

const flagsOf = (catalog: readonly KessenCard[], name: string) =>
  catalogBalance(catalog).cards.find((entry) => entry.card.name === name)?.flags ?? [];

describe("Kessen balance guidelines", () => {
  it("holds the seed catalog inside every guideline, with its tech tactics below the curve", () => {
    const report = catalogBalance(KESSEN_SEED_CATALOG);
    const flagged = report.cards
      .filter((entry) => entry.flags.length > 0)
      .map((entry) => [entry.card.name, entry.flags.map((flag) => flag.severity)]);
    expect(flagged).toEqual([
      ["Kawarimi", ["warn"]],
      ["Seal of Nullification", ["warn"]],
      ["Biting Frost", ["warn"]],
      ["Howling Gale", ["warn"]],
      ["Torrential Rain", ["warn"]],
    ]);
    expect(report.factions.flatMap((faction) => faction.flags)).toEqual([]);
    expect(report.decks.flatMap((deck) => deck.flags)).toEqual([]);
    expect(report.decks).toHaveLength(12);
  });

  it("breaks a card priced over its value curve and names the numbers", () => {
    const flags = cardBalance({ ...seedCardByName("Cryverin"), power: 9 }).flags;
    expect(flags).toEqual([
      {
        rule: "curve",
        severity: "break",
        message: "Value 9.0 is 3.0 over the 6.0 its cost allows (limit 1.5)",
      },
    ]);
  });

  it("breaks a deck card outside its rarity's provision range and an off-range leader bonus", () => {
    const common = cardBalance({
      ...seedCardByName("Cryverin"),
      power: 12,
      provision: 9,
    });
    expect(common.flags.map((flag) => flag.rule)).toEqual(["provision"]);
    const leader = cardBalance({
      ...seedCardByName("Ravena Bloodsilk"),
      leaderBonus: 20,
    });
    expect(leader.flags.map((flag) => flag.message)).toEqual([
      "Leader bonus 20 is outside 10–13",
    ]);
    expect(leader.value).toBeNull();
  });

  it("breaks a Forbidden variant whose stats leave its base card", () => {
    const variant = KESSEN_SEED_CATALOG.find((card) => card.variant === "FORBIDDEN");
    if (!variant) throw new Error("No Forbidden variant");
    const catalog = KESSEN_SEED_CATALOG.map((card) =>
      card.id === variant.id ? { ...card, power: card.power + 2 } : card,
    );
    const flags = cardBalance(
      catalog.find((card) => card.id === variant.id) as KessenCard,
      catalog,
    ).flags;
    expect(flags.map((flag) => [flag.rule, flag.severity])).toEqual([
      ["variant", "break"],
    ]);
    expect(flags[0]?.message).toContain("in power");
  });

  it("breaks a Forbidden variant whose base card is absent from the catalog", () => {
    const variant: KessenCard = {
      ...seedCardByName("The Drowned Gatekeeper"),
      id: "orphan-forbidden",
      variant: "FORBIDDEN",
      baseCardId: "missing-base",
    };
    expect(cardBalance(variant, KESSEN_SEED_CATALOG).flags).toContainEqual({
      rule: "variant",
      severity: "break",
      message: "Base card missing-base is missing from the catalog",
    });
    expect(cardBalance(variant).flags).toEqual([]);
  });

  it("reports and diffs Forbidden parity when its base is edited, without counting variants in faction pools", () => {
    const base = seedCardByName("Amaterasu's Avatar");
    const variant = KESSEN_SEED_CATALOG.find((card) => card.baseCardId === base.id);
    if (!variant) throw new Error("No Forbidden variant");
    const before = catalogBalance(KESSEN_SEED_CATALOG);
    const after = catalogBalance(edited({ [base.name]: { power: base.power - 1 } }));
    const parity: KessenBalanceFlag = {
      rule: "variant",
      severity: "break",
      message: `Differs from its base card ${base.name} in power`,
    };
    expect(after.cards.find((entry) => entry.card.id === variant.id)?.flags).toEqual([
      parity,
    ]);
    expect(catalogBalanceDiff(before, after, base.id).raised).toContainEqual({
      subject: variant.name,
      flag: parity,
    });
    expect(catalogBalanceDiff(after, before, base.id).cleared).toContainEqual({
      subject: variant.name,
      flag: parity,
    });
    const standardOnly = catalogBalance(
      KESSEN_SEED_CATALOG.filter((card) => card.variant === "STANDARD"),
    );
    expect(before.factions).toEqual(standardOnly.factions);
    expect(before.sets).toEqual(standardOnly.sets);
  });

  it("breaks a Summon whose set holds a unit worth more than the Summon", () => {
    const catalog = edited({ Colossus: { sets: ["Sandworm"] } });
    expect(flagsOf(catalog, "Beta Sandworm").map((flag) => flag.message)).toEqual([
      "Summon Sandworm can pull Colossus (power 12), over the 5.0 a Summon from it allows",
    ]);
  });

  it("warns about a Bond without a partner and a Summon with nothing to pull", () => {
    const catalog = edited({
      Owlcat: { sets: [] },
      "Ghost Ship Deckhand": { sets: [] },
      "Ghost Ship Gunner": { sets: [] },
    });
    expect(flagsOf(catalog, "Moonprowler").map((flag) => flag.message)).toEqual([
      "Bond Moon Pack has no other unit its decks can field",
    ]);
    expect(flagsOf(catalog, "The Drowned Gatekeeper").map((flag) => flag.rule)).toEqual(
      ["summonSet"],
    );
  });

  it("breaks the reference decks a catalog change makes illegal", () => {
    const report = catalogBalance(
      edited({ "Musashi Ken Swordsman": { rarity: "RARE", provision: 5 } }),
    );
    const broken = report.decks.filter((deck) => deck.flags.length > 0);
    expect(broken.map((deck) => deck.deck.key)).toContain("starter-HYORIN");
    expect(broken[0]?.flags[0]?.message).toContain("is no longer legal");
  });

  it("breaks a faction whose cards all lean over the curve inside the tolerance", () => {
    const hyorin = KESSEN_SEED_CATALOG.filter(
      (card) => card.faction === "HYORIN" && card.kind !== "LEADER",
    ).map((card) => card.name);
    const report = catalogBalance(
      KESSEN_SEED_CATALOG.map((card) => {
        if (!hyorin.includes(card.name)) return card;
        const gap = cardBalance(card).gap ?? 0;
        // One point more, unless that would leave the tolerance.
        return gap + 1000 <= KESSEN_BALANCE.curveTolerance
          ? { ...card, power: card.power + 1 }
          : card;
      }),
    );
    const faction = report.factions.find((entry) => entry.faction === "HYORIN");
    expect(faction?.flags.map((flag) => [flag.rule, flag.severity])).toEqual([
      ["factionBias", "break"],
    ]);
  });

  it("lists the guidelines an edit newly breaks and the ones it clears", () => {
    const saved = seedCardByName("Cryverin");
    const raised = { ...saved, power: 9 };
    expect(cardBalanceChanges(saved, raised)).toEqual([
      "Balance break: Value 9.0 is 3.0 over the 6.0 its cost allows (limit 1.5)",
    ]);
    expect(cardBalanceChanges(raised, saved)).toEqual([
      "Balance cleared: Value 9.0 is 3.0 over the 6.0 its cost allows (limit 1.5)",
    ]);
    expect(cardBalanceChanges(raised, { ...raised, power: 10 })).toEqual([
      "Balance break: Value 10.0 is 4.0 over the 6.0 its cost allows (limit 1.5)",
    ]);
    expect(cardBalanceChanges(saved, { ...saved, power: 6 })).toEqual([]);
  });
});

describe("Kessen match trials", () => {
  it("lets an off-deck catalog edit change the reference gauntlet through AI threat estimates", () => {
    const card = seedCardByName("Colossus");
    const decks = kessenReferenceDecks();
    expect(
      decks.some(
        (deck) =>
          deck.list.leaderId === card.id ||
          deck.list.cards.some((entry) => entry.itemId === card.id),
      ),
    ).toBe(false);
    const job = gauntletJobs(decks, 2).find(
      (entry) =>
        entry.id ===
        "kessen-balance:v2:gauntlet:champion-HYORIN:champion-SYNDICATE:0:0",
    );
    if (!job) throw new Error("No champion gauntlet job");
    const saved = playSimGame(job, KESSEN_SEED_CATALOG);
    const draft = playSimGame(job, edited({ Colossus: { power: 20 } }));
    expect(saved).toMatchObject({ finished: true, winner: 1, plays: 27, ties: 0 });
    expect(draft).toMatchObject({ finished: true, winner: 0, plays: 30, ties: 1 });
  });

  it.each(["Kimiko, Frost Warden", "Aerathiel Wind-Bearer"])(
    "gives %s without abilities zero edge while preserving its faction passive",
    async (name) => {
      const saved = seedCardByName(name);
      const card = { ...saved, abilities: [] };
      const pool = edited({ [name]: card });
      const catalog = trialCatalog(pool);
      const pairs = trialPairs(card, 10);
      const pair = pairs[0];
      if (!pair) throw new Error("No trial pair");
      const subject = createMatch({ ...pair.subject, cards: catalog });
      const reference = createMatch({ ...pair.reference, cards: catalog });
      expect(reference.seats[pair.seat].faction).toBe(card.faction);
      expect(reference.seats[pair.seat].mull).toEqual(subject.seats[pair.seat].mull);
      const outcomes = await runKessenSims(
        {
          cards: catalog,
          pool,
          jobs: pairs.flatMap((entry) => [entry.subject, entry.reference]),
        },
        null,
      );
      expect(summarizeTrial(card, pairs, outcomes)).toMatchObject({
        edge: 0,
        se: 0,
        games: pairs.length,
        flags: [],
      });
    },
  );

  it("plays every card the same number of paired games, differing only in its slots", () => {
    for (const name of ["Cryverin", "Kazehiko", "Colossus", "Frost Sovereign"]) {
      const card = seedCardByName(name);
      const pairs = trialPairs(card);
      expect({ name, games: pairs.length }).toEqual({
        name,
        games: KESSEN_BALANCE_SIM.trialGames,
      });
      for (const pair of pairs) {
        expect(pair.subject.seed).toBe(pair.reference.seed);
        const own = pair.subject.seats[pair.seat];
        const control = pair.reference.seats[pair.seat];
        expect(pair.subject.seats[1 - pair.seat]).toEqual(
          pair.reference.seats[1 - pair.seat],
        );
        expect(own.deck).toHaveLength(control.deck.length);
        if (card.kind === "LEADER") {
          expect([own.leaderId, control.leaderId]).toEqual([
            card.id,
            trialReference(card).id,
          ]);
          continue;
        }
        const reference = trialReference(card).id;
        expect(own.deck.filter((id) => id === card.id)).toHaveLength(
          KESSEN_COPY_LIMITS[card.rarity],
        );
        expect(control.deck.filter((id) => id === card.id)).toHaveLength(0);
        expect(control.deck.filter((id) => id === reference)).toHaveLength(
          KESSEN_COPY_LIMITS[card.rarity],
        );
        own.deck.forEach((id, index) => {
          if (id !== control.deck[index]) {
            expect([id, control.deck[index]]).toEqual([card.id, reference]);
          }
        });
      }
    }
  });

  it("fills the copy limit from the card's own copies, then the vanilla filler", () => {
    const pair = trialPairs(seedCardByName("Byakuho"))[0];
    if (!pair) throw new Error("No trial pair");
    const deck = pair.subject.seats[pair.seat].deck;
    expect(deck.filter((id) => id === "kessen-byakuho")).toHaveLength(2);
    expect(deck.filter((id) => id === TRIAL_FILLER_ID)).toHaveLength(3);
    const legendary = trialPairs(seedCardByName("Colossus"))[0];
    const slots = legendary?.subject.seats[legendary.seat].deck.filter(
      (id) => id === "kessen-colossus",
    );
    expect(slots).toHaveLength(1);
  });

  it("gives a card identical to its reference an edge of exactly zero", async () => {
    const catalog = trialCatalog(KESSEN_SEED_CATALOG);
    const card = seedCardByName("Musashi Ken Swordsman");
    const pairs = trialPairs(card, 10);
    const outcomes = await runKessenSims(
      {
        cards: catalog,
        pool: KESSEN_SEED_CATALOG,
        jobs: pairs.flatMap((pair) => [pair.subject, pair.reference]),
      },
      null,
    );
    expect(summarizeTrial(card, pairs, outcomes)).toMatchObject({
      edge: 0,
      se: 0,
      games: pairs.length,
      flags: [],
    });
  });

  it("plays the same outcome for a job in any process", () => {
    const pair = trialPairs(seedCardByName("Fireball"))[3];
    if (!pair) throw new Error("No trial pair");
    const catalog = trialCatalog(KESSEN_SEED_CATALOG);
    expect(playSimGame(pair.subject, catalog, KESSEN_SEED_CATALOG)).toEqual(
      playSimGame(pair.subject, catalog, KESSEN_SEED_CATALOG),
    );
  });

  it("warns about leaders far from the median leader's edge", () => {
    const trial = (cardId: string, edge: number) => ({
      card: { ...seedCardByName("Ravena Bloodsilk"), id: cardId },
      trial: { cardId, edge, se: 5, games: 60, discarded: 0, flags: [] },
    });
    const flags = leaderSpreadFlags([
      trial("a", 20),
      trial("b", 25),
      trial("c", 30),
      trial("d", 60),
    ]);
    expect([...flags.keys()]).toEqual(["d"]);
    expect(flags.get("d")?.[0]?.message).toBe(
      "Adds 60.0 win-rate points over a leader without abilities, 32.5 above the median leader (limit 20)",
    );
  });
});

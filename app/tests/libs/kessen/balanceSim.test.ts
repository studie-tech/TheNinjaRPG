import { describe, expect, it } from "bun:test";
import { KESSEN_COPY_LIMITS } from "@/drizzle/constants";
import {
  cardBalance,
  catalogBalance,
  kessenReferenceDecks,
} from "@/libs/kessen/balance";
import {
  gauntletJobs,
  type KessenSimOutcome,
  leaderSpreadFlags,
  playSimGame,
  summarizeGauntlet,
  summarizeTrial,
  TRIAL_FILLER_ID,
  trialPairs,
  trialReference,
} from "@/libs/kessen/balanceSim";
import {
  type KessenSimWorker,
  runGauntlet,
  runKessenSims,
  runTrials,
} from "@/libs/kessen/balanceSimRunner";
import { kessenCardToCardData, summonValueMilli } from "@/libs/kessen/catalog";
import type { KessenCard } from "@/libs/kessen/types";
import { cardDataSchema } from "@/validators/itemCard";
import { KESSEN_SEED_CATALOG, seedCardByName } from "./fixtures/catalog";

describe("Kessen balance simulation coverage", () => {
  it.each(["RARE", "EPIC", "LEGENDARY"] as const)(
    "isolates the allowed %s copies when a starter card's rarity changes",
    (rarity) => {
      const card = { ...seedCardByName("Cryverin"), rarity };
      const pair = trialPairs(card, 1)[0];
      if (!pair) throw new Error("No trial pair");
      const subject = pair.subject.seats[pair.seat].deck;
      const reference = pair.reference.seats[pair.seat].deck;
      const limit = KESSEN_COPY_LIMITS[rarity];
      expect(subject.filter((id) => id === card.id)).toHaveLength(limit);
      expect(reference.filter((id) => id === card.id)).toHaveLength(0);
      expect(reference.filter((id) => id === trialReference(card).id)).toHaveLength(
        limit,
      );
      expect(subject.filter((id) => id === TRIAL_FILLER_ID)).toHaveLength(6 - limit);
      subject.forEach((id, index) => {
        expect(reference[index]).toBe(id === card.id ? trialReference(card).id : id);
      });
    },
  );

  it("limits the vanilla filler's own trial after its rarity changes", () => {
    const card: KessenCard = {
      ...seedCardByName("Musashi Ken Swordsman"),
      rarity: "RARE",
    };
    const pair = trialPairs(card, 1)[0];
    if (!pair) throw new Error("No trial pair");
    const subject = pair.subject.seats[pair.seat].deck;
    const reference = pair.reference.seats[pair.seat].deck;
    expect(subject.filter((id) => id === card.id)).toHaveLength(2);
    expect(reference.filter((id) => id === card.id)).toHaveLength(0);
    expect(subject.filter((id, index) => id !== reference[index])).toHaveLength(2);
    subject.forEach((id, index) => {
      expect(reference[index]).toBe(id === card.id ? trialReference(card).id : id);
    });
  });

  it("keeps capped games in health diagnostics and out of every score denominator", () => {
    const card: KessenCard = {
      ...seedCardByName("Musashi Ken Swordsman"),
      abilities: [{ k: "substitution" }],
    };
    expect(cardDataSchema.safeParse(kessenCardToCardData(card)).success).toBe(true);
    const catalog = KESSEN_SEED_CATALOG.map((entry) =>
      entry.id === card.id ? card : entry,
    );
    const decks = kessenReferenceDecks();
    const job = gauntletJobs(decks, 2).find(
      (entry) =>
        entry.decks[0] === "champion-HYORIN" && entry.decks[1] === "champion-AKASUMI",
    );
    if (!job) throw new Error("No champion matchup");
    const capped = playSimGame(job, catalog);
    expect(capped).toMatchObject({
      finished: false,
      winner: null,
      plays: 390,
      rounds: 2,
    });
    const finished: KessenSimOutcome = {
      ...capped,
      id: "finished",
      finished: true,
      winner: 0,
      opener: 0,
      plays: 24,
    };
    const summary = summarizeGauntlet(
      decks,
      [job, { ...job, id: finished.id }],
      new Map([
        [job.id, capped],
        [finished.id, finished],
      ]),
    );
    expect(summary.health).toMatchObject({
      games: 2,
      skipped: 0,
      unfinished: 1,
      plays: 207,
      opener: 1,
    });
    expect(
      summary.health.flags.some((flag) => flag.message.includes("never finished")),
    ).toBe(true);
    expect(
      summary.decks.find((entry) => entry.key === job.decks[0])?.rate,
    ).toMatchObject({ games: 1, score: 1 });
    expect(
      summary.factions.find((entry) => entry.faction === "HYORIN")?.rate,
    ).toMatchObject({ games: 1, score: 1 });
    const incomplete = summarizeGauntlet(decks, [job], new Map([[job.id, capped]]));
    expect(incomplete.decks.every((entry) => entry.rate.games === 0)).toBe(true);
    expect(incomplete.factions.every((entry) => entry.rate.games === 0)).toBe(true);
    expect(
      incomplete.health.flags.some((flag) => flag.message.includes("opener")),
    ).toBe(false);
  });

  it("scores only fully finished trial pairs and reports discarded pairs", () => {
    const card = seedCardByName("Cryverin");
    const pairs = trialPairs(card, 1).slice(0, 4);
    const outcomes = new Map<string, KessenSimOutcome>();
    for (const [index, pair] of pairs.entries()) {
      if (index === 3) continue;
      outcomes.set(pair.subject.id, outcome(pair.subject.id, index === 1, 0));
      outcomes.set(pair.reference.id, outcome(pair.reference.id, index !== 2, 1));
    }
    const summary = summarizeTrial(card, pairs, outcomes);
    expect(summary).toMatchObject({ games: 1, discarded: 3 });
    expect(
      summary.flags.some((flag) => flag.message.includes("3 trial pairs excluded")),
    ).toBe(true);
    const first = pairs[0];
    if (!first) throw new Error("No trial pair");
    expect(summarizeTrial(card, [first], outcomes)).toMatchObject({
      games: 0,
      discarded: 1,
      edge: 0,
      se: 0,
    });
    const leader = seedCardByName("Ravena Bloodsilk");
    expect(
      leaderSpreadFlags([{ card: leader, trial: { ...summary, games: 0, edge: 100 } }])
        .size,
    ).toBe(0);
  });

  it("preserves playable trials and gauntlet matches when an edit makes a starter unplayable", async () => {
    const card: KessenCard = {
      ...seedCardByName("Cryverin"),
      kind: "LEADER",
      row: null,
      power: 0,
      provision: 0,
      leaderBonus: 11,
      abilities: [],
    };
    expect(cardDataSchema.safeParse(kessenCardToCardData(card)).success).toBe(true);
    const catalog = KESSEN_SEED_CATALOG.map((entry) =>
      entry.id === card.id ? card : entry,
    );
    const gauntlet = await runGauntlet(catalog, { createWorker: null, workers: 1 });
    expect(gauntlet.health.skipped).toBeGreaterThan(0);
    expect(gauntlet.health.games).toBeGreaterThan(0);
    expect(gauntlet.health.unfinished).toBe(0);
    expect(gauntlet.health.flags.some((flag) => flag.message.includes("skipped"))).toBe(
      true,
    );
    expect(
      gauntlet.decks.find((entry) => entry.key === "starter-HYORIN")?.rate.games,
    ).toBe(0);
    expect(
      gauntlet.decks.find((entry) => entry.key === "starter-SHIROHANA")?.rate.games,
    ).toBeGreaterThan(0);
    const other = seedCardByName("Fireball");
    const trials = await runTrials(
      catalog,
      { createWorker: null, workers: 1 },
      [card, other],
      1,
    );
    expect(trials[card.id]).toMatchObject({
      games: 0,
      discarded: trialPairs(card, 1).length,
    });
    expect(trials[other.id]?.games).toBeGreaterThan(0);
    expect(trials[other.id]?.discarded).toBeGreaterThan(0);
  }, 30_000);
});

describe("Kessen balance Summon diagnostics", () => {
  it("uses only members an actual caller can pull, including caller exclusion", () => {
    const caller: KessenCard = {
      ...seedCardByName("Cryverin"),
      abilities: [{ k: "summon", group: "CrossFaction" }],
      sets: ["CrossFaction"],
    };
    const member = {
      ...seedCardByName("Beta Sandworm"),
      abilities: [],
      sets: ["CrossFaction"],
    };
    expect(catalogBalance([caller, member]).sets[0]?.maxSummonPower).toBeNull();
    expect(
      cardBalance(caller, [caller, member]).flags.some((flag) =>
        flag.message.includes("no unit"),
      ),
    ).toBe(true);
    const eligible: KessenCard = { ...member, faction: "NEUTRAL" };
    expect(catalogBalance([caller, eligible]).sets[0]?.maxSummonPower).toBe(
      eligible.power,
    );
  });

  it.each(["constructor", "toString", "__proto__", "unknown"])(
    "prices the valid set name %s at the default",
    (group) => {
      expect(summonValueMilli(group)).toBe(3000);
      const caller: KessenCard = {
        ...seedCardByName("Cryverin"),
        abilities: [{ k: "summon", group }],
      };
      const member: KessenCard = {
        ...seedCardByName("Beta Sandworm"),
        faction: caller.faction,
        abilities: [],
        sets: [group],
        power: 3,
      };
      expect(cardDataSchema.safeParse(kessenCardToCardData(caller)).success).toBe(true);
      expect(
        cardBalance(caller, [caller, member]).flags.filter(
          (flag) => flag.rule === "summonSet",
        ),
      ).toEqual([]);
      expect(summonValueMilli("Sandworm")).toBe(3500);
      expect(summonValueMilli("Crew")).toBe(3000);
    },
  );
});

describe("Kessen simulation worker startup", () => {
  it("terminates workers created before a later factory call fails", async () => {
    let created = 0;
    let terminated = 0;
    const factory = (): KessenSimWorker => {
      if (++created === 2) throw new Error("Worker startup failed");
      return {
        onmessage: null,
        onerror: null,
        postMessage: () => {},
        terminate: () => {
          terminated++;
        },
      };
    };
    const job = trialPairs(seedCardByName("Cryverin"), 1)[0]?.subject;
    if (!job) throw new Error("No trial job");
    const jobs = Array.from({ length: 13 }, (_, index) => ({
      ...job,
      id: String(index),
    }));
    await expect(runKessenSims({ cards: [], jobs }, factory, 2)).rejects.toThrow(
      "Worker startup failed",
    );
    expect(terminated).toBe(1);
  });

  it("rejects a pre-aborted run before creating workers", async () => {
    const controller = new AbortController();
    controller.abort();
    let created = 0;
    const pair = trialPairs(seedCardByName("Cryverin"), 1)[0];
    if (!pair) throw new Error("No trial pair");
    await expect(
      runKessenSims(
        { cards: [], jobs: [pair.subject], signal: controller.signal },
        () => {
          created++;
          throw new Error("Unexpected startup");
        },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(created).toBe(0);
  });
});

const outcome = (id: string, finished: boolean, winner: 0 | 1): KessenSimOutcome => ({
  id,
  finished,
  winner,
  opener: 0,
  plays: 24,
  rounds: 2,
  ties: 0,
  swings: [],
  maxRow: 0,
});

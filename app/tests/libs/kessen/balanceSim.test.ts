import { describe, expect, it } from "bun:test";
import { KESSEN_COPY_LIMITS } from "@/drizzle/constants";
import { aiRng, decide } from "@/libs/kessen/ai";
import {
  cardBalance,
  catalogBalance,
  kessenReferenceDecks,
} from "@/libs/kessen/balance";
import {
  gauntletJobs,
  KESSEN_BALANCE_SIM,
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
import { catalogById, validateDeck } from "@/libs/kessen/deck";
import { actingSeats, applyAction, createMatch, viewFor } from "@/libs/kessen/engine";
import type { KessenCard } from "@/libs/kessen/types";
import { cardDataSchema } from "@/validators/itemCard";
import { act, handCard, scenario } from "./engineHelpers";
import { KESSEN_SEED_CATALOG, seedCardByName } from "./fixtures/catalog";

describe("Kessen balance simulation coverage", () => {
  it.each([
    {
      label: "a summoned row before round cleanup",
      matchup: "champion-SHIROHANA:starter-HYORIN:4:1",
      step: 31,
      card: "Beta Sandworm",
      maxRow: 35,
      phase: "mulligan",
    },
    {
      label: "Meditate on the retained final board",
      matchup: "starter-SHIROHANA:starter-TSUKIMORI:0:0",
      step: 32,
      card: "Taiyo Kami Devotee",
      maxRow: 32,
      phase: "over",
    },
  ])("records $label", ({ matchup, step, card, maxRow, phase }) => {
    const job = gauntletJobs(kessenReferenceDecks()).find(
      (entry) => entry.id === `kessen-balance:v2:gauntlet:${matchup}`,
    );
    if (!job) throw new Error("No canonical matchup");
    let state = createMatch({
      seed: job.seed,
      seats: job.seats,
      cards: KESSEN_SEED_CATALOG,
    });
    while (state.step <= step) {
      const seat = actingSeats(state)[0];
      if (seat === undefined) throw new Error("Match ended before the target play");
      const action = decide(
        viewFor(state, seat),
        seat,
        { tier: KESSEN_BALANCE_SIM.tier },
        aiRng(job.seed, seat, state.step),
        { pool: KESSEN_SEED_CATALOG, deck: job.seats[seat].deck },
      );
      const result = applyAction(state, seat, action);
      if (!result.ok) throw new Error(result.reason);
      if (state.step === step) {
        expect(action.t).toBe("play");
        if (action.t !== "play") throw new Error("Expected a card play");
        expect(state.cards[state.inst[action.card] ?? ""]?.name).toBe(card);
        expect(result.events).toContainEqual(
          expect.objectContaining({ t: "roundEnd", round: 2 }),
        );
        expect(result.state.phase).toBe(phase);
        if (phase === "mulligan") {
          expect(result.events).toContainEqual(
            expect.objectContaining({ t: "roundEnd", totals: [25, 35] }),
          );
        } else {
          expect(result.events).toContainEqual(
            expect.objectContaining({ t: "boosted", cause: "meditate" }),
          );
        }
      }
      state = result.state;
    }
    expect(playSimGame(job, KESSEN_SEED_CATALOG)).toMatchObject({
      finished: true,
      maxRow,
    });
  });

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

  it("flags a simulated leader outlier against its cohort but not against itself", async () => {
    const leader: KessenCard = {
      ...seedCardByName("Ravena Bloodsilk"),
      abilities: [{ k: "draw", x: 20 }],
    };
    expect(cardDataSchema.safeParse(kessenCardToCardData(leader)).success).toBe(true);
    const catalog = KESSEN_SEED_CATALOG.map((card) =>
      card.id === leader.id ? leader : card,
    );
    const subjects = [
      seedCardByName("Junko, Moon Warden"),
      seedCardByName("Amir, the Hoarder"),
      leader,
    ];
    const trials = await runTrials(
      catalog,
      { createWorker: null, workers: 1 },
      subjects,
      10,
    );
    for (const card of subjects) {
      expect(trials[card.id]).toMatchObject({ games: 10, discarded: 0 });
    }
    const trial = trials[leader.id];
    if (!trial) throw new Error("No leader trial");
    expect(trial.flags).toContainEqual(
      expect.objectContaining({ rule: "leaderTrial", severity: "warn" }),
    );
    expect(leaderSpreadFlags([{ card: leader, trial }]).size).toBe(0);
  });
});

describe("Kessen balance Summon diagnostics", () => {
  it.each(["EPIC", "LEGENDARY"] as const)(
    "excludes the %s caller's only copy and members from another faction",
    (rarity) => {
      const caller: KessenCard = {
        ...seedCardByName("Cryverin"),
        rarity,
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
    },
  );

  it.each(["COMMON", "RARE", "EPIC", "LEGENDARY"] as const)(
    "uses the base card's %s copy limit for a Forbidden Summon caller",
    (rarity) => {
      const base: KessenCard = {
        ...seedCardByName("The Drowned Gatekeeper"),
        rarity,
        sets: ["Crew"],
      };
      const variant: KessenCard = {
        ...base,
        id: "forbidden-summoner",
        variant: "FORBIDDEN",
        baseCardId: base.id,
      };
      const catalog = KESSEN_SEED_CATALOG.map((card) =>
        card.id === base.id ? base : card,
      ).concat(variant);
      const summoningFlags = (card: KessenCard) =>
        cardBalance(card, catalog).flags.filter((flag) => flag.rule === "summonSet");
      expect(summoningFlags(variant)).toEqual(summoningFlags(base));
      expect(
        summoningFlags({
          ...variant,
          rarity: rarity === "COMMON" ? "LEGENDARY" : "COMMON",
        }),
      ).toEqual(summoningFlags(base));
      const list = kessenReferenceDecks().find(
        (deck) => deck.faction === base.faction,
      )!.list;
      const { errors } = validateDeck(
        {
          ...list,
          cards: [
            { itemId: base.id, count: 1 },
            { itemId: variant.id, count: 1 },
          ],
        },
        catalogById(catalog),
      );
      expect(errors.some((error) => error.code === "copies")).toBe(
        KESSEN_COPY_LIMITS[rarity] === 1,
      );
      expect(summoningFlags(variant).some((flag) => flag.severity === "break")).toBe(
        KESSEN_COPY_LIMITS[rarity] > 1,
      );
    },
  );

  it.each(["COMMON", "RARE"] as const)(
    "includes another %s copy as the strongest eligible Summon pull",
    (rarity) => {
      const caller: KessenCard = {
        ...seedCardByName("Beta Sandworm"),
        rarity,
        power: 6,
        provision: rarity === "COMMON" ? 6 : 7,
      };
      const flag = {
        rule: "summonSet",
        set: "Sandworm",
        severity: "break",
        message:
          "Summon Sandworm can pull Beta Sandworm (power 6), over the 5.0 a Summon from it allows",
      } as const;
      expect(cardBalance(caller, [caller]).flags).toEqual([flag]);
      expect(catalogBalance([caller]).sets[0]?.maxSummonPower).toBe(caller.power);
      const catalog = KESSEN_SEED_CATALOG.map((card) =>
        card.id === caller.id ? caller : card,
      );
      expect(cardBalance(caller, catalog).flags).toEqual([flag]);
      expect(
        catalogBalance(catalog).sets.find((set) => set.name === "Sandworm")
          ?.maxSummonPower,
      ).toBe(caller.power);

      const state = scenario({
        p0: { hand: [caller.name], deck: [caller.name] },
        p1: { hand: ["Cryverin"] },
      });
      state.cards = { ...state.cards, [caller.id]: caller };
      const result = act(state, 0, {
        t: "play",
        card: handCard(state, 0, caller.name),
      });
      expect(
        result.state.board[0].CLOSE.map((unit) => [
          result.state.inst[unit.id],
          unit.stored,
        ]),
      ).toEqual([
        [caller.id, caller.power],
        [caller.id, caller.power],
      ]);
      expect(result.state.seats[0].deck).toEqual([]);
      expect(result.events).toContainEqual(
        expect.objectContaining({ t: "placed", source: "summon" }),
      );
    },
  );

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

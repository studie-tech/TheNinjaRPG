import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { readFileSync } from "node:fs";
import {
  aiRng,
  chooseMulligan,
  decide,
  decideWithTrace,
  greedyDecide,
  KESSEN_AI_TIER_SPECS,
  KESSEN_AI_TIERS,
  type KessenAiProfile,
  type KessenAiTier,
  oppThreat,
} from "@/libs/kessen/ai";
import { canonicalJson, stateHash, viewFor } from "@/libs/kessen/engine";
import { KESSEN_NPCS, kessenNpc, kessenNpcAiProfile } from "@/libs/kessen/npcs";
import { createRng, shuffleInPlace } from "@/libs/kessen/rng";
import { TOKEN_PREFIX } from "@/libs/kessen/rules";
import type { KessenAction, MatchState, MatchView, Seat } from "@/libs/kessen/types";
import {
  type AiDecisionRecord,
  BOSS_DECKS,
  HOUSE_RULES,
  playAiMatch,
  STARTER_DECKS,
  type TestDeck,
} from "./aiHelpers";
import { CATALOG, cid, handCard, scenario } from "./engineHelpers";
import { KESSEN_DECK_CARDS, KESSEN_SEED_CATALOG } from "./fixtures/catalog";

// Whole AI matches run per test, which outlasts the default timeout on a loaded machine.
setDefaultTimeout(30_000);

const POOL = KESSEN_SEED_CATALOG;
const SEED_BY_ID = Object.fromEntries(POOL.map((card) => [card.id, card]));
const MUSASHI = "Musashi Ken Swordsman";
const deck = (index: number) => STARTER_DECKS[index % STARTER_DECKS.length] as TestDeck;
const profile = (tier: KessenAiTier): KessenAiProfile => ({ tier });

/** The AI's decision for seat 1 of a hand-built state. */
const decideFor = (
  s: MatchState,
  player: KessenAiProfile,
  seed = "scenario",
  pool = POOL,
) => decideWithTrace(viewFor(s, 1), 1, player, aiRng(seed, 1, s.step), { pool });

/** Records every decision of a match between two tiers on starter decks. */
const recordMatch = (
  seed: string,
  tiers: [KessenAiTier, KessenAiTier],
  decks = [0, 1],
) => {
  const records: AiDecisionRecord[] = [];
  const state = playAiMatch({
    seed,
    seats: [
      { player: profile(tiers[0]), deck: deck(decks[0] ?? 0) },
      { player: profile(tiers[1]), deck: deck(decks[1] ?? 0) },
    ],
    onDecision: (record) => records.push(record),
  });
  return { state, records };
};

/**
 * A copy of `s` that differs only in what `viewer` cannot see: the opponent's hand and
 * deck hold other cards in another order, and the viewer's own deck is reordered.
 */
const hiddenTwin = (s: MatchState, viewer: Seat, salt: string): MatchState => {
  const twin = structuredClone(s);
  const rng = createRng(salt);
  const opponent = viewer === 0 ? 1 : 0;
  const swaps = KESSEN_DECK_CARDS.map((card) => card.id);
  for (const id of [...twin.seats[opponent].hand, ...twin.seats[opponent].deck]) {
    if (id.startsWith(TOKEN_PREFIX)) continue;
    const cardId = swaps[rng.int(swaps.length)] as string;
    twin.inst[id] = cardId;
    twin.cards[cardId] = SEED_BY_ID[cardId] as (typeof twin.cards)[string];
  }
  shuffleInPlace(rng, twin.seats[opponent].hand);
  shuffleInPlace(rng, twin.seats[opponent].deck);
  shuffleInPlace(rng, twin.seats[viewer].deck);
  return twin;
};

describe("Kessen AI determinism", () => {
  it("replays a match between every tier pair move for move", () => {
    for (const tiers of [
      ["GENIN", "CHUNIN"],
      ["KAGE", "JONIN"],
    ] as [KessenAiTier, KessenAiTier][]) {
      const first = recordMatch("determinism", tiers, [2, 3]);
      const second = recordMatch("determinism", tiers, [2, 3]);
      expect(second.records.map((record) => record.action)).toEqual(
        first.records.map((record) => record.action),
      );
      expect(stateHash(second.state)).toBe(stateHash(first.state));
      expect(first.state.phase).toBe("over");
    }
  });

  it("decides the same from a view that went through JSON", () => {
    const { records } = recordMatch("json-view", ["CHUNIN", "CHUNIN"], [4, 5]);
    const positions = records.filter((record) => record.seat === 1).slice(0, 12);
    for (const tier of KESSEN_AI_TIERS) {
      for (const { state } of positions.slice(0, tier === "KAGE" ? 3 : 12)) {
        const view = viewFor(state, 1);
        const stored = JSON.parse(JSON.stringify(view)) as MatchView;
        const rngA = aiRng("json-view", 1, state.step);
        const rngB = aiRng("json-view", 1, state.step);
        expect(decide(stored, 1, profile(tier), rngB, { pool: POOL })).toEqual(
          decide(view, 1, profile(tier), rngA, { pool: POOL }),
        );
      }
    }
  });

  it("decides the same whatever order the catalog pool arrives in", () => {
    const { records } = recordMatch("pool-order", ["CHUNIN", "CHUNIN"], [1, 3]);
    const positions = records.filter((record) => record.seat === 1).slice(0, 10);
    const shuffled = shuffleInPlace(createRng("pool-order"), [...POOL]);
    const reversed = [...POOL].reverse();
    for (const tier of KESSEN_AI_TIERS) {
      for (const { state } of positions.slice(0, tier === "KAGE" ? 2 : 6)) {
        const view = viewFor(state, 1);
        const run = (pool: typeof POOL) =>
          decideWithTrace(view, 1, profile(tier), aiRng("pool-order", 1, state.step), {
            pool,
          });
        const expected = run(POOL);
        expect(run(shuffled)).toEqual(expected);
        expect(run(reversed)).toEqual(expected);
      }
      const view = viewFor(positions[0]?.state as MatchState, 1);
      expect(chooseMulligan(view, 1, { pool: shuffled })).toEqual(
        chooseMulligan(view, 1, { pool: POOL }),
      );
      expect(oppThreat(view, reversed)).toBe(oppThreat(view, POOL));
    }
  });

  it("derives a separate stream per seat and step", () => {
    const values = [
      aiRng("seed", 1, 4).next(),
      aiRng("seed", 1, 5).next(),
      aiRng("seed", 0, 4).next(),
      aiRng("other", 1, 4).next(),
    ];
    expect(new Set(values).size).toBe(values.length);
    expect(aiRng("seed", 1, 4).next()).toBe(values[0] as number);
  });
});

describe("Kessen AI hidden information", () => {
  const view = (state: MatchState) => viewFor(state, 1);

  it("sees the same view of states that differ only in hidden zones", () => {
    const { records } = recordMatch("hidden-info", ["CHUNIN", "CHUNIN"], [1, 3]);
    const positions = records.filter((record) => record.seat === 1);
    expect(positions.length).toBeGreaterThan(10);
    for (const [index, { state }] of positions.entries()) {
      const twin = hiddenTwin(state, 1, `twin-${index}`);
      expect(
        canonicalJson(twin.seats[0].hand.map((id) => twin.inst[id])) ===
          canonicalJson(state.seats[0].hand.map((id) => state.inst[id])),
      ).toBe(state.seats[0].hand.every((id) => id.startsWith(TOKEN_PREFIX)));
      expect(canonicalJson(viewFor(twin, 1))).toBe(canonicalJson(view(state)));
    }
  });

  it("decides the same whatever order the server's deck list is in", () => {
    const { records } = recordMatch("hidden-deck", ["CHUNIN", "CHUNIN"], [2, 4]);
    const positions = records.filter((record) => record.seat === 1);
    let compared = 0;
    for (const tier of KESSEN_AI_TIERS) {
      const sample =
        tier === "JONIN" || tier === "KAGE" ? positions.slice(0, 6) : positions;
      for (const [index, { state }] of sample.entries()) {
        // The server passes the NPC's whole deck list (`aiDeck`), never its true order.
        const list = Object.entries(state.inst)
          .filter(([id]) => id.startsWith("s1-"))
          .map(([, cardId]) => cardId)
          .sort();
        const reordered = [...list];
        shuffleInPlace(createRng(`deck-${index}`), reordered);
        const run = (deck: string[]) =>
          decide(view(state), 1, profile(tier), aiRng("h", 1, state.step), {
            pool: POOL,
            deck,
          });
        expect(run(reordered)).toEqual(run(list));
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(30);
  });

  it("takes a redacted view, never a full match state", () => {
    const mustNotCompile = (s: MatchState) =>
      // @ts-expect-error The AI accepts only a MatchView.
      decide(s, 1, profile("CHUNIN"), aiRng("type", 1, 0));
    expect(typeof mustNotCompile).toBe("function");
  });
});

describe("Kessen AI legality and budget", () => {
  it("plays only legal actions across seeded matches, house rules and boss decks", () => {
    const games: {
      tiers: [KessenAiTier | "GREEDY", KessenAiTier | "GREEDY"];
      decks: [TestDeck, TestDeck];
      rules?: (typeof HOUSE_RULES)[number];
    }[] = [];
    for (let n = 0; n < 24; n++) {
      games.push({
        tiers: n % 2 === 0 ? ["CHUNIN", "GENIN"] : ["GENIN", "CHUNIN"],
        decks: [deck(n), deck(n + 1 + (n % 5))],
        rules: HOUSE_RULES[n % HOUSE_RULES.length],
      });
    }
    for (let n = 0; n < 4; n++) {
      games.push({ tiers: ["GREEDY", "GENIN"], decks: [deck(n), deck(n + 2)] });
      games.push({
        tiers: ["CHUNIN", "JONIN"],
        decks: [deck(n + 3), deck(n)],
        rules: HOUSE_RULES[(n * 3) % HOUSE_RULES.length],
      });
    }
    for (const boss of BOSS_DECKS) {
      games.push({
        tiers: ["CHUNIN", "KAGE"],
        decks: [deck(1), boss],
        rules: boss.rules,
      });
    }
    let decisions = 0;
    for (const [index, game] of games.entries()) {
      const state = playAiMatch({
        seed: `legal-${index}`,
        seats: [
          {
            player: game.tiers[0] === "GREEDY" ? "GREEDY" : profile(game.tiers[0]),
            deck: game.decks[0],
          },
          {
            player: game.tiers[1] === "GREEDY" ? "GREEDY" : profile(game.tiers[1]),
            deck: game.decks[1],
          },
        ],
        rules: game.rules,
        onDecision: ({ seat, trace }) => {
          decisions += 1;
          if (!trace) return;
          const tier = game.tiers[seat] as KessenAiTier;
          expect(trace.applications).toBeLessThanOrEqual(
            KESSEN_AI_TIER_SPECS[tier].budget + 1000,
          );
        },
      });
      expect({ game: index, phase: state.phase }).toEqual({
        game: index,
        phase: "over",
      });
    }
    expect(decisions).toBeGreaterThan(1000);
  });

  it("keeps the rule choice when the rollout budget runs out", () => {
    const { records } = recordMatch("budget", ["CHUNIN", "CHUNIN"], [0, 0]);
    const position = records.find(
      (record) => record.seat === 1 && record.state.phase === "play",
    ) as AiDecisionRecord;
    const view = viewFor(position.state, 1);
    const run = (tier: KessenAiTier, budget?: number) =>
      decideWithTrace(view, 1, profile(tier), aiRng("budget", 1, 7), {
        pool: POOL,
        budget,
      });
    const kage = run("KAGE", 1800);
    const jonin = run("JONIN", 1800);
    expect(kage.fallback).toBe(true);
    expect(jonin.fallback).toBe(true);
    expect(kage.action).toEqual(jonin.action);
    const full = run("KAGE");
    expect(full.fallback).toBe(false);
    expect(full.samples).toBeGreaterThanOrEqual(KESSEN_AI_TIER_SPECS.KAGE.samples >> 2);
    expect(full.applications).toBeLessThanOrEqual(
      KESSEN_AI_TIER_SPECS.KAGE.budget + 1000,
    );
  });
});

describe("Kessen AI rules", () => {
  it("passes once the opponent has passed and it leads", () => {
    const s = scenario({
      turn: 1,
      p0: {
        leader: "Hisame, Dune Warden",
        hand: [MUSASHI],
        passed: true,
        board: { CLOSE: ["Enrai no Oni"] },
      },
      p1: {
        leader: "Kimiko, Frost Warden",
        hand: [MUSASHI, "Cryverin"],
        board: { CLOSE: [MUSASHI] },
      },
    });
    for (const tier of KESSEN_AI_TIERS) {
      expect(decideFor(s, profile(tier))).toMatchObject({
        action: { t: "pass" },
        rule: "leading",
      });
    }
  });

  it("wins a passed round with the lowest-retention card that suffices", () => {
    const s = scenario({
      turn: 1,
      p0: {
        leader: "Hisame, Dune Warden",
        hand: [MUSASHI],
        passed: true,
        board: { CLOSE: ["Colossus"] },
      },
      p1: {
        leader: "Kimiko, Frost Warden",
        hand: ["Colossus", MUSASHI, "Cryverin"],
        board: { CLOSE: [MUSASHI] },
      },
    });
    for (const tier of KESSEN_AI_TIERS) {
      const decision = decideFor(s, profile(tier));
      expect(decision.action).toEqual({
        t: "play",
        card: handCard(s, 1, "Cryverin"),
        row: "CLOSE",
      });
      expect(decision.rule).toBe("plan 1");
    }
  });

  it("concedes a passed Round 1 that would take three cards at even hands", () => {
    const s = scenario({
      turn: 1,
      p0: {
        leader: "Hisame, Dune Warden",
        hand: [MUSASHI, MUSASHI, MUSASHI, MUSASHI],
        passed: true,
        board: { CLOSE: ["Colossus", MUSASHI] },
      },
      p1: {
        leader: "Kimiko, Frost Warden",
        hand: ["Cryverin", "Cryverin", "Cryverin", "Cryverin"],
        board: { CLOSE: [MUSASHI] },
      },
    });
    const decision = decideFor(s, profile("CHUNIN"));
    expect(decision).toMatchObject({ action: { t: "pass" }, rule: "concede round" });
    const final = decideFor({ ...s, round: 3 }, profile("CHUNIN"));
    expect(final.action.t).toBe("play");
  });

  it("lets Genin pass Round 1 at a fixed lead of 12", () => {
    const s = scenario({
      turn: 1,
      p0: {
        leader: "Hisame, Dune Warden",
        hand: [MUSASHI, MUSASHI, MUSASHI],
        played: 2,
        board: { RANGED: ["Owlcat"] },
      },
      p1: {
        leader: "Kimiko, Frost Warden",
        hand: [MUSASHI, MUSASHI],
        played: 2,
        board: { CLOSE: ["Colossus", "Enrai no Oni"] },
      },
    });
    for (const seed of ["a", "b", "c", "d", "e", "f"]) {
      expect(decideFor(s, profile("GENIN"), seed)).toMatchObject({
        action: { t: "pass" },
        rule: "genin lead",
      });
    }
  });

  it("passes Round 1 only once its lead beats the opponent's exact threat", () => {
    const build = (board: string[]) =>
      scenario({
        turn: 1,
        p0: {
          leader: "Kimiko, Frost Warden",
          leaderUsed: true,
          hand: [MUSASHI, MUSASHI, MUSASHI],
          played: 2,
          board: { CLOSE: ["Cryverin"] },
        },
        p1: {
          leader: "Kimiko, Frost Warden",
          hand: [MUSASHI, MUSASHI, MUSASHI, "Cryverin"],
          played: 2,
          board: { CLOSE: board },
        },
      });
    const pool = [MUSASHI, "Cryverin"].map(
      (name) => CATALOG[cid(name)] as (typeof POOL)[number],
    );
    // Lead 13 against a threat of 7 (Musashi Ken): they now need two cards.
    expect(
      decideFor(build(["Colossus", MUSASHI]), profile("CHUNIN"), "x", pool),
    ).toMatchObject({
      action: { t: "pass" },
      rule: "round lead",
    });
    // Lead 6 does not beat the threat, so it keeps playing.
    expect(decideFor(build(["Colossus"]), profile("CHUNIN"), "x", pool).action.t).toBe(
      "play",
    );
  });

  it("holds a signature card until its condition holds", () => {
    const raizhen = "Raizhen, the Ten-Tailed";
    const s = scenario({
      turn: 1,
      p0: {
        leader: "Hisame, Dune Warden",
        hand: [MUSASHI, MUSASHI],
        played: 2,
        board: { CLOSE: [MUSASHI] },
      },
      p1: {
        leader: "Kimiko, Frost Warden",
        hand: [raizhen],
        played: 2,
        board: { CLOSE: ["Cryverin"] },
      },
    });
    const hinted: KessenAiProfile = {
      tier: "CHUNIN",
      signatures: [{ cardId: cid(raizhen), rule: { hold: "untilRound", round: 3 } }],
    };
    expect(decideFor(s, hinted)).toMatchObject({ action: { t: "pass" }, rule: "hold" });
    expect(decideFor(s, profile("CHUNIN")).action).toMatchObject({
      t: "play",
      card: handCard(s, 1, raizhen),
    });
    expect(decideFor({ ...s, round: 3 }, hinted).action).toMatchObject({ t: "play" });
    // The server plays Unmeishi with the profile its NPC entry declares.
    const unmeishi = kessenNpc("unmeishi");
    if (!unmeishi) throw new Error("missing Unmeishi");
    expect(decideFor(s, kessenNpcAiProfile(unmeishi, "CHUNIN"))).toMatchObject({
      action: { t: "pass" },
      rule: "hold",
    });
  });

  it("gives every NPC signature a card of that NPC's decks", () => {
    for (const npc of KESSEN_NPCS) {
      const decks = [npc.standard, npc.ascended].flatMap((variant) =>
        variant ? variant.deck.cards.map((entry) => entry.itemId) : [],
      );
      for (const signature of npc.aiProfile.signatures ?? []) {
        expect({ npc: npc.key, card: decks.includes(signature.cardId) }).toEqual({
          npc: npc.key,
          card: true,
        });
      }
    }
  });

  it("chooses mulligans by its rules, keeps the Genin hand and sharpens Kage's", () => {
    const s = scenario({
      turn: 1,
      p0: { leader: "Hisame, Dune Warden", hand: [MUSASHI, MUSASHI] },
      p1: {
        leader: "Kimiko, Frost Warden",
        hand: [
          "Beta Sandworm",
          "Biting Frost",
          "Colossus",
          "Beta Sandworm",
          "Biting Frost",
          "Seal of Nullification",
          "Anbu Chief",
          "Kuzenbo, the Mountain God",
          "Cryverin",
          "Thorn Grasp",
        ],
      },
    });
    s.phase = "mulligan";
    s.seats[1].mull = 3;
    s.seats[0].mull = 3;
    const view = viewFor(s, 1);
    const hand = s.seats[1].hand;
    // Second Summon copy, second Terrain and Clear Skies against a faction without Terrain.
    expect([...chooseMulligan(view, 1, { pool: POOL })].sort()).toEqual(
      [hand[3], hand[4], hand[5]].map(String).sort(),
    );
    expect(decide(view, 1, profile("GENIN"), aiRng("m", 1, 0))).toEqual({
      t: "mull",
      cards: [],
    });
    const chunin = decide(view, 1, profile("CHUNIN"), aiRng("m", 1, 0), { pool: POOL });
    expect(chunin).toEqual({
      t: "mull",
      cards: chooseMulligan(view, 1, { pool: POOL }),
    });
    s.seats[1].mull = 6;
    const wide = viewFor(s, 1);
    const kage = decide(wide, 1, profile("KAGE"), aiRng("m", 1, 0), { pool: POOL });
    const jonin = decide(wide, 1, profile("JONIN"), aiRng("m", 1, 0), { pool: POOL });
    expect(kage.t === "mull" && jonin.t === "mull").toBe(true);
    if (kage.t === "mull" && jonin.t === "mull") {
      expect(kage.cards.length).toBeGreaterThan(jonin.cards.length);
      expect(kage.cards.slice(0, jonin.cards.length)).toEqual(jonin.cards);
    }
  });
});

describe("Kessen AI threat", () => {
  const build = (
    discard: string[] = [],
    passed = false,
    hand = [MUSASHI, MUSASHI, MUSASHI],
  ) =>
    scenario({
      turn: 1,
      p0: { leader: "The Crowned Captain", leaderUsed: true, hand, discard, passed },
      p1: {
        leader: "Kimiko, Frost Warden",
        hand: [MUSASHI],
        board: { CLOSE: ["Colossus"] },
      },
    });
  const pool = ["Divine Railgun", MUSASHI].map(
    (name) => CATALOG[cid(name)] as (typeof POOL)[number],
  );

  it("is the largest single-play gain over the opponent's possible pool", () => {
    // Divine Railgun strikes Colossus for 8, more than Musashi Ken's 7 points.
    expect(oppThreat(viewFor(build(), 1), pool)).toBe(8000);
  });

  it("drops cards whose copy limit is already visible", () => {
    expect(oppThreat(viewFor(build(["Divine Railgun"]), 1), pool)).toBe(7000);
  });

  it("is zero once the opponent cannot act", () => {
    expect(oppThreat(viewFor(build([], true), 1), pool)).toBe(0);
    expect(oppThreat(viewFor(build([], false, []), 1), pool)).toBe(0);
  });

  it("counts an unused leader", () => {
    const s = scenario({
      turn: 1,
      p0: { leader: "Ravena Bloodsilk", hand: [] },
      p1: {
        leader: "Kimiko, Frost Warden",
        hand: [MUSASHI],
        board: { CLOSE: [MUSASHI] },
      },
    });
    // Crimson Tithe strikes Musashi Ken (7) for 4.
    expect(oppThreat(viewFor(s, 1), pool)).toBe(4000);
  });
});

describe("Kessen greedy baseline", () => {
  it("plays the largest immediate gain and passes only when the opponent has passed", () => {
    const s = scenario({
      turn: 1,
      p0: {
        leader: "Hisame, Dune Warden",
        hand: [MUSASHI],
        board: { CLOSE: [MUSASHI, MUSASHI] },
      },
      p1: {
        leader: "Kimiko, Frost Warden",
        hand: ["Enrai no Oni", MUSASHI],
        board: { CLOSE: ["Colossus", "Colossus"] },
      },
    });
    const play: KessenAction = {
      t: "play",
      card: handCard(s, 1, MUSASHI),
      row: "CLOSE",
    };
    expect(greedyDecide(viewFor(s, 1), 1)).toEqual(play);
    s.seats[0].passed = true;
    expect(greedyDecide(viewFor(s, 1), 1)).toEqual({ t: "pass" });
  });
});

describe("Kessen AI source", () => {
  it("keeps floats, wall clocks and ambient randomness out of the AI", () => {
    const source = readFileSync(
      new URL("../../../src/libs/kessen/ai.ts", import.meta.url),
      "utf8",
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    for (const banned of [
      /Math\.random/,
      /\bDate\b/,
      /\bperformance\b/,
      /Math\.(pow|exp|sin|cos|tan|hypot|log|sqrt|round)\b/,
      /\*\*/,
      /\bparseFloat\b/,
      /\b\d+\.\d+\b/,
    ]) {
      expect({ banned: String(banned), found: banned.test(source) }).toEqual({
        banned: String(banned),
        found: false,
      });
    }
  });
});

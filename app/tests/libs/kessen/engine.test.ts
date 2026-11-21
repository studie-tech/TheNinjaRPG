import { describe, expect, it } from "bun:test";
import { legalActions, rowOptions, targetOptions } from "@/libs/kessen/abilities";
import {
  actingSeats,
  applyAction,
  boardTotals,
  createMatch,
  legalActionsForView,
  previewAction,
  previewPartial,
  redactEvents,
  rowOptionsForView,
  targetOptionsForView,
  unitPower,
  viewFor,
  viewToState,
} from "@/libs/kessen/engine";
import { DEFAULT_KNOBS, TOKEN_CARD_ID } from "@/libs/kessen/rules";
import type { KessenCard, MatchState, Seat } from "@/libs/kessen/types";
import {
  act,
  CATALOG,
  cid,
  deckOf,
  handCard,
  scenario,
  stored,
  unitAt,
} from "./engineHelpers";
import { KESSEN_SEED_CATALOG } from "./fixtures/catalog";
import { KESSEN_RULES_CATALOG } from "./fixtures/rulesCatalog";

const MUSASHI = "Musashi Ken Swordsman";
const FILLER = deckOf([
  [MUSASHI, 3],
  ["Cryverin", 3],
  ["Enrai no Oni", 3],
  ["Kajioka", 3],
  ["Mei Back-Alley Enforcer", 3],
  ["Arashima Stormcaller", 3],
  ["Colossus", 1],
  ["Kawarimi", 3],
  ["Seal of Nullification", 3],
]);
const LEADER = {
  hisame: "Hisame, Dune Warden",
  demonLord: "Subaku Demon Lord",
  junko: "Junko, Moon Warden",
  widow: "Widow of the Waning Moon",
  kimiko: "Kimiko, Frost Warden",
  sovereign: "Frost Sovereign",
  captain: "The Crowned Captain",
  conductor: "The Hollow Conductor",
  aerathiel: "Aerathiel Wind-Bearer",
  kaze: "Kaze no Seirei",
  amir: "Amir, the Hoarder",
  ravena: "Ravena Bloodsilk",
  shishi: "Divine Shishi",
  loom: "The Loom of Fate",
} as const;

const leaderId = (name: string) => cid(name);

const newMatch = (overrides: Partial<Parameters<typeof createMatch>[0]> = {}) =>
  createMatch({
    seed: "engine-test",
    seats: [
      { leaderId: leaderId(LEADER.hisame), deck: FILLER },
      { leaderId: leaderId(LEADER.amir), deck: FILLER },
    ],
    cards: KESSEN_RULES_CATALOG,
    ...overrides,
  });

/** Every seat with a pending mulligan keeps its hand. */
const keepBoth = (s: MatchState) => {
  let state = s;
  for (const seat of [0, 1] as const) {
    if (state.phase === "mulligan" && state.seats[seat].mull !== null) {
      state = act(state, seat, { t: "mull", cards: [] }).state;
    }
  }
  return state;
};

const passBoth = (s: MatchState) => {
  let state = s;
  for (let i = 0; i < 2 && state.phase === "play"; i++)
    state = act(state, state.turn, { t: "pass" }).state;
  return state;
};

const power = (s: MatchState, id: string) => unitPower(s, id);

describe("match setup", () => {
  it("shuffles, tosses the coin and deals ten cards into the Round 1 mulligan", () => {
    const s = newMatch();
    expect(s.phase).toBe("mulligan");
    expect(s.round).toBe(1);
    for (const seat of [0, 1] as const) {
      expect(s.seats[seat].hand).toHaveLength(10);
      expect(s.seats[seat].deck).toHaveLength(FILLER.length - 10);
      expect(s.seats[seat].mull).toBe(3);
      expect(s.seats[seat].hand.every((id) => id.startsWith(`s${seat}-`))).toBe(true);
    }
    expect(actingSeats(s)).toEqual([0, 1]);
    expect(Object.keys(s.cards).sort()).toEqual(Object.keys(s.cards));
    expect(s.cards[cid("Fireball")]).toBeUndefined();
    expect(s.cards[TOKEN_CARD_ID]?.power).toBe(DEFAULT_KNOBS.gambitPower);
  });

  it("labels instances independently of their deck position", () => {
    // A drawn id must not tell the opponent which deck position (and so which draw) it was.
    let aligned = 0;
    let total = 0;
    for (let n = 0; n < 20; n++) {
      const s = newMatch({ seed: `labels-${n}` });
      for (const seat of [0, 1] as const) {
        const order = [...s.seats[seat].hand, ...s.seats[seat].deck];
        const labels = order.map((id) => Number(id.slice(3)));
        expect([...labels].sort((a, b) => a - b)).toEqual(order.map((_, i) => i));
        aligned += labels.filter((label, i) => label === i).length;
        total += labels.length;
      }
    }
    // A random permutation fixes about one position per deck.
    expect(aligned).toBeLessThan(total / 10);
  });

  it("is deterministic per seed and differs across seeds", () => {
    expect(newMatch()).toEqual(newMatch());
    const cardsOf = (s: MatchState) => s.seats[0].deck.map((id) => s.inst[id]);
    expect(cardsOf(newMatch({ seed: "other" }))).not.toEqual(cardsOf(newMatch()));
  });

  it("keeps a scripted deck order when shuffle is off", () => {
    const deck = deckOf([
      [MUSASHI, 1],
      ["Cryverin", 1],
      ["Colossus", 1],
    ]);
    const s = createMatch({
      seed: "lesson",
      seats: [
        { leaderId: null, deck, shuffle: false },
        { leaderId: null, deck, shuffle: false },
      ],
      cards: KESSEN_RULES_CATALOG,
    });
    expect(s.seats[0].hand.map((id) => s.inst[id])).toEqual(deck);
    expect(s.seats[0].faction).toBe("NEUTRAL");
  });

  it("rejects unknown cards and leaders", () => {
    expect(() =>
      newMatch({
        seats: [
          { leaderId: "nope", deck: FILLER },
          { leaderId: null, deck: FILLER },
        ],
      }),
    ).toThrow();
    expect(() =>
      newMatch({
        seats: [
          { leaderId: null, deck: ["nope"] },
          { leaderId: null, deck: FILLER },
        ],
      }),
    ).toThrow();
    expect(() =>
      newMatch({
        seats: [
          { leaderId: cid(MUSASHI), deck: FILLER },
          { leaderId: null, deck: FILLER },
        ],
      }),
    ).toThrow();
  });

  it("starts the Round 1 opener with a Shadow Clone on its Taijutsu row after both mulligans", () => {
    let s = newMatch({ rules: { knobs: { gambitPower: 3, sunBonus: 2 } } });
    s = act(s, 0, { t: "mull", cards: [] }).state;
    const result = act(s, 1, { t: "mull", cards: [] });
    s = result.state;
    expect(s.phase).toBe("play");
    expect(s.turn).toBe(s.opener);
    expect(s.inst["t-1"]).toBe(TOKEN_CARD_ID);
    expect(s.board[s.opener].CLOSE.map((unit) => unit.id)).toEqual(["t-1"]);
    // Placed by the rules, not from hand: no Sun-Blessed bonus, no card played.
    expect(stored(s, "t-1")).toBe(3);
    expect(s.seats[s.opener].sun).toBe(false);
    expect(s.seats[s.opener].played).toBe(0);
    for (const seat of [0, 1] as const) expect(s.seats[seat].hand).not.toContain("t-1");
    expect(result.events).toContainEqual(
      expect.objectContaining({
        t: "placed",
        id: "t-1",
        source: "gambit",
        row: "CLOSE",
      }),
    );
    // The opponent sees the clone; it never returns to a hand and is banished at round end.
    expect(viewFor(s, other(s.opener)).inst["t-1"]).toBe(TOKEN_CARD_ID);
    const ended = act(act(s, s.opener, { t: "pass" }).state, other(s.opener), {
      t: "pass",
    }).state;
    expect(ended.board[s.opener].CLOSE).toEqual([]);
    expect(ended.seats[s.opener].discard).not.toContain("t-1");
  });

  it("keeps the Shadow Clone out of Substitution", () => {
    const s = scenario({
      p0: { hand: ["Kawarimi", MUSASHI], board: { CLOSE: [MUSASHI] } },
      p1: { hand: [MUSASHI] },
    });
    s.inst["t-1"] = TOKEN_CARD_ID;
    s.tokens = 1;
    s.board[0].CLOSE.push({
      id: "t-1",
      owner: 0,
      stored: 3,
      sealed: false,
      med: 0,
      res: false,
      seq: 9,
    });
    const kawarimi = handCard(s, 0, "Kawarimi");
    expect(applyAction(s, 0, { t: "play", card: kawarimi, targets: ["t-1"] })).toEqual({
      ok: false,
      reason: "Invalid target for substitution",
    });
    expect(
      act(s, 0, { t: "play", card: kawarimi, targets: [unitAt(s, 0, "CLOSE", 0)] })
        .state.seats[0].hand,
    ).toHaveLength(2);
  });

  it("sets the token power from the gambitPower knob", () => {
    const s = keepBoth(newMatch({ rules: { knobs: { gambitPower: 0 } } }));
    expect(s.cards[TOKEN_CARD_ID]?.power).toBe(0);
  });
});

describe("mulligans", () => {
  it("puts removed cards on the bottom in hand order and draws from the top", () => {
    const s = newMatch();
    const hand = s.seats[0].hand;
    const top = s.seats[0].deck.slice(0, 2);
    const chosen = [hand[7] as string, hand[2] as string];
    const next = act(s, 0, { t: "mull", cards: chosen }).state;
    expect(next.seats[0].hand).toEqual([
      ...hand.filter((id) => !chosen.includes(id)),
      ...top,
    ]);
    expect(next.seats[0].deck.slice(-2)).toEqual([
      hand[2] as string,
      hand[7] as string,
    ]);
    expect(next.seats[0].mull).toBeNull();
    expect(next.phase).toBe("mulligan");
  });

  it("rejects more cards than allowed, duplicates and a second submission", () => {
    const s = newMatch();
    const hand = s.seats[0].hand;
    expect(applyAction(s, 0, { t: "mull", cards: hand.slice(0, 4) }).ok).toBe(false);
    expect(
      applyAction(s, 0, { t: "mull", cards: [hand[0] as string, hand[0] as string] })
        .ok,
    ).toBe(false);
    const done = act(s, 0, { t: "mull", cards: [] }).state;
    expect(applyAction(done, 0, { t: "mull", cards: [] }).ok).toBe(false);
    expect(applyAction(s, 0, { t: "pass" }).ok).toBe(false);
  });

  it("gives Akikaze Tailwind +1 at every step", () => {
    const s = newMatch({
      seats: [
        { leaderId: leaderId(LEADER.aerathiel), deck: FILLER },
        { leaderId: leaderId(LEADER.amir), deck: FILLER },
      ],
    });
    expect(s.seats[0].mull).toBe(4);
    expect(s.seats[1].mull).toBe(3);
  });

  it("applies Masquerade (r1MulliganCap) and Night Parade (extraMulligans for the human)", () => {
    expect(
      newMatch({ rules: { r1MulliganCap: 5 } }).seats.map((seat) => seat.mull),
    ).toEqual([5, 5]);
    expect(
      newMatch({ rules: { extraMulligans: 1 } }).seats.map((seat) => seat.mull),
    ).toEqual([4, 4]);
    expect(
      newMatch({ rules: { extraMulligans: { seat: "human", n: 1 } } }).seats.map(
        (seat) => seat.mull,
      ),
    ).toEqual([4, 3]);
  });

  it("banks a skipped draw at the hand cap and adds it to the next mulligan step", () => {
    const tenCards = Array.from({ length: 10 }, () => MUSASHI);
    const s = scenario({
      round: 1,
      opener: 0,
      p0: { hand: tenCards, deck: [MUSASHI, MUSASHI, MUSASHI, MUSASHI] },
      p1: { hand: [MUSASHI], deck: [MUSASHI, MUSASHI, MUSASHI] },
    });
    const next = passBoth(s);
    expect(next.round).toBe(2);
    expect(next.phase).toBe("mulligan");
    expect(next.seats[0].hand).toHaveLength(10);
    expect(next.seats[0].deck).toHaveLength(4);
    // 1 base + 2 banked from the two skipped Round 2 draws; the bank is spent.
    expect(next.seats[0].mull).toBe(3);
    expect(next.seats[0].banked).toBe(0);
    expect(next.seats[1].mull).toBe(1);
  });

  it("caps banked mulligans at three", () => {
    const s = scenario({
      p0: {
        hand: Array.from({ length: 10 }, () => MUSASHI),
        deck: Array.from({ length: 6 }, () => MUSASHI),
      },
      p1: { hand: [MUSASHI], board: {} },
      knobs: { handCap: 10 },
    });
    s.seats[0].banked = 2;
    const next = passBoth(s);
    // Two Round 2 draws on a full hand, but the bank is capped at three: 1 + 3.
    expect(next.seats[0].mull).toBe(4);
  });
});

describe("turns, passing and round flow", () => {
  it("alternates turns and lets the other player continue after a pass", () => {
    const s = scenario({
      p0: { hand: [MUSASHI, MUSASHI, MUSASHI] },
      p1: { hand: [MUSASHI, MUSASHI, MUSASHI] },
    });
    let state = act(s, 0, { t: "play", card: handCard(s, 0, MUSASHI) }).state;
    expect(state.turn).toBe(1);
    expect(applyAction(state, 0, { t: "pass" }).ok).toBe(false);
    state = act(state, 1, { t: "pass" }).state;
    expect(state.turn).toBe(0);
    state = act(state, 0, { t: "play", card: handCard(state, 0, MUSASHI) }).state;
    expect(state.turn).toBe(0);
    expect(state.seats[1].passed).toBe(true);
  });

  it("auto-passes a player with an empty hand and no leader ability left", () => {
    const s = scenario({ p0: { hand: [MUSASHI, MUSASHI] }, p1: { hand: [] } });
    const result = act(s, 0, { t: "play", card: handCard(s, 0, MUSASHI) });
    expect(result.events).toContainEqual({ t: "passed", seat: 1, auto: true });
    expect(result.state.turn).toBe(0);
    const withLeader = scenario({
      p0: { hand: [MUSASHI, MUSASHI] },
      p1: { hand: [], leader: LEADER.hisame },
    });
    expect(
      act(withLeader, 0, { t: "play", card: handCard(withLeader, 0, MUSASHI) }).state
        .turn,
    ).toBe(1);
  });

  it("scores displayed power, extinguishes the loser's lantern and lets the winner open", () => {
    const s = scenario({
      opener: 0,
      p0: {
        hand: [MUSASHI],
        board: { CLOSE: [MUSASHI] },
        deck: [MUSASHI, MUSASHI, MUSASHI],
      },
      p1: {
        hand: [MUSASHI],
        board: { CLOSE: ["Enrai no Oni"] },
        deck: [MUSASHI, MUSASHI, MUSASHI],
      },
    });
    const result = act(act(s, 0, { t: "pass" }).state, 1, { t: "pass" });
    expect(result.events).toContainEqual(
      expect.objectContaining({
        t: "roundEnd",
        round: 1,
        totals: [7, 6],
        winner: 0,
        lanterns: [2, 1],
      }),
    );
    const next = result.state;
    expect(next.round).toBe(2);
    expect(next.opener).toBe(0);
    // Round 2 draws 2, opener first.
    expect(next.seats[0].hand).toHaveLength(3);
    expect(next.seats[1].hand).toHaveLength(3);
    const drawn = result.events.filter((event) => event.t === "drawn");
    expect(drawn.map((event) => (event.t === "drawn" ? event.seat : -1))).toEqual([
      0, 1,
    ]);
  });

  it("on a tie both lose a lantern and the player who did not open the tied round opens", () => {
    const s = scenario({
      opener: 0,
      p0: { hand: [MUSASHI], board: { CLOSE: [MUSASHI] }, deck: [MUSASHI] },
      p1: { hand: [MUSASHI], board: { CLOSE: [MUSASHI] }, deck: [MUSASHI] },
    });
    const next = passBoth(s);
    expect(next.seats.map((seat) => seat.lanterns)).toEqual([1, 1]);
    expect(next.history[0]).toEqual({
      round: 1,
      totals: [7, 7],
      winner: null,
      riggedOdds: false,
    });
    expect(next.opener).toBe(1);
  });

  it("ends in a draw when a tie extinguishes both last lanterns", () => {
    const s = scenario({
      round: 2,
      p0: { hand: [MUSASHI], lanterns: 1 },
      p1: { hand: [MUSASHI], lanterns: 1 },
    });
    const result = act(act(s, 0, { t: "pass" }).state, 1, { t: "pass" });
    expect(result.state.phase).toBe("over");
    expect(result.state.result).toEqual({ winner: null });
    expect(result.events.at(-1)).toEqual({ t: "matchEnd", winner: null });
    expect(applyAction(result.state, 0, { t: "pass" }).ok).toBe(false);
    expect(legalActions(result.state, 0)).toEqual([]);
  });

  it("names the match winner when a lantern runs out and keeps the final board", () => {
    const s = scenario({
      round: 3,
      p0: { hand: [MUSASHI], lanterns: 1, board: { CLOSE: [MUSASHI] } },
      p1: { hand: [MUSASHI], lanterns: 1 },
    });
    const done = passBoth(s);
    expect(done.result).toEqual({ winner: 0 });
    expect(done.board[0].CLOSE).toHaveLength(1);
  });

  it("draws one card at the start of Round 3", () => {
    const s = scenario({
      round: 2,
      opener: 1,
      p0: { hand: [MUSASHI], lanterns: 1, deck: [MUSASHI, MUSASHI] },
      p1: { hand: [MUSASHI], lanterns: 2, deck: [MUSASHI, MUSASHI], board: {} },
    });
    s.board[0].CLOSE.push({
      id: "s0-90",
      owner: 0,
      stored: 5,
      sealed: false,
      med: 0,
      res: false,
      seq: 1,
    });
    s.inst["s0-90"] = cid(MUSASHI);
    const next = passBoth(s);
    expect(next.round).toBe(3);
    expect(next.opener).toBe(0);
    expect(next.seats[0].hand).toHaveLength(2);
    expect(next.seats[1].hand).toHaveLength(2);
  });

  it("never mutates the input state", () => {
    const s = scenario({
      p0: { hand: ["Fireball"] },
      p1: { hand: [MUSASHI], board: { CLOSE: [MUSASHI] } },
    });
    const before = JSON.stringify(s);
    act(s, 0, {
      t: "play",
      card: handCard(s, 0, "Fireball"),
      targets: [unitAt(s, 1, "CLOSE")],
    });
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("cleanup", () => {
  it("keeps unsealed Resilient units once and discards the rest to their owners", () => {
    const s = scenario({
      p0: {
        hand: [MUSASHI],
        deck: [MUSASHI, MUSASHI],
        board: {
          CLOSE: [
            { name: "Mummy of the Shining Dunes", stored: 9 },
            { name: "Moon Shrine Guardian", sealed: true },
          ],
          RANGED: [{ name: "Gale Courier", owner: 1 }],
        },
      },
      p1: {
        hand: [MUSASHI],
        deck: [MUSASHI, MUSASHI],
        board: { CLOSE: ["Sand Golem", "Colossus", "Kuzenbo, the Mountain God"] },
      },
    });
    const mummy = unitAt(s, 0, "CLOSE", 0);
    const guardian = unitAt(s, 0, "CLOSE", 1);
    const courier = unitAt(s, 0, "RANGED", 0);
    const result = act(act(s, 0, { t: "pass" }).state, 1, { t: "pass" });
    const next = result.state;
    expect(next.board[0].CLOSE.map((unit) => unit.id)).toEqual([mummy]);
    expect(next.board[0].CLOSE[0]).toMatchObject({ stored: 9, res: false });
    expect(next.seats[0].discard).toContain(guardian);
    // The Infiltrator returns to the discard of the player who played it.
    expect(next.seats[1].discard).toContain(courier);
    expect(next.seats[0].discard).not.toContain(courier);
    expect(next.board[1].CLOSE).toHaveLength(0);
    expect(next.round).toBe(2);
    // A second round end (Round 2 won by seat 0, so Round 3 follows) discards it.
    const later = passBoth(keepBoth(next));
    expect(later.seats[0].discard).toContain(mummy);
  });

  it("never carries Unyielding units, Infiltrators or tokens, and clears Terrain", () => {
    const s = scenario({
      p0: {
        hand: [MUSASHI],
        deck: [MUSASHI],
        board: {
          CLOSE: [{ name: "Sand Golem", res: true }],
          JUTSU: [{ name: "Gale Courier", owner: 1, res: true }],
        },
      },
      p1: { hand: [MUSASHI], deck: [MUSASHI] },
    });
    s.terrain[0].CLOSE = true;
    s.terrain[1].RANGED = true;
    s.inst["t-1"] = TOKEN_CARD_ID;
    s.tokens = 1;
    s.board[1].RANGED.push({
      id: "t-1",
      owner: 1,
      stored: 3,
      sealed: false,
      med: 0,
      res: true,
      seq: 9,
    });
    s.inst["t-2"] = TOKEN_CARD_ID;
    s.seats[1].hand.push("t-2");
    const result = act(act(s, 0, { t: "pass" }).state, 1, { t: "pass" });
    const next = result.state;
    expect(next.board[0].CLOSE).toHaveLength(0);
    expect(next.board[0].JUTSU).toHaveLength(0);
    expect(next.board[1].RANGED).toHaveLength(0);
    expect(next.seats[1].hand).not.toContain("t-2");
    expect(next.seats[1].discard).not.toContain("t-1");
    expect(next.terrain).toEqual([
      { CLOSE: false, RANGED: false, JUTSU: false },
      { CLOSE: false, RANGED: false, JUTSU: false },
    ]);
    const cleanup = result.events.find((event) => event.t === "cleanup");
    expect(cleanup).toMatchObject({ banished: ["t-1", "t-2"] });
  });

  it("Evergreen keeps the most recently placed own unit, reset to printed power", () => {
    const s = scenario({
      knobs: { evergreen: true },
      p0: {
        leader: LEADER.junko,
        hand: [MUSASHI],
        deck: [MUSASHI, MUSASHI, MUSASHI, MUSASHI],
        board: {
          CLOSE: [MUSASHI, { name: "Mosswolf", stored: 7, med: 4 }],
          RANGED: [{ name: "Gale Courier", owner: 1 }],
        },
      },
      p1: { hand: [MUSASHI], deck: [MUSASHI, MUSASHI] },
    });
    const mosswolf = unitAt(s, 0, "CLOSE", 1);
    s.board[0].RANGED[0]!.seq = 99;
    const next = passBoth(s);
    expect(next.phase).toBe("mulligan");
    expect(next.board[0].CLOSE).toHaveLength(1);
    expect(next.board[0].CLOSE[0]).toMatchObject({ id: mosswolf, stored: 3, med: 0 });
  });

  it("Evergreen skips sealed and Unyielding units, stays beside a Resilient unit and is off after Round 2", () => {
    const s = scenario({
      knobs: { evergreen: true },
      p0: {
        leader: LEADER.junko,
        hand: [MUSASHI],
        deck: [MUSASHI, MUSASHI],
        board: {
          CLOSE: [
            "Mummy of the Shining Dunes",
            MUSASHI,
            { name: "Cryverin", sealed: true },
            "Sand Golem",
          ],
        },
      },
      p1: { hand: [MUSASHI], deck: [MUSASHI, MUSASHI] },
    });
    const [mummy, musashi] = s.board[0].CLOSE.map((unit) => unit.id);
    const next = passBoth(s);
    expect(next.board[0].CLOSE.map((unit) => unit.id)).toEqual([
      mummy as string,
      musashi as string,
    ]);

    const roundThree = scenario({
      knobs: { evergreen: true },
      round: 2,
      p0: {
        leader: LEADER.junko,
        hand: [MUSASHI],
        lanterns: 1,
        board: { CLOSE: [MUSASHI, MUSASHI] },
      },
      p1: { hand: [MUSASHI], lanterns: 2 },
    });
    // Round 2 end keeps one; there is no Evergreen at the end of Round 3.
    expect(passBoth(roundThree).board[0].CLOSE).toHaveLength(1);
    const final = scenario({
      knobs: { evergreen: true },
      round: 3,
      p0: {
        leader: LEADER.junko,
        hand: [MUSASHI],
        lanterns: 1,
        board: { CLOSE: [MUSASHI] },
      },
      p1: { hand: [MUSASHI], lanterns: 1, board: { CLOSE: [MUSASHI] } },
    });
    expect(passBoth(final).result).toEqual({ winner: null });
  });
});

describe("power model", () => {
  it("adds Rally from other unsealed units in the row; a sealed unit still receives it", () => {
    const s = scenario({
      p0: {
        board: {
          JUTSU: ["Taiyo Kami Devotee", "Lemu, Academy Instructor", "Tsukihana"],
          CLOSE: [MUSASHI],
        },
      },
    });
    const [taiyo, lemu, tsukihana] = s.board[0].JUTSU.map((unit) => unit.id) as [
      string,
      string,
      string,
    ];
    expect([power(s, taiyo), power(s, lemu), power(s, tsukihana)]).toEqual([4, 5, 5]);
    expect(power(s, unitAt(s, 0, "CLOSE"))).toBe(7);
    s.board[0].JUTSU[1]!.sealed = true;
    expect([power(s, taiyo), power(s, lemu), power(s, tsukihana)]).toEqual([3, 5, 4]);
  });

  it("caps Bond at +4 and a sealed unit neither gives nor receives it", () => {
    const s = scenario({
      p0: {
        board: {
          CLOSE: ["Moonprowler", "Moonprowler", "Moonprowler"],
          RANGED: ["Owlcat"],
        },
      },
    });
    const ids = [...s.board[0].CLOSE, ...s.board[0].RANGED].map((unit) => unit.id);
    expect(ids.map((id) => power(s, id))).toEqual([7, 7, 7, 7]);
    s.board[0].CLOSE[0]!.sealed = true;
    expect(ids.map((id) => power(s, id))).toEqual([3, 7, 7, 7]);
    s.board[0].CLOSE[1]!.sealed = true;
    expect(ids.map((id) => power(s, id))).toEqual([3, 3, 5, 5]);
  });

  it("Terrain shows -2 with a minimum of 1, after auras, and skips Unyielding", () => {
    const s = scenario({
      p0: {
        board: {
          CLOSE: [
            MUSASHI,
            { name: "Cryverin", stored: 2 },
            { name: "Cryverin", stored: 1 },
            "Sand Golem",
          ],
          JUTSU: ["Taiyo Kami Devotee", "Tsukihana"],
        },
      },
    });
    s.terrain[0].CLOSE = true;
    s.terrain[0].JUTSU = true;
    const close = s.board[0].CLOSE.map((unit) => unit.id);
    expect(close.map((id) => power(s, id))).toEqual([5, 1, 1, 7]);
    expect(s.board[0].JUTSU.map((unit) => power(s, unit.id))).toEqual([1, 2]);
    expect(boardTotals(s)).toEqual([17, 0]);
    // The other side's row is not afflicted.
    s.terrain[0].CLOSE = false;
    expect(power(s, close[0] as string)).toBe(7);
  });
});

describe("keywords", () => {
  it("Strike reduces stored, destroys at 0 and hits Unyielding units", () => {
    const s = scenario({
      p0: { hand: ["Fireball", "Thorn Grasp"] },
      p1: {
        hand: [MUSASHI],
        board: {
          CLOSE: [MUSASHI, "Kuzenbo, the Mountain God"],
          JUTSU: ["Taiyo Kami Devotee"],
        },
      },
    });
    const musashi = unitAt(s, 1, "CLOSE", 0);
    const kuzenbo = unitAt(s, 1, "CLOSE", 1);
    const fireball = handCard(s, 0, "Fireball");
    const after = act(s, 0, { t: "play", card: fireball, targets: [kuzenbo] }).state;
    expect(stored(after, kuzenbo)).toBe(6);
    expect(after.seats[0].discard).toEqual([fireball]);
    const kill = act(s, 0, {
      t: "play",
      card: handCard(s, 0, "Thorn Grasp"),
      targets: [unitAt(s, 1, "JUTSU")],
    });
    expect(kill.events).toContainEqual(
      expect.objectContaining({ t: "destroyed", cause: "strike", owner: 1 }),
    );
    expect(kill.state.seats[1].discard).toEqual([unitAt(s, 1, "JUTSU")]);
    expect(stored(kill.state, musashi)).toBe(7);
  });

  it("Strike fizzles with no target and the card is still played", () => {
    const s = scenario({ p0: { hand: ["Fireball"] }, p1: { hand: [MUSASHI] } });
    const result = act(s, 0, { t: "play", card: handCard(s, 0, "Fireball") });
    expect(result.events).toContainEqual({
      t: "fizzled",
      ability: "strike",
      source: handCard(s, 0, "Fireball"),
    });
    expect(result.state.seats[0].discard).toHaveLength(1);
  });

  it("a second Strike cannot target a unit the first destroyed", () => {
    const s = scenario({
      p0: { hand: ["Fist of 10,000 Volts"] },
      p1: {
        hand: [MUSASHI],
        board: { CLOSE: [MUSASHI], JUTSU: ["Taiyo Kami Devotee"] },
      },
    });
    const fist = handCard(s, 0, "Fist of 10,000 Volts");
    const taiyo = unitAt(s, 1, "JUTSU");
    const musashi = unitAt(s, 1, "CLOSE");
    expect(
      applyAction(s, 0, { t: "play", card: fist, targets: [taiyo, taiyo] }).ok,
    ).toBe(false);
    const ok = act(s, 0, { t: "play", card: fist, targets: [taiyo, musashi] }).state;
    expect(stored(ok, musashi)).toBe(5);
    const same = act(s, 0, {
      t: "play",
      card: fist,
      targets: [musashi, musashi],
    }).state;
    expect(stored(same, musashi)).toBe(2);
    const status = targetOptions(s, 0, { t: "play", card: fist, targets: [taiyo] });
    expect(status).toEqual({
      status: "need",
      request: {
        kind: "enemyUnit",
        options: [musashi],
        optional: false,
        ability: "strike",
        source: fist,
      },
    });
  });

  it("may Strike your own Infiltrator on the enemy side", () => {
    const s = scenario({
      p0: { hand: ["Fireball"] },
      p1: { hand: [MUSASHI], board: { RANGED: [{ name: "Gale Courier", owner: 0 }] } },
    });
    const courier = unitAt(s, 1, "RANGED");
    const next = act(s, 0, {
      t: "play",
      card: handCard(s, 0, "Fireball"),
      targets: [courier],
    }).state;
    expect(stored(next, courier)).toBe(1);
    const thorn = scenario({
      p0: { hand: ["Thorn Grasp"] },
      p1: {
        hand: [MUSASHI],
        board: { RANGED: [{ name: "Gale Courier", owner: 0, stored: 3 }] },
      },
    });
    const killed = act(thorn, 0, {
      t: "play",
      card: handCard(thorn, 0, "Thorn Grasp"),
      targets: [unitAt(thorn, 1, "RANGED")],
    }).state;
    expect(killed.seats[0].discard).toContain(unitAt(thorn, 1, "RANGED"));
  });

  it("row Strikes hit every enemy unit in scope at once", () => {
    const s = scenario({
      p0: {
        hand: [
          "Leviathan of the Shroud",
          "Thousand Scarlet Fangs",
          "Raizhen, the Ten-Tailed",
        ],
      },
      p1: {
        hand: [MUSASHI],
        board: {
          CLOSE: [MUSASHI, { name: "Cryverin", stored: 2 }],
          RANGED: ["Owlcat"],
          JUTSU: ["Kuzenbo, the Mountain God"],
        },
      },
    });
    const [musashi, cryverin] = s.board[1].CLOSE.map((unit) => unit.id) as [
      string,
      string,
    ];
    const owlcat = unitAt(s, 1, "RANGED");
    const kuzenbo = unitAt(s, 1, "JUTSU");
    const leviathan = act(s, 0, {
      t: "play",
      card: handCard(s, 0, "Leviathan of the Shroud"),
    }).state;
    expect(stored(leviathan, musashi)).toBe(5);
    expect(stored(leviathan, cryverin)).toBeNull();
    expect(stored(leviathan, owlcat)).toBe(3);
    const fangs = act(s, 0, {
      t: "play",
      card: handCard(s, 0, "Thousand Scarlet Fangs"),
      targets: ["RANGED"],
    }).state;
    expect(stored(fangs, owlcat)).toBe(1);
    expect(stored(fangs, musashi)).toBe(7);
    const raizhen = act(s, 0, {
      t: "play",
      card: handCard(s, 0, "Raizhen, the Ten-Tailed"),
    }).state;
    expect(
      [musashi, cryverin, owlcat, kuzenbo].map((id) => stored(raizhen, id)),
    ).toEqual([6, 1, 2, 10]);
  });

  it("Empower targets another own unit, never itself, and fizzles alone", () => {
    const s = scenario({
      p0: { hand: ["Blazing Flash Adept"], board: { CLOSE: [MUSASHI] } },
      p1: { hand: [MUSASHI] },
    });
    const adept = handCard(s, 0, "Blazing Flash Adept");
    expect(applyAction(s, 0, { t: "play", card: adept, targets: [adept] }).ok).toBe(
      false,
    );
    const next = act(s, 0, {
      t: "play",
      card: adept,
      targets: [unitAt(s, 0, "CLOSE")],
    }).state;
    expect(stored(next, unitAt(s, 0, "CLOSE"))).toBe(10);
    const alone = scenario({
      p0: { hand: ["Blazing Flash Adept"] },
      p1: { hand: [MUSASHI] },
    });
    const result = act(alone, 0, {
      t: "play",
      card: handCard(alone, 0, "Blazing Flash Adept"),
    });
    expect(result.events).toContainEqual(
      expect.objectContaining({ t: "fizzled", ability: "empower" }),
    );
  });

  it("row Empowers: its row, a chosen row (tactics need a unit there)", () => {
    const s = scenario({
      p0: {
        hand: ["Yamabiko Echo-Caller", "Amaterasu's Holy Mirror"],
        board: { RANGED: ["Owlcat", "Owlcat"], CLOSE: [MUSASHI] },
      },
      p1: { hand: [MUSASHI], board: { RANGED: ["Owlcat"] } },
    });
    const echo = act(s, 0, {
      t: "play",
      card: handCard(s, 0, "Yamabiko Echo-Caller"),
    }).state;
    expect(echo.board[0].RANGED.map((unit) => unit.stored)).toEqual([5, 5, 4]);
    expect(echo.board[1].RANGED[0]?.stored).toBe(3);
    const mirror = handCard(s, 0, "Amaterasu's Holy Mirror");
    expect(applyAction(s, 0, { t: "play", card: mirror, targets: ["JUTSU"] })).toEqual({
      ok: false,
      reason: "Invalid target for empower",
    });
    const pumped = act(s, 0, { t: "play", card: mirror, targets: ["RANGED"] }).state;
    expect(pumped.board[0].RANGED.map((unit) => unit.stored)).toEqual([6, 6]);
    const empty = scenario({
      p0: { hand: ["Amaterasu's Holy Mirror"] },
      p1: { hand: [MUSASHI] },
    });
    expect(
      targetOptions(empty, 0, {
        t: "play",
        card: handCard(empty, 0, "Amaterasu's Holy Mirror"),
      }),
    ).toEqual({
      status: "illegal",
      reason: "Needs one of your units in the chosen row",
    });
  });

  it("Meditate grows at the start of its side's turns up to +6, not while sealed or after passing", () => {
    const s = scenario({
      p0: {
        hand: [MUSASHI, MUSASHI, MUSASHI],
        board: {
          CLOSE: [
            "Mosswolf",
            { name: "Ava, the Snow Terror", med: 5 },
            { name: "Wood Warrior", sealed: true },
          ],
        },
      },
      p1: { hand: [MUSASHI, MUSASHI, MUSASHI, MUSASHI] },
    });
    const [moss, ava, wood] = s.board[0].CLOSE.map((unit) => unit.id) as [
      string,
      string,
      string,
    ];
    let state = act(s, 0, { t: "play", card: handCard(s, 0, MUSASHI) }).state;
    const reply = act(state, 1, { t: "play", card: handCard(state, 1, MUSASHI) });
    state = reply.state;
    expect(reply.events).toContainEqual({
      t: "boosted",
      id: moss,
      amount: 1,
      stored: 4,
      source: moss,
      cause: "meditate",
    });
    expect([stored(state, moss), stored(state, ava), stored(state, wood)]).toEqual([
      4, 5, 5,
    ]);
    expect(state.board[0].CLOSE[1]?.med).toBe(6);
    state = act(state, 0, { t: "play", card: handCard(state, 0, MUSASHI) }).state;
    state = act(state, 1, { t: "play", card: handCard(state, 1, MUSASHI) }).state;
    expect([stored(state, moss), stored(state, ava)]).toEqual([5, 5]);
    state = act(state, 0, { t: "pass" }).state;
    state = act(state, 1, { t: "play", card: handCard(state, 1, MUSASHI) }).state;
    expect(stored(state, moss)).toBe(5);
  });

  it("Summon deploys the top-most group member without its Deploy and never pulls from hand", () => {
    const s = scenario({
      p0: {
        hand: ["Beta Sandworm", "Beta Sandworm"],
        deck: [MUSASHI, "Gamma Sandworm", "Beta Sandworm"],
      },
      p1: { hand: [MUSASHI] },
    });
    const result = act(s, 0, { t: "play", card: handCard(s, 0, "Beta Sandworm") });
    const next = result.state;
    expect(next.board[0].CLOSE.map((unit) => next.inst[unit.id])).toEqual([
      cid("Beta Sandworm"),
      cid("Gamma Sandworm"),
    ]);
    expect(next.seats[0].deck.map((id) => next.inst[id])).toEqual([
      cid(MUSASHI),
      cid("Beta Sandworm"),
    ]);
    expect(result.events).toContainEqual(
      expect.objectContaining({ t: "placed", source: "summon", row: "CLOSE" }),
    );
    const empty = scenario({
      p0: { hand: ["Beta Sandworm", "Beta Sandworm"], deck: [MUSASHI] },
      p1: { hand: [MUSASHI] },
    });
    const fizzled = act(empty, 0, {
      t: "play",
      card: handCard(empty, 0, "Beta Sandworm"),
    });
    expect(fizzled.events).toContainEqual(
      expect.objectContaining({ t: "fizzled", ability: "summon" }),
    );
    expect(fizzled.state.seats[0].hand).toHaveLength(1);
  });

  it("Summon skips members whose row is full and keeps searching", () => {
    const s = scenario({
      p0: {
        hand: ["Ghost Ship Gunner"],
        deck: ["Ghost Ship Deckhand", "Ghost Ship Gunner"],
        board: { CLOSE: [MUSASHI, MUSASHI, MUSASHI, MUSASHI, MUSASHI] },
      },
      p1: { hand: [MUSASHI] },
    });
    const next = act(s, 0, {
      t: "play",
      card: handCard(s, 0, "Ghost Ship Gunner"),
    }).state;
    expect(next.board[0].RANGED).toHaveLength(2);
    expect(next.seats[0].deck.map((id) => next.inst[id])).toEqual([
      cid("Ghost Ship Deckhand"),
    ]);
  });

  it("Summon puts an Any-row member into the summoner's row", () => {
    const s = scenario({
      p0: { hand: ["Ghost Ship Gunner"] },
      p1: { hand: [MUSASHI] },
    });
    const sailor: KessenCard = {
      ...CATALOG[cid("Arashima Stormcaller")]!,
      id: "test-any-crew",
      summonGroups: ["Crew"],
    };
    s.cards = { ...s.cards, [sailor.id]: sailor };
    s.inst["s0-50"] = sailor.id;
    s.seats[0].deck = ["s0-50"];
    const next = act(s, 0, {
      t: "play",
      card: handCard(s, 0, "Ghost Ship Gunner"),
    }).state;
    expect(next.board[0].RANGED.map((unit) => unit.id)).toContain("s0-50");
  });

  it("Infiltrator joins the enemy side, counts for them and draws 1", () => {
    const s = scenario({
      p0: { hand: ["Gale Courier"], deck: [MUSASHI, "Cryverin"] },
      p1: { hand: [MUSASHI] },
    });
    const courier = handCard(s, 0, "Gale Courier");
    expect(
      rowOptions(s, 0, courier).map((option) => [
        option.row,
        option.side,
        option.legal,
      ]),
    ).toEqual([
      ["CLOSE", 1, true],
      ["RANGED", 1, true],
      ["JUTSU", 1, true],
    ]);
    const next = act(s, 0, { t: "play", card: courier, row: "JUTSU" }).state;
    expect(next.board[1].JUTSU.map((unit) => [unit.id, unit.owner])).toEqual([
      [courier, 0],
    ]);
    expect(boardTotals(next)).toEqual([0, 6]);
    expect(next.seats[0].hand.map((id) => next.inst[id])).toEqual([cid(MUSASHI)]);
    expect(applyAction(s, 0, { t: "play", card: courier })).toEqual({
      ok: false,
      reason: "Choose a row",
    });
  });

  it("Infiltrator is unplayable into a full enemy row and draws respect the hand cap", () => {
    const s = scenario({
      p0: {
        hand: ["Oblivion Seal Bearer", ...Array.from({ length: 9 }, () => MUSASHI)],
        deck: [MUSASHI],
      },
      p1: {
        hand: [MUSASHI],
        board: { CLOSE: [MUSASHI, MUSASHI, MUSASHI, MUSASHI, MUSASHI] },
      },
    });
    const bearer = handCard(s, 0, "Oblivion Seal Bearer");
    expect(applyAction(s, 0, { t: "play", card: bearer })).toEqual({
      ok: false,
      reason: "Row full",
    });
    expect(rowOptions(s, 0, bearer)).toEqual([
      { row: "CLOSE", side: 1, legal: false, reason: "Row full" },
    ]);
    s.board[1].CLOSE.pop();
    // 9 cards after playing; the draw fits.
    expect(act(s, 0, { t: "play", card: bearer }).state.seats[0].hand).toHaveLength(10);
  });

  it("the Caged Sovereign seals each other unit in the enemy row it joins", () => {
    const s = scenario({
      p0: { hand: ["The Caged Sovereign"], deck: [MUSASHI] },
      p1: {
        hand: [MUSASHI],
        board: { RANGED: ["Owlcat", "Aurex, the Imperial Wyrm"], CLOSE: [MUSASHI] },
      },
    });
    const next = act(s, 0, {
      t: "play",
      card: handCard(s, 0, "The Caged Sovereign"),
      row: "RANGED",
    }).state;
    expect(next.board[1].RANGED.map((unit) => unit.sealed)).toEqual([
      true,
      false,
      false,
    ]);
    expect(next.board[1].CLOSE[0]?.sealed).toBe(false);
  });

  it("Revive deploys an eligible discard unit and triggers its Deploy", () => {
    const s = scenario({
      p0: {
        hand: ["Furuki no Seirei"],
        discard: [
          "Sand Golem",
          "Gale Courier",
          "The Salvager",
          "Frozen Wraith",
          "Kajioka",
        ],
      },
      p1: { hand: [MUSASHI], board: { CLOSE: [MUSASHI] } },
    });
    const furuki = handCard(s, 0, "Furuki no Seirei");
    const [, , , wraith, kajioka] = s.seats[0].discard as [
      string,
      string,
      string,
      string,
      string,
    ];
    const status = targetOptions(s, 0, { t: "play", card: furuki });
    expect(status).toEqual({
      status: "need",
      request: {
        kind: "discard",
        options: [wraith, kajioka],
        optional: false,
        ability: "revive",
        source: furuki,
      },
    });
    const target = unitAt(s, 1, "CLOSE");
    const result = act(s, 0, { t: "play", card: furuki, targets: [wraith, target] });
    expect(result.state.board[0].RANGED.map((unit) => unit.id)).toEqual([wraith]);
    expect(stored(result.state, target)).toBe(5);
    expect(result.events).toContainEqual(
      expect.objectContaining({ t: "placed", id: wraith, source: "revive" }),
    );
    const anyRow = targetOptions(s, 0, { t: "play", card: furuki, targets: [kajioka] });
    expect(anyRow).toMatchObject({
      status: "need",
      request: { kind: "ownRow", options: ["CLOSE", "RANGED", "JUTSU"] },
    });
    const placed = act(s, 0, {
      t: "play",
      card: furuki,
      targets: [kajioka, "CLOSE"],
    }).state;
    expect(placed.board[0].CLOSE.map((unit) => unit.id)).toEqual([kajioka]);
  });

  it("Revive fizzles with no eligible card", () => {
    const s = scenario({
      p0: { hand: ["Furuki no Seirei"], discard: ["Sand Golem"] },
      p1: { hand: [MUSASHI] },
    });
    const result = act(s, 0, { t: "play", card: handCard(s, 0, "Furuki no Seirei") });
    expect(result.events).toContainEqual(
      expect.objectContaining({ t: "fizzled", ability: "revive" }),
    );
  });

  it("Substitution returns an own, owned, non-Unyielding unit to hand at printed state", () => {
    const s = scenario({
      p0: {
        hand: ["Kawarimi", "Cryverin"],
        board: {
          CLOSE: [{ name: MUSASHI, stored: 11 }, "Sand Golem"],
          RANGED: [{ name: "Gale Courier", owner: 1 }],
        },
      },
      p1: { hand: [MUSASHI] },
    });
    const kawarimi = handCard(s, 0, "Kawarimi");
    const musashi = unitAt(s, 0, "CLOSE");
    expect(targetOptions(s, 0, { t: "play", card: kawarimi })).toMatchObject({
      status: "need",
      request: { kind: "ownUnit", options: [musashi] },
    });
    const next = act(s, 0, { t: "play", card: kawarimi, targets: [musashi] }).state;
    expect(next.seats[0].hand.at(-1)).toBe(musashi);
    expect(stored(next, musashi)).toBeNull();
    const replay = act(
      { ...next, turn: 0, seats: [next.seats[0], { ...next.seats[1], passed: true }] },
      0,
      {
        t: "play",
        card: musashi,
      },
    ).state;
    expect(stored(replay, musashi)).toBe(7);
  });

  it("Resilient can be granted by Lotus Barrier to a non-Unyielding own unit", () => {
    const s = scenario({
      p0: {
        hand: ["Lotus Barrier", MUSASHI],
        deck: [MUSASHI],
        board: {
          CLOSE: [MUSASHI, "Sand Golem"],
          RANGED: [{ name: "Gale Courier", owner: 1 }],
        },
      },
      p1: { hand: [MUSASHI], deck: [MUSASHI] },
    });
    const lotus = handCard(s, 0, "Lotus Barrier");
    const musashi = unitAt(s, 0, "CLOSE");
    expect(targetOptions(s, 0, { t: "play", card: lotus })).toMatchObject({
      request: { options: [musashi] },
    });
    let state = act(s, 0, { t: "play", card: lotus, targets: [musashi] }).state;
    state = passBoth(state);
    expect(state.board[0].CLOSE.map((unit) => unit.id)).toEqual([musashi]);
  });

  it("Purge kills the strongest non-Unyielding unit of a row totalling 10+, ties to the most recent", () => {
    const s = scenario({
      p0: { hand: ["Demon of Tsuki", "Typhoon Tear"] },
      p1: {
        hand: [MUSASHI],
        board: {
          RANGED: [
            { name: "Byakuho" },
            { name: "Owlcat", stored: 5 },
            "Aurex, the Imperial Wyrm",
          ],
          CLOSE: [MUSASHI],
        },
      },
    });
    const [, owlcat] = s.board[1].RANGED.map((unit) => unit.id);
    const result = act(s, 0, { t: "play", card: handCard(s, 0, "Demon of Tsuki") });
    expect(result.events).toContainEqual(
      expect.objectContaining({ t: "destroyed", id: owlcat, cause: "purge" }),
    );
    expect(result.state.board[1].RANGED).toHaveLength(2);
    const below = act(s, 0, {
      t: "play",
      card: handCard(s, 0, "Typhoon Tear"),
      targets: ["CLOSE"],
    });
    expect(below.events).toContainEqual(
      expect.objectContaining({ t: "fizzled", ability: "purge" }),
    );
  });

  it("Purge each enemy row picks every target from the pre-Purge board and never touches its side", () => {
    const s = scenario({
      p0: { hand: ["Cruel Sun"], board: { CLOSE: [MUSASHI, MUSASHI] } },
      p1: {
        hand: [MUSASHI],
        board: {
          CLOSE: [MUSASHI, { name: "Enrai no Oni" }],
          RANGED: [{ name: "Owlcat" }, { name: "Byakuho" }, "Mei Cutpurse"],
          JUTSU: ["Kuzenbo, the Mountain God"],
        },
      },
    });
    const next = act(s, 0, { t: "play", card: handCard(s, 0, "Cruel Sun") }).state;
    expect(next.board[1].CLOSE.map((unit) => next.inst[unit.id])).toEqual([
      cid("Enrai no Oni"),
    ]);
    expect(next.board[1].RANGED.map((unit) => next.inst[unit.id])).toEqual([
      cid("Owlcat"),
      cid("Mei Cutpurse"),
    ]);
    expect(next.board[1].JUTSU).toHaveLength(1);
    expect(next.board[0].CLOSE).toHaveLength(2);
  });

  it("Terrain afflicts both sides, is illegal on a tactic when nothing is new and fizzles on a unit", () => {
    const s = scenario({
      p0: { hand: ["Biting Frost", "Shimo no Seirei"], board: { CLOSE: [MUSASHI] } },
      p1: { hand: [MUSASHI], board: { CLOSE: [MUSASHI] } },
    });
    const next = act(s, 0, { t: "play", card: handCard(s, 0, "Biting Frost") }).state;
    expect([next.terrain[0].CLOSE, next.terrain[1].CLOSE]).toEqual([true, true]);
    expect(boardTotals(next)).toEqual([5, 5]);
    const again = scenario({
      p0: { hand: ["Biting Frost", "Shimo no Seirei"] },
      p1: { hand: [MUSASHI] },
    });
    again.terrain[0].CLOSE = true;
    again.terrain[1].CLOSE = true;
    expect(
      applyAction(again, 0, { t: "play", card: handCard(again, 0, "Biting Frost") }),
    ).toEqual({
      ok: false,
      reason: "Terrain would afflict nothing new",
    });
    const unit = act(again, 0, {
      t: "play",
      card: handCard(again, 0, "Shimo no Seirei"),
    });
    expect(unit.events).toContainEqual(
      expect.objectContaining({ t: "fizzled", ability: "terrain" }),
    );
  });

  it("Terrain on the enemy row with the most units breaks ties Taijutsu first", () => {
    const s = scenario({
      p0: { hand: ["Kuraokami, Kami of the Night Snow"] },
      p1: { hand: [MUSASHI], board: { RANGED: [MUSASHI], JUTSU: [MUSASHI] } },
    });
    const next = act(s, 0, {
      t: "play",
      card: handCard(s, 0, "Kuraokami, Kami of the Night Snow"),
    }).state;
    expect(next.terrain[1]).toEqual({ CLOSE: false, RANGED: true, JUTSU: false });
    expect(next.terrain[0].RANGED).toBe(true);
    const empty = scenario({
      p0: { hand: ["Kuraokami, Kami of the Night Snow"] },
      p1: { hand: [MUSASHI] },
    });
    expect(
      act(empty, 0, {
        t: "play",
        card: handCard(empty, 0, "Kuraokami, Kami of the Night Snow"),
      }).state.terrain[1].CLOSE,
    ).toBe(true);
  });

  it("Clear Skies removes all Terrain and is playable without any", () => {
    const s = scenario({
      p0: { hand: ["Seal of Nullification", "Kugatsunagi"] },
      p1: { hand: [MUSASHI] },
    });
    s.terrain[0].CLOSE = true;
    s.terrain[1].JUTSU = true;
    const cleared = act(s, 0, {
      t: "play",
      card: handCard(s, 0, "Seal of Nullification"),
    });
    expect(cleared.state.terrain[0].CLOSE || cleared.state.terrain[1].JUTSU).toBe(
      false,
    );
    expect(cleared.events.filter((event) => event.t === "terrain")).toHaveLength(2);
    const fresh = scenario({
      p0: { hand: ["Seal of Nullification"] },
      p1: { hand: [MUSASHI] },
    });
    expect(
      applyAction(fresh, 0, {
        t: "play",
        card: handCard(fresh, 0, "Seal of Nullification"),
      }).ok,
    ).toBe(true);
  });

  it("Seal strips Rally, Bond, Meditate and Resilient, keeps stored and cannot touch Unyielding", () => {
    const s = scenario({
      p0: {
        hand: ["Hyouga Yui Clansman"],
        board: { CLOSE: [{ name: MUSASHI, stored: 9 }] },
      },
      p1: {
        hand: [MUSASHI],
        board: {
          JUTSU: ["Lemu, Academy Instructor", "Tsukihana", "Amaterasu's Avatar"],
        },
      },
    });
    const clansman = handCard(s, 0, "Hyouga Yui Clansman");
    const [lemu, tsukihana, avatar] = s.board[1].JUTSU.map((unit) => unit.id) as [
      string,
      string,
      string,
    ];
    const status = targetOptions(s, 0, { t: "play", card: clansman });
    expect(status).toMatchObject({
      status: "need",
      request: { kind: "anyUnit", options: [unitAt(s, 0, "CLOSE"), lemu, tsukihana] },
    });
    expect(applyAction(s, 0, { t: "play", card: clansman, targets: [avatar] }).ok).toBe(
      false,
    );
    const next = act(s, 0, { t: "play", card: clansman, targets: [lemu] }).state;
    expect(power(next, tsukihana)).toBe(5);
    expect(power(next, lemu)).toBe(6);
    const ownSeal = act(s, 0, {
      t: "play",
      card: clansman,
      targets: [unitAt(s, 0, "CLOSE")],
    }).state;
    expect(ownSeal.board[0].CLOSE[0]).toMatchObject({ sealed: true, stored: 9 });
  });

  it("Seal then Strike hits the sealed enemy unit; the row Seal hits a chosen enemy row", () => {
    const s = scenario({
      p0: { hand: ["Yuki Onna", "Cryostorm Aegis"], board: { CLOSE: [MUSASHI] } },
      p1: { hand: [MUSASHI], board: { CLOSE: ["Mosswolf", MUSASHI, "Sand Golem"] } },
    });
    const yuki = handCard(s, 0, "Yuki Onna");
    const [moss, musashi] = s.board[1].CLOSE.map((unit) => unit.id) as [string, string];
    expect(targetOptions(s, 0, { t: "play", card: yuki })).toMatchObject({
      request: { kind: "enemyUnit", options: [moss, musashi] },
    });
    const sealed = act(s, 0, { t: "play", card: yuki, targets: [musashi] }).state;
    expect(sealed.board[1].CLOSE[1]).toMatchObject({ sealed: true, stored: 4 });
    expect(
      applyAction(s, 0, { t: "play", card: yuki, targets: [musashi, musashi] }).ok,
    ).toBe(false);
    const aegis = act(s, 0, {
      t: "play",
      card: handCard(s, 0, "Cryostorm Aegis"),
      targets: ["CLOSE"],
    }).state;
    expect(aegis.board[1].CLOSE.map((unit) => unit.sealed)).toEqual([
      true,
      true,
      false,
    ]);
  });

  it("Unyielding ignores Terrain but can be Struck, Empowered and Rallied", () => {
    const s = scenario({
      p0: {
        hand: ["Wind Release"],
        board: { JUTSU: ["Amaterasu's Avatar", "Lemu, Academy Instructor"] },
      },
      p1: { hand: [MUSASHI] },
    });
    s.terrain[0].JUTSU = true;
    const [avatar, lemu] = s.board[0].JUTSU.map((unit) => unit.id) as [string, string];
    expect(power(s, avatar)).toBe(10);
    expect(power(s, lemu)).toBe(4);
    const next = act(s, 0, {
      t: "play",
      card: handCard(s, 0, "Wind Release"),
      targets: [avatar],
    }).state;
    expect(power(next, avatar)).toBe(16);
  });
});

describe("faction perks", () => {
  it("Sun-Blessed boosts the first unit placed from hand each round only", () => {
    const s = scenario({
      knobs: { sunBonus: 2 },
      p0: {
        leader: LEADER.hisame,
        hand: ["Beta Sandworm", MUSASHI],
        deck: ["Gamma Sandworm"],
      },
      p1: { hand: [MUSASHI, MUSASHI] },
    });
    let state = act(s, 0, { t: "play", card: handCard(s, 0, "Beta Sandworm") }).state;
    expect(state.board[0].CLOSE.map((unit) => unit.stored)).toEqual([5, 5]);
    state = act(state, 1, { t: "play", card: handCard(state, 1, MUSASHI) }).state;
    state = act(state, 0, { t: "play", card: handCard(state, 0, MUSASHI) }).state;
    expect(state.board[0].CLOSE.at(-1)?.stored).toBe(7);
    expect(state.board[1].CLOSE[0]?.stored).toBe(7);
  });

  it("Permafrost makes Hyorin Terrain one-sided (knob can switch it off in Round 3)", () => {
    const s = scenario({
      p0: { leader: LEADER.kimiko, hand: ["Biting Frost"] },
      p1: { hand: [MUSASHI] },
    });
    const next = act(s, 0, { t: "play", card: handCard(s, 0, "Biting Frost") }).state;
    expect([next.terrain[0].CLOSE, next.terrain[1].CLOSE]).toEqual([false, true]);
    const r3 = scenario({
      round: 3,
      knobs: { permafrostR3: false },
      p0: { leader: LEADER.kimiko, hand: ["Biting Frost"] },
      p1: { hand: [MUSASHI] },
    });
    const both = act(r3, 0, { t: "play", card: handCard(r3, 0, "Biting Frost") }).state;
    expect([both.terrain[0].CLOSE, both.terrain[1].CLOSE]).toEqual([true, true]);
  });

  it("Returning Tide deploys the strongest eligible discard unit at the start of Round 3", () => {
    const s = scenario({
      knobs: { tideMaxPower: 4 },
      round: 2,
      opener: 0,
      p0: {
        leader: LEADER.captain,
        lanterns: 1,
        hand: [MUSASHI],
        discard: [
          "Ghost Ship Gunner",
          "Mizu no Seirei",
          "Enrai no Oni",
          "The Salvager",
          "Arashima Stormcaller",
          "Sand Golem",
        ],
        board: { CLOSE: [MUSASHI] },
      },
      p1: { hand: [MUSASHI], lanterns: 2 },
    });
    const mizu = s.seats[0].discard[1];
    const result = act(act(s, 0, { t: "pass" }).state, 1, { t: "pass" });
    const next = result.state;
    expect(next.round).toBe(3);
    expect(next.phase).toBe("play");
    // Mizu (4) and Arashima (4) tie under the cap: the earliest discarded wins; Any row joins the emptiest row.
    expect(next.board[0].CLOSE.map((unit) => unit.id)).toEqual([mizu as string]);
    expect(result.events).toContainEqual(
      expect.objectContaining({ t: "placed", id: mizu, source: "tide" }),
    );
  });

  it("Rigged Odds wins a tie only after a card from hand, never in a mirror", () => {
    const tie = (
      p0: Parameters<typeof scenario>[0]["p0"],
      p1Leader: string | null = LEADER.hisame,
    ) => {
      const s = scenario({
        p0,
        p1: {
          leader: p1Leader,
          hand: [MUSASHI],
          deck: [MUSASHI],
          board: { CLOSE: [MUSASHI] },
        },
      });
      return passBoth(s);
    };
    const spent = tie({
      leader: LEADER.amir,
      hand: [MUSASHI],
      deck: [MUSASHI],
      board: { CLOSE: [MUSASHI] },
      played: 1,
    });
    expect(spent.history[0]).toMatchObject({ winner: 0, riggedOdds: true });
    expect(spent.seats.map((seat) => seat.lanterns)).toEqual([2, 1]);
    expect(spent.opener).toBe(0);
    const dry = tie({
      leader: LEADER.amir,
      hand: [MUSASHI],
      deck: [MUSASHI],
      board: { CLOSE: [MUSASHI] },
    });
    expect(dry.history[0]?.winner).toBeNull();
    const mirror = tie(
      {
        leader: LEADER.amir,
        hand: [MUSASHI],
        deck: [MUSASHI],
        board: { CLOSE: [MUSASHI] },
        played: 1,
      },
      LEADER.ravena,
    );
    expect(mirror.history[0]?.winner).toBeNull();
  });

  it("Rigged Odds ignores the Shadow Clone token", () => {
    const s = scenario({
      p0: { leader: LEADER.amir, hand: [MUSASHI], deck: [MUSASHI] },
      p1: {
        hand: [MUSASHI],
        deck: [MUSASHI],
        board: { CLOSE: [{ name: "Cryverin", stored: 3 }] },
      },
    });
    s.cards = {
      ...s.cards,
      [TOKEN_CARD_ID]: { ...(s.cards[TOKEN_CARD_ID] as KessenCard), power: 3 },
    };
    s.inst["t-1"] = TOKEN_CARD_ID;
    s.seats[0].hand.push("t-1");
    let state = act(s, 0, { t: "play", card: "t-1", row: "CLOSE" }).state;
    expect(state.seats[0].played).toBe(0);
    state = passBoth(state);
    expect(state.history[0]?.winner).toBeNull();
  });
});

describe("leaders", () => {
  const leaderScenario = (leader: string, extra: Parameters<typeof scenario>[0] = {}) =>
    scenario({
      ...extra,
      p0: { leader, hand: [MUSASHI], ...extra.p0 },
      p1: { hand: [MUSASHI], ...extra.p1 },
    });

  it("activating a leader uses the turn, once per match", () => {
    const s = leaderScenario(LEADER.hisame, { p0: { board: { CLOSE: [MUSASHI] } } });
    const result = act(s, 0, { t: "leader", row: "CLOSE" });
    expect(result.state.turn).toBe(1);
    expect(result.state.seats[0].leaderUsed).toBe(true);
    expect(result.events).toContainEqual({
      t: "leader",
      seat: 0,
      cardId: cid(LEADER.hisame),
    });
    const again = { ...result.state, turn: 0 as Seat };
    expect(applyAction(again, 0, { t: "leader", row: "CLOSE" })).toEqual({
      ok: false,
      reason: "Your leader ability is used",
    });
  });

  it("Sunflare empowers a chosen own row; an empty row is illegal", () => {
    const s = leaderScenario(LEADER.hisame, {
      p0: { board: { CLOSE: [MUSASHI, "Cryverin"] } },
    });
    expect(
      act(s, 0, { t: "leader", row: "CLOSE" }).state.board[0].CLOSE.map(
        (unit) => unit.stored,
      ),
    ).toEqual([10, 10]);
    expect(
      act(s, 0, { t: "leader", targets: ["CLOSE"] }).state.board[0].CLOSE[0]?.stored,
    ).toBe(10);
    expect(applyAction(s, 0, { t: "leader", row: "RANGED" }).ok).toBe(false);
  });

  it("Desert Verdict purges a chosen enemy row", () => {
    const s = leaderScenario(LEADER.demonLord, {
      p1: { board: { CLOSE: [MUSASHI, "Enrai no Oni"] } },
    });
    const next = act(s, 0, { t: "leader", row: "CLOSE" }).state;
    expect(next.board[1].CLOSE.map((unit) => next.inst[unit.id])).toEqual([
      cid("Enrai no Oni"),
    ]);
  });

  it("Rebirth Rite revives with Deploy", () => {
    const s = leaderScenario(LEADER.junko, {
      p0: { discard: ["Frozen Wraith"] },
      p1: { board: { CLOSE: [{ name: "Taiyo Kami Devotee", stored: 2 }] } },
    });
    const wraith = s.seats[0].discard[0] as string;
    const next = act(s, 0, {
      t: "leader",
      targets: [wraith, unitAt(s, 1, "CLOSE")],
    }).state;
    expect(next.board[0].RANGED.map((unit) => unit.id)).toEqual([wraith]);
    expect(next.board[1].CLOSE).toHaveLength(0);
  });

  it("Moonlit Harvest recalls a unit card to hand; illegal at 10 cards", () => {
    const s = leaderScenario(LEADER.widow, {
      p0: { discard: ["Sand Golem", "Gale Courier", "Mosswolf"] },
    });
    const moss = s.seats[0].discard[2] as string;
    expect(targetOptions(s, 0, { t: "leader" })).toMatchObject({
      request: { kind: "discard", options: [moss] },
    });
    expect(act(s, 0, { t: "leader", targets: [moss] }).state.seats[0].hand).toContain(
      moss,
    );
    const full = leaderScenario(LEADER.widow, {
      p0: { hand: Array.from({ length: 10 }, () => MUSASHI), discard: ["Mosswolf"] },
    });
    expect(
      applyAction(full, 0, {
        t: "leader",
        targets: [full.seats[0].discard[0] as string],
      }),
    ).toEqual({
      ok: false,
      reason: "Hand full",
    });
  });

  it("Whiteout lays a one-sided Terrain on a chosen row", () => {
    const s = leaderScenario(LEADER.kimiko);
    const next = act(s, 0, { t: "leader", row: "JUTSU" }).state;
    expect([next.terrain[0].JUTSU, next.terrain[1].JUTSU]).toEqual([false, true]);
    next.turn = 0;
    next.seats[0].leaderUsed = false;
    expect(targetOptions(next, 0, { t: "leader" })).toMatchObject({
      request: { kind: "anyRow", options: ["CLOSE", "RANGED"] },
    });
  });

  it("Glacial Seal seals an enemy unit, then Strikes it for 3", () => {
    const s = leaderScenario(LEADER.sovereign, {
      p1: { board: { CLOSE: [MUSASHI, "Sand Golem"] } },
    });
    const [musashi, golem] = s.board[1].CLOSE.map((unit) => unit.id) as [
      string,
      string,
    ];
    const next = act(s, 0, { t: "leader", targets: [musashi] }).state;
    expect(next.board[1].CLOSE.map((unit) => [unit.sealed, unit.stored])).toEqual([
      [true, 4],
      [false, 7],
    ]);
    expect(applyAction(s, 0, { t: "leader", targets: [golem] }).ok).toBe(false);
  });

  it("All Hands deploys the top-most Summon unit and triggers only its Summon", () => {
    const s = leaderScenario(LEADER.captain, {
      p0: {
        deck: [
          MUSASHI,
          "Ghost Ship Deckhand",
          "Enrai no Oni",
          "Ghost Ship Gunner",
          "Ghost Ship Deckhand",
        ],
      },
    });
    const next = act(s, 0, { t: "leader" }).state;
    expect(next.board[0].CLOSE.map((unit) => next.inst[unit.id])).toEqual([
      cid("Ghost Ship Deckhand"),
    ]);
    expect(next.board[0].RANGED.map((unit) => next.inst[unit.id])).toEqual([
      cid("Ghost Ship Gunner"),
    ]);
    expect(next.seats[0].deck.map((id) => next.inst[id])).toEqual([
      cid(MUSASHI),
      cid("Enrai no Oni"),
      cid("Ghost Ship Deckhand"),
    ]);
  });

  it("Crescendo empowers each own unit by 1", () => {
    const s = leaderScenario(LEADER.conductor, {
      p0: { board: { CLOSE: [MUSASHI], JUTSU: ["Tsukihana"] } },
    });
    const next = act(s, 0, { t: "leader" }).state;
    expect([next.board[0].CLOSE[0]?.stored, next.board[0].JUTSU[0]?.stored]).toEqual([
      8, 4,
    ]);
    expect(applyAction(leaderScenario(LEADER.conductor), 0, { t: "leader" }).ok).toBe(
      false,
    );
  });

  it("Cycle puts up to 2 hand cards on the bottom and draws as many", () => {
    const s = leaderScenario(LEADER.aerathiel, {
      p0: {
        hand: [MUSASHI, "Cryverin", "Colossus"],
        deck: ["Kajioka", "Enrai no Oni"],
      },
    });
    const [musashi, cryverin, colossus] = s.seats[0].hand as [string, string, string];
    const next = act(s, 0, { t: "leader", targets: [colossus, musashi] }).state;
    expect(next.seats[0].hand.map((id) => next.inst[id])).toEqual([
      cid("Cryverin"),
      cid("Kajioka"),
      cid("Enrai no Oni"),
    ]);
    expect(next.seats[0].deck).toEqual([musashi, colossus]);
    expect(act(s, 0, { t: "leader" }).state.seats[0].hand).toEqual([
      musashi,
      cryverin,
      colossus,
    ]);
  });

  it("the seed Aerathiel cycles up to 2 hand cards and draws one more", () => {
    const s = withSeedLeader(
      leaderScenario(LEADER.aerathiel, {
        p0: {
          hand: [MUSASHI, "Cryverin"],
          deck: ["Kajioka", "Enrai no Oni", "Colossus"],
        },
      }),
      LEADER.aerathiel,
    );
    const [musashi, cryverin] = s.seats[0].hand as [string, string];
    const next = act(s, 0, { t: "leader", targets: [musashi] }).state;
    expect(next.seats[0].hand.map((id) => next.inst[id])).toEqual([
      cid("Cryverin"),
      cid("Kajioka"),
      cid("Enrai no Oni"),
    ]);
    expect(next.seats[0].deck.at(-1)).toBe(musashi);
    // Keeping every card still draws one.
    const kept = act(s, 0, { t: "leader" }).state;
    expect(kept.seats[0].hand.slice(0, 2)).toEqual([musashi, cryverin]);
    expect(kept.seats[0].hand).toHaveLength(3);
  });

  it("the seed Glacial Seal seals and Strikes one enemy unit for 5, then Strikes another for 4", () => {
    const s = withSeedLeader(
      leaderScenario(LEADER.sovereign, {
        p1: { board: { CLOSE: ["Sand Golem", "Cryverin", MUSASHI] } },
      }),
      LEADER.sovereign,
    );
    const [golem, cryverin, musashi] = s.board[1].CLOSE.map((unit) => unit.id) as [
      string,
      string,
      string,
    ];
    // Sand Golem is Unyielding: it cannot be the Seal target, but the second Strike hits it.
    expect(applyAction(s, 0, { t: "leader", targets: [golem, cryverin] }).ok).toBe(
      false,
    );
    const next = act(s, 0, { t: "leader", targets: [musashi, golem] }).state;
    expect(
      next.board[1].CLOSE.map((unit) => [next.inst[unit.id], unit.sealed, unit.stored]),
    ).toEqual([
      [cid("Sand Golem"), false, (stored(s, golem) as number) - 4],
      [cid("Cryverin"), false, stored(s, cryverin) as number],
      [cid(MUSASHI), true, (stored(s, musashi) as number) - 5],
    ]);
  });

  it("Updraft substitutes, then empowers another unit (both chosen up front)", () => {
    const s = leaderScenario(LEADER.kaze, {
      p0: { board: { CLOSE: [MUSASHI, "Cryverin"] } },
    });
    const [musashi, cryverin] = s.board[0].CLOSE.map((unit) => unit.id) as [
      string,
      string,
    ];
    const next = act(s, 0, { t: "leader", targets: [musashi, cryverin] }).state;
    expect(next.seats[0].hand).toContain(musashi);
    expect(stored(next, cryverin)).toBe(9);
    expect(applyAction(s, 0, { t: "leader", targets: [musashi, musashi] }).ok).toBe(
      false,
    );
    const full = leaderScenario(LEADER.kaze, {
      p0: {
        hand: Array.from({ length: 10 }, () => MUSASHI),
        board: { CLOSE: [MUSASHI] },
      },
    });
    expect(
      applyAction(full, 0, { t: "leader", targets: [unitAt(full, 0, "CLOSE")] }),
    ).toEqual({ ok: false, reason: "Hand full" });
  });

  it("Fence deploys from the opponent's discard without Deploy; it returns to their discard", () => {
    const s = leaderScenario(LEADER.amir, {
      p0: { deck: [MUSASHI] },
      p1: {
        discard: ["Frozen Wraith", "Sand Golem", "Gale Courier"],
        board: { CLOSE: ["Taiyo Kami Devotee"] },
        deck: [MUSASHI],
      },
    });
    const wraith = s.seats[1].discard[0] as string;
    expect(targetOptions(s, 0, { t: "leader" })).toMatchObject({
      request: { kind: "enemyDiscard", options: [wraith] },
    });
    const result = act(s, 0, { t: "leader", targets: [wraith] });
    expect(result.state.board[0].RANGED[0]).toMatchObject({ id: wraith, owner: 1 });
    expect(result.state.board[1].CLOSE).toHaveLength(1);
    expect(boardTotals(result.state)[0]).toBe(5);
    const next = passBoth(result.state);
    expect(next.seats[1].discard).toContain(wraith);
  });

  it("Crimson Tithe draws only when its Strike destroys the target", () => {
    const s = leaderScenario(LEADER.ravena, {
      p0: { deck: ["Cryverin"] },
      p1: { board: { CLOSE: [MUSASHI, "Cryverin"] } },
    });
    const [musashi] = s.board[1].CLOSE.map((unit) => unit.id) as [string];
    expect(
      act(s, 0, { t: "leader", targets: [musashi] }).state.seats[0].hand,
    ).toHaveLength(1);
    const weak = leaderScenario(LEADER.ravena, {
      p0: { deck: ["Cryverin"] },
      p1: { board: { CLOSE: [{ name: MUSASHI, stored: 4 }] } },
    });
    expect(
      act(weak, 0, { t: "leader", targets: [unitAt(weak, 1, "CLOSE")] }).state.seats[0]
        .hand,
    ).toHaveLength(2);
  });

  it("Ascension revives twice; the second may not pick the first's card", () => {
    const s = leaderScenario(LEADER.shishi, {
      p0: { discard: ["Mosswolf", "Kajioka"] },
    });
    const [moss, kajioka] = s.seats[0].discard as [string, string];
    expect(targetOptions(s, 0, { t: "leader", targets: [moss] })).toMatchObject({
      request: { options: [kajioka] },
    });
    const next = act(s, 0, { t: "leader", targets: [moss, kajioka, "JUTSU"] }).state;
    expect(next.board[0].CLOSE.map((unit) => unit.id)).toEqual([moss]);
    expect(next.board[0].JUTSU.map((unit) => unit.id)).toEqual([kajioka]);
    expect(applyAction(s, 0, { t: "leader", targets: [moss, moss] }).ok).toBe(false);
  });

  it("Thread of Fate recharges the boss leader after each lost round", () => {
    const s = scenario({
      rules: { leaderRecharge: "onRoundLoss" },
      p0: { hand: [MUSASHI], deck: [MUSASHI], board: { CLOSE: [MUSASHI] } },
      p1: { leader: LEADER.loom, leaderUsed: true, hand: [MUSASHI], deck: [MUSASHI] },
    });
    const result = act(act(s, 0, { t: "pass" }).state, 1, { t: "pass" });
    expect(result.events).toContainEqual({ t: "leaderRecharged", seat: 1 });
    expect(result.state.seats[1].leaderUsed).toBe(false);
    const winner = scenario({
      rules: { leaderRecharge: "onRoundLoss" },
      p0: { hand: [MUSASHI], deck: [MUSASHI] },
      p1: {
        leader: LEADER.loom,
        leaderUsed: true,
        hand: [MUSASHI],
        deck: [MUSASHI],
        board: { CLOSE: [MUSASHI] },
      },
    });
    expect(passBoth(winner).seats[1].leaderUsed).toBe(true);
  });
});

describe("house rules", () => {
  it("High Noon adds +1 to every unit placed from hand in Round 3", () => {
    const s = scenario({
      round: 3,
      rules: { r3PlacementBonus: 1 },
      p0: { hand: [MUSASHI] },
      p1: { hand: [MUSASHI] },
    });
    expect(
      act(s, 0, { t: "play", card: handCard(s, 0, MUSASHI) }).state.board[0].CLOSE[0]
        ?.stored,
    ).toBe(8);
    const r2 = scenario({
      round: 2,
      rules: { r3PlacementBonus: 1 },
      p0: { hand: [MUSASHI] },
      p1: { hand: [MUSASHI] },
    });
    expect(
      act(r2, 0, { t: "play", card: handCard(r2, 0, MUSASHI) }).state.board[0].CLOSE[0]
        ?.stored,
    ).toBe(7);
  });

  it("Blood Moon gives kept units +2 when the next round starts", () => {
    const s = scenario({
      rules: { carryBonus: 2 },
      p0: {
        hand: [MUSASHI],
        deck: [MUSASHI],
        board: { CLOSE: ["Mummy of the Shining Dunes"] },
      },
      p1: { hand: [MUSASHI], deck: [MUSASHI] },
    });
    const next = keepBoth(passBoth(s));
    expect(next.board[0].CLOSE[0]?.stored).toBe(6);
  });

  it("Permafrost Peaks and Fog Bank afflict rows at the start of listed rounds", () => {
    const s = keepBoth(
      newMatch({
        rules: {
          startTerrain: [
            { row: "CLOSE", rounds: [1, 2, 3] },
            { row: "JUTSU", rounds: [2] },
          ],
        },
      }),
    );
    expect(s.terrain).toEqual([
      { CLOSE: true, RANGED: false, JUTSU: false },
      { CLOSE: true, RANGED: false, JUTSU: false },
    ]);
  });

  it("Blood Price adds +1 to every Strike", () => {
    const s = scenario({
      rules: { strikeBonus: 1 },
      p0: { hand: ["Fireball"] },
      p1: { hand: [MUSASHI], board: { CLOSE: [MUSASHI] } },
    });
    expect(
      act(s, 0, {
        t: "play",
        card: handCard(s, 0, "Fireball"),
        targets: [unitAt(s, 1, "CLOSE")],
      }).state.board[1].CLOSE[0]?.stored,
    ).toBe(1);
  });
});

describe("row caps", () => {
  it("allows five units per row and reports a full row", () => {
    const s = scenario({
      p0: {
        hand: [MUSASHI, "Kajioka"],
        board: { CLOSE: [MUSASHI, MUSASHI, MUSASHI, MUSASHI, MUSASHI] },
      },
      p1: { hand: [MUSASHI] },
    });
    expect(applyAction(s, 0, { t: "play", card: handCard(s, 0, MUSASHI) })).toEqual({
      ok: false,
      reason: "Row full",
    });
    expect(rowOptions(s, 0, handCard(s, 0, "Kajioka"))).toEqual([
      { row: "CLOSE", side: 0, legal: false, reason: "Row full" },
      { row: "RANGED", side: 0, legal: true, reason: null },
      { row: "JUTSU", side: 0, legal: true, reason: null },
    ]);
  });

  it("Revive and Fence need room in the target row", () => {
    const s = scenario({
      p0: {
        leader: LEADER.amir,
        hand: ["Furuki no Seirei"],
        discard: ["Mosswolf"],
        board: { CLOSE: [MUSASHI, MUSASHI, MUSASHI, MUSASHI, MUSASHI] },
      },
      p1: { hand: [MUSASHI], discard: ["Cryverin"] },
    });
    expect(
      act(s, 0, { t: "play", card: handCard(s, 0, "Furuki no Seirei") }).events,
    ).toContainEqual(expect.objectContaining({ t: "fizzled", ability: "revive" }));
    expect(act(s, 0, { t: "leader" }).events).toContainEqual(
      expect.objectContaining({ t: "fizzled", ability: "fence" }),
    );
  });
});

describe("the Shadow Clone token", () => {
  it("is exempt from the hand cap and playable only in Round 1", () => {
    const s = scenario({
      p0: {
        hand: ["Gale Courier", ...Array.from({ length: 9 }, () => MUSASHI)],
        deck: [MUSASHI, MUSASHI],
      },
      p1: { hand: [MUSASHI] },
    });
    s.inst["t-1"] = TOKEN_CARD_ID;
    s.seats[0].hand.push("t-1");
    const next = act(s, 0, {
      t: "play",
      card: handCard(s, 0, "Gale Courier"),
      row: "CLOSE",
    }).state;
    expect(next.seats[0].hand).toHaveLength(11);
    const late = { ...s, round: 2 };
    expect(applyAction(late, 0, { t: "play", card: "t-1", row: "CLOSE" })).toEqual({
      ok: false,
      reason: "The Shadow Clone is playable only in Round 1",
    });
  });
});

describe("legal actions, views and previews", () => {
  it("lists pass plus every fully targeted play and leader activation", () => {
    const s = scenario({
      p0: {
        leader: LEADER.hisame,
        hand: ["Fist of 10,000 Volts", "Kajioka"],
        board: { CLOSE: [MUSASHI] },
      },
      p1: {
        hand: [MUSASHI],
        board: { CLOSE: [MUSASHI], JUTSU: ["Taiyo Kami Devotee"] },
      },
    });
    const actions = legalActions(s, 0);
    expect(actions[0]).toEqual({ t: "pass" });
    const fist = handCard(s, 0, "Fist of 10,000 Volts");
    // Musashi survives both hits; Taiyo (3) dies to the first Strike of 3.
    expect(
      actions.filter((action) => action.t === "play" && action.card === fist),
    ).toHaveLength(3);
    expect(
      actions.filter(
        (action) => action.t === "play" && action.card === handCard(s, 0, "Kajioka"),
      ),
    ).toHaveLength(3);
    expect(actions.filter((action) => action.t === "leader")).toEqual([
      { t: "leader", targets: ["CLOSE"] },
    ]);
    for (const action of actions) expect(applyAction(s, 0, action).ok).toBe(true);
    expect(legalActions(s, 1)).toEqual([]);
  });

  it("hides the opponent's hand, both deck orders and the seed", () => {
    const s = keepBoth(newMatch());
    const view = viewFor(s, 0);
    expect(view.seats[0].hand).toEqual(s.seats[0].hand);
    expect(view.seats[1].hand).toBeNull();
    expect(view.seats[1].handCount).toBe(s.seats[1].hand.length);
    expect(view.seats[1].deckCount).toBe(s.seats[1].deck.length);
    expect(JSON.stringify(view)).not.toContain(s.seed);
    expect("seed" in view).toBe(false);
    for (const id of [...s.seats[1].hand, ...s.seats[1].deck, ...s.seats[0].deck]) {
      expect(view.inst[id]).toBeUndefined();
    }
  });

  it("previews exact ghost numbers on a view and flags hidden draws and pulls", () => {
    const s = scenario({
      p0: {
        leader: LEADER.hisame,
        hand: ["Blazing Flash Adept", "Beta Sandworm", "Gale Courier"],
        deck: ["Gamma Sandworm"],
        board: { CLOSE: [MUSASHI] },
      },
      p1: { hand: [MUSASHI], board: { JUTSU: ["Taiyo Kami Devotee"] } },
    });
    const view = viewFor(s, 0);
    const adept = handCard(s, 0, "Blazing Flash Adept");
    const preview = previewAction(view, 0, {
      t: "play",
      card: adept,
      row: "CLOSE",
      targets: [unitAt(s, 0, "CLOSE")],
    });
    expect(preview).toMatchObject({
      ok: true,
      totals: { before: [7, 3], after: [14, 3] },
      hidden: [],
    });
    if (!preview.ok) throw new Error("preview failed");
    expect(preview.units).toContainEqual({
      id: unitAt(s, 0, "CLOSE"),
      cardId: cid(MUSASHI),
      side: 0,
      row: "CLOSE",
      before: 7,
      after: 10,
    });
    expect(preview.units).toContainEqual({
      id: adept,
      cardId: cid("Blazing Flash Adept"),
      side: 0,
      row: "CLOSE",
      before: null,
      after: 4,
    });
    const pull = previewAction(view, 0, {
      t: "play",
      card: handCard(s, 0, "Beta Sandworm"),
    });
    expect(pull).toMatchObject({ ok: true, hidden: ["summon"] });
    const courier = previewAction(view, 0, {
      t: "play",
      card: handCard(s, 0, "Gale Courier"),
      row: "RANGED",
    });
    expect(courier).toMatchObject({
      ok: true,
      hidden: ["draw"],
      totals: { after: [7, 9] },
    });
    expect(previewAction(view, 0, { t: "play", card: adept, row: "RANGED" })).toEqual({
      ok: false,
      reason: "This unit has a printed row",
    });
    // The preview agrees with the real application.
    const real = act(s, 0, {
      t: "play",
      card: adept,
      targets: [unitAt(s, 0, "CLOSE")],
    }).state;
    expect(boardTotals(real)).toEqual([14, 3]);
  });

  it("redacts the opponent's draws and mulligan picks", () => {
    const s = newMatch();
    const result = act(s, 1, { t: "mull", cards: s.seats[1].hand.slice(0, 2) });
    const redacted = redactEvents(result.events, 0);
    expect(redacted[0]).toEqual({
      t: "mulligan",
      seat: 1,
      count: 2,
      removed: ["?", "?"],
      drawn: ["?", "?"],
    });
    expect(redactEvents(result.events, 1)).toEqual(result.events);
  });

  it("rejects extra and malformed targets", () => {
    const s = scenario({
      p0: { hand: ["Fireball", MUSASHI] },
      p1: { hand: [MUSASHI], board: { CLOSE: [MUSASHI] } },
    });
    const target = unitAt(s, 1, "CLOSE");
    expect(
      applyAction(s, 0, {
        t: "play",
        card: handCard(s, 0, MUSASHI),
        targets: [target],
      }),
    ).toEqual({
      ok: false,
      reason: "Too many targets",
    });
    expect(applyAction(s, 0, { t: "play", card: handCard(s, 0, "Fireball") })).toEqual({
      ok: false,
      reason: "Choose a target for strike",
    });
    const malformed = {
      t: "play",
      card: handCard(s, 0, "Fireball"),
      targets: [7],
    } as unknown as Parameters<typeof applyAction>[2];
    expect(applyAction(s, 0, malformed)).toEqual({
      ok: false,
      reason: "Targets must be a list of ids and rows",
    });
    expect(applyAction(s, 1, { t: "pass" })).toEqual({
      ok: false,
      reason: "Not your turn",
    });
  });

  it("turns a view into a playable state; a filled opponent hand lets the AI simulate replies", () => {
    const s = scenario({
      p0: { hand: ["Fireball", MUSASHI], deck: [MUSASHI] },
      p1: {
        hand: ["Thorn Grasp", "Cryverin"],
        deck: ["Colossus"],
        board: { CLOSE: [MUSASHI] },
      },
      turn: 1,
    });
    const view = viewFor(s, 1);
    const blind = viewToState(view);
    expect(blind.seats[0].hand).toEqual(["x0h0", "x0h1"]);
    expect(blind.inst.x0h0).toBe("?");
    expect(legalActions(blind, 1).length).toBe(legalActions(s, 1).length);
    // The opponent's cards are not in the view's catalog; the AI supplies the public pool.
    expect(view.cards[cid("Fireball")]).toBeUndefined();
    const filled = viewToState(view, {
      hands: { 0: [cid("Fireball"), cid(MUSASHI)] },
      cards: KESSEN_RULES_CATALOG,
    });
    const reply = act(filled, 1, { t: "pass" }).state;
    expect(legalActions(reply, 0).filter((action) => action.t === "play")).toHaveLength(
      2,
    );
  });
});

describe("action payloads, previews and the clone", () => {
  const TOTO = "Toto the Baby Dragon";

  it("a leader's row answers its first row choice, after the card choice", () => {
    const s = scenario({
      p0: { leader: LEADER.junko, hand: [MUSASHI], discard: [TOTO] },
      p1: { hand: [MUSASHI] },
    });
    const toto = s.seats[0].discard[0] as string;
    const viaRow = act(s, 0, { t: "leader", row: "RANGED", targets: [toto] }).state;
    const viaTargets = act(s, 0, { t: "leader", targets: [toto, "RANGED"] }).state;
    expect(viaRow.board[0].RANGED.map((unit) => unit.id)).toEqual([toto]);
    expect(viaRow.board).toEqual(viaTargets.board);
    expect(
      applyAction(s, 0, { t: "leader", row: "RANGED", targets: [toto, "RANGED"] }),
    ).toEqual({ ok: false, reason: "Too many targets" });
  });

  it("Fence takes a leader row for an Any-row enemy unit; a leader without a row choice refuses one", () => {
    const fence = scenario({
      p0: { leader: LEADER.amir, hand: [MUSASHI] },
      p1: { hand: [MUSASHI], discard: [TOTO] },
    });
    const toto = fence.seats[1].discard[0] as string;
    const fenced = act(fence, 0, { t: "leader", row: "JUTSU", targets: [toto] }).state;
    expect(fenced.board[0].JUTSU.map((unit) => unit.id)).toEqual([toto]);
    const strike = scenario({
      p0: { leader: LEADER.ravena, hand: [MUSASHI] },
      p1: { hand: [MUSASHI], board: { CLOSE: [MUSASHI] } },
    });
    expect(
      applyAction(strike, 0, {
        t: "leader",
        row: "CLOSE",
        targets: [unitAt(strike, 1, "CLOSE")],
      }),
    ).toEqual({ ok: false, reason: "This leader takes no row" });
  });

  it("a 0-power Shadow Clone is destroyed as it is placed; the opener keeps the turn", () => {
    // No leaders: Sun-Blessed never applies to the rules' placement anyway.
    const bare = (rules?: MatchState["rules"]) => {
      const created = newMatch({
        seats: [
          { leaderId: null, deck: FILLER },
          { leaderId: null, deck: FILLER },
        ],
        rules,
      });
      const kept = act(created, 0, { t: "mull", cards: [] }).state;
      return act(kept, 1, { t: "mull", cards: [] });
    };
    const zero = bare({ knobs: { gambitPower: 0 } });
    const s = zero.state;
    const opener = s.opener;
    expect(zero.events.find((event) => event.t === "destroyed")).toEqual(
      expect.objectContaining({ id: "t-1", cause: "depleted" }),
    );
    expect(s.board[opener].CLOSE).toEqual([]);
    expect(s.seats[opener].discard).not.toContain("t-1");
    expect(s.turn).toBe(opener);
    const strong = bare({ knobs: { gambitPower: 3 } }).state;
    expect(stored(strong, "t-1")).toBe(3);
    expect(strong.turn).toBe(strong.opener);
  });

  it("previews a partial action up to its next choice, with a result per option", () => {
    const s = scenario({
      p0: { hand: ["Fist of 10,000 Volts", MUSASHI] },
      p1: {
        hand: [MUSASHI],
        board: {
          CLOSE: [
            { name: MUSASHI, stored: 3 },
            { name: "Cryverin", stored: 6 },
          ],
        },
      },
    });
    const fist = handCard(s, 0, "Fist of 10,000 Volts");
    const [weak, strong] = [unitAt(s, 1, "CLOSE", 0), unitAt(s, 1, "CLOSE", 1)];
    const view = viewFor(s, 0);
    const first = previewPartial(view, 0, { t: "play", card: fist });
    if (!first.ok) throw new Error(first.reason);
    expect(first.request).toEqual(
      expect.objectContaining({ kind: "enemyUnit", ability: "strike" }),
    );
    expect(first.options.map((option) => option.target)).toEqual([weak, strong]);
    const kill = first.options.find((option) => option.target === weak);
    expect(kill).toEqual(
      expect.objectContaining({
        ok: true,
        kills: [weak],
        next: expect.objectContaining({ options: [strong] }),
      }),
    );
    const second = previewPartial(view, 0, {
      t: "play",
      card: fist,
      targets: [strong],
    });
    if (!second.ok) throw new Error(second.reason);
    expect(second.units.find((unit) => unit.id === strong)?.after).toBe(3);
    expect(second.options.map((option) => option.target)).toEqual([weak, strong]);
    const done = previewPartial(view, 0, {
      t: "play",
      card: fist,
      targets: [weak, strong],
    });
    expect(done).toEqual(
      expect.objectContaining({ ok: true, request: null, options: [], kills: [weak] }),
    );
    expect(previewPartial(view, 1, { t: "play", card: fist }).ok).toBe(false);
  });

  it("offers view-level target, row and action helpers", () => {
    const s = scenario({
      p0: { hand: ["Fireball", TOTO] },
      p1: { hand: [MUSASHI], board: { CLOSE: [MUSASHI] } },
    });
    const view = viewFor(s, 0);
    const fireball = handCard(s, 0, "Fireball");
    expect(targetOptionsForView(view, 0, { t: "play", card: fireball })).toEqual(
      targetOptions(s, 0, { t: "play", card: fireball }),
    );
    expect(rowOptionsForView(view, 0, handCard(s, 0, TOTO))).toEqual(
      rowOptions(s, 0, handCard(s, 0, TOTO)),
    );
    expect(legalActionsForView(view, 0)).toEqual(legalActions(s, 0));
  });

  it("a view-derived state offers exactly the choices of the full state for every catalog card", () => {
    const deckUnits = KESSEN_SEED_CATALOG.filter(
      (card) =>
        card.kind === "UNIT" && card.isCollectible && card.variant === "STANDARD",
    ).map((card) => card.name);
    const groupMembers = KESSEN_SEED_CATALOG.filter(
      (card) => card.summonGroups.length > 0 && card.variant === "STANDARD",
    ).map((card) => card.name);
    for (const card of KESSEN_SEED_CATALOG) {
      // Forbidden variants print their base card's abilities.
      if (card.id === TOKEN_CARD_ID || card.variant === "FORBIDDEN") continue;
      const leader = card.kind === "LEADER";
      const s = scenario({
        p0: {
          leader: leader ? card.name : null,
          hand: leader ? [MUSASHI, "Cryverin"] : [card.name, MUSASHI, "Cryverin"],
          deck: [...groupMembers, ...deckUnits.slice(0, 6)],
          discard: [TOTO, "Cryverin", MUSASHI],
          board: { CLOSE: [MUSASHI, MUSASHI, MUSASHI, MUSASHI], RANGED: ["Kajioka"] },
        },
        p1: {
          hand: [MUSASHI],
          discard: [TOTO, "Colossus"],
          board: { CLOSE: [MUSASHI, "Enrai no Oni"], JUTSU: ["Colossus"] },
        },
      });
      const blind = viewToState(viewFor(s, 0));
      const key = (actions: ReturnType<typeof legalActions>) =>
        actions.map((action) => JSON.stringify(action)).sort();
      expect({ card: card.name, actions: key(legalActions(blind, 0)) }).toEqual({
        card: card.name,
        actions: key(legalActions(s, 0)),
      });
    }
  });

  it("a live catalog never overrides the match's snapshot in a view-derived state", () => {
    const s = scenario({
      p0: { hand: [MUSASHI], board: { CLOSE: [MUSASHI] } },
      p1: { hand: [MUSASHI] },
    });
    const live = { ...(CATALOG[cid(MUSASHI)] as KessenCard), power: 99 };
    const extra = { ...(CATALOG[cid("Colossus")] as KessenCard) };
    const state = viewToState(viewFor(s, 0), { cards: [live, extra] });
    expect(state.cards[cid(MUSASHI)]).toBe(s.cards[cid(MUSASHI)] as KessenCard);
    expect(state.cards[cid("Colossus")]).toBe(extra);
  });
});

const other = (seat: Seat): Seat => (seat === 0 ? 1 : 0);

/** The scenario with `leader`'s seed-catalog card, for abilities the balance pass changed. */
const withSeedLeader = (s: MatchState, leader: string) => {
  const card = KESSEN_SEED_CATALOG.find((entry) => entry.name === leader) as KessenCard;
  return { ...s, cards: { ...s.cards, [card.id]: card } };
};

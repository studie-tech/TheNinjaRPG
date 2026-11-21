import {
  aiRng,
  decideWithTrace,
  greedyDecide,
  type KessenAiDecision,
  type KessenAiProfile,
  type KessenAiTier,
} from "@/libs/kessen/ai";
import { KESSEN_DECK_FACTIONS, starterDeck } from "@/libs/kessen/deck";
import { actingSeats, applyAction, createMatch, viewFor } from "@/libs/kessen/engine";
import type { KessenAction, MatchRules, MatchState, Seat } from "@/libs/kessen/types";
import { cid, deckOf } from "./engineHelpers";
import { KESSEN_SEED_CATALOG } from "./fixtures/catalog";

export interface TestDeck {
  leader: string;
  cards: [string, number][];
}

const NAMES = Object.fromEntries(
  KESSEN_SEED_CATALOG.map((card) => [card.id, card.name]),
);

/** The six starter decks, read from the deck module. */
export const STARTER_DECKS: TestDeck[] = KESSEN_DECK_FACTIONS.map((faction) => {
  const deck = starterDeck(faction);
  return {
    leader: NAMES[deck.leaderId] as string,
    cards: deck.cards.map((entry): [string, number] => [
      NAMES[entry.itemId] as string,
      entry.count,
    ]),
  };
});

/** The two boss decks, with their boss rules. */
export const BOSS_DECKS: (TestDeck & { rules: MatchRules })[] = [
  {
    leader: "Divine Shishi",
    rules: { extraMulligans: { seat: "human", n: 1 } },
    cards: [
      ["Shishi, God of Death", 1],
      ["Yasei no Seirei, the Wild Spirit", 1],
      ["Kuzenbo, the Mountain God", 1],
      ["The Cedarback Elder", 1],
      ["Demon of Tsuki", 1],
      ["Cruel Sun", 1],
      ["Furuki no Seirei", 2],
      ["Moon Shrine Guardian", 2],
      ["Wood Warrior", 2],
      ["Moonprowler", 3],
      ["Owlcat", 2],
      ["Mosswolf", 3],
      ["Tsukihana", 2],
      ["Thorn Grasp", 1],
      ["Kawarimi", 1],
      ["Seal of Nullification", 1],
    ],
  },
  {
    leader: "The Loom of Fate",
    rules: { leaderRecharge: "onRoundLoss" },
    cards: [
      ["Amaterasu's Avatar", 1],
      ["Raizhen, the Ten-Tailed", 1],
      ["Aurex, the Imperial Wyrm", 1],
      ["Subaku Winged Captain", 1],
      ["Amaterasu's Holy Mirror", 1],
      ["Colossus", 1],
      ["Gamma Sandworm", 2],
      ["Subaku Princess", 2],
      ["Sand Golem", 2],
      ["Taiyo Kami Devotee", 3],
      ["Mummy of the Shining Dunes", 2],
      ["Blazing Flash Adept", 2],
      ["Fireball", 2],
      ["Beta Sandworm", 1],
      ["Lemu, Academy Instructor", 1],
      ["Seal of Nullification", 1],
      ["Kawarimi", 1],
    ],
  },
];

/** House rules, cycled through the legality games. */
export const HOUSE_RULES: MatchRules[] = [
  {},
  { r3PlacementBonus: 1 },
  { carryBonus: 2 },
  { startTerrain: [{ row: "CLOSE", rounds: [1, 2, 3] }] },
  { startTerrain: [{ row: "JUTSU", rounds: [1] }] },
  { extraMulligans: 1 },
  { strikeBonus: 1 },
  { r1MulliganCap: 5 },
];

/** An AI tier profile, or the greedy baseline bot. */
export type AiPlayer = KessenAiProfile | "GREEDY";

export interface AiSeat {
  player: AiPlayer;
  deck: TestDeck;
}

export interface AiDecisionRecord {
  state: MatchState;
  seat: Seat;
  action: KessenAction;
  trace: KessenAiDecision | null;
}

/**
 * Plays a full match between two AI players, each deciding only from its own view and
 * its own deck list; throws on any illegal action.
 */
export const playAiMatch = (input: {
  seed: string;
  seats: [AiSeat, AiSeat];
  rules?: MatchRules;
  onDecision?: (record: AiDecisionRecord) => void;
}) => {
  const decks = input.seats.map((seat) => deckOf(seat.deck.cards));
  let state = createMatch({
    seed: input.seed,
    seats: [
      { leaderId: cid(input.seats[0].deck.leader), deck: decks[0] as string[] },
      { leaderId: cid(input.seats[1].deck.leader), deck: decks[1] as string[] },
    ],
    rules: input.rules,
    cards: KESSEN_SEED_CATALOG,
  });
  for (let step = 0; step < 400; step++) {
    const seat = actingSeats(state)[0];
    if (seat === undefined) break;
    const view = viewFor(state, seat);
    const player = input.seats[seat].player;
    const trace =
      player === "GREEDY"
        ? null
        : decideWithTrace(view, seat, player, aiRng(input.seed, seat, state.step), {
            pool: KESSEN_SEED_CATALOG,
            deck: decks[seat],
          });
    const action = trace ? trace.action : greedyDecide(view, seat);
    input.onDecision?.({ state, seat, action, trace });
    const result = applyAction(state, seat, action);
    if (!result.ok) {
      throw new Error(`Illegal AI action ${JSON.stringify(action)}: ${result.reason}`);
    }
    state = result.state;
  }
  return state;
};

export interface LadderJob {
  a: KessenAiTier | "GREEDY";
  b: KessenAiTier | "GREEDY";
  prefix: string;
  /** Game indices: game i plays starter deck (i >> 1) mod 6 as a mirror; odd i swaps seats. */
  games: number[];
}

export interface LadderTally {
  wins: number;
  losses: number;
  draws: number;
}

/** Plays ladder games and tallies them from `a`'s side. */
export const playLadderGames = (job: LadderJob): LadderTally => {
  const tally: LadderTally = { wins: 0, losses: 0, draws: 0 };
  const playerOf = (tier: LadderJob["a"]): AiPlayer =>
    tier === "GREEDY" ? "GREEDY" : { tier };
  for (const game of job.games) {
    const pair = game >> 1;
    const deck = STARTER_DECKS[pair % STARTER_DECKS.length] as TestDeck;
    const aSeat: Seat = game % 2 === 0 ? 0 : 1;
    const players: [AiPlayer, AiPlayer] =
      aSeat === 0
        ? [playerOf(job.a), playerOf(job.b)]
        : [playerOf(job.b), playerOf(job.a)];
    const state = playAiMatch({
      seed: `${job.prefix}${pair}`,
      seats: [
        { player: players[0], deck },
        { player: players[1], deck },
      ],
    });
    const winner = state.result?.winner;
    if (winner === null || winner === undefined) tally.draws += 1;
    else if (winner === aSeat) tally.wins += 1;
    else tally.losses += 1;
  }
  return tally;
};

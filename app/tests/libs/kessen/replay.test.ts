import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  aiRng,
  decideWithTrace,
  KESSEN_AI_TIERS,
  KESSEN_AI_VERSION,
} from "@/libs/kessen/ai";
import { catalogFingerprint } from "@/libs/kessen/catalog";
import {
  actingSeats,
  applyAction,
  canonicalJson,
  createMatch,
  stateHash,
  viewFor,
} from "@/libs/kessen/engine";
import { createRng, hashString, shuffleInPlace } from "@/libs/kessen/rng";
import { CARD_ENGINE_VERSION } from "@/libs/kessen/rules";
import type { KessenCard, MatchRules, MatchState } from "@/libs/kessen/types";
import { playBotMatch } from "./engineHelpers";
import { KESSEN_SEED_CATALOG } from "./fixtures/catalog";
import {
  rulesCardId as cid,
  KESSEN_RULES_CATALOG,
  KESSEN_RULES_REVISED_LEADERS,
} from "./fixtures/rulesCatalog";

// Whole AI matches run per test, which outlasts the default timeout on a loaded machine.
setDefaultTimeout(30_000);

interface TestDeck {
  leader: string;
  cards: [string, number][];
  rules?: MatchRules;
}

/** The signature decks, with their house and boss rules. */
const DECKS: Record<string, TestDeck> = {
  lemu: {
    leader: "The Crowned Captain",
    cards: [
      ["Arashima Stormcaller", 3],
      ["Enrai no Oni", 3],
      ["Fist of 10,000 Volts", 3],
      ["Ghost Ship Deckhand", 3],
      ["Ghost Ship Gunner", 3],
      ["Musashi Ken Swordsman", 3],
      ["Lemu, Academy Instructor", 2],
      ["Mizu no Seirei", 2],
      ["Colossus", 1],
      ["Divine Railgun", 1],
      ["Leviathan of the Shroud", 1],
    ],
  },
  kazehiko: {
    leader: "Aerathiel Wind-Bearer",
    cards: [
      ["Kajioka", 3],
      ["Sky-Bridge Scout", 3],
      ["Blazdrift", 3],
      ["Kugatsunagi", 3],
      ["Wind Release", 3],
      ["Kazehiko", 2],
      ["Musashi Ken Swordsman", 3],
      ["Lemu, Academy Instructor", 2],
      ["Yamabiko Echo-Caller", 2],
      ["Colossus", 1],
    ],
  },
  hisame: {
    leader: "Subaku Demon Lord",
    rules: { r3PlacementBonus: 1 },
    cards: [
      ["Beta Sandworm", 3],
      ["Gamma Sandworm", 2],
      ["Taiyo Kami Devotee", 3],
      ["Mummy of the Shining Dunes", 2],
      ["Blazing Flash Adept", 2],
      ["Fireball", 3],
      ["Sand Golem", 1],
      ["Subaku Princess", 2],
      ["Subaku Winged Captain", 1],
      ["Amaterasu's Holy Mirror", 1],
      ["Musashi Ken Swordsman", 3],
      ["Lotus Barrier", 1],
      ["Seal of Nullification", 1],
    ],
  },
  junko: {
    leader: "Widow of the Waning Moon",
    rules: { carryBonus: 2 },
    cards: [
      ["Moonprowler", 3],
      ["Owlcat", 3],
      ["Mosswolf", 3],
      ["Tsukihana", 3],
      ["Thorn Grasp", 2],
      ["Furuki no Seirei", 2],
      ["Moon Shrine Guardian", 2],
      ["Wood Warrior", 2],
      ["The Cedarback Elder", 1],
      ["Musashi Ken Swordsman", 3],
      ["Seal of Nullification", 1],
    ],
  },
  kimiko: {
    leader: "Frost Sovereign",
    rules: { startTerrain: [{ row: "CLOSE", rounds: [1, 2, 3] }] },
    cards: [
      ["Frozen Wraith", 3],
      ["Cryverin", 3],
      ["Hyouga Yui Clansman", 3],
      ["Shimo no Seirei", 2],
      ["Kori no Seirei", 2],
      ["Byakuho", 2],
      ["Ava, the Snow Terror", 2],
      ["Cryostorm Aegis", 1],
      ["Lord Pengu", 1],
      ["Yuki Onna", 1],
      ["Biting Frost", 1],
      ["Torrential Rain", 1],
      ["Musashi Ken Swordsman", 3],
    ],
  },
  captain: {
    leader: "The Hollow Conductor",
    rules: { startTerrain: [{ row: "JUTSU", rounds: [1] }] },
    cards: [
      ["Ghost Ship Deckhand", 3],
      ["Ghost Ship Gunner", 3],
      ["Fist of 10,000 Volts", 3],
      ["Arashima Stormcaller", 3],
      ["Enrai no Oni", 3],
      ["Mizu no Seirei", 2],
      ["The Salvager", 1],
      ["Undertide Executioner", 1],
      ["Leviathan of the Shroud", 1],
      ["Divine Railgun", 1],
      ["Torrential Rain", 1],
      ["Musashi Ken Swordsman", 2],
      ["Seal of Nullification", 1],
    ],
  },
  kaze: {
    leader: "Kaze no Seirei",
    rules: { extraMulligans: 1 },
    cards: [
      ["Kajioka", 3],
      ["Blazdrift", 3],
      ["Kugatsunagi", 2],
      ["Sky-Bridge Scout", 3],
      ["Wind Release", 1],
      ["Yamabiko Echo-Caller", 2],
      ["Gale Courier", 2],
      ["Typhoon Tear", 1],
      ["Aetherion", 1],
      ["Stormrender", 1],
      ["Kazehiko", 2],
      ["Musashi Ken Swordsman", 2],
      ["Kawarimi", 2],
    ],
  },
  ravena: {
    leader: "Ravena Bloodsilk",
    rules: { strikeBonus: 1 },
    cards: [
      ["Thorn Ambusher", 3],
      ["Black Maw Acolyte", 3],
      ["Mei Back-Alley Enforcer", 3],
      ["Mei Cutpurse", 3],
      ["Thousand Scarlet Fangs", 2],
      ["Oblivion Seal Bearer", 2],
      ["Thorn Ambush Captain", 2],
      ["Veylan, Maw of the Pyre", 2],
      ["Kinjutsu: Black Thorn Rose", 1],
      ["Headless Rider", 1],
      ["Musashi Ken Swordsman", 2],
      ["Seal of Nullification", 1],
    ],
  },
  anbu: {
    leader: "Frost Sovereign",
    cards: [
      ["Frozen Wraith", 3],
      ["Cryverin", 3],
      ["Hyouga Yui Clansman", 3],
      ["Shimo no Seirei", 2],
      ["Kori no Seirei", 2],
      ["Byakuho", 2],
      ["Ava, the Snow Terror", 2],
      ["Cryostorm Aegis", 1],
      ["Yuki Onna", 1],
      ["Anbu Chief", 1],
      ["Kuraokami, Kami of the Night Snow", 1],
      ["Kazehiko", 2],
      ["Biting Frost", 1],
      ["Kawarimi", 1],
    ],
  },
  momo: {
    leader: "Amir, the Hoarder",
    rules: { r1MulliganCap: 5 },
    cards: [
      ["Thorn Ambusher", 3],
      ["Black Maw Acolyte", 3],
      ["Mei Cutpurse", 3],
      ["Mei Back-Alley Enforcer", 2],
      ["Thousand Scarlet Fangs", 2],
      ["Oblivion Seal Bearer", 1],
      ["Thorn Ambush Captain", 2],
      ["Veylan, Maw of the Pyre", 2],
      ["Kinjutsu: Black Thorn Rose", 1],
      ["Headless Rider", 1],
      ["The Caged Sovereign", 1],
      ["Kawarimi", 3],
      ["Seal of Nullification", 1],
    ],
  },
  shishi: {
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
  unmeishi: {
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
};

/** Human deck versus NPC deck (the NPC's rules apply), each on its own seed. */
const MATCHUPS: [seed: string, human: string, npc: string][] = [
  ["replay-1", "lemu", "kazehiko"],
  ["replay-2", "hisame", "junko"],
  ["replay-3", "kimiko", "captain"],
  ["replay-4", "kaze", "ravena"],
  ["replay-5", "anbu", "momo"],
  ["replay-6", "junko", "shishi"],
  ["replay-7", "ravena", "unmeishi"],
  ["replay-8", "momo", "hisame"],
];

/** Expands `[name, copies]` pairs of the frozen catalog into deck card ids. */
const deckOf = (entries: [string, number][]) =>
  entries.flatMap(([name, copies]) => Array.from({ length: copies }, () => cid(name)));

/** A random-bot match on the frozen catalog, so only engine changes move its states. */
const play = (seed: string, human: string, npc: string, botSeed = `${seed}-bot`) => {
  const a = DECKS[human] as TestDeck;
  const b = DECKS[npc] as TestDeck;
  return playBotMatch({
    seed,
    botSeed,
    decks: [deckOf(a.cards), deckOf(b.cards)],
    leaders: [cid(a.leader), cid(b.leader)],
    rules: b.rules,
    cards: KESSEN_RULES_CATALOG,
  });
};

describe("deterministic replay", () => {
  it("uses 25-card signature decks", () => {
    for (const deck of Object.values(DECKS))
      expect(deckOf(deck.cards)).toHaveLength(25);
  });

  it("finishes every scripted match within the stored-state budget", () => {
    for (const [seed, human, npc] of MATCHUPS) {
      const { state, states } = play(seed, human, npc);
      expect(state.phase).toBe("over");
      expect(state.history.length).toBeGreaterThanOrEqual(2);
      for (const step of states)
        expect(JSON.stringify(step).length).toBeLessThan(30_000);
    }
  });

  it("replays the same seed and actions to the same state hash at every step", () => {
    for (const [seed, human, npc] of MATCHUPS) {
      const recorded = play(seed, human, npc);
      const a = DECKS[human] as TestDeck;
      const b = DECKS[npc] as TestDeck;
      let state = createMatch({
        seed,
        seats: [
          { leaderId: cid(a.leader), deck: deckOf(a.cards) },
          { leaderId: cid(b.leader), deck: deckOf(b.cards) },
        ],
        rules: b.rules,
        cards: KESSEN_RULES_CATALOG,
      });
      expect(stateHash(state)).toBe(stateHash(recorded.states[0] as MatchState));
      recorded.log.forEach(({ seat, action }, index) => {
        // Replay from a JSON round trip, as the server stores the state between requests;
        // every other step reorders the keys, as MySQL JSON does.
        const stored = JSON.parse(JSON.stringify(state)) as MatchState;
        const result = applyAction(
          index % 2 === 0 ? stored : (reverseKeys(stored) as MatchState),
          seat,
          action,
        );
        if (!result.ok)
          throw new Error(`Replay diverged at ${index}: ${result.reason}`);
        state = result.state;
        expect(stateHash(state)).toBe(
          stateHash(recorded.states[index + 1] as MatchState),
        );
      });
    }
  });

  it("hashes independently of object key order", () => {
    const { state } = play("replay-keys", "hisame", "kimiko");
    const reversed = reverseKeys(state) as MatchState;
    expect(JSON.stringify(reversed)).not.toBe(JSON.stringify(state));
    expect(stateHash(reversed)).toBe(stateHash(state));
  });

  it("diverges for different seeds", () => {
    const a = play("seed-a", "lemu", "kazehiko", "bot");
    const b = play("seed-b", "lemu", "kazehiko", "bot");
    expect(stateHash(a.states[0] as MatchState)).not.toBe(
      stateHash(b.states[0] as MatchState),
    );
  });

  it("pins how recorded matches replay to CARD_ENGINE_VERSION", () => {
    // A rule change moves this fingerprint: bump CARD_ENGINE_VERSION with it, so matches
    // stored under the previous rules are recognised. It plays the frozen rules catalog,
    // so seed-catalog edits never move it.
    expect({ version: CARD_ENGINE_VERSION, fingerprint: rulesFingerprint() }).toEqual({
      version: 3,
      fingerprint: "4b17ac5854642eb74ee264c6b7d00763836250bae6b5feade99f7ea2f5c185c1",
    });
  });

  it("pins the revised leader texts' rule paths to CARD_ENGINE_VERSION", () => {
    // Plays the leaders whose texts reach rules the base matchups never do (an
    // unconditional Draw, Seal and two Strikes); bump CARD_ENGINE_VERSION with it too.
    expect({ version: CARD_ENGINE_VERSION, fingerprint: revisedFingerprint() }).toEqual(
      {
        version: 3,
        fingerprint: "77c63898d5cdd65d791075dfc38e1d3ad7912d50c96f5de307b9a39564efdaf5",
      },
    );
  });

  it("pins the AI's decisions to KESSEN_AI_VERSION", () => {
    // Every tier plays one match on the frozen catalog with a shuffled pool. A decision
    // change moves this fingerprint: bump KESSEN_AI_VERSION with it.
    expect({ version: KESSEN_AI_VERSION, fingerprint: aiFingerprint() }).toEqual({
      version: 2,
      fingerprint: "40b34ce2cee1603ba61660223d59edb4e4b0a257b590756c089ed8caa5cde858",
    });
  });

  it("pins the seed catalog's engine data", () => {
    // Re-pin on a deliberate balance edit, without a version bump: every match
    // snapshots its own catalog, so a stored match keeps the numbers it started with.
    expect(catalogFingerprint(KESSEN_SEED_CATALOG)).toBe("53a19431618af328");
  });

  it("keeps floats, wall clocks and ambient randomness out of the deterministic modules", () => {
    const files = [
      "rng.ts",
      "types.ts",
      "rules.ts",
      "board.ts",
      "engine.ts",
      "abilities.ts",
      "text.ts",
      "catalog.ts",
      "ai.ts",
      "deck.ts",
      "npcs.ts",
      "rewards.ts",
      "academy.ts",
      "academyLessons.ts",
      "academyPosition.ts",
    ];
    for (const file of files) {
      const source = stripComments(
        readFileSync(
          new URL(`../../../src/libs/kessen/${file}`, import.meta.url),
          "utf8",
        ),
      );
      for (const banned of [
        /Math\.random/,
        /\bDate\b/,
        /\bperformance\b/,
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

const rulesFingerprint = () => {
  const digest = createHash("sha256");
  digest.update(`${CARD_ENGINE_VERSION}:${catalogFingerprint(KESSEN_RULES_CATALOG)}`);
  for (const [seed, human, npc] of MATCHUPS) {
    const match = play(seed, human, npc);
    for (const state of match.states) digest.update(stateHash(state));
    digest.update(hashString(canonicalJson(match.events)));
  }
  return digest.digest("hex");
};

/** Random-bot matches with each revised leader on the human seat, three seeds each. */
const revisedFingerprint = () => {
  const cards = [...KESSEN_RULES_CATALOG, ...KESSEN_RULES_REVISED_LEADERS];
  const digest = createHash("sha256");
  digest.update(`${CARD_ENGINE_VERSION}:${catalogFingerprint(cards)}`);
  for (const [deckKey, npcKey] of REVISED_MATCHUPS) {
    const own = DECKS[deckKey] as TestDeck;
    const npc = DECKS[npcKey] as TestDeck;
    const revised = KESSEN_RULES_REVISED_LEADERS.find(
      (card) => card.id === `${cid(own.leader)}-revised`,
    ) as KessenCard;
    for (const salt of ["a", "b", "c"]) {
      const seed = `revised-${deckKey}-${salt}`;
      const match = playBotMatch({
        seed,
        botSeed: `${seed}-bot`,
        decks: [deckOf(own.cards), deckOf(npc.cards)],
        leaders: [revised.id, cid(npc.leader)],
        rules: npc.rules,
        cards,
      });
      for (const state of match.states) digest.update(stateHash(state));
      digest.update(hashString(canonicalJson(match.events)));
    }
  }
  return digest.digest("hex");
};

/** Signature decks whose leader has a revised text, each against another deck. */
const REVISED_MATCHUPS: [deck: string, npc: string][] = [
  ["hisame", "junko"],
  ["kimiko", "captain"],
  ["captain", "ravena"],
  ["kazehiko", "lemu"],
  ["ravena", "momo"],
];

/** One match per AI tier on the frozen catalog, each seat deciding from its own view. */
const aiFingerprint = () => {
  const digest = createHash("sha256");
  digest.update(`${KESSEN_AI_VERSION}:${catalogFingerprint(KESSEN_RULES_CATALOG)}`);
  KESSEN_AI_TIERS.forEach((tier, index) => {
    const [seed, human, npc] = MATCHUPS[index] as (typeof MATCHUPS)[number];
    const a = DECKS[human] as TestDeck;
    const b = DECKS[npc] as TestDeck;
    const decks = [deckOf(a.cards), deckOf(b.cards)];
    const pool: KessenCard[] = shuffleInPlace(createRng(`pool:${seed}`), [
      ...KESSEN_RULES_CATALOG,
    ]);
    let state = createMatch({
      seed,
      seats: [
        { leaderId: cid(a.leader), deck: decks[0] as string[] },
        { leaderId: cid(b.leader), deck: decks[1] as string[] },
      ],
      rules: b.rules,
      cards: KESSEN_RULES_CATALOG,
    });
    for (let step = 0; step < 400 && state.phase !== "over"; step++) {
      const seat = actingSeats(state)[0];
      if (seat === undefined) break;
      const decision = decideWithTrace(
        viewFor(state, seat),
        seat,
        { tier },
        aiRng(seed, seat, state.step),
        { pool, deck: decks[seat] },
      );
      digest.update(canonicalJson(decision));
      const result = applyAction(state, seat, decision.action);
      if (!result.ok) throw new Error(`Illegal AI action: ${result.reason}`);
      state = result.state;
    }
    digest.update(stateHash(state));
  });
  return digest.digest("hex");
};

const reverseKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, entry]) => [key, reverseKeys(entry)]),
  );
};

const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

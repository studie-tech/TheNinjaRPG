/**
 * The Kessen Circuit: twelve NPC opponents with signature and Ascended decks, house rules,
 * unlock order, first-win rewards, drop tables and barks. Lemu's Academy lessons live
 * in `academy.ts`. Code data, versioned with the engine.
 */
import { KESSEN_NPC_KEYS, type KessenTier } from "@/drizzle/constants";
import type { KessenDeckCard } from "@/drizzle/schema";
import type { KessenAiProfile } from "./ai";
import { copyKey } from "./catalog";
import {
  type DeckFaction,
  dayIndex,
  KESSEN_ALT_LEADERS,
  KESSEN_DECK_FACTIONS,
  KESSEN_STARTER_LEADERS,
  normalizeDeckCards,
} from "./deck";
import { KESSEN_PACK_IDS } from "./packs";
import { type KessenDropTableKey, standardLegendaries } from "./rewards";
import { DEFAULT_KNOBS } from "./rules";
import type { KessenKeyword } from "./text";
import type { KessenCard, MatchRules } from "./types";

/** Power a unit kept on the board gains under Junko's Ascended Blood Moon. */
const BLOOD_MOON_CARRY = 2;
/** Keys of every NPC, Lemu included, in roster order. */
export const KessenNpcKeys = KESSEN_NPC_KEYS;
export type KessenNpcKey = (typeof KessenNpcKeys)[number];

/** The Circuit's matches: the standard match, or a champion's Ascended rematch. */
export const KESSEN_CIRCUIT_MODES = ["standard", "ascended"] as const;
export type KessenCircuitMode = (typeof KESSEN_CIRCUIT_MODES)[number];
/** Every NPC match mode: an Academy lesson at Lemu's table, or a Circuit match. */
export type KessenNpcMode = "lesson" | KessenCircuitMode;

/** An NPC deck: its leader and card counts. */
export interface KessenNpcDeck {
  leaderId: string;
  cards: KessenDeckCard[];
}

/** Items a reward grants. */
export interface KessenItemGrant {
  itemId: string;
  quantity: number;
}

/** A player choice that completes a reward. */
export type KessenRewardChoice =
  | { kind: "items"; itemIds: string[] }
  /**
   * Any standard legendary the player owns no copy of (`unownedLegendaries`); a player
   * who owns them all picks any standard legendary instead.
   */
  | { kind: "unownedLegendary" }
  /** A faction's starter deck and leader (`starterDeck`), once per account. */
  | { kind: "starterFaction" };

/** Once per NPC and mode; not limited by the daily caps. */
export interface KessenFirstWinReward {
  items: KessenItemGrant[];
  choice: KessenRewardChoice | null;
  /** Badge name granted with the reward. */
  badge?: string;
  /** Title granted with the reward. */
  title?: string;
}

/** A variant's named rule as the pre-match screen prints it; `MatchRules` enforce it. */
export interface KessenHouseRule {
  name: string;
  text: string;
}

/** One playable configuration of an NPC. */
export interface KessenNpcVariant {
  tier: KessenTier;
  deck: KessenNpcDeck;
  rules: MatchRules;
  houseRule: KessenHouseRule | null;
  dropTable: KessenDropTableKey | null;
  firstWin: KessenFirstWinReward;
}

/** When an NPC's standard match opens (`npcLockReason`). */
export type KessenNpcUnlock =
  | { kind: "always" }
  /** Every listed NPC beaten in its standard mode. */
  | { kind: "beat"; npcs: KessenNpcKey[] }
  /** A village champion: after Kazehiko, the home champion first. */
  | { kind: "champion" }
  /** Any `count` village champions beaten. */
  | { kind: "champions"; count: number };

/** Speech lines (HTML) per match moment, from the NPC's point of view. */
export interface KessenBarks {
  matchStart: string;
  firstPass: string;
  roundWon: string;
  roundLost: string;
  matchWon: string;
  matchLost: string;
}

/** An NPC's AI personality; the tier comes from the variant being played. */
export type KessenNpcAiProfile = Omit<KessenAiProfile, "tier">;

/** One Circuit opponent: identity, unlock, variants, barks and AI personality. */
export interface KessenNpc {
  key: KessenNpcKey;
  name: string;
  title: string;
  /** Where the NPC sits on the Circuit map. */
  location: string;
  image: string;
  /** Portrait swapped in when the boss reveals its divine form. */
  divineImage: string | null;
  faction: DeckFaction;
  boss: boolean;
  /** Village champions: beaten to open the rest of the Circuit and Ascended rematches. */
  champion: boolean;
  teaches: KessenKeyword[];
  unlock: KessenNpcUnlock;
  standard: KessenNpcVariant;
  ascended: KessenNpcVariant | null;
  barks: KessenBarks;
  aiProfile: KessenNpcAiProfile;
}

const e = (slug: string, count = 1): KessenDeckCard => ({
  itemId: `kessen-${slug}`,
  count,
});
const id = (slug: string) => `kessen-${slug}`;

const UT = "https://ui0arpl8sm.ufs.sh/f/";
const LEADER_IMAGES = {
  hisame: `${UT}ai-sprite-20261018-sxd1f3plxebhw4km47pgn4k4-main-6c6cfeb5b958.webp`,
  junko: `${UT}ai-sprite-20261018-rwh7txta9l7y9baz48olnaao-main-944739a9a2ae.webp`,
  kimiko: `${UT}ai-sprite-20261018-h0tkhn358lux6kr4xztqed3s-main-6144f84f3bf3.webp`,
  crownedCaptain: `${UT}ai-sprite-20261018-fDU9jCPZtH7YHbdQPO9RF-main-25d24b15223f.webp`,
  kazeNoSeirei: `${UT}ai-sprite-20261018-SAZrjNFK30GatL9QsPZlN-main-4266bd4afe06.webp`,
  ravena: `${UT}ai-sprite-20261018-Vg5Tqp6mBvOJsm5zPMpdv-main-6727156fd8c8.webp`,
  divineShishi: `${UT}bn0WSLZhQDTiNPWveEtmy.webp`,
  loomOfFate: `${UT}_4klyO6uSAhyewLQ-6qYu.webp`,
};

/** Each faction's legendary, added to its champion's Ascended deck. */
const FACTION_LEGENDARY: Readonly<Record<DeckFaction, string>> = {
  SHIROHANA: id("amaterasus-avatar"),
  TSUKIMORI: id("yasei-no-seirei-the-wild-spirit"),
  HYORIN: id("kuraokami-kami-of-the-night-snow"),
  AKASUMI: id("the-drowned-gatekeeper"),
  AKIKAZE: id("fury-of-the-white-tiger"),
  SYNDICATE: id("the-caged-sovereign"),
};

/** Each faction's two epics: the Ascended first-win choice. */
const FACTION_EPICS: Readonly<Record<DeckFaction, [string, string]>> = {
  SHIROHANA: [id("subaku-winged-captain"), id("amaterasus-holy-mirror")],
  TSUKIMORI: [id("the-cedarback-elder"), id("demon-of-tsuki")],
  HYORIN: [id("lord-pengu"), id("yuki-onna")],
  AKASUMI: [id("leviathan-of-the-shroud"), id("divine-railgun")],
  AKIKAZE: [id("aetherion"), id("stormrender")],
  SYNDICATE: [id("headless-rider"), id("kinjutsu-black-thorn-rose")],
};

const MUSASHI = id("musashi-ken-swordsman");
const COLOSSUS = id("colossus");

/**
 * Ascended deck: the champion deck minus Musashi Ken x2, plus the faction
 * legendary and Colossus; Syndicate also trades one Oblivion Seal Bearer for Kawarimi to
 * stay at two Infiltrators.
 */
export const ascendedDeckOf = (
  deck: KessenNpcDeck,
  faction: DeckFaction,
): KessenNpcDeck => {
  const delta: KessenDeckCard[] = [
    { itemId: MUSASHI, count: -2 },
    { itemId: FACTION_LEGENDARY[faction], count: 1 },
    { itemId: COLOSSUS, count: 1 },
  ];
  if (faction === "SYNDICATE") {
    delta.push({ itemId: id("oblivion-seal-bearer"), count: -1 }, e("kawarimi"));
  }
  return {
    leaderId: deck.leaderId,
    cards: normalizeDeckCards([...deck.cards, ...delta]),
  };
};

const villageBundle = (faction: DeckFaction): KessenItemGrant => ({
  itemId: KESSEN_PACK_IDS.village(faction),
  quantity: 1,
});

/** First-win reward of a village champion: its alt leader and a Village Bundle. */
const championFirstWin = (faction: DeckFaction): KessenFirstWinReward => ({
  items: [{ itemId: KESSEN_ALT_LEADERS[faction], quantity: 1 }, villageBundle(faction)],
  choice: null,
});

/** Ascended first win: one of the faction's two epics. */
const ascendedFirstWin = (faction: DeckFaction): KessenFirstWinReward => ({
  items: [],
  choice: { kind: "items", itemIds: [...FACTION_EPICS[faction]] },
});

const DEFAULT_AI: KessenNpcAiProfile = {
  passLeadOffset: 0,
  lambdaScale: 100,
  signatures: [],
};

interface ChampionInput {
  key: KessenNpcKey;
  name: string;
  title: string;
  location: string;
  image: string;
  faction: DeckFaction;
  teaches: KessenKeyword[];
  cards: KessenDeckCard[];
  houseRule: KessenHouseRule;
  ascendedRules: MatchRules;
  barks: KessenBarks;
  aiProfile?: KessenNpcAiProfile;
}

const champion = (input: ChampionInput): KessenNpc => {
  const deck = { leaderId: KESSEN_ALT_LEADERS[input.faction], cards: input.cards };
  return {
    key: input.key,
    name: input.name,
    title: input.title,
    location: input.location,
    image: input.image,
    divineImage: null,
    faction: input.faction,
    boss: false,
    champion: true,
    teaches: input.teaches,
    unlock: { kind: "champion" },
    standard: {
      tier: "CHUNIN",
      deck,
      rules: {},
      houseRule: null,
      dropTable: "ADEPT",
      firstWin: championFirstWin(input.faction),
    },
    ascended: {
      tier: "JONIN",
      deck: ascendedDeckOf(deck, input.faction),
      rules: input.ascendedRules,
      houseRule: input.houseRule,
      dropTable: "MASTER",
      firstWin: ascendedFirstWin(input.faction),
    },
    barks: input.barks,
    aiProfile: input.aiProfile ?? DEFAULT_AI,
  };
};

const paperBundle: KessenItemGrant = { itemId: KESSEN_PACK_IDS.paper, quantity: 1 };
const lacquerCase: KessenItemGrant = { itemId: KESSEN_PACK_IDS.lacquer, quantity: 1 };

/** The Circuit roster in unlock order. */
export const KESSEN_NPCS: readonly KessenNpc[] = [
  {
    key: "lemu",
    name: "Lemu",
    title: "Academy Instructor",
    location: "Horizon academy",
    image:
      "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJIG7HmDxfOewksxBoS1HQCihpL7c42Ky9uUFv.webp",
    divineImage: null,
    faction: "AKASUMI",
    boss: false,
    champion: false,
    teaches: ["Strike", "Rally", "Summon"],
    unlock: { kind: "always" },
    standard: {
      tier: "GENIN",
      deck: {
        leaderId: KESSEN_STARTER_LEADERS.AKASUMI,
        cards: [
          e("arashima-stormcaller", 3),
          e("enrai-no-oni", 3),
          e("fist-of-10000-volts", 3),
          e("ghost-ship-deckhand", 3),
          e("ghost-ship-gunner", 3),
          e("musashi-ken-swordsman", 3),
          e("lemu-academy-instructor", 2),
          e("mizu-no-seirei", 2),
          e("colossus"),
          e("divine-railgun"),
          e("leviathan-of-the-shroud"),
        ],
      },
      rules: {},
      houseRule: null,
      dropTable: "NOVICE",
      firstWin: {
        items: [{ itemId: id("lemu-academy-instructor"), quantity: 1 }, paperBundle],
        choice: null,
      },
    },
    ascended: null,
    barks: {
      matchStart: "Cards on the table, student. Let's see what you remember.",
      firstPass: "Passing already? Good. Now make it count.",
      roundWon: "That round is mine. Do you still have cards to spend?",
      roundLost: "Well taken. You kept your hand, I see.",
      matchWon: "Not today. Count your cards before you count your points.",
      matchLost: "You won by saving cards. That's the whole secret.",
    },
    aiProfile: DEFAULT_AI,
  },
  {
    key: "kazehiko",
    name: "Kazehiko",
    title: "Sparring Partner",
    location: "Horizon sparring yard",
    image: `${UT}ai-sprite-20261018-user_2ue4TutSeewDxpR7CqT4IhC7b-main-91bcad7dfc8a.webp`,
    divineImage: null,
    faction: "AKIKAZE",
    boss: false,
    champion: false,
    teaches: ["Empower", "Seal", "Clear Skies"],
    unlock: { kind: "beat", npcs: ["lemu"] },
    standard: {
      tier: "GENIN",
      deck: {
        leaderId: KESSEN_STARTER_LEADERS.AKIKAZE,
        cards: [
          e("kajioka", 3),
          e("sky-bridge-scout", 3),
          e("blazdrift", 3),
          e("kugatsunagi", 3),
          e("wind-release", 3),
          e("kazehiko", 2),
          e("musashi-ken-swordsman", 3),
          e("lemu-academy-instructor", 2),
          e("yamabiko-echo-caller", 2),
          e("colossus"),
        ],
      },
      rules: {},
      houseRule: null,
      dropTable: "NOVICE",
      firstWin: {
        items: [{ itemId: id("kazehiko"), quantity: 1 }, paperBundle],
        choice: null,
      },
    },
    ascended: null,
    barks: {
      matchStart: "Wind first, questions later!",
      firstPass: "You're done? I'm just getting airborne.",
      roundWon: "Tailwind's on my side this round.",
      roundLost: "Huh. The wind turned.",
      matchWon: "Faster next time, yeah?",
      matchLost: "Okay, okay. The teahouses are yours to visit now.",
    },
    aiProfile: DEFAULT_AI,
  },
  champion({
    key: "hisame",
    name: "Hisame",
    title: "Dune Warden",
    location: "Shirohana teahouse",
    image: LEADER_IMAGES.hisame,
    faction: "SHIROHANA",
    teaches: ["Bond", "Resilient", "Unyielding"],
    cards: [
      e("beta-sandworm", 3),
      e("gamma-sandworm", 2),
      e("taiyo-kami-devotee", 3),
      e("mummy-of-the-shining-dunes", 2),
      e("blazing-flash-adept", 2),
      e("fireball", 3),
      e("sand-golem", 2),
      e("subaku-princess", 2),
      e("subaku-winged-captain"),
      e("amaterasus-holy-mirror"),
      e("musashi-ken-swordsman", 3),
      e("seal-of-nullification"),
    ],
    houseRule: {
      name: "High Noon",
      text: "In Round 3, every unit placed from hand gets +1 power.",
    },
    ascendedRules: { r3PlacementBonus: 1 },
    barks: {
      matchStart: "The sun sees every card you hold.",
      firstPass: "Rest in the shade, then. The dunes keep moving.",
      roundWon: "Noon always comes.",
      roundLost: "A cloud. It will pass.",
      matchWon: "Return when you can stand the heat.",
      matchLost: "The desert remembers its equals. Take this banner.",
    },
  }),
  champion({
    key: "junko",
    name: "Junko",
    title: "Moon Warden",
    location: "Tsukimori teahouse",
    image: LEADER_IMAGES.junko,
    faction: "TSUKIMORI",
    teaches: ["Meditate", "Revive", "Bond", "Resilient"],
    cards: [
      e("moonprowler", 3),
      e("owlcat", 3),
      e("mosswolf", 3),
      e("tsukihana", 3),
      e("thorn-grasp", 3),
      e("furuki-no-seirei", 2),
      e("moon-shrine-guardian"),
      e("wood-warrior", 2),
      e("the-cedarback-elder"),
      e("musashi-ken-swordsman", 3),
      e("seal-of-nullification"),
    ],
    houseRule: {
      name: "Blood Moon",
      text: `A unit kept on the board by Resilient${DEFAULT_KNOBS.evergreen ? " or Evergreen" : ""} gets +${BLOOD_MOON_CARRY} power when the next round starts.`,
    },
    ascendedRules: { carryBonus: BLOOD_MOON_CARRY },
    barks: {
      matchStart: "The forest is patient. Are you?",
      firstPass: "Rest. The roots keep growing.",
      roundWon: "What falls here grows back.",
      roundLost: "Every winter ends.",
      matchWon: "Come back next season.",
      matchLost: "The moon bows to you tonight.",
    },
  }),
  champion({
    key: "kimiko",
    name: "Kimiko",
    title: "Frost Warden",
    location: "Hyorin teahouse",
    image: LEADER_IMAGES.kimiko,
    faction: "HYORIN",
    teaches: ["Terrain", "Meditate"],
    cards: [
      e("frozen-wraith", 3),
      e("cryverin", 3),
      e("hyouga-yui-clansman", 3),
      e("shimo-no-seirei", 2),
      e("kori-no-seirei", 3),
      e("byakuho", 2),
      e("ava-the-snow-terror", 2),
      e("cryostorm-aegis"),
      e("lord-pengu"),
      e("yuki-onna"),
      e("biting-frost"),
      e("musashi-ken-swordsman", 3),
    ],
    houseRule: {
      name: "Permafrost Peaks",
      text: "Both Taijutsu rows start every round afflicted by Terrain.",
    },
    ascendedRules: { startTerrain: [{ row: "CLOSE", rounds: [1, 2, 3] }] },
    barks: {
      matchStart: "Pick a row. I'll freeze it.",
      firstPass: "Cold feet already?",
      roundWon: "Frost settles where it likes.",
      roundLost: "A thaw. Nothing more.",
      matchWon: "Warm up and try again.",
      matchLost: "You walked through the blizzard. Respect.",
    },
    aiProfile: {
      ...DEFAULT_AI,
      signatures: [
        // Waits for at least 3 non-Unyielding units in the opponent's Taijutsu row.
        {
          cardId: id("biting-frost"),
          rule: { hold: "untilEnemyRowUnits", row: "CLOSE", min: 3 },
        },
      ],
    },
  }),
  champion({
    key: "crowned-captain",
    name: "The Crowned Captain",
    title: "Captain of the Ghost Ship",
    location: "Akasumi harbour, the Ghost Ship",
    image: LEADER_IMAGES.crownedCaptain,
    faction: "AKASUMI",
    teaches: ["Purge", "Revive", "Terrain"],
    cards: [
      e("ghost-ship-deckhand", 3),
      e("ghost-ship-gunner", 3),
      e("fist-of-10000-volts", 3),
      e("arashima-stormcaller", 3),
      e("enrai-no-oni", 3),
      e("mizu-no-seirei", 2),
      e("the-salvager"),
      e("undertide-executioner"),
      e("leviathan-of-the-shroud"),
      e("divine-railgun"),
      e("torrential-rain"),
      e("musashi-ken-swordsman", 2),
      e("seal-of-nullification"),
    ],
    houseRule: {
      name: "Fog Bank",
      text: "Both Ninjutsu rows start Round 1 afflicted by Terrain.",
    },
    ascendedRules: { startTerrain: [{ row: "JUTSU", rounds: [1] }] },
    barks: {
      matchStart: "All hands! We've a challenger aboard.",
      firstPass: "Pass already? The tide does not.",
      roundWon: "Another one for the deep.",
      roundLost: "Rough waters. We sail on.",
      matchWon: "Swab the deck and come back.",
      matchLost: "You've earned your sea legs. Take the helm.",
    },
    aiProfile: {
      ...DEFAULT_AI,
      signatures: [
        // Fires only at a target with at least 7 stored power.
        { cardId: id("divine-railgun"), rule: { hold: "untilTargetStored", min: 7 } },
      ],
    },
  }),
  champion({
    key: "kaze-no-seirei",
    name: "Kaze no Seirei",
    title: "Spirit of the Gale",
    location: "Akikaze sky-bridge shrine",
    image: LEADER_IMAGES.kazeNoSeirei,
    faction: "AKIKAZE",
    teaches: ["Infiltrator", "Substitution", "Purge"],
    cards: [
      e("kajioka", 3),
      e("blazdrift", 3),
      e("kugatsunagi", 3),
      e("sky-bridge-scout", 3),
      e("wind-release", 2),
      e("yamabiko-echo-caller", 2),
      e("gale-courier"),
      e("typhoon-tear"),
      e("stormrender"),
      e("kazehiko", 2),
      e("musashi-ken-swordsman", 2),
      e("kawarimi", 2),
    ],
    houseRule: {
      name: "Updraft",
      text: "Both players get +1 mulligan at every step.",
    },
    ascendedRules: { extraMulligans: 1 },
    barks: {
      matchStart: "Catch me if the wind allows.",
      firstPass: "Still air. How dull.",
      roundWon: "Swept away.",
      roundLost: "A lull. The gale returns.",
      matchWon: "The sky keeps its secrets.",
      matchLost: "You ride the wind well, mortal.",
    },
  }),
  champion({
    key: "ravena",
    name: "Ravena Bloodsilk",
    title: "Mistress of the Syndicate",
    location: "City of Mei, the Syndicate den",
    image: LEADER_IMAGES.ravena,
    faction: "SYNDICATE",
    teaches: ["Infiltrator", "Purge"],
    cards: [
      e("thorn-ambusher", 3),
      e("black-maw-acolyte", 3),
      e("mei-back-alley-enforcer", 3),
      e("mei-cutpurse", 3),
      e("thousand-scarlet-fangs", 2),
      e("oblivion-seal-bearer", 2),
      e("thorn-ambush-captain", 2),
      e("veylan-maw-of-the-pyre", 2),
      e("kinjutsu-black-thorn-rose"),
      e("headless-rider"),
      e("musashi-ken-swordsman", 2),
      e("seal-of-nullification"),
    ],
    houseRule: { name: "Blood Price", text: "Every Strike deals +1 damage." },
    ascendedRules: { strikeBonus: 1 },
    barks: {
      matchStart: "Every debt is paid in blood. Shall we begin?",
      firstPass: "Folding so soon? How generous.",
      roundWon: "The house always collects.",
      roundLost: "Enjoy it. Interest accrues.",
      matchWon: "Your tab is open. Come back and settle it.",
      matchLost: "Well played. The den remembers a good thief.",
    },
  }),
  {
    key: "anbu-chief",
    name: "Anbu Chief",
    title: "Commander of the Global ANBU",
    location: "Freedom State, Global ANBU HQ",
    image: `${UT}ai-sprite-20261018-pUESbqbSQkf8jZ_RIatnC-main-0c94404cdae1.webp`,
    divineImage: null,
    faction: "HYORIN",
    boss: false,
    champion: false,
    teaches: [],
    unlock: { kind: "champions", count: 3 },
    standard: {
      tier: "JONIN",
      deck: {
        leaderId: KESSEN_ALT_LEADERS.HYORIN,
        cards: [
          e("frozen-wraith", 3),
          e("cryverin", 3),
          e("hyouga-yui-clansman", 3),
          e("shimo-no-seirei", 2),
          e("kori-no-seirei", 2),
          e("byakuho", 2),
          e("ava-the-snow-terror", 2),
          e("cryostorm-aegis"),
          e("yuki-onna"),
          e("anbu-chief"),
          e("kuraokami-kami-of-the-night-snow"),
          e("kazehiko", 2),
          e("biting-frost"),
          e("kawarimi"),
        ],
      },
      rules: {},
      houseRule: null,
      dropTable: "MASTER",
      firstWin: {
        items: [{ itemId: id("anbu-chief"), quantity: 1 }, lacquerCase],
        choice: null,
      },
    },
    ascended: null,
    barks: {
      matchStart: "State your business. Briefly.",
      firstPass: "Noted. Proceeding.",
      roundWon: "Objective secured.",
      roundLost: "Acceptable losses.",
      matchWon: "Dismissed.",
      matchLost: "Impressive. Your file has been updated.",
    },
    aiProfile: DEFAULT_AI,
  },
  {
    key: "momo",
    name: "Momo",
    title: "the Yokai Trickster",
    location: "A different village each day",
    image: `${UT}ai-sprite-20261019-v3-kkRImVBXHpsbT5umRzTEo-main-e1ecfa3b3e99.webp`,
    divineImage: null,
    faction: "SYNDICATE",
    boss: false,
    champion: false,
    teaches: [],
    unlock: { kind: "champions", count: 6 },
    standard: {
      tier: "JONIN",
      deck: {
        leaderId: KESSEN_STARTER_LEADERS.SYNDICATE,
        cards: [
          e("thorn-ambusher", 3),
          e("black-maw-acolyte", 3),
          e("mei-cutpurse", 3),
          e("mei-back-alley-enforcer", 2),
          e("thousand-scarlet-fangs", 2),
          e("oblivion-seal-bearer"),
          e("thorn-ambush-captain", 2),
          e("veylan-maw-of-the-pyre", 2),
          e("kinjutsu-black-thorn-rose"),
          e("headless-rider"),
          e("the-caged-sovereign"),
          e("kawarimi", 3),
          e("seal-of-nullification"),
        ],
      },
      rules: { r1MulliganCap: 5 },
      houseRule: {
        name: "Masquerade",
        text: "Both players may mulligan up to 5 cards before Round 1.",
      },
      dropTable: "MASTER",
      firstWin: { items: [lacquerCase], choice: null },
    },
    ascended: null,
    barks: {
      matchStart: "Hee hee! Shuffle up, shuffle up!",
      firstPass: "Oh, was that card yours?",
      roundWon: "Mine now!",
      roundLost: "Rude! I was winning that.",
      matchWon: "Catch me tomorrow, somewhere else!",
      matchLost: "Fine, fine. Take a shiny thing.",
    },
    aiProfile: DEFAULT_AI,
  },
  {
    key: "shishi",
    name: "Shishi",
    title: "God of Death",
    location: "Kuzenbo mountain shrine",
    image: `${UT}m-Dl27oHF1rtNlyAm-dv6.webp`,
    divineImage: LEADER_IMAGES.divineShishi,
    faction: "TSUKIMORI",
    boss: true,
    champion: false,
    teaches: [],
    unlock: { kind: "beat", npcs: ["anbu-chief", "momo"] },
    standard: {
      tier: "KAGE",
      deck: {
        leaderId: id("leader-divine-shishi"),
        cards: [
          e("shishi-god-of-death"),
          e("yasei-no-seirei-the-wild-spirit"),
          e("kuzenbo-the-mountain-god"),
          e("the-cedarback-elder"),
          e("demon-of-tsuki"),
          e("cruel-sun"),
          e("furuki-no-seirei", 2),
          e("moon-shrine-guardian", 2),
          e("wood-warrior", 2),
          e("moonprowler", 3),
          e("owlcat", 2),
          e("mosswolf", 3),
          e("tsukihana", 2),
          e("thorn-grasp"),
          e("kawarimi"),
          e("seal-of-nullification"),
        ],
      },
      rules: { extraMulligans: { seat: "human", n: 1 } },
      houseRule: {
        name: "Night Parade",
        text: "You get +1 mulligan at every step to offset the boss's larger budget.",
      },
      dropTable: "KAGE",
      firstWin: {
        items: [{ itemId: id("shishi-god-of-death"), quantity: 1 }],
        choice: null,
        badge: "Night Parade Survivor",
      },
    },
    ascended: null,
    barks: {
      matchStart: "Every soul plays this game once. Begin.",
      firstPass: "You yield to the inevitable.",
      roundWon: "The parade claims another.",
      roundLost: "Death is patient.",
      matchWon: "Your lantern is out. Walk with the parade.",
      matchLost: "You survived the Night Parade. Few do.",
    },
    aiProfile: DEFAULT_AI,
  },
  {
    key: "unmeishi",
    name: "Unmeishi",
    title: "the Fate-Weaver",
    location: "Wake Island, beyond the Card Hall",
    image: `${UT}WcRihRlPNO7qFWEsAbpUr.webp`,
    divineImage: LEADER_IMAGES.loomOfFate,
    faction: "SHIROHANA",
    boss: true,
    champion: false,
    teaches: [],
    unlock: { kind: "beat", npcs: ["shishi"] },
    standard: {
      tier: "KAGE",
      deck: {
        leaderId: id("leader-the-loom-of-fate"),
        cards: [
          e("amaterasus-avatar"),
          e("raizhen-the-ten-tailed"),
          e("aurex-the-imperial-wyrm"),
          e("subaku-winged-captain"),
          e("amaterasus-holy-mirror"),
          e("colossus"),
          e("gamma-sandworm", 2),
          e("subaku-princess", 2),
          e("sand-golem", 2),
          e("taiyo-kami-devotee", 3),
          e("mummy-of-the-shining-dunes", 2),
          e("blazing-flash-adept", 2),
          e("fireball", 2),
          e("beta-sandworm"),
          e("lemu-academy-instructor"),
          e("seal-of-nullification"),
          e("kawarimi"),
        ],
      },
      rules: { leaderRecharge: "onRoundLoss", leaderRechargeSeat: 1 },
      houseRule: {
        name: "Thread of Fate",
        text: "When Unmeishi loses a round, her leader ability becomes usable again.",
      },
      dropTable: "KAGE",
      firstWin: {
        items: [],
        choice: { kind: "unownedLegendary" },
        title: "Thread-Reader",
      },
    },
    ascended: null,
    barks: {
      matchStart: "I have already seen how this ends.",
      firstPass: "A thread cut short.",
      roundWon: "Every thread you pull is one I spun.",
      roundLost: "The loom turns. Watch.",
      matchWon: "As it was woven.",
      matchLost: "You have rewoven fate. Read the threads, then.",
    },
    aiProfile: {
      ...DEFAULT_AI,
      signatures: [
        // Always held for Round 3.
        {
          cardId: id("raizhen-the-ten-tailed"),
          rule: { hold: "untilRound", round: 3 },
        },
      ],
    },
  },
];

const BY_KEY = new Map<string, KessenNpc>(KESSEN_NPCS.map((npc) => [npc.key, npc]));

/** The NPC with this key; undefined for unknown keys. */
export const kessenNpc = (key: string) => BY_KEY.get(key);

/** The AI profile an NPC plays a variant with: its personality at the variant's tier. */
export const kessenNpcAiProfile = (
  npc: KessenNpc,
  tier: KessenTier,
): KessenAiProfile => ({
  ...npc.aiProfile,
  tier,
});

/** The variant of an NPC mode; null when the NPC has no such mode. */
export const npcVariant = (
  npc: KessenNpc,
  mode: KessenNpcMode,
): KessenNpcVariant | null =>
  mode === "standard" ? npc.standard : mode === "ascended" ? npc.ascended : null;

/** Distinct cards an NPC's drop table picks from: its signature and Ascended decks. */
export const npcDropPool = (npc: KessenNpc, cards: Iterable<KessenCard>) => {
  const ids = new Set<string>();
  for (const variant of [npc.standard, npc.ascended]) {
    for (const entry of variant?.deck.cards ?? []) ids.add(entry.itemId);
  }
  return [...cards]
    .filter((card) => ids.has(card.id) && card.isCollectible && card.kind !== "LEADER")
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
};

/** Forbidden variants a Kage win may drop: Shishi only his own, Unmeishi any of them. */
export const npcForbiddenPool = (npc: KessenNpc, cards: Iterable<KessenCard>) => {
  if (npc.standard.dropTable !== "KAGE") return [];
  const forbidden = [...cards]
    .filter((card) => card.variant === "FORBIDDEN")
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return npc.key === "shishi"
    ? forbidden.filter((card) => card.baseCardId === id("shishi-god-of-death"))
    : forbidden;
};

/**
 * The catalog cards an NPC match stores for its turns and payout: every card of both
 * seats' factions and Neutral's possible deck cards (what the AI infers hands and threats
 * from), the drop and Forbidden pools, the legendaries of an unowned-legendary first-win
 * pick, and each card sharing a name with those, so copy counts stay exact.
 */
export const npcMatchPool = (
  npc: KessenNpc,
  mode: KessenNpcMode,
  factions: readonly string[],
  cards: readonly KessenCard[],
) => {
  const rewards = [
    ...npcDropPool(npc, cards),
    ...npcForbiddenPool(npc, cards),
    ...(npcVariant(npc, mode)?.firstWin.choice?.kind === "unownedLegendary"
      ? standardLegendaries(cards)
      : []),
  ];
  const names = new Set(rewards.map(copyKey));
  return cards.filter(
    (card) =>
      factions.includes(card.faction) ||
      (card.faction === "NEUTRAL" &&
        card.isCollectible &&
        card.kind !== "LEADER" &&
        card.variant === "STANDARD") ||
      names.has(copyKey(card)),
  );
};

/** Village names mapped to their faction; Syndicate is the outlaw side. */
const VILLAGE_FACTIONS: Readonly<Record<string, DeckFaction>> = {
  Shirohana: "SHIROHANA",
  Tsukimori: "TSUKIMORI",
  Hyorin: "HYORIN",
  Akasumi: "AKASUMI",
  Akikaze: "AKIKAZE",
  Syndicate: "SYNDICATE",
};

/**
 * The faction of a player's village. Outlaws are Syndicate; Horizon, Freedom State and
 * players without a village have none.
 */
export const villageFaction = (
  villageName: string | null | undefined,
  isOutlaw = false,
): DeckFaction | null => {
  if (isOutlaw) return "SYNDICATE";
  return villageName ? (VILLAGE_FACTIONS[villageName] ?? null) : null;
};

/**
 * The player's home faction: their village's, else the faction chosen after the lesson.
 * Null means every champion is open (the player picks one).
 */
export const homeFaction = (
  villageName: string | null | undefined,
  isOutlaw: boolean,
  starterFaction: string | null | undefined,
): DeckFaction | null =>
  villageFaction(villageName, isOutlaw) ??
  KESSEN_DECK_FACTIONS.find((faction) => faction === starterFaction) ??
  null;

/** Village whose teahouse Momo visits on `dayKey`. */
export const momoFaction = (dayKey: string): DeckFaction =>
  KESSEN_DECK_FACTIONS[
    dayIndex(`momo:${dayKey}`, KESSEN_DECK_FACTIONS.length)
  ] as DeckFaction;

/** What the unlock rules read: NPC keys with a standard or Ascended first win. */
export interface KessenCircuitProgress {
  /** The first Academy lesson is complete. */
  lessonCompleted: boolean;
  beaten: readonly string[];
  ascendedBeaten: readonly string[];
  homeFaction: DeckFaction | null;
}

/** Keys of the village champions, in roster order. */
export const championKeys = () =>
  KESSEN_NPCS.filter((npc) => npc.champion).map((npc) => npc.key);

/** Why an NPC mode is locked; null when it can be challenged. */
export const npcLockReason = (
  npc: KessenNpc,
  mode: KessenCircuitMode,
  progress: KessenCircuitProgress,
): string | null => {
  const beaten = new Set(progress.beaten);
  const championsBeaten = championKeys().filter((key) => beaten.has(key)).length;
  if (mode === "ascended") {
    if (!npc.ascended) return "No Ascended rematch with this opponent.";
    if (championsBeaten < championKeys().length)
      return "Beat all six village champions.";
    return null;
  }
  if (npc.key === "lemu" && !progress.lessonCompleted)
    return "Finish Lemu's first Academy lesson first.";
  const unlock = npc.unlock;
  switch (unlock.kind) {
    case "always":
      return null;
    case "beat": {
      const missing = unlock.npcs.filter((key) => !beaten.has(key));
      if (missing.length === 0) return null;
      return `Beat ${missing.map((key) => kessenNpc(key)?.name ?? key).join(" and ")}.`;
    }
    case "champion": {
      if (!beaten.has("kazehiko")) return "Beat Kazehiko.";
      if (championsBeaten > 0 || progress.homeFaction === null) return null;
      return npc.faction === progress.homeFaction ? null : "Beat your home champion.";
    }
    case "champions":
      return championsBeaten >= unlock.count
        ? null
        : unlock.count === championKeys().length
          ? "Beat all six village champions."
          : `Beat any ${unlock.count} village champions.`;
  }
};

/**
 * Display data shared by the Card Hall components: faction titles and perks, tier pips,
 * Circuit map pin positions, deck summaries and the "where to find" sources of a card.
 * Pure; every input arrives through props, so the lists follow live data.
 */

import {
  IMG_KESSEN_NPC_PORTRAITS,
  KESSEN_COPY_LIMITS,
  type KessenTier,
} from "@/drizzle/constants";
import {
  catalogById,
  type DeckFaction,
  KESSEN_ALT_LEADERS,
  KESSEN_DECK_FACTIONS,
  KESSEN_STARTER_LEADERS,
  type OwnedQuantities,
  validateDeck,
} from "@/libs/kessen/deck";
import {
  KESSEN_NPCS,
  type KessenFirstWinReward,
  type KessenNpcKey,
  kessenNpc,
} from "@/libs/kessen/npcs";
import {
  KESSEN_FACTION_NAMES,
  KESSEN_PACK_IDS,
  kessenPackName,
  kessenVillagePackFaction,
} from "@/libs/kessen/packs";
import { DEFAULT_KNOBS } from "@/libs/kessen/rules";
import type { KessenCard, KessenKnobs } from "@/libs/kessen/types";
import { clamp } from "@/utils/math";
import type { KessenFaction } from "@/validators/itemCard";
import type {
  KessenCatalogEntry,
  KessenCircuitEntry,
  KessenDeckRow,
  KessenHub,
  KessenPackEntry,
} from "@/validators/kessen";

/**
 * A faction's passive perk under a set of rule knobs, worded from the knobs so the text
 * names what a match does; null for a faction whose perk the knobs switch off.
 */
export const kessenFactionPerk = (
  faction: KessenFaction,
  knobs: Readonly<KessenKnobs> = DEFAULT_KNOBS,
): { perk: string; perkText: string } | null => {
  switch (faction) {
    case "SHIROHANA":
      return knobs.sunBonus > 0
        ? {
            perk: "Sun-Blessed",
            perkText: `The first unit you place from your hand each round gets +${knobs.sunBonus} power.`,
          }
        : null;
    case "TSUKIMORI":
      return knobs.evergreen
        ? {
            perk: "Evergreen",
            perkText: "Your last-placed unit stays on the board into the next round.",
          }
        : null;
    case "HYORIN":
      return knobs.permafrost
        ? {
            perk: "Permafrost",
            perkText: `Terrain from your cards and leader afflicts only the opponent's side${knobs.permafrostR3 ? "" : " before Round 3"}.`,
          }
        : null;
    case "AKASUMI":
      return knobs.tideCount > 0
        ? {
            perk: "Returning Tide",
            perkText: `In Round 3 ${knobs.tideCount === 1 ? "your strongest unit" : `up to ${knobs.tideCount} of your strongest units`} of power ${knobs.tideMaxPower} or less returns from your discard to fight again.`,
          }
        : null;
    case "AKIKAZE":
      return knobs.tailwind > 0
        ? {
            perk: "Tailwind",
            perkText: `${knobs.tailwind === 1 ? "One extra mulligan" : `${knobs.tailwind} extra mulligans`} at every mulligan step.`,
          }
        : null;
    case "SYNDICATE":
      return knobs.riggedOdds
        ? {
            perk: "Rigged Odds",
            perkText: `You win a tied round${knobs.riggedOddsR3 ? "" : " before Round 3"} if you played a card from your hand in it.`,
          }
        : null;
    case "NEUTRAL":
      return null;
  }
};

/** A faction's perk fields under the default knobs; both null without a perk. */
function perkFields(faction: KessenFaction) {
  const perk = kessenFactionPerk(faction);
  return { perk: perk?.perk ?? null, perkText: perk?.perkText ?? null };
}

/** Region titles, identities and passive perks (under the default knobs) of the factions. */
export const KESSEN_FACTION_INFO: Record<
  KessenFaction,
  { region: string; perk: string | null; perkText: string | null; identity: string }
> = {
  SHIROHANA: {
    region: "Sunward Dunes",
    identity: "Goes wide in one row and pumps it.",
    ...perkFields("SHIROHANA"),
  },
  TSUKIMORI: {
    region: "Moonforest",
    identity: "Wins long rounds and carries points forward.",
    ...perkFields("TSUKIMORI"),
  },
  HYORIN: {
    region: "Frost Peaks",
    identity: "Shrinks the opponent's widest row.",
    ...perkFields("HYORIN"),
  },
  AKASUMI: {
    region: "Storm Coast",
    identity: "Floods the board late with crews and summons.",
    ...perkFields("AKASUMI"),
  },
  AKIKAZE: {
    region: "Gale Highlands",
    identity: "Wins consistency and passing duels.",
    ...perkFields("AKIKAZE"),
  },
  SYNDICATE: {
    region: "Oblivion Outlaws",
    identity: "Plays an exact-points game around ties and denial.",
    ...perkFields("SYNDICATE"),
  },
  NEUTRAL: {
    region: "Wanderers and Calamities",
    identity: "Tech cards and the neutral legendaries; they join any deck.",
    perk: null,
    perkText: null,
  },
};

/** Book order of the factions: the six deck factions, then Neutral. */
export const KESSEN_BOOK_FACTIONS: readonly KessenFaction[] = [
  ...KESSEN_DECK_FACTIONS,
  "NEUTRAL",
];

export const KESSEN_TIER_LABELS: Record<KessenTier, string> = {
  GENIN: "Genin",
  CHUNIN: "Chunin",
  JONIN: "Jonin",
  KAGE: "Kage",
};

/** Difficulty pips of a tier: Genin 1 to Kage 4. */
export const tierPips = (tier: KessenTier) =>
  ({ GENIN: 1, CHUNIN: 2, JONIN: 3, KAGE: 4 })[tier];

/** Pin of each Circuit seat on the painted map, in percent of the map image. */
const CIRCUIT_PINS: Record<KessenNpcKey, { x: number; y: number }> = {
  lemu: { x: 14, y: 44 },
  kazehiko: { x: 26, y: 22 },
  kimiko: { x: 46, y: 9 },
  shishi: { x: 63, y: 13 },
  "kaze-no-seirei": { x: 86, y: 11 },
  "anbu-chief": { x: 56, y: 38 },
  junko: { x: 87, y: 46 },
  ravena: { x: 30, y: 64 },
  hisame: { x: 63, y: 67 },
  "crowned-captain": { x: 13, y: 84 },
  momo: { x: 46, y: 84 },
  unmeishi: { x: 88, y: 85 },
};

/** Where Momo sits on the day she visits each village's teahouse. */
const MOMO_SPOTS: Record<DeckFaction, { x: number; y: number }> = {
  SHIROHANA: { x: 46, y: 84 },
  TSUKIMORI: { x: 75, y: 30 },
  HYORIN: { x: 40, y: 43 },
  AKASUMI: { x: 44, y: 86 },
  AKIKAZE: { x: 75, y: 30 },
  SYNDICATE: { x: 46, y: 84 },
};

/**
 * Safe inset of the pins, in percent of the map: a pin's portrait sits above its anchor
 * and its name plate below, so the vertical band leaves room for both inside the frame.
 */
const PIN_INSET = { xMin: 9, xMax: 91, yMin: 13, yMax: 79 };

/**
 * Map position of a Circuit entry, clamped to the safe inset; Momo follows the village
 * named in her location.
 */
export const circuitPinPosition = (
  entry: Pick<KessenCircuitEntry, "key" | "location">,
) => {
  const village =
    entry.key === "momo"
      ? KESSEN_DECK_FACTIONS.find((faction) =>
          entry.location
            .toLowerCase()
            .includes(KESSEN_FACTION_NAMES[faction].toLowerCase()),
        )
      : undefined;
  const pin = village ? MOMO_SPOTS[village] : CIRCUIT_PINS[entry.key];
  return {
    x: clamp(pin.x, PIN_INSET.xMin, PIN_INSET.xMax),
    y: clamp(pin.y, PIN_INSET.yMin, PIN_INSET.yMax),
  };
};

/**
 * Focus order of the map pins: by difficulty (bosses last), then in reading order across
 * the map, top to bottom in bands and left to right, so Tab never jumps back and forth.
 */
export const mapPinOrder = <
  T extends {
    entry: Pick<KessenCircuitEntry, "tier" | "boss">;
    position: { x: number; y: number };
  },
>(
  pins: readonly T[],
) =>
  [...pins].sort(
    (a, b) =>
      tierPips(a.entry.tier) - tierPips(b.entry.tier) ||
      Number(a.entry.boss) - Number(b.entry.boss) ||
      Math.round(a.position.y / PIN_ROW_BAND) -
        Math.round(b.position.y / PIN_ROW_BAND) ||
      a.position.x - b.position.x,
  );

/** Height of a reading-order row of pins, in percent of the map. */
const PIN_ROW_BAND = 12;

/**
 * What the next standard first win grants, as display lines: the preview items, the
 * reward choice and the title. Empty once the first win is claimed.
 */
export const firstWinRewardLines = (
  entry: Pick<KessenCircuitEntry, "key" | "firstWinAt" | "firstWinPreview">,
  lookup: Readonly<Record<string, KessenCatalogEntry>>,
  packs: readonly KessenPackEntry[] = [],
) => {
  if (entry.firstWinAt) return [];
  return rewardLines(
    entry.firstWinPreview,
    kessenNpc(entry.key)?.standard.firstWin,
    lookup,
    packs,
  );
};

/**
 * What the next Ascended first win grants, as display lines. Empty while the rematch is
 * locked, once it is beaten, and for opponents without one.
 */
export const ascendedFirstWinRewardLines = (
  entry: Pick<
    KessenCircuitEntry,
    "key" | "ascendedTier" | "ascendedLockReason" | "ascendedFirstWinAt"
  >,
  lookup: Readonly<Record<string, KessenCatalogEntry>>,
  packs: readonly KessenPackEntry[] = [],
) => {
  if (!entry.ascendedTier || entry.ascendedLockReason || entry.ascendedFirstWinAt)
    return [];
  const reward = kessenNpc(entry.key)?.ascended?.firstWin;
  if (!reward) return [];
  return rewardLines(
    reward.items.map((item) => item.itemId),
    reward,
    lookup,
    packs,
  );
};

/**
 * A lock reason with the player's progress: the champion count for champion locks, the
 * home champion by name, the count of named opponents beaten when a lock names several,
 * and (with `chain`, for the sheet) the condition of a still-locked opponent this one
 * waits on (one level). Rows pass `chain = false` to stay one sentence.
 */
export const lockProgressText = (
  reason: string | null,
  entry: Pick<KessenCircuitEntry, "key">,
  circuit: readonly KessenCircuitEntry[],
  mode: "standard" | "ascended" = "standard",
  chain = true,
): string | null => {
  if (!reason) return null;
  const npc = kessenNpc(entry.key);
  if (!npc || circuit.length === 0) return reason;
  const championsBeaten = circuit.filter(
    (other) => other.champion && other.firstWinAt,
  ).length;
  const championTotal = KESSEN_NPCS.filter((other) => other.champion).length;
  const withCount = (count: number) =>
    `${withoutPeriod(reason)} · ${Math.min(championsBeaten, count)}/${count}`;
  if (mode === "ascended") return withCount(championTotal);
  const unlock = npc.unlock;
  if (unlock.kind === "champions") return withCount(unlock.count);
  if (unlock.kind === "champion" && HOME_CHAMPION_LOCK.test(reason)) {
    // Until the first champion falls, the home champion is the only one open.
    const home = circuit.find(
      (other) =>
        other.champion &&
        !other.lockReason &&
        !other.firstWinAt &&
        other.key !== entry.key,
    );
    return home ? `Beat ${home.name}, your home champion.` : reason;
  }
  if (unlock.kind !== "beat") return reason;
  const named =
    unlock.npcs.length > 1
      ? `${withoutPeriod(reason)} · ${
          unlock.npcs.filter(
            (key) => circuit.find((other) => other.key === key)?.firstWinAt,
          ).length
        }/${unlock.npcs.length}`
      : reason;
  if (!chain) return named;
  const chained = unlock.npcs.flatMap((key) => {
    const other = circuit.find((candidate) => candidate.key === key);
    const inner = other
      ? lockProgressText(other.lockReason, other, circuit, "standard", false)
      : null;
    return other && inner
      ? [`${other.name} unlocks once you ${lowerFirst(withoutPeriod(inner))}.`]
      : [];
  });
  return chained.length > 0 ? `${withPeriod(named)} ${chained.join(" ")}` : named;
};

/**
 * An opponent's wins by mode. `wins` counts both modes, so it reads as the standard count
 * until the Ascended rematch is beaten; after that the Ascended tier reads "beaten" and the
 * count is the total of both.
 */
export const kessenWinText = (
  entry: Pick<KessenCircuitEntry, "wins" | "ascendedFirstWinAt">,
) => {
  const count = `${entry.wins} ${entry.wins === 1 ? "win" : "wins"}`;
  if (entry.ascendedFirstWinAt)
    return { standard: null, ascended: "beaten", total: `${count} in all` };
  return { standard: entry.wins > 0 ? count : null, ascended: null, total: null };
};

/**
 * "Round 2 · 1–0 · your turn" (round, rounds won by the player and the opponent, who
 * acts): one line for the sheet, the map strip and the banner's Resume button.
 */
export const activeMatchStateText = ({
  round,
  roundWins,
  yourTurn,
}: Pick<NonNullable<KessenHub["activeMatch"]>, "round" | "roundWins" | "yourTurn">) =>
  `Round ${round} · ${roundWins[0]}–${roundWins[1]} · ${yourTurn ? "your turn" : "their turn"}`;

/**
 * Portrait of a Circuit NPC: the painted Kessen portrait once the NPC is open, else its
 * transparent AI sprite, which renders as a clean ink silhouette.
 */
export const npcPortrait = (
  entry: Pick<KessenCircuitEntry, "key" | "image" | "lockReason">,
) =>
  npcPortraitKind(entry) === "painted"
    ? IMG_KESSEN_NPC_PORTRAITS[entry.key as keyof typeof IMG_KESSEN_NPC_PORTRAITS]
    : entry.image;

/** Whether `npcPortrait` shows a painted bust or a full-body AI sprite. */
export const npcPortraitKind = (
  entry: Pick<KessenCircuitEntry, "key" | "lockReason">,
): "painted" | "sprite" =>
  !entry.lockReason && entry.key in IMG_KESSEN_NPC_PORTRAITS ? "painted" : "sprite";

/** Copies of a card a deck may hold (and the collection counts as complete). */
export const copyLimitOf = (card: Pick<KessenCard, "rarity">) =>
  KESSEN_COPY_LIMITS[card.rarity];

/** Catalog entries by item id. */
export const catalogLookup = (cards: readonly KessenCatalogEntry[]) =>
  catalogById(cards) as Record<string, KessenCatalogEntry>;

/** Display name of a reward item: a card, a pack, or the id as a last resort. */
export const kessenItemName = (
  itemId: string,
  lookup: Readonly<Record<string, KessenCatalogEntry>>,
  packs: readonly KessenPackEntry[] = [],
) =>
  lookup[itemId]?.name ??
  packs.find((pack) => pack.id === itemId)?.name ??
  kessenPackName(itemId) ??
  itemId;

/** One saved deck as the Card Hall shows it on chips and pickers. */
export interface KessenDeckSummary {
  id: string;
  name: string;
  faction: DeckFaction | null;
  leaderName: string;
  provision: number;
  budget: number;
  cards: number;
  /** Valid with owned copies only. */
  ready: boolean;
  /** Only short of owned copies or cards, so "Fill with borrowed" completes it. */
  fillable: boolean;
  /** First rule the deck breaks; null when ready. */
  problem: string | null;
}

/** Validates a saved deck against the catalog and owned copies for display. */
export const summarizeDeck = (
  deck: KessenDeckRow,
  lookup: Readonly<Record<string, KessenCard>>,
  owned: OwnedQuantities,
): KessenDeckSummary => {
  const leader = lookup[deck.leaderItemId];
  const result = validateDeck(
    { leaderId: deck.leaderItemId, cards: deck.cards },
    lookup,
    {
      owned,
    },
  );
  const faction =
    leader && leader.faction !== "NEUTRAL" ? (leader.faction as DeckFaction) : null;
  return {
    id: deck.id,
    name: deck.name,
    faction,
    leaderName: leader?.name ?? "No leader",
    provision: result.stats.provision,
    budget: result.stats.budget,
    cards: result.stats.cards,
    ready: result.ok,
    fillable:
      !result.ok &&
      result.errors.every(
        (error) => error.code === "notOwned" || error.code === "size",
      ) &&
      (owned[deck.leaderItemId] ?? 0) > 0,
    problem: result.errors[0]?.message ?? null,
  };
};

/** Live sources of a card for the collection book's "Where to find" list. */
export interface KessenFindContext {
  packs: readonly KessenPackEntry[];
  /** First wins already earned here are no longer listed as sources. */
  circuit: readonly KessenCircuitEntry[];
  /**
   * Whether the player still has the one-time First Bundle to come (it arrives with the
   * starter choice). Omitted means it was granted, as for every player past the lesson.
   */
  firstBundleAhead?: boolean;
  /** Further sources from live data (dungeon drops, world AI drops, quest rewards). */
  extra?: Readonly<Record<string, readonly string[]>>;
}

/**
 * Where a card can be obtained, most dependable first: first wins still to earn, packs
 * by their chance to hold the card's rarity, wins against NPCs whose deck carries it, then
 * any extra sources the page passes in. One-time sources already used are left out.
 */
export const whereToFind = (card: KessenCatalogEntry, context: KessenFindContext) => {
  const firstWins: string[] = [];
  const packs: { name: string; chance: number; village: boolean }[] = [];
  const drops: string[] = [];
  const npcName = (key: string) =>
    context.circuit.find((entry) => entry.key === key)?.name ??
    KESSEN_NPCS.find((npc) => npc.key === key)?.name ??
    key;
  const circuitEntry = (key: string) =>
    context.circuit.find((entry) => entry.key === key);

  if (card.kind === "LEADER") {
    const faction = card.faction as DeckFaction;
    if (KESSEN_STARTER_LEADERS[faction] === card.id)
      firstWins.push(`${KESSEN_FACTION_NAMES[faction]} starter deck`);
    if (KESSEN_ALT_LEADERS[faction] === card.id) {
      const champion = KESSEN_NPCS.find(
        (npc) => npc.champion && npc.faction === faction,
      );
      if (champion && !circuitEntry(champion.key)?.firstWinAt)
        firstWins.push(`First win against ${npcName(champion.key)}`);
    }
  } else {
    const tier = card.variant === "FORBIDDEN" ? "FORBIDDEN" : card.rarity;
    for (const pack of context.packs) {
      if (pack.id === KESSEN_PACK_IDS.first && !context.firstBundleAhead) continue;
      const chance = Math.max(
        pack.odds.normal[tier] ?? 0,
        pack.odds.rareSlot[tier] ?? 0,
      );
      if (chance <= 0 || !packCovers(pack.id, card.faction)) continue;
      packs.push({
        name: pack.name,
        chance,
        village: !!kessenVillagePackFaction(pack.id),
      });
    }
  }

  for (const npc of KESSEN_NPCS) {
    const entry = circuitEntry(npc.key);
    const open = [
      entry?.firstWinAt ? null : npc.standard,
      entry?.ascendedFirstWinAt ? null : npc.ascended,
    ].filter((variant) => variant !== null);
    if (
      open.some(
        (variant) =>
          variant.firstWin.items.some((item) => item.itemId === card.id) ||
          (variant.firstWin.choice?.kind === "items" &&
            variant.firstWin.choice.itemIds.includes(card.id)),
      )
    ) {
      firstWins.push(`First win against ${npcName(npc.key)}`);
      continue;
    }
    const variants = [npc.standard, npc.ascended].filter((variant) => variant !== null);
    if (
      card.kind !== "LEADER" &&
      card.variant === "STANDARD" &&
      variants.some(
        (variant) =>
          variant.dropTable &&
          variant.deck.cards.some((deckCard) => deckCard.itemId === card.id),
      )
    ) {
      drops.push(`Wins against ${npcName(npc.key)}`);
    }
  }

  // A Neutral card sits in every Village Bundle: one line names them all.
  const anyVillage = packs.filter((pack) => pack.village).length > 1;
  const packNames = packs
    .sort((a, b) => b.chance - a.chance)
    .map((pack) => (anyVillage && pack.village ? ANY_VILLAGE_BUNDLE : pack.name));

  return [
    ...new Set([
      ...firstWins,
      ...packNames,
      ...drops,
      ...(context.extra?.[card.id] ?? []),
    ]),
  ];
};

const ANY_VILLAGE_BUNDLE = "Any Village Bundle";

/** Whether a pack's pool can hold a card of `faction` (Village Bundles: own + Neutral). */
const packCovers = (packId: string, faction: KessenFaction) => {
  const village = kessenVillagePackFaction(packId);
  return !village || faction === "NEUTRAL" || faction === village;
};

/** The server's lock reason for a champion behind the player's home champion. */
const HOME_CHAMPION_LOCK = /home champion/i;

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

const withoutPeriod = (text: string) => text.replace(/\.$/, "");

const withPeriod = (text: string) => (text.endsWith(".") ? text : `${text}.`);

/** A first-win reward as display lines: its items, its choice and its title. */
const rewardLines = (
  itemIds: readonly string[],
  reward: KessenFirstWinReward | undefined,
  lookup: Readonly<Record<string, KessenCatalogEntry>>,
  packs: readonly KessenPackEntry[],
) => {
  const lines = itemIds.map((id) => kessenItemName(id, lookup, packs));
  const choice = reward?.choice;
  if (choice?.kind === "unownedLegendary") lines.push("any legendary you don't own");
  else if (choice?.kind === "items")
    lines.push(
      `one of ${choice.itemIds.map((id) => kessenItemName(id, lookup, packs)).join(" or ")}`,
    );
  if (reward?.title) lines.push(`the title ${reward.title}`);
  return lines;
};

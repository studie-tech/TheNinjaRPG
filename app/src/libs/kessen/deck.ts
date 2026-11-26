/**
 * Deck rules and deck generation: the validator, starter decks, the daily loaner, the
 * borrowed fill of short decks and auto-build over owned cards. Pure and deterministic:
 * every random choice comes from a string-seeded sfc32 stream and iterates id-sorted pools.
 */
import { KESSEN_COPY_LIMITS } from "@/drizzle/constants";
import type { KessenDeckCard } from "@/drizzle/schema";
import type { KessenFaction } from "@/validators/itemCard";
import { copyKey } from "./catalog";
import { selectWeighted } from "./rewards";
import { createRng, hashString, type Rng } from "./rng";
import type { KessenCard, KessenRarity } from "./types";

/** The six factions a deck can be built around; Neutral cards join any of them. */
export type DeckFaction = Exclude<KessenFaction, "NEUTRAL">;
export const KESSEN_DECK_FACTIONS = [
  "SHIROHANA",
  "TSUKIMORI",
  "HYORIN",
  "AKASUMI",
  "AKIKAZE",
  "SYNDICATE",
] as const satisfies readonly DeckFaction[];

/** Rarities from lowest to highest. */
export const KESSEN_RARITY_ORDER: readonly KessenRarity[] = [
  "COMMON",
  "RARE",
  "EPIC",
  "LEGENDARY",
];

/** Deck construction limits. */
export const KESSEN_DECK_RULES = {
  minCards: 25,
  maxCards: 30,
  maxTactics: 8,
  maxLegendaries: 2,
  /** Kage bosses print their exception on the pre-match screen. */
  bossMaxLegendaries: 3,
  maxInfiltrators: 2,
  /** Provision budget before the leader's bonus. */
  baseBudget: 150,
} as const;

/** Loaner generation: a lower budget, rarity weights per slot and quotas. */
export const KESSEN_LOANER = {
  budget: 130,
  size: 25,
  anchorCopies: 3,
  synergyTarget: 3,
  /** Provision kept back for every slot still open after a pick. */
  slotReserve: 4,
  weights: { COMMON: 6400, RARE: 2800, EPIC: 700, LEGENDARY: 100 } as Record<
    KessenRarity,
    number
  >,
  quotas: {
    tacticsMax: 6,
    terrainMax: 2,
    infiltratorMax: 1,
    purgeMax: 2,
    epicMax: 2,
    legendaryMax: 1,
  },
} as const;

/** Per-category caps the deck generator keeps (on top of the deck rules). */
export interface KessenDeckQuotas {
  tacticsMax: number;
  terrainMax: number;
  infiltratorMax: number;
  purgeMax: number;
  epicMax: number;
  legendaryMax: number;
}

/** Owned copies per item id; callers exclude copies listed in the auction house. */
export type OwnedQuantities = Readonly<Record<string, number>>;

/** Catalog lookup by item id. */
export type CardLookup = Readonly<Record<string, KessenCard>>;

/** A deck as stored on `KessenDeck`: a leader plus card counts, all item ids. */
export interface KessenDeckList {
  leaderId: string;
  cards: KessenDeckCard[];
}

export type DeckErrorCode =
  | "unknownCard"
  | "count"
  | "leader"
  | "notCollectible"
  | "faction"
  | "size"
  | "tactics"
  | "copies"
  | "legendaries"
  | "infiltrators"
  | "budget"
  | "notOwned";

/** One broken deck rule; `itemId` names the card or leader at fault. */
export interface DeckError {
  code: DeckErrorCode;
  message: string;
  itemId?: string;
}

export interface DeckStats {
  cards: number;
  units: number;
  tactics: number;
  provision: number;
  /** `KESSEN_DECK_RULES.baseBudget` + the leader's bonus; 0 without a valid leader. */
  budget: number;
  legendaries: number;
  infiltrators: number;
}

/** `validateDeck`'s verdict with the deck's totals. */
export interface DeckValidation {
  ok: boolean;
  errors: DeckError[];
  stats: DeckStats;
}

export interface ValidateDeckOptions {
  /** Checks ownership of the leader and every copy when given. */
  owned?: OwnedQuantities;
  /** Copies that need no ownership (loaner stamps). */
  borrowed?: readonly KessenDeckCard[];
  /** Kage boss decks: a non-collectible leader and up to `bossMaxLegendaries` legendaries. */
  boss?: boolean;
}

/** A generated deck; `borrowed` lists the copies the player does not have to own. */
export interface BuiltDeck {
  leaderId: string;
  cards: KessenDeckCard[];
  borrowed: KessenDeckCard[];
  /** True when generation failed validation and the starter list was returned. */
  fallback: boolean;
}

/** Catalog lookup from a card list. */
export const catalogById = (
  cards: Iterable<KessenCard>,
): Record<string, KessenCard> => {
  const out: Record<string, KessenCard> = {};
  for (const card of cards) out[card.id] = card;
  return out;
};

/** Sums the counts per item id (negative counts subtract), drops totals below 1, sorts by id. */
export const normalizeDeckCards = (
  cards: readonly KessenDeckCard[],
): KessenDeckCard[] => {
  const counts = new Map<string, number>();
  for (const entry of cards) {
    counts.set(entry.itemId, (counts.get(entry.itemId) ?? 0) + entry.count);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) => compareIds(a, b))
    .map(([itemId, count]) => ({ itemId, count }));
};

/** One item id per copy, in entry order: the `deck` of an engine `SeatSetup`. */
export const expandDeckCards = (cards: readonly KessenDeckCard[]) =>
  cards.flatMap((entry) => Array.from({ length: entry.count }, () => entry.itemId));

/** Counts a list of item ids (one per copy) into sorted deck entries. */
export const collapseDeckCards = (ids: readonly string[]) =>
  normalizeDeckCards(ids.map((itemId) => ({ itemId, count: 1 })));

/** Total copies in a deck list. */
export const deckSize = (cards: readonly KessenDeckCard[]) =>
  cards.reduce((sum, entry) => sum + entry.count, 0);

/** Validates a deck against every deck construction rule; ownership only when `owned` is given. */
export const validateDeck = (
  deck: KessenDeckList,
  catalog: CardLookup,
  options: ValidateDeckOptions = {},
): DeckValidation => {
  const errors: DeckError[] = [];
  const stats: DeckStats = {
    cards: 0,
    units: 0,
    tactics: 0,
    provision: 0,
    budget: 0,
    legendaries: 0,
    infiltrators: 0,
  };

  const leader = catalog[deck.leaderId];
  if (leader?.kind !== "LEADER") {
    errors.push({ code: "leader", message: "Choose a leader.", itemId: deck.leaderId });
  } else if (!leader.isCollectible && !options.boss) {
    errors.push({
      code: "notCollectible",
      message: `${leader.name} cannot lead a player deck.`,
      itemId: leader.id,
    });
  } else {
    stats.budget = KESSEN_DECK_RULES.baseBudget + leader.leaderBonus;
  }
  const faction = leader?.kind === "LEADER" ? leader.faction : null;

  const copies = new Map<string, { count: number; card: KessenCard }>();
  for (const entry of deck.cards) {
    if (!Number.isInteger(entry.count) || entry.count < 1) {
      errors.push({
        code: "count",
        message: "Invalid copy count.",
        itemId: entry.itemId,
      });
      continue;
    }
    const card = catalog[entry.itemId];
    if (!card) {
      errors.push({
        code: "unknownCard",
        message: "Unknown card.",
        itemId: entry.itemId,
      });
      continue;
    }
    if (card.kind === "LEADER") {
      errors.push({
        code: "leader",
        message: `${card.name} is a leader and cannot be in the deck.`,
        itemId: card.id,
      });
      continue;
    }
    if (!card.isCollectible) {
      errors.push({
        code: "notCollectible",
        message: `${card.name} cannot be put in a deck.`,
        itemId: card.id,
      });
      continue;
    }
    if (faction && card.faction !== "NEUTRAL" && card.faction !== faction) {
      errors.push({
        code: "faction",
        message: `${card.name} does not belong to this leader's faction.`,
        itemId: card.id,
      });
    }
    stats.cards += entry.count;
    stats.provision += card.provision * entry.count;
    if (card.kind === "TACTIC") stats.tactics += entry.count;
    else stats.units += entry.count;
    if (card.rarity === "LEGENDARY") stats.legendaries += entry.count;
    if (card.abilities.some((ability) => ability.k === "infiltrator")) {
      stats.infiltrators += entry.count;
    }
    const key = copyKey(card);
    const base = catalog[key] ?? card;
    const prior = copies.get(key);
    copies.set(key, { count: (prior?.count ?? 0) + entry.count, card: base });
  }

  const rules = KESSEN_DECK_RULES;
  if (stats.cards < rules.minCards || stats.cards > rules.maxCards) {
    errors.push({
      code: "size",
      message: `A deck holds ${rules.minCards}–${rules.maxCards} cards (${stats.cards}).`,
    });
  }
  if (stats.tactics > rules.maxTactics) {
    errors.push({
      code: "tactics",
      message: `At most ${rules.maxTactics} tactics (${stats.tactics}).`,
    });
  }
  for (const [key, { count, card }] of [...copies.entries()].sort(([a], [b]) =>
    compareIds(a, b),
  )) {
    const limit = KESSEN_COPY_LIMITS[card.rarity];
    if (count > limit) {
      errors.push({
        code: "copies",
        message: `At most ${limit} ${limit === 1 ? "copy" : "copies"} of ${card.name}.`,
        itemId: key,
      });
    }
  }
  const maxLegendaries = options.boss ? rules.bossMaxLegendaries : rules.maxLegendaries;
  if (stats.legendaries > maxLegendaries) {
    errors.push({
      code: "legendaries",
      message: `At most ${maxLegendaries} legendary cards (${stats.legendaries}).`,
    });
  }
  if (stats.infiltrators > rules.maxInfiltrators) {
    errors.push({
      code: "infiltrators",
      message: `At most ${rules.maxInfiltrators} Infiltrators (${stats.infiltrators}).`,
    });
  }
  if (stats.budget > 0 && stats.provision > stats.budget) {
    errors.push({
      code: "budget",
      message: `Provision ${stats.provision} exceeds the budget of ${stats.budget}.`,
    });
  }

  if (options.owned) {
    const owned = options.owned;
    const borrowed = new Map<string, number>();
    for (const entry of options.borrowed ?? []) {
      borrowed.set(entry.itemId, (borrowed.get(entry.itemId) ?? 0) + entry.count);
    }
    if (leader && (owned[leader.id] ?? 0) < 1 && (borrowed.get(leader.id) ?? 0) < 1) {
      errors.push({
        code: "notOwned",
        message: `You do not own ${leader.name}.`,
        itemId: leader.id,
      });
    }
    for (const entry of normalizeDeckCards(deck.cards)) {
      const need = entry.count - (borrowed.get(entry.itemId) ?? 0);
      const have = owned[entry.itemId] ?? 0;
      if (need > have) {
        const name = catalog[entry.itemId]?.name ?? entry.itemId;
        errors.push({
          code: "notOwned",
          message: `You own ${have} of ${need} copies of ${name}.`,
          itemId: entry.itemId,
        });
      }
    }
  }

  return { ok: errors.length === 0, errors, stats };
};

/** A starter-deck entry by card slug. */
const e = (slug: string, count: number): KessenDeckCard => ({
  itemId: `kessen-${slug}`,
  count,
});

/** Starter leader of each faction, granted with its starter deck. */
export const KESSEN_STARTER_LEADERS: Readonly<Record<DeckFaction, string>> = {
  SHIROHANA: "kessen-leader-hisame-dune-warden",
  TSUKIMORI: "kessen-leader-junko-moon-warden",
  HYORIN: "kessen-leader-kimiko-frost-warden",
  AKASUMI: "kessen-leader-the-crowned-captain",
  AKIKAZE: "kessen-leader-aerathiel-wind-bearer",
  SYNDICATE: "kessen-leader-amir-the-hoarder",
};

/** Alt leader of each faction; only its village champion awards it. */
export const KESSEN_ALT_LEADERS: Readonly<Record<DeckFaction, string>> = {
  SHIROHANA: "kessen-leader-subaku-demon-lord",
  TSUKIMORI: "kessen-leader-widow-of-the-waning-moon",
  HYORIN: "kessen-leader-frost-sovereign",
  AKASUMI: "kessen-leader-the-hollow-conductor",
  AKIKAZE: "kessen-leader-kaze-no-seirei",
  SYNDICATE: "kessen-leader-ravena-bloodsilk",
};

/** Neutral cards every starter deck shares. */
const STARTER_NEUTRALS = [
  e("musashi-ken-swordsman", 3),
  e("seal-of-nullification", 1),
  e("ryouichi-wake-islander", 1),
];

/**
 * Starter decks: the faction's five commons and three rares, the shared
 * neutrals, Lemu and one flex neutral (Kawarimi; Kazehiko for Tsukimori, Akasumi and
 * Akikaze). Copy counts differ per faction so every starter wins 44-56% of a starter
 * round-robin: a weaker card at one or two copies makes room for a second copy of a
 * stronger one, and Akikaze carries its Infiltrator.
 */
const STARTER_DECKS: Readonly<Record<DeckFaction, KessenDeckCard[]>> = {
  SHIROHANA: [
    e("taiyo-kami-devotee", 3),
    e("mummy-of-the-shining-dunes", 3),
    e("beta-sandworm", 3),
    e("blazing-flash-adept", 3),
    e("fireball", 3),
    e("sand-golem", 1),
    e("gamma-sandworm", 1),
    e("subaku-princess", 1),
    ...STARTER_NEUTRALS,
    e("lemu-academy-instructor", 1),
    e("kawarimi", 1),
  ],
  TSUKIMORI: [
    e("moonprowler", 3),
    e("mosswolf", 3),
    e("tsukihana", 3),
    e("owlcat", 3),
    e("furuki-no-seirei", 2),
    e("moon-shrine-guardian", 2),
    e("wood-warrior", 2),
    ...STARTER_NEUTRALS,
    e("lemu-academy-instructor", 1),
    e("kazehiko", 1),
  ],
  HYORIN: [
    e("frozen-wraith", 3),
    e("cryverin", 3),
    e("hyouga-yui-clansman", 3),
    e("shimo-no-seirei", 1),
    e("kori-no-seirei", 3),
    e("byakuho", 2),
    e("ava-the-snow-terror", 1),
    e("cryostorm-aegis", 1),
    ...STARTER_NEUTRALS,
    e("lemu-academy-instructor", 2),
    e("kawarimi", 1),
  ],
  AKASUMI: [
    e("ghost-ship-deckhand", 3),
    e("ghost-ship-gunner", 2),
    e("fist-of-10000-volts", 3),
    e("arashima-stormcaller", 3),
    e("enrai-no-oni", 3),
    e("undertide-executioner", 1),
    e("the-salvager", 2),
    e("mizu-no-seirei", 1),
    ...STARTER_NEUTRALS,
    e("lemu-academy-instructor", 1),
    e("kazehiko", 1),
  ],
  AKIKAZE: [
    e("kugatsunagi", 2),
    e("kajioka", 3),
    e("blazdrift", 3),
    e("sky-bridge-scout", 3),
    e("wind-release", 3),
    e("yamabiko-echo-caller", 2),
    e("typhoon-tear", 1),
    e("gale-courier", 1),
    ...STARTER_NEUTRALS,
    e("lemu-academy-instructor", 1),
    e("kazehiko", 1),
  ],
  SYNDICATE: [
    e("thorn-ambusher", 3),
    e("black-maw-acolyte", 3),
    e("mei-back-alley-enforcer", 3),
    e("mei-cutpurse", 3),
    e("thousand-scarlet-fangs", 3),
    e("thorn-ambush-captain", 1),
    e("veylan-maw-of-the-pyre", 2),
    ...STARTER_NEUTRALS,
    e("lemu-academy-instructor", 1),
    e("kawarimi", 1),
  ],
};

/** The faction's starter deck and leader; also the loaner's fallback. */
export const starterDeck = (faction: DeckFaction): KessenDeckList => ({
  leaderId: KESSEN_STARTER_LEADERS[faction],
  cards: STARTER_DECKS[faction].map((entry) => ({ ...entry })),
});

/** The faction that rotates through the loaner for players without a village faction. */
export const rotatingFaction = (dayKey: string): DeckFaction =>
  KESSEN_DECK_FACTIONS[
    dayIndex(`faction:${dayKey}`, KESSEN_DECK_FACTIONS.length)
  ] as DeckFaction;

/** Loaner faction: the player's village faction, else the day's rotating faction. */
export const loanerFaction = (home: DeckFaction | null, dayKey: string): DeckFaction =>
  home ?? rotatingFaction(dayKey);

/** Uniform index in [0, size) from a string; stable across runtimes. */
export const dayIndex = (key: string, size: number) =>
  Number.parseInt(hashString(key).slice(0, 8), 16) % size;

export interface LoanerInput {
  userId: string;
  dayKey: string;
  faction: DeckFaction;
  cards: Iterable<KessenCard>;
}

/**
 * The player's loaner of the day for one faction. Seeded by user, day and
 * faction, so rerolling is impossible; falls back to the starter list if generation fails.
 */
export const loanerDeck = (input: LoanerInput): BuiltDeck => {
  const catalog = catalogById(input.cards);
  const leaderId = KESSEN_STARTER_LEADERS[input.faction];
  const leader = catalog[leaderId];
  const pool = loanerPool(catalog, input.faction);
  const ids = leader
    ? buildDeck({
        rng: createRng(loanerSeed(input.userId, input.dayKey, input.faction)),
        pool,
        faction: input.faction,
        catalog,
        fixed: [],
        budget: KESSEN_LOANER.budget,
        quotas: KESSEN_LOANER.quotas,
        copiesAllowed: copyLimitOf,
      })
    : [];
  const cards = collapseDeckCards(ids);
  const result = validateDeck({ leaderId, cards }, catalog);
  if (!leader || !result.ok) {
    const starter = starterDeck(input.faction);
    return { ...starter, borrowed: starter.cards, fallback: true };
  }
  return { leaderId, cards, borrowed: cards, fallback: false };
};

export interface FillInput {
  userId: string;
  dayKey: string;
  deck: KessenDeckList;
  owned: OwnedQuantities;
  cards: Iterable<KessenCard>;
}

/**
 * Completes a deck that is short, or short of owned copies. The player's own spare
 * copies (owned minus the copies already in the deck) fill first, then the faction's
 * loaner pool lends the rest, all under the deck's real budget. `borrowed` holds only
 * the copies the player cannot supply. Null when the owned part breaks another rule or
 * no valid completion exists.
 */
export const fillWithBorrowed = (input: FillInput): BuiltDeck | null => {
  const catalog = catalogById(input.cards);
  const leader = catalog[input.deck.leaderId];
  if (leader?.kind !== "LEADER" || !leader.isCollectible) return null;
  if ((input.owned[leader.id] ?? 0) < 1) return null;
  const faction = leader.faction;
  if (faction === "NEUTRAL") return null;

  const kept = normalizeDeckCards(input.deck.cards)
    .map((entry) => ({
      itemId: entry.itemId,
      count: Math.min(entry.count, input.owned[entry.itemId] ?? 0),
    }))
    .filter((entry) => entry.count > 0);
  const check = validateDeck({ leaderId: leader.id, cards: kept }, catalog, {
    owned: input.owned,
  });
  if (check.errors.some((error) => error.code !== "size")) return null;
  if (check.stats.cards > KESSEN_DECK_RULES.maxCards) return null;

  const fixed = expandDeckCards(kept);
  const budget = KESSEN_DECK_RULES.baseBudget + leader.leaderBonus;
  const loanPool = loanerPool(catalog, faction);
  const seed = loanerSeed(input.userId, input.dayKey, faction);
  const lend = (from: string[]) =>
    buildDeck({
      rng: createRng(seed),
      pool: loanPool,
      faction,
      catalog,
      fixed: from,
      budget,
      quotas: KESSEN_LOANER.quotas,
      copiesAllowed: copyLimitOf,
    });
  // Copies of the same card under other item ids (a Forbidden variant) already in the deck.
  const keptByKey = new Map<string, number>();
  for (const id of fixed) {
    const card = catalog[id];
    if (card) keptByKey.set(copyKey(card), (keptByKey.get(copyKey(card)) ?? 0) + 1);
  }
  const keptOf = (id: string) => kept.find((entry) => entry.itemId === id)?.count ?? 0;
  const ownPool = loanPool.filter(
    (card) => (input.owned[card.id] ?? 0) > keptOf(card.id),
  );
  const owned = buildDeck({
    rng: createRng(`${seed}:owned:${collectionHash(ownPool, input.owned)}`),
    pool: ownPool,
    faction,
    catalog,
    fixed,
    budget,
    quotas: KESSEN_AUTOBUILD_QUOTAS,
    copiesAllowed: (card) =>
      Math.min(
        copyLimitOf(card),
        (input.owned[card.id] ?? 0) +
          (keptByKey.get(copyKey(card)) ?? 0) -
          keptOf(card.id),
      ),
    // Owned copies may leave slots open; the reserve keeps them completable from the loaner pool.
    completion: { pool: loanPool, copiesAllowed: copyLimitOf },
    repair: false,
  });
  // The single-pass loaner fill stays as the fallback when the owned-first deck cannot complete.
  for (const ids of [lend(owned), lend(fixed)]) {
    const cards = collapseDeckCards(ids);
    const borrowed = borrowedCopies(cards, input.owned);
    const result = validateDeck({ leaderId: leader.id, cards }, catalog, {
      owned: input.owned,
      borrowed,
    });
    if (result.ok) return { leaderId: leader.id, cards, borrowed, fallback: false };
  }
  return null;
};

/** The copies of `cards` beyond what the player owns, per item id. */
const borrowedCopies = (cards: readonly KessenDeckCard[], owned: OwnedQuantities) =>
  cards
    .map((entry) => ({
      itemId: entry.itemId,
      count: entry.count - Math.min(entry.count, owned[entry.itemId] ?? 0),
    }))
    .filter((entry) => entry.count > 0);

export interface AutoBuildInput {
  userId: string;
  faction: DeckFaction;
  owned: OwnedQuantities;
  cards: Iterable<KessenCard>;
  /** Defaults to the starter leader if owned, else the faction's alt leader. */
  leaderId?: string;
}

/** Quotas of auto-build: the loaner's shape with the deck rules' rarity caps. */
export const KESSEN_AUTOBUILD_QUOTAS: KessenDeckQuotas = {
  ...KESSEN_LOANER.quotas,
  infiltratorMax: KESSEN_DECK_RULES.maxInfiltrators,
  epicMax: KESSEN_DECK_RULES.maxCards,
  legendaryMax: KESSEN_DECK_RULES.maxLegendaries,
};

/**
 * The loaner algorithm over owned cards only, with the real budget, seeded by the
 * collection so the same collection always builds the same deck. Null when the owned
 * cards cannot form a valid deck.
 */
export const autoBuild = (input: AutoBuildInput): BuiltDeck | null => {
  const catalog = catalogById(input.cards);
  const leaderId =
    input.leaderId ??
    [KESSEN_STARTER_LEADERS[input.faction], KESSEN_ALT_LEADERS[input.faction]].find(
      (id) => (input.owned[id] ?? 0) > 0,
    );
  const leader = leaderId ? catalog[leaderId] : undefined;
  if (leader?.kind !== "LEADER" || leader.faction !== input.faction) return null;
  if ((input.owned[leader.id] ?? 0) < 1) return null;

  const pool = loanerPool(catalog, input.faction).filter(
    (card) => (input.owned[card.id] ?? 0) > 0,
  );
  const ids = buildDeck({
    rng: createRng(
      `autobuild:${input.userId}:${input.faction}:${collectionHash(pool, input.owned)}`,
    ),
    pool,
    faction: input.faction,
    catalog,
    fixed: [],
    budget: KESSEN_DECK_RULES.baseBudget + leader.leaderBonus,
    quotas: KESSEN_AUTOBUILD_QUOTAS,
    copiesAllowed: (card) => Math.min(copyLimitOf(card), input.owned[card.id] ?? 0),
  });
  const cards = collapseDeckCards(ids);
  const result = validateDeck({ leaderId: leader.id, cards }, catalog, {
    owned: input.owned,
  });
  return result.ok
    ? { leaderId: leader.id, cards, borrowed: [], fallback: false }
    : null;
};

/**
 * A player's deck for one match: a saved deck of owned copies, today's loaner of a
 * faction, or a saved deck completed with borrowed cards. `deckRow` is the saved deck
 * the source names (null when it no longer exists).
 */
export const buildPlayerDeck = (input: {
  source: PlayerDeckSource;
  deckRow: { leaderItemId: string; cards: { itemId: string; count: number }[] } | null;
  userId: string;
  dayKey: string;
  pool: readonly KessenCard[];
  owned: OwnedQuantities;
}): Pick<BuiltDeck, "leaderId" | "cards" | "borrowed"> | { error: string } => {
  const { source } = input;
  if (source.source === "loaner") {
    return loanerDeck({
      userId: input.userId,
      dayKey: input.dayKey,
      faction: source.faction,
      cards: input.pool,
    });
  }
  if (!input.deckRow) return { error: "That deck no longer exists." };
  const deck = { leaderId: input.deckRow.leaderItemId, cards: input.deckRow.cards };
  if (source.source === "fill") {
    const filled = fillWithBorrowed({
      userId: input.userId,
      dayKey: input.dayKey,
      deck,
      owned: input.owned,
      cards: input.pool,
    });
    return filled ?? { error: "This deck cannot be completed with borrowed cards." };
  }
  const check = validateDeck(deck, catalogById(input.pool), { owned: input.owned });
  if (!check.ok)
    return { error: check.errors[0]?.message ?? "This deck is not valid." };
  return { leaderId: deck.leaderId, cards: deck.cards, borrowed: [] };
};

/** Hash of the owned copies of a pool, so auto-build changes when the collection does. */
export const collectionHash = (pool: readonly KessenCard[], owned: OwnedQuantities) =>
  hashString(
    pool
      .filter((card) => (owned[card.id] ?? 0) > 0)
      .map((card) => `${card.id}:${owned[card.id]}`)
      .join(","),
  );

const loanerSeed = (userId: string, dayKey: string, faction: DeckFaction) =>
  `loaner:${userId}:${dayKey}:${faction}`;

/**
 * Provision the generator keeps back with `openSlots` still to fill: `slotReserve` per
 * slot, or the cheapest completion when that costs more (infinite when none).
 */
export const loanerReserve = (openSlots: number, completionCost: number) =>
  Math.max(KESSEN_LOANER.slotReserve * openSlots, completionCost);

/** Faction plus Neutral deck cards, without leaders, tokens and Forbidden variants. */
const loanerPool = (catalog: CardLookup, faction: DeckFaction) =>
  Object.values(catalog)
    .filter(
      (card) =>
        card.kind !== "LEADER" &&
        card.isCollectible &&
        card.variant === "STANDARD" &&
        (card.faction === faction || card.faction === "NEUTRAL"),
    )
    .sort((a, b) => compareIds(a.id, b.id));

const copyLimitOf = (card: KessenCard) => KESSEN_COPY_LIMITS[card.rarity];

interface BuildInput {
  rng: Rng;
  pool: KessenCard[];
  faction: DeckFaction;
  catalog: CardLookup;
  /** Item ids already in the deck, one per copy; never removed. */
  fixed: string[];
  budget: number;
  quotas: KessenDeckQuotas;
  copiesAllowed: (card: KessenCard) => number;
  /** Pool and copy rule the budget reserve completes from; defaults to `pool`. */
  completion?: { pool: KessenCard[]; copiesAllowed: (card: KessenCard) => number };
  /** Swaps surplus tactics for units at the end; off for a partial first pass. */
  repair?: boolean;
}

/** The shared deck generator: anchor, weighted fill, synergy completion, repair. */
const buildDeck = (input: BuildInput): string[] => {
  const { rng, pool, catalog, budget, quotas } = input;
  const size = KESSEN_LOANER.size;
  const deck = createTally(catalog, input.fixed);
  const fits = (card: KessenCard) =>
    deck.length < size &&
    deck.copies(card) < input.copiesAllowed(card) &&
    deck.quotasAllow(card, quotas);
  const completion = input.completion ?? { pool, copiesAllowed: input.copiesAllowed };
  const byCost = [...completion.pool].sort(
    (a, b) => a.provision - b.provision || compareIds(a.id, b.id),
  );
  /** Cheapest-first completion of `tally` with `slots` cards under copies and quotas. */
  const greedyCompletion = (tally: Tally, slots: number) => {
    const picks: KessenCard[] = [];
    for (const card of byCost) {
      while (
        picks.length < slots &&
        tally.copies(card) < completion.copiesAllowed(card) &&
        tally.quotasAllow(card, quotas)
      ) {
        tally.add(card);
        picks.push(card);
      }
    }
    return picks;
  };
  const memo = new Map<string, number>();
  let memoVersion = -1;
  /**
   * Provision kept back after adding `card`: `slotReserve` per open slot, and
   * never less than the cheapest-first completion, so the deck stays completable.
   */
  const reserveAfter = (card: KessenCard) => {
    const rest = size - deck.length - 1;
    if (rest <= 0) return 0;
    if (memoVersion !== deck.version) {
      memo.clear();
      memoVersion = deck.version;
    }
    const key = `${copyKey(card)}|${deck.categoriesOf(card)}`;
    const known = memo.get(key);
    if (known !== undefined) return known;
    const sim = deck.clone();
    sim.add(card);
    const picks = greedyCompletion(sim, rest);
    const cost = loanerReserve(
      rest,
      picks.length < rest
        ? Number.POSITIVE_INFINITY
        : picks.reduce((sum, pick) => sum + pick.provision, 0),
    );
    memo.set(key, cost);
    return cost;
  };
  const canAdd = (card: KessenCard, reserved = true) =>
    fits(card) &&
    deck.provision + card.provision <= budget - (reserved ? reserveAfter(card) : 0);

  // 1. Anchor: a faction common unit in or naming a set, else the strongest one.
  const commons = pool.filter(
    (card) =>
      card.faction === input.faction &&
      card.rarity === "COMMON" &&
      card.kind === "UNIT",
  );
  const inSets = commons.filter((card) => setsOf(card).length > 0);
  const anchor =
    inSets.length > 0
      ? inSets[rng.int(inSets.length)]
      : commons.reduce<KessenCard | undefined>(
          (best, card) => (!best || card.power > best.power ? card : best),
          undefined,
        );
  if (anchor) {
    for (let n = 0; n < KESSEN_LOANER.anchorCopies && canAdd(anchor); n++) {
      deck.add(anchor);
    }
  }

  // 2. Fill with weighted rarities, downgrading until a card fits.
  while (deck.length < size) {
    const rarity = selectWeighted(KESSEN_LOANER.weights, KESSEN_RARITY_ORDER, rng);
    let candidates: KessenCard[] = [];
    // Downgrade L -> E -> R -> C; only a deck that no common completes tries upwards.
    const ranks = rarity
      ? [
          ...KESSEN_RARITY_ORDER.slice(0, rarityRank(rarity) + 1).reverse(),
          ...KESSEN_RARITY_ORDER.slice(rarityRank(rarity) + 1),
        ]
      : [];
    for (const wanted of ranks) {
      candidates = pool.filter((card) => card.rarity === wanted && canAdd(card));
      if (candidates.length > 0) break;
    }
    if (candidates.length === 0) break;
    const card = candidates[rng.int(candidates.length)] as KessenCard;
    deck.add(card);
    for (const set of setsOf(card)) {
      const members = pool
        .filter((member) => isSetMember(member, set))
        .sort(
          (a, b) =>
            rarityRank(a.rarity) - rarityRank(b.rarity) || compareIds(a.id, b.id),
        );
      for (const member of members) {
        while (deck.setCount(set) < KESSEN_LOANER.synergyTarget && canAdd(member)) {
          deck.add(member);
        }
      }
    }
  }

  // 3. Repair: swap the latest borrowed tactics for the cheapest fitting common units.
  const fixedCount = input.fixed.length;
  while (
    input.repair !== false &&
    (deck.tactics > KESSEN_DECK_RULES.maxTactics || deck.units < 17)
  ) {
    const index = deck.lastIndexWhere(
      (card, at) => at >= fixedCount && card.kind === "TACTIC",
    );
    if (index < 0) break;
    const tactic = deck.removeAt(index);
    const replacement = pool
      .filter(
        (card) =>
          card.rarity === "COMMON" && card.kind === "UNIT" && canAdd(card, false),
      )
      .sort((a, b) => a.provision - b.provision || compareIds(a.id, b.id))[0];
    if (!replacement) {
      deck.insertAt(index, tactic);
      break;
    }
    deck.insertAt(index, replacement);
  }
  return deck.ids();
};

/** Running counts of a deck under construction, in insertion order. */
const createTally = (catalog: CardLookup, fixed: readonly string[]) => {
  const list: KessenCard[] = [];
  const byKey = new Map<string, number>();
  const totals = { provision: 0, tactics: 0, terrain: 0, infiltrator: 0, purge: 0 };
  const rarities: Record<KessenRarity, number> = {
    COMMON: 0,
    RARE: 0,
    EPIC: 0,
    LEGENDARY: 0,
  };
  let version = 0;
  const track = (card: KessenCard, sign: 1 | -1) => {
    version += 1;
    const key = copyKey(card);
    byKey.set(key, (byKey.get(key) ?? 0) + sign);
    totals.provision += sign * card.provision;
    if (card.kind === "TACTIC") totals.tactics += sign;
    if (hasKind(card, "terrain")) totals.terrain += sign;
    if (hasKind(card, "infiltrator")) totals.infiltrator += sign;
    if (hasKind(card, "purge")) totals.purge += sign;
    rarities[card.rarity] += sign;
  };
  const insertAt = (index: number, card: KessenCard) => {
    list.splice(index, 0, card);
    track(card, 1);
  };
  const tally = {
    get length() {
      return list.length;
    },
    /** Changes on every insertion and removal. */
    get version() {
      return version;
    },
    get provision() {
      return totals.provision;
    },
    get tactics() {
      return totals.tactics;
    },
    get units() {
      return list.length - totals.tactics;
    },
    ids: () => list.map((card) => card.id),
    clone: () =>
      createTally(
        catalog,
        list.map((card) => card.id),
      ),
    copies: (card: KessenCard) => byKey.get(copyKey(card)) ?? 0,
    add: (card: KessenCard) => insertAt(list.length, card),
    insertAt,
    removeAt: (index: number) => {
      const [card] = list.splice(index, 1) as [KessenCard];
      track(card, -1);
      return card;
    },
    lastIndexWhere: (test: (card: KessenCard, index: number) => boolean) => {
      for (let i = list.length - 1; i >= 0; i--) {
        if (test(list[i] as KessenCard, i)) return i;
      }
      return -1;
    },
    setCount: (set: string) => list.filter((card) => isSetMember(card, set)).length,
    /** The quota categories a card counts toward, as a stable key. */
    categoriesOf: (card: KessenCard) =>
      [
        card.kind === "TACTIC" ? "T" : "",
        hasKind(card, "terrain") ? "W" : "",
        hasKind(card, "infiltrator") ? "I" : "",
        hasKind(card, "purge") ? "P" : "",
        card.rarity,
      ].join(""),
    /** True when adding `card` keeps every quota. */
    quotasAllow: (card: KessenCard, quotas: KessenDeckQuotas) =>
      (card.kind !== "TACTIC" || totals.tactics < quotas.tacticsMax) &&
      (!hasKind(card, "terrain") || totals.terrain < quotas.terrainMax) &&
      (!hasKind(card, "infiltrator") || totals.infiltrator < quotas.infiltratorMax) &&
      (!hasKind(card, "purge") || totals.purge < quotas.purgeMax) &&
      (card.rarity !== "EPIC" || rarities.EPIC < quotas.epicMax) &&
      (card.rarity !== "LEGENDARY" || rarities.LEGENDARY < quotas.legendaryMax),
  };
  for (const id of fixed) {
    const card = catalog[id];
    if (card) tally.add(card);
  }
  return tally;
};
type Tally = ReturnType<typeof createTally>;

const hasKind = (card: KessenCard, k: string) =>
  card.abilities.some((ability) => ability.k === k);

/** Sets a card takes part in: those its Bond or Summon names and those it belongs to. */
const setsOf = (card: KessenCard) => {
  const sets = new Set<string>(card.sets);
  for (const ability of card.abilities) {
    if (ability.k === "bond" || ability.k === "summon") sets.add(ability.group);
  }
  return [...sets].sort();
};

const isSetMember = (card: KessenCard, set: string) => card.sets.includes(set);

const rarityRank = (rarity: KessenRarity) => KESSEN_RARITY_ORDER.indexOf(rarity);

const compareIds = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Where a match's deck comes from (see `kessenDeckSourceSchema`). */
export type PlayerDeckSource =
  | { source: "saved"; deckId: string }
  | { source: "loaner"; faction: DeckFaction }
  | { source: "fill"; deckId: string };

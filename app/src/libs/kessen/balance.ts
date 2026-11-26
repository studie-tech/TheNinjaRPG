/**
 * Kessen balance guidelines and the checks that hold the catalog to them. Every check is a
 * pure function of the cards, so the balance page, the card editor, the change log and
 * the tests reach the same verdict. Simulated metrics live in `balanceSim.ts`.
 */
import type { ItemRarity } from "@/drizzle/constants";
import type { KessenAbility, KessenFaction } from "@/validators/itemCard";
import { isInfiltrator } from "./board";
import {
  cardValueMilli,
  catalogFingerprint,
  itemToKessenCard,
  kessenSets,
  summonValueMilli,
  VALUE_PREMIUM_MILLI,
} from "./catalog";
import {
  type CardLookup,
  catalogById,
  type DeckError,
  type DeckFaction,
  type DeckStats,
  KESSEN_DECK_FACTIONS,
  type KessenDeckList,
  starterDeck,
  validateDeck,
} from "./deck";
import { KESSEN_NPCS } from "./npcs";
import { KESSEN_FACTION_NAMES } from "./packs";
import { keywordBudgetIssue } from "./text";
import type { KessenCard } from "./types";

/**
 * The guidelines. The value curve prices a card in milli-points (`cardValueMilli`); a
 * card on the curve scores its provision plus its rarity premium. Win rates come from the
 * seeded gauntlet and match trials of `balanceSim.ts`.
 */
export const KESSEN_BALANCE = {
  /** How far a card's curve value may sit from its target, either way. */
  curveTolerance: 1500,
  /** How far the mean curve gap of a faction's cards inside the tolerance may sit from zero. */
  factionBias: 750,
  /** Provision range of a deck card per rarity, which keeps rarer cards the costlier ones. */
  provision: {
    COMMON: [3, 6],
    RARE: [4, 8],
    EPIC: [8, 11],
    LEGENDARY: [13, 15],
  } satisfies Record<ItemRarity, readonly [number, number]>,
  /** Leader bonus range of a collectible leader. */
  leaderBonus: [10, 13],
  /**
   * Units a set a Bond names may hold: a Bond needs a partner, and a large set reaches
   * the Bond cap so often that its flat curve price no longer holds.
   */
  bondSet: [2, 6],
  /** Faction win rate across the gauntlet. */
  factionWinRate: [0.4, 0.6],
  /** Where a tuned faction sits; shaded on the page, not flagged. */
  factionTarget: [0.45, 0.55],
  /** Win rate of each reference deck across the gauntlet. */
  deckWinRate: [0.35, 0.65],
  /**
   * Match trial edge in win-rate points: flagged only when the edge passes this and stays
   * past it by more than two standard errors less this margin, so noise alone rarely flags.
   */
  trialEdge: 15,
  /** How far a leader's trial edge may sit from the median leader's. */
  leaderSpread: 20,
  /** Match health across the gauntlet. */
  health: {
    /** Plays (cards and leader activations, without tokens) per match. */
    plays: [18, 32],
    /** Share of rounds that end in a tie. */
    tieRate: 0.08,
    /** Score of the Round 1 opener. */
    opener: [0.36, 0.64],
    /** 99th percentile of the board swing of one play. */
    swingP99: 20,
    /** Largest board swing of one play. */
    swingMax: 30,
    /** Largest row total. */
    rowMax: 50,
  },
} as const;

export type KessenBalanceRule =
  | "curve"
  | "provision"
  | "keywords"
  | "leaderBonus"
  | "variant"
  | "summonSet"
  | "bondSet"
  | "deck"
  | "factionBias"
  | "factionWinRate"
  | "deckWinRate"
  | "trial"
  | "leaderTrial"
  | "health";

/** `break`: outside a guideline. `warn`: inside the rules but worth a look. */
export type KessenBalanceSeverity = "break" | "warn";

export interface KessenBalanceFlag {
  rule: KessenBalanceRule;
  severity: KessenBalanceSeverity;
  message: string;
}

/** One card against the guidelines. */
export interface KessenCardBalance {
  card: KessenCard;
  /** Curve value in milli-points; null for leaders and Infiltrators, which it does not price. */
  value: number | null;
  /** Provision plus rarity premium in milli-points; null when `value` is. */
  target: number | null;
  /** `value - target`. */
  gap: number | null;
  flags: KessenBalanceFlag[];
}

/** A deck the gauntlet plays: each faction's starter deck and its village champion's. */
export interface KessenReferenceDeck {
  key: string;
  label: string;
  faction: DeckFaction;
  list: KessenDeckList;
}

/** A reference deck's legality under the current catalog. */
export interface KessenReferenceDeckBalance {
  deck: KessenReferenceDeck;
  stats: DeckStats;
  errors: DeckError[];
  flags: KessenBalanceFlag[];
}

/** A faction's card pool against the guidelines. */
export interface KessenFactionBalance {
  faction: KessenFaction;
  /** Collectible standard deck cards per rarity. */
  counts: Record<ItemRarity, number>;
  /** Mean curve gap of its cards inside the tolerance in milli-points; null without any. */
  bias: number | null;
  flags: KessenBalanceFlag[];
}

/** A set with its members, the cards that call it and what its Summons can pull. */
export interface KessenSetBalance {
  name: string;
  members: KessenCard[];
  /** Cards whose Bond or Summon names the set, members included. */
  callers: KessenCard[];
  /** Largest power an eligible Summon caller can pull; null without an eligible unit. */
  maxSummonPower: number | null;
}

/** The whole catalog against the guidelines. */
export interface KessenCatalogBalance {
  fingerprint: string;
  /** Collectible cards, including Forbidden variants checked against their base. */
  cards: KessenCardBalance[];
  factions: KessenFactionBalance[];
  decks: KessenReferenceDeckBalance[];
  sets: KessenSetBalance[];
}

/** Faction order of the balance reports: the six deck factions, then Neutral. */
export const KESSEN_BALANCE_FACTIONS: readonly KessenFaction[] = [
  ...KESSEN_DECK_FACTIONS,
  "NEUTRAL",
];

/** Collectible standard cards counted in faction pools and sets. */
export const isBalancedCard = (card: KessenCard) =>
  card.isCollectible && card.variant === "STANDARD";

/** Each faction's starter deck and village champion deck, in faction order. */
export const kessenReferenceDecks = (): KessenReferenceDeck[] =>
  KESSEN_DECK_FACTIONS.flatMap((faction) => {
    const champion = KESSEN_NPCS.find((npc) => npc.champion && npc.faction === faction);
    const decks: KessenReferenceDeck[] = [
      {
        key: `starter-${faction}`,
        label: "Starter deck",
        faction,
        list: starterDeck(faction),
      },
    ];
    if (champion) {
      decks.push({
        key: `champion-${faction}`,
        label: `${champion.name}'s deck`,
        faction,
        list: champion.standard.deck,
      });
    }
    return decks;
  });

/**
 * One card against the guidelines. With `catalog`, also the checks that need other cards:
 * a Forbidden variant against its base card, and the sets its Bond and Summon name.
 */
export const cardBalance = (
  card: KessenCard,
  catalog?: readonly KessenCard[],
): KessenCardBalance => {
  const flags: KessenBalanceFlag[] = [];
  const priced = card.kind !== "LEADER" && card.variant === "STANDARD";
  const value = priced ? cardValueMilli(card) : null;
  const target =
    value === null ? null : card.provision * 1000 + VALUE_PREMIUM_MILLI[card.rarity];
  const gap = value === null || target === null ? null : value - target;
  if (gap !== null && value !== null && target !== null) {
    const limit = KESSEN_BALANCE.curveTolerance;
    if (Math.abs(gap) > limit) {
      flags.push({
        rule: "curve",
        severity: gap > 0 ? "break" : "warn",
        message: `Value ${points(value)} is ${points(Math.abs(gap))} ${gap > 0 ? "over" : "under"} the ${points(target)} its cost allows (limit ${points(limit)})`,
      });
    }
  }
  if (card.kind === "LEADER") {
    const [low, high] = KESSEN_BALANCE.leaderBonus;
    if (card.isCollectible && (card.leaderBonus < low || card.leaderBonus > high)) {
      flags.push({
        rule: "leaderBonus",
        severity: "break",
        message: `Leader bonus ${card.leaderBonus} is outside ${low}–${high}`,
      });
    }
  } else if (card.variant === "STANDARD") {
    const [low, high] = KESSEN_BALANCE.provision[card.rarity];
    if (card.provision < low || card.provision > high) {
      flags.push({
        rule: "provision",
        severity: "break",
        message: `Provision ${card.provision} is outside the ${card.rarity.toLowerCase()} range ${low}–${high}`,
      });
    }
    const keywords = keywordBudgetIssue(card.abilities, card.rarity);
    if (keywords)
      flags.push({ rule: "keywords", severity: "break", message: keywords });
  }
  if (catalog) flags.push(...catalogFlags(card, catalog));
  return { card, value, target, gap, flags };
};

/** The whole catalog against the guidelines. */
export const catalogBalance = (
  catalog: readonly KessenCard[],
): KessenCatalogBalance => {
  const covered = catalog.filter(isBalancedCard);
  const cards = catalog
    .filter((card) => card.isCollectible)
    .map((card) => cardBalance(card, catalog));
  const lookup = catalogById(catalog);
  const decks = kessenReferenceDecks().map((deck) =>
    referenceDeckBalance(deck, lookup),
  );
  const factions = KESSEN_BALANCE_FACTIONS.map((faction) =>
    factionBalance(
      faction,
      cards.filter(
        (entry) => isBalancedCard(entry.card) && entry.card.faction === faction,
      ),
    ),
  );
  return {
    fingerprint: catalogFingerprint(catalog),
    cards,
    factions,
    decks,
    sets: kessenSets(covered).map((set) => setBalance(set.name, catalog)),
  };
};

/** A reference deck's legality under `lookup`. */
export const referenceDeckBalance = (
  deck: KessenReferenceDeck,
  lookup: CardLookup,
): KessenReferenceDeckBalance => {
  const { errors, stats } = validateDeck(deck.list, lookup);
  return {
    deck,
    stats,
    errors,
    flags: errors.map((error) => ({
      rule: "deck",
      severity: "break",
      message: `${KESSEN_FACTION_NAMES[deck.faction]} ${deck.label.toLowerCase()} is no longer legal: ${error.message}`,
    })),
  };
};

/**
 * What changed between a saved card and its edit, as change-log lines: guidelines it
 * newly breaks or warns about, and ones it no longer does. Uses the card alone, so the
 * server can compute it from the row it updates.
 */
export const cardBalanceChanges = (
  before: KessenCard | null,
  after: KessenCard | null,
): string[] => {
  const old = before ? cardBalance(before).flags : [];
  const now = after ? cardBalance(after).flags : [];
  const has = (flags: KessenBalanceFlag[], flag: KessenBalanceFlag) =>
    flags.some((other) => other.message === flag.message);
  return [
    ...now
      .filter((flag) => !has(old, flag))
      .map(
        (flag) =>
          `Balance ${flag.severity === "break" ? "break" : "warning"}: ${flag.message}`,
      ),
    ...old
      .filter(
        (flag) => !now.some((other) => other.rule === flag.rule) && !has(now, flag),
      )
      .map((flag) => `Balance cleared: ${flag.message}`),
  ];
};

/** `cardBalanceChanges` of two item rows; empty unless one of them is a valid card. */
export const itemBalanceChanges = (
  before: { id: string; name: string; rarity: ItemRarity; cardData: unknown },
  after: { id: string; name: string; rarity: ItemRarity; cardData: unknown },
) => {
  const saved = itemToKessenCard(before);
  const edited = itemToKessenCard(after);
  return saved || edited ? cardBalanceChanges(saved, edited) : [];
};

/** A flag with the card, faction or deck it belongs to. */
export interface KessenSubjectFlag {
  subject: string;
  flag: KessenBalanceFlag;
}

/**
 * Flags a catalog change raises and clears on everything but the edited card: other
 * cards whose sets it joins or leaves, Forbidden variants, its faction's bias and the
 * reference decks.
 */
export const catalogBalanceDiff = (
  before: KessenCatalogBalance,
  after: KessenCatalogBalance,
  editedId: string,
) => {
  const flagsOf = (report: KessenCatalogBalance): KessenSubjectFlag[] => [
    ...report.cards
      .filter((entry) => entry.card.id !== editedId)
      .flatMap((entry) =>
        entry.flags.map((flag) => ({ subject: entry.card.name, flag })),
      ),
    ...report.factions.flatMap((entry) =>
      entry.flags.map((flag) => ({
        subject: KESSEN_FACTION_NAMES[entry.faction],
        flag,
      })),
    ),
    ...report.decks.flatMap((entry) =>
      entry.flags.map((flag) => ({
        subject: KESSEN_FACTION_NAMES[entry.deck.faction],
        flag,
      })),
    ),
  ];
  const key = (entry: KessenSubjectFlag) => `${entry.subject}\n${entry.flag.message}`;
  const old = flagsOf(before);
  const now = flagsOf(after);
  const oldKeys = new Set(old.map(key));
  const nowKeys = new Set(now.map(key));
  return {
    raised: now.filter((entry) => !oldKeys.has(key(entry))),
    cleared: old.filter((entry) => !nowKeys.has(key(entry))),
  };
};

/** Milli-points as points with one or two decimals: 11500 is "11.5", 750 is "0.75". */
export const points = (milli: number) => {
  const value = milli / 1000;
  return Number.isInteger(value * 10) ? value.toFixed(1) : value.toFixed(2);
};

/** The set's members and callers, and the strongest unit its Summon can place. */
const setBalance = (name: string, catalog: readonly KessenCard[]): KessenSetBalance => {
  const covered = catalog.filter(isBalancedCard);
  const members = covered.filter((card) => card.sets.includes(name));
  const callers = covered.filter((card) =>
    card.abilities.some(
      (ability) =>
        (ability.k === "bond" || ability.k === "summon") && ability.group === name,
    ),
  );
  const summoners = callers.filter((card) =>
    card.abilities.some((ability) => ability.k === "summon" && ability.group === name),
  );
  const pulled = members
    .filter(
      (member) =>
        isSummonable(member) &&
        summoners.some(
          (caller) =>
            caller.id !== member.id && sharesDeck(caller.faction, member.faction),
        ),
    )
    .map((card) => card.power);
  return {
    name,
    members,
    callers,
    maxSummonPower: pulled.length > 0 ? Math.max(...pulled) : null,
  };
};

/** Checks of a card that read other cards: Forbidden parity and its Bond and Summon sets. */
const catalogFlags = (
  card: KessenCard,
  catalog: readonly KessenCard[],
): KessenBalanceFlag[] => {
  const flags: KessenBalanceFlag[] = [];
  if (card.variant === "FORBIDDEN") {
    const base = catalog.find((other) => other.id === card.baseCardId);
    const fields = base ? differingFields(card, base) : [];
    if (base && fields.length > 0) {
      flags.push({
        rule: "variant",
        severity: "break",
        message: `Differs from its base card ${base.name} in ${fields.join(", ")}`,
      });
    }
  }
  for (const ability of card.abilities) {
    if (ability.k === "summon")
      flags.push(...summonFlags(card, ability.group, catalog));
    if (ability.k === "bond") flags.push(...bondFlags(card, ability.group, catalog));
  }
  return flags;
};

/** A Summon must have a unit to pull, and none worth more than the Summon is priced at. */
const summonFlags = (
  card: KessenCard,
  set: string,
  catalog: readonly KessenCard[],
): KessenBalanceFlag[] => {
  const pool = catalog.filter(
    (other) =>
      other.id !== card.id &&
      isBalancedCard(other) &&
      other.sets.includes(set) &&
      isSummonable(other) &&
      sharesDeck(card.faction, other.faction),
  );
  if (pool.length === 0) {
    return [
      {
        rule: "summonSet",
        severity: "warn",
        message: `Summon ${set} has no unit its decks can pull`,
      },
    ];
  }
  const limit = summonValueMilli(set) + KESSEN_BALANCE.curveTolerance;
  const strongest = pool.reduce((best, other) =>
    other.power > best.power ? other : best,
  );
  if (strongest.power * 1000 <= limit) return [];
  return [
    {
      rule: "summonSet",
      severity: "break",
      message: `Summon ${set} can pull ${strongest.name} (power ${strongest.power}), over the ${points(limit)} a Summon from it allows`,
    },
  ];
};

/** A Bond needs a partner in its set and a set small enough for its flat price. */
const bondFlags = (
  card: KessenCard,
  set: string,
  catalog: readonly KessenCard[],
): KessenBalanceFlag[] => {
  const units = catalog.filter(
    (other) =>
      isBalancedCard(other) &&
      other.kind === "UNIT" &&
      other.sets.includes(set) &&
      sharesDeck(card.faction, other.faction),
  );
  const partners = units.filter((other) => other.id !== card.id).length;
  const [low, high] = KESSEN_BALANCE.bondSet;
  if (partners === 0) {
    return [
      {
        rule: "bondSet",
        severity: "warn",
        message: `Bond ${set} has no other unit its decks can field`,
      },
    ];
  }
  const size = units.length;
  if (size >= low && size <= high) return [];
  return [
    {
      rule: "bondSet",
      severity: "break",
      message: `Bond ${set} counts ${size} units, outside ${low}–${high}`,
    },
  ];
};

/** A faction's pool counts and curve bias. */
const factionBalance = (
  faction: KessenFaction,
  entries: KessenCardBalance[],
): KessenFactionBalance => {
  const deckCards = entries.filter((entry) => entry.card.kind !== "LEADER");
  const counts: Record<ItemRarity, number> = {
    COMMON: 0,
    RARE: 0,
    EPIC: 0,
    LEGENDARY: 0,
  };
  for (const entry of deckCards) counts[entry.card.rarity] += 1;
  // Cards off the curve are flagged on their own; the bias catches a pool of cards that
  // each stay inside it while leaning the same way.
  const gaps = deckCards.flatMap((entry) =>
    entry.gap === null || Math.abs(entry.gap) > KESSEN_BALANCE.curveTolerance
      ? []
      : [entry.gap],
  );
  const bias =
    gaps.length > 0
      ? Math.round(gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length)
      : null;
  const flags: KessenBalanceFlag[] = [];
  if (bias !== null && Math.abs(bias) > KESSEN_BALANCE.factionBias) {
    flags.push({
      rule: "factionBias",
      severity: bias > 0 ? "break" : "warn",
      message: `${KESSEN_FACTION_NAMES[faction]} cards on the curve average ${points(Math.abs(bias))} ${bias > 0 ? "over" : "under"} it (limit ${points(KESSEN_BALANCE.factionBias)})`,
    });
  }
  return { faction, counts, bias, flags };
};

/** Engine fields of a Forbidden variant that differ from its base card. */
const differingFields = (variant: KessenCard, base: KessenCard) => {
  const fields: string[] = [];
  if (variant.kind !== base.kind) fields.push("kind");
  if (variant.faction !== base.faction) fields.push("faction");
  if (variant.rarity !== base.rarity) fields.push("rarity");
  if (variant.row !== base.row) fields.push("row");
  if (variant.power !== base.power) fields.push("power");
  if (variant.provision !== base.provision) fields.push("provision");
  if (variant.leaderBonus !== base.leaderBonus) fields.push("leader bonus");
  if (!sameAbilities(variant.abilities, base.abilities)) fields.push("abilities");
  if (!sameList(variant.sets, base.sets)) fields.push("sets");
  return fields;
};

const sameAbilities = (a: readonly KessenAbility[], b: readonly KessenAbility[]) =>
  JSON.stringify(a) === JSON.stringify(b);

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((entry, index) => entry === b[index]);

/** A unit a Summon can place: Infiltrators never come out of a Summon. */
const isSummonable = (card: KessenCard) => card.kind === "UNIT" && !isInfiltrator(card);

/** Cards of the two factions can share a deck. */
const sharesDeck = (a: KessenFaction, b: KessenFaction) =>
  a === b || a === "NEUTRAL" || b === "NEUTRAL";

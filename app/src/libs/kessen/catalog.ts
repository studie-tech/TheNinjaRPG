/**
 * Catalog helpers: `Item` rows to engine cards, the per-match snapshot and its
 * fingerprint, stable seed ids and the value curve used for provision costs.
 */
import { type CardData, cardDataSchema } from "@/validators/itemCard";
import { canonicalJson } from "./engine";
import { hashString } from "./rng";
import type { KessenCard, KessenRarity } from "./types";

/** Prefix of every Kessen card item id. */
export const KESSEN_ID_PREFIX = "kessen-";

/** URL-safe slug of a card name: "Ava, the Snow Terror" becomes "ava-the-snow-terror". */
export const kessenSlug = (name: string) =>
  name
    .toLowerCase()
    .replace(/['’,.]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Stable seed item id of a card (`kessen-<slug>`, `kessen-leader-<slug>`, ...). */
export const kessenCardId = (
  name: string,
  kind: "card" | "leader" | "forbidden" | "token" = "card",
) => {
  const slug = kessenSlug(name);
  return kind === "card"
    ? `${KESSEN_ID_PREFIX}${slug}`
    : `${KESSEN_ID_PREFIX}${kind}-${slug}`;
};

/** Engine card of an `Item` row; null when `cardData` is missing or invalid. */
export const itemToKessenCard = (item: {
  id: string;
  name: string;
  rarity: KessenRarity;
  cardData: unknown;
}): KessenCard | null => {
  if (item.cardData === null || item.cardData === undefined) return null;
  const parsed = cardDataSchema.safeParse(item.cardData);
  if (!parsed.success) return null;
  return cardDataToKessenCard(item, parsed.data);
};

/** Engine cards of item rows; rows that are not valid cards are left out. */
export const kessenCatalogCards = (
  rows: Iterable<{ id: string; name: string; rarity: KessenRarity; cardData: unknown }>,
) =>
  [...rows].flatMap((row) => {
    const card = itemToKessenCard(row);
    return card ? [card] : [];
  });

/**
 * Owned card copies per item id from per-stack (or grouped) rows: all of them, the
 * `free` ones not listed in the auction house, which are the copies a deck may use, and
 * the `listed` rest.
 */
export const ownedCardCounts = (
  rows: Iterable<{ itemId: string; isInAuction: boolean; quantity: number }>,
) => {
  const all: Record<string, number> = {};
  const free: Record<string, number> = {};
  const listed: Record<string, number> = {};
  for (const row of rows) {
    all[row.itemId] = (all[row.itemId] ?? 0) + row.quantity;
    const split = row.isInAuction ? listed : free;
    split[row.itemId] = (split[row.itemId] ?? 0) + row.quantity;
  }
  return { all, free, listed };
};

/** Engine card of an item and its parsed `cardData`. */
export const cardDataToKessenCard = (
  item: { id: string; name: string; rarity: KessenRarity },
  data: CardData,
): KessenCard => ({
  id: item.id,
  name: item.name,
  rarity: item.rarity,
  kind: data.kind,
  faction: data.faction,
  row: data.row,
  power: data.power,
  provision: data.provision,
  abilities: data.abilities,
  summonGroups: data.summonGroups,
  leaderBonus: data.leaderBonus,
  variant: data.variant,
  baseCardId: data.baseCardId,
  isCollectible: data.isCollectible,
});

/** `cardData` of an engine card; display fields take defaults unless given. */
export const kessenCardToCardData = (
  card: KessenCard,
  display: { flavor?: string; artUrl?: string; focalX?: number; focalY?: number } = {},
): CardData => ({
  kind: card.kind,
  faction: card.faction,
  row: card.row,
  power: card.power,
  provision: card.provision,
  abilities: card.abilities,
  summonGroups: card.summonGroups,
  leaderBonus: card.leaderBonus,
  flavor: display.flavor ?? "",
  artUrl: display.artUrl ?? "",
  focalX: display.focalX ?? 50,
  focalY: display.focalY ?? 35,
  variant: card.variant,
  baseCardId: card.baseCardId,
  isCollectible: card.isCollectible,
});

/** Copy-limit identity: a Forbidden variant counts as its base card. */
export const copyKey = (card: Pick<KessenCard, "id" | "baseCardId">) =>
  card.baseCardId ?? card.id;

/** The engine fields of the cards (only those in `ids` when given), sorted by id. */
export const snapshotCatalog = (
  cards: Iterable<KessenCard>,
  ids?: Iterable<string>,
) => {
  const wanted = ids ? new Set(ids) : null;
  const out: KessenCard[] = [];
  for (const card of cards) {
    if (wanted && !wanted.has(card.id)) continue;
    out.push(cardDataToKessenCard(card, kessenCardToCardData(card)));
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
};

/** Fingerprint of the engine-relevant catalog; changes whenever a rule-bearing field does. */
export const catalogFingerprint = (cards: Iterable<KessenCard>) =>
  hashString(canonicalJson(snapshotCatalog(cards)));

/** Value premium over provision per rarity, in milli-points. */
export const VALUE_PREMIUM_MILLI: Record<KessenRarity, number> = {
  COMMON: 2000,
  RARE: 1000,
  EPIC: 1000,
  LEGENDARY: 2000,
};

const SUMMON_VALUE_MILLI: Record<string, number> = { Sandworm: 3500, Crew: 3000 };

/**
 * Curve value (power + ability values) in milli-points; null for Infiltrators, whose
 * value depends on the board. A balanced card scores `provision * 1000 + premium`.
 */
export const cardValueMilli = (card: KessenCard): number | null => {
  let value = card.power * 1000;
  if (card.row === "ANY") value += 500;
  for (const ability of card.abilities) {
    switch (ability.k) {
      case "strike":
        value +=
          ability.mode === "single"
            ? ability.x * 1000 + 1500
            : ability.mode === "oppositeRow"
              ? ability.x * 2000
              : ability.mode === "chosenRow"
                ? ability.x * 2500
                : ability.x * 4000;
        break;
      case "empower":
        value +=
          ability.mode === "single"
            ? ability.x * 1000
            : ability.mode === "ownRowOthers"
              ? ability.x * 2000
              : ability.mode === "chosenRow"
                ? ability.x * 3000
                : ability.x * 5000;
        break;
      case "rally":
        value += ability.x * 2500;
        break;
      case "bond":
        value += 3000;
        break;
      case "meditate":
        value += Math.min(6000, ability.x * 2250);
        break;
      case "summon":
        value += SUMMON_VALUE_MILLI[ability.group] ?? 3000;
        break;
      case "revive":
        value += 6000 * (ability.times ?? 1);
        break;
      case "substitution":
        value += 3000;
        break;
      case "resilient":
        value += card.power * 500;
        break;
      case "grantResilient":
        value += 3500;
        break;
      case "purge":
        value += ability.mode === "eachEnemyRow" ? 10500 : 6000;
        break;
      case "terrain":
        value +=
          ability.row === "enemyMostUnits"
            ? 7000
            : card.faction === "HYORIN"
              ? 5000
              : 4000;
        break;
      case "clearSkies":
        value += 2000;
        break;
      case "seal":
        value +=
          ability.mode === "single"
            ? 3000
            : ability.mode === "joinRowOthers"
              ? 0
              : 6000;
        break;
      case "unyielding":
        value += 2000;
        break;
      case "infiltrator":
        return null;
      default:
        break;
    }
  }
  return value;
};

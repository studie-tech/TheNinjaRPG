/**
 * Kessen card pack identity shared by the server and the Card Hall: faction names, pack
 * item ids and pack names. Pure, so client code can import it.
 */
import {
  KESSEN_FIRST_BUNDLE_ITEM_ID,
  KESSEN_PACK_ID_PREFIX,
  KESSEN_PACK_NORMAL_SLOTS,
} from "@/drizzle/constants";
import type { KessenFaction } from "@/validators/itemCard";
import type { KessenPackSlots } from "@/validators/kessen";
import { type DeckFaction, KESSEN_DECK_FACTIONS } from "./deck";

/** Village names of the factions. */
export const KESSEN_FACTION_NAMES: Record<KessenFaction, string> = {
  SHIROHANA: "Shirohana",
  TSUKIMORI: "Tsukimori",
  HYORIN: "Hyorin",
  AKASUMI: "Akasumi",
  AKIKAZE: "Akikaze",
  SYNDICATE: "Syndicate",
  NEUTRAL: "Neutral",
};

/** Item ids of the card packs (CONSUMABLE items opened through the weighted cache). */
export const KESSEN_PACK_IDS = {
  paper: `${KESSEN_PACK_ID_PREFIX}paper`,
  lacquer: `${KESSEN_PACK_ID_PREFIX}lacquer`,
  /** Lemu's untradeable welcome pack whose fifth card is EPIC or better. */
  first: KESSEN_FIRST_BUNDLE_ITEM_ID,
  village: (faction: DeckFaction) =>
    `${KESSEN_PACK_ID_PREFIX}village-${faction.toLowerCase()}`,
} as const;

/** Whether an item id is a Kessen card pack. */
export const isKessenPackId = (itemId: string) =>
  itemId.startsWith(KESSEN_PACK_ID_PREFIX);

/** The faction of a Village Bundle id; null for every other item. */
export const kessenVillagePackFaction = (itemId: string): DeckFaction | null =>
  KESSEN_DECK_FACTIONS.find((faction) => KESSEN_PACK_IDS.village(faction) === itemId) ??
  null;

/**
 * Purchase-limit key of the Village Bundles: the six bundles count against one weekly
 * limit together, so the stall's purchase counter is kept under this key instead of the
 * bundle's item id.
 */
export const KESSEN_VILLAGE_BUNDLE_LIMIT_KEY = `${KESSEN_PACK_ID_PREFIX}village`;

/** Display names of the card packs, keyed like `KESSEN_PACK_IDS`. */
export const KESSEN_PACK_NAMES = {
  paper: "Paper Bundle",
  lacquer: "Lacquer Case",
  first: "First Bundle",
  village: (faction: DeckFaction) => `${KESSEN_FACTION_NAMES[faction]} Village Bundle`,
} as const;

/** Display name of a pack id; null when the id is not one of the Kessen packs. */
export const kessenPackName = (itemId: string): string | null => {
  if (itemId === KESSEN_PACK_IDS.paper) return KESSEN_PACK_NAMES.paper;
  if (itemId === KESSEN_PACK_IDS.first) return KESSEN_PACK_NAMES.first;
  if (itemId === KESSEN_PACK_IDS.lacquer) return KESSEN_PACK_NAMES.lacquer;
  const faction = kessenVillagePackFaction(itemId);
  return faction ? KESSEN_PACK_NAMES.village(faction) : null;
};

/** The slots a pack is built with, when its stored caches do not say. */
export const KESSEN_DEFAULT_PACK_SLOTS: KessenPackSlots = {
  normal: KESSEN_PACK_NORMAL_SLOTS,
  rareSlot: 1,
};

/** Column labels of a pack's odds: "Slots 1–4" and "Slot 5" for the default layout. */
export const kessenPackSlotLabels = (slots: KessenPackSlots) => ({
  normal: slotRange(1, slots.normal),
  rareSlot: slotRange(slots.normal + 1, slots.normal + slots.rareSlot),
});

const slotRange = (first: number, last: number) =>
  last <= first ? `Slot ${first}` : `Slots ${first}–${last}`;

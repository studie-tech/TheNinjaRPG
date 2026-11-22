/**
 * Card Hall cache patches of the Kessen collection mutations: saved decks, the starter
 * grant, pack reveals and the auto-sell toggle, applied to the `kessen.getHub` view.
 */
import { KESSEN_PACK_ID_PREFIX } from "@/drizzle/constants";
import type { DeckFaction } from "@/libs/kessen/deck";
import type { KessenDeckRow, KessenHub } from "@/validators/kessen";
import type { CardPackReveal } from "@/validators/weightedCache";

/** Hub with a saved deck in place of its previous version, or appended when new. */
export const withSavedDeck = (hub: KessenHub, deck: KessenDeckRow): KessenHub => ({
  ...hub,
  decks: hub.decks.some((entry) => entry.id === deck.id)
    ? hub.decks.map((entry) => (entry.id === deck.id ? deck : entry))
    : [...hub.decks, deck],
});

/** Hub without a deleted deck. */
export const withoutDeck = (hub: KessenHub, deckId: string): KessenHub => ({
  ...hub,
  decks: hub.decks.filter((deck) => deck.id !== deckId),
});

/**
 * Hub after the starter grant: the granted cards join the owned counts (packs are not
 * cards and stay out), the starter deck is saved and the starter step is done.
 */
export const withStarterGranted = (
  hub: KessenHub,
  result: {
    faction: DeckFaction;
    granted: readonly { itemId: string; quantity: number }[];
    deck: KessenDeckRow | null;
  },
): KessenHub => {
  const owned = { ...hub.owned };
  for (const grant of result.granted)
    if (!grant.itemId.startsWith(KESSEN_PACK_ID_PREFIX))
      owned[grant.itemId] = (owned[grant.itemId] ?? 0) + grant.quantity;
  const next: KessenHub = {
    ...hub,
    owned,
    needsStarter: false,
    progress: {
      ...hub.progress,
      starterGranted: true,
      starterFaction: result.faction,
    },
  };
  return result.deck ? withSavedDeck(next, result.deck) : next;
};

/**
 * Hub after a pack opening: delivered cards join the owned counts, pity updates and the
 * opened stack (`openedStackId`) holds one pack fewer, leaving the hub once empty.
 */
export const withPackReveal = (
  hub: KessenHub,
  reveal: CardPackReveal,
  openedStackId: string | undefined,
): KessenHub => {
  const owned = { ...hub.owned };
  for (const card of reveal.cards)
    if (card.soldFor === null) owned[card.itemId] = (owned[card.itemId] ?? 0) + 1;
  const packs = hub.packs
    .map((pack) =>
      pack.userItemId === openedStackId
        ? { ...pack, quantity: pack.quantity - 1 }
        : pack,
    )
    .filter((pack) => pack.quantity > 0);
  return { ...hub, owned, packs, pity: reveal.pity };
};

/** Hub with the auto-sell toggle set. */
export const withAutoSell = (hub: KessenHub, enabled: boolean): KessenHub => ({
  ...hub,
  autoSellSurplus: enabled,
});

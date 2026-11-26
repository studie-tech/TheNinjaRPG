"use client";

import { useKessenCatalog } from "@/hooks/kessen/useKessenHub";
import type { CardPackReveal } from "@/validators/weightedCache";
import { catalogLookup, kessenItemName } from "./hubData";
import { PackOpening } from "./PackOpening";

/**
 * The pack ceremony for a Kessen pack opened outside the Card Hall (the item page). It
 * reads the CDN-cached catalog for the card faces; until it arrives the sealed pack shows
 * and unknown faces use placeholders, so the ceremony never waits on it. `motion` is the
 * opener's settled `useKessenMotion()`, so the first frame already honours it.
 */
export const ItemPackReveal = ({
  reveal,
  onClose,
  returnFocusTo,
  motion,
}: {
  reveal: CardPackReveal | null;
  onClose: () => void;
  motion?: boolean;
  /** Focus target after closing, for an opener that unmounts with the ceremony open. */
  returnFocusTo?: () => HTMLElement | null | undefined;
}) => {
  const catalog = useKessenCatalog();
  const cards = catalog.data?.cards ?? [];
  const packName = reveal
    ? kessenItemName(reveal.packItemId, catalogLookup(cards), catalog.data?.packs)
    : undefined;
  const packImage = catalog.data?.packs.find(
    (pack) => pack.id === reveal?.packItemId,
  )?.image;
  return (
    <PackOpening
      open={reveal !== null}
      reveal={reveal}
      cards={cards}
      packName={packName}
      packImage={packImage}
      onClose={onClose}
      returnFocusTo={returnFocusTo}
      motion={motion}
    />
  );
};

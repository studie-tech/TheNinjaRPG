import type { Item } from "@/drizzle/schema";
import type { KessenCardDisplay } from "@/layout/kessen/kessenArt";
import { itemToKessenCard } from "@/libs/kessen/catalog";

/** The card face of a card item; null when its card data is missing or invalid. */
export const itemCardDisplay = (
  item: Pick<Item, "id" | "name" | "rarity" | "image" | "cardData">,
): KessenCardDisplay | null => {
  const card = itemToKessenCard(item);
  if (!card) return null;
  return {
    ...card,
    image: item.image,
    artUrl: item.cardData?.artUrl,
    focalX: item.cardData?.focalX,
    focalY: item.cardData?.focalY,
    flavor: item.cardData?.flavor,
  };
};

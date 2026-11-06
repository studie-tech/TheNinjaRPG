import type { Item } from "@/drizzle/schema";
import ContentImage from "@/layout/ContentImage";
import { rarityLabel, rarityTextClass } from "@/layout/items/ItemCard";
import { ShopPriceTag } from "@/layout/shop/ShopPriceTag";
import { cn } from "@/libs/shadui";
import type { ShopCurrency, ShopPrice } from "@/libs/shop";

/** One item for sale, laid out like a backpack card: art, name, rarity and type, then its price. */
export function ShopItemCard({
  item,
  prices,
  wallet,
  silverLabel,
  isSelected,
  onSelect,
}: {
  item: Item;
  prices: ShopPrice[];
  wallet: Record<ShopCurrency, number>;
  silverLabel: string;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      data-item-name={item.name}
      aria-current={isSelected ? "true" : undefined}
      onClick={onSelect}
      className={cn(
        "bg-card hover:bg-muted/60 focus-visible:outline-primary flex h-full w-full min-w-0 items-center gap-2 rounded-lg border p-1.5 text-left focus-visible:outline-2",
        isSelected && "border-primary ring-primary/40 ring-2",
      )}
    >
      <span className="relative h-11 w-11 shrink-0">
        <ContentImage
          image={item.image}
          alt={item.name}
          rarity={item.rarity}
          // Sized by the box, so the art stays inside the frame's border.
          className="h-full w-full"
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{item.name}</span>
        <span
          className={cn(
            "block truncate text-xs font-medium",
            rarityTextClass[item.rarity],
          )}
        >
          {rarityLabel[item.rarity]} · {typeLabel(item)}
        </span>
        {/* Room for the price and its "Need … more" line, so every card is one size. */}
        <span className="mt-1 flex min-h-10 items-start">
          <ShopPriceTag prices={prices} wallet={wallet} silverLabel={silverLabel} />
        </span>
      </span>
    </button>
  );
}

/** The item's type as one word, matching the backpack card's line. */
const typeLabel = (item: Pick<Item, "itemType">) =>
  item.itemType.charAt(0) + item.itemType.slice(1).toLowerCase();

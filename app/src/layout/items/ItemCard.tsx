"use client";

import type { ItemRarity } from "@/drizzle/constants";
import type { UserItemWithRelations, UserItemWithVariants } from "@/drizzle/schema";
import ContentImage from "@/layout/ContentImage";
import DurabilityBar from "@/layout/DurabilityBar";
import { applyActiveVariant } from "@/libs/combat/util";
import { showsItemLevelBadge } from "@/libs/item";
import { cn } from "@/libs/shadui";

interface ItemCardProps {
  userItem: UserItemWithRelations;
  isSelected: boolean;
  onSelect: (userItemId: string) => void;
  /** Makes the card a drag-to-equip source; the page passes it on devices with a mouse or trackpad. */
  onDragStart?: (userItem: UserItemWithRelations) => void;
  onDragEnd?: () => void;
}

/** One backpack item: art, name, rarity and where it goes, with stack size or wear. */
export function ItemCard({
  userItem,
  isSelected,
  onSelect,
  onDragStart,
  onDragEnd,
}: ItemCardProps) {
  const { item } = userItem;
  const look = applyActiveVariant(userItem as UserItemWithVariants);
  const wears = item.maxDurability > 0;
  const detail = itemDetail(userItem);
  return (
    <button
      type="button"
      data-item-name={item.name}
      aria-current={isSelected ? "true" : undefined}
      draggable={!!onDragStart}
      onDragStart={
        onDragStart
          ? (event) => {
              event.dataTransfer.setData(USER_ITEM_DRAG_TYPE, userItem.id);
              event.dataTransfer.effectAllowed = "move";
              onDragStart(userItem);
            }
          : undefined
      }
      onDragEnd={onDragEnd}
      onClick={() => onSelect(userItem.id)}
      className={cn(
        "flex w-full min-w-0 items-center gap-2 rounded-lg border bg-card p-1.5 text-left hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-primary",
        isSelected && "border-primary ring-2 ring-primary/40",
      )}
    >
      <span className="relative h-11 w-11 shrink-0">
        <ContentImage
          image={look.image}
          alt={item.name}
          rarity={item.rarity}
          className="h-11 w-11"
        />
        {wears && (
          <DurabilityBar
            currentDurability={userItem.durability}
            maxDurability={item.maxDurability}
            size="medium"
          />
        )}
        {showsItemLevelBadge(item) && (
          <span className="absolute bottom-0 left-0 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-red-600 bg-slate-200 px-0.5 font-bold text-[10px] text-black">
            {userItem.level}
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold text-sm">{look.name}</span>
        <span
          className={cn(
            "block truncate text-xs font-medium",
            rarityTextClass[item.rarity],
          )}
        >
          {rarityLabel[item.rarity]} · {slotLabel(userItem)}
        </span>
      </span>
      {detail && (
        <span className="shrink-0 text-muted-foreground text-xs font-semibold">
          {detail}
        </span>
      )}
    </button>
  );
}

/** Data-transfer type carrying a dragged user item's id. */
export const USER_ITEM_DRAG_TYPE = "application/x-tnr-user-item";

export const rarityLabel: Record<ItemRarity, string> = {
  COMMON: "Common",
  RARE: "Rare",
  EPIC: "Epic",
  LEGENDARY: "Legendary",
};

export const rarityTextClass: Record<ItemRarity, string> = {
  COMMON: "text-slate-600 dark:text-slate-300",
  RARE: "text-blue-700 dark:text-blue-300",
  EPIC: "text-violet-700 dark:text-violet-300",
  LEGENDARY: "text-amber-700 dark:text-amber-300",
};

/** "Hand", "Item", … for gear; the item type for everything else. */
export const slotLabel = (userItem: UserItemWithRelations) => {
  const value =
    userItem.item.slot === "NONE" ? userItem.item.itemType : userItem.item.slot;
  return value.charAt(0) + value.slice(1).toLowerCase();
};

/** Stack size for stacks, remaining wear for gear that wears. */
const itemDetail = (userItem: UserItemWithRelations) => {
  if (userItem.quantity > 1) return `×${userItem.quantity}`;
  if (userItem.item.maxDurability > 0) {
    return `${Math.round((userItem.durability / userItem.item.maxDurability) * 100)}%`;
  }
  return null;
};

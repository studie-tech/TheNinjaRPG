"use client";

import { Check } from "lucide-react";
import type { ItemRarity } from "@/drizzle/constants";
import type { UserItemWithRelations, UserItemWithVariants } from "@/drizzle/schema";
import ContentImage from "@/layout/ContentImage";
import DurabilityBar from "@/layout/DurabilityBar";
import { applyActiveVariant, showsItemLevelBadge } from "@/libs/item";
import { isKessenGood, shortBlockReason } from "@/libs/kessen/cardSale";
import { isKessenPackId } from "@/libs/kessen/packs";
import { cn } from "@/libs/shadui";
import { capitalizeFirstLetter } from "@/utils/string";

/** One backpack item: art, name, rarity and where it goes, with stack size or wear. */
export function ItemCard({
  userItem,
  isSelected,
  onSelect,
  onDragStart,
  onDragEnd,
  isTicked,
  blockReason,
  tag,
}: ItemCardProps) {
  const { item } = userItem;
  const look = applyActiveVariant(userItem as UserItemWithVariants);
  const wears = item.maxDurability > 0 && !isKessenGood(item);
  const detail = itemDetail(userItem);
  const isCard = item.itemType === "CARD";
  const isPack = isKessenPackId(item.id);
  // Card and pack names share long prefixes, so their name and meta lines wrap instead.
  const wraps = isCard || isPack;
  const marker = cardMarker(userItem);
  // A ticked stack that can no longer be sold can still be unticked.
  const isBlocked = !!blockReason && !isTicked;
  return (
    <button
      type="button"
      data-item-name={item.name}
      data-item-id={item.id}
      aria-current={isSelected ? "true" : undefined}
      aria-pressed={isTicked}
      disabled={isBlocked}
      title={blockReason ? `${item.name} ${blockReason}` : undefined}
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
        "flex h-full w-full min-w-0 items-center gap-2 rounded-lg border bg-card p-1.5 text-left hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-primary",
        isSelected && "border-primary ring-2 ring-primary/40",
        isTicked && "border-destructive bg-destructive/10 ring-2 ring-destructive/40",
        // Only the art fades, so the reason below stays readable.
        isBlocked && "cursor-not-allowed bg-muted/40 hover:bg-muted/40",
      )}
    >
      <span
        className={cn(
          "relative h-11 w-11 shrink-0",
          isBlocked && "opacity-40 grayscale",
        )}
      >
        <ContentImage
          image={look.image}
          alt={look.name}
          rarity={item.rarity}
          className="h-11 w-11"
        />
        {isTicked && (
          <span className="absolute -top-1 -left-1 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-white">
            <Check className="h-3.5 w-3.5" aria-hidden />
          </span>
        )}
        {wears && (
          <DurabilityBar
            currentDurability={userItem.durability}
            maxDurability={item.maxDurability}
            size="small"
          />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "font-semibold text-base",
            wraps ? "line-clamp-2 break-words leading-tight" : "block truncate",
          )}
        >
          {look.name}
        </span>
        {(marker || tag) && (
          <span className="mt-0.5 flex flex-wrap gap-1">
            {marker && (
              <span className="rounded-sm bg-red-950 px-1 font-bold text-[11px] text-red-50 uppercase leading-tight tracking-wide dark:bg-red-900">
                {marker}
              </span>
            )}
            {tag && (
              <span className="rounded-sm bg-amber-200 px-1 font-bold text-[11px] text-amber-950 leading-tight dark:bg-amber-900 dark:text-amber-50">
                {tag}
              </span>
            )}
          </span>
        )}
        {blockReason ? (
          <span className="block truncate font-medium text-[11px] text-muted-foreground">
            {shortBlockReason(blockReason)}
          </span>
        ) : (
          <span
            className={cn(
              "block font-medium text-[11px]",
              wraps ? "leading-tight" : "truncate",
              rarityTextClass[item.rarity],
            )}
          >
            {rarityLabel[item.rarity]} ·{" "}
            {isCard ? (
              <span
                className={cn(
                  item.cardData?.kind === "LEADER" &&
                    "rounded-sm bg-amber-200 px-1 font-bold text-amber-950 dark:bg-amber-900 dark:text-amber-50",
                )}
              >
                {cardKindLabel(userItem)}
              </span>
            ) : isPack ? (
              "Card pack"
            ) : (
              slotLabel(userItem)
            )}
            {showsItemLevelBadge(item) && ` · Lv ${userItem.level}`}
          </span>
        )}
      </span>
      {detail && (
        <span className="shrink-0 font-semibold text-[11px] text-muted-foreground">
          {detail}
        </span>
      )}
    </button>
  );
}

/** Data-transfer type carrying a dragged user item's id. */
export const USER_ITEM_DRAG_TYPE = "application/x-tnr-user-item";

/** Player-facing rarity names shared by cards and inspectors. */
export const rarityLabel: Record<ItemRarity, string> = {
  COMMON: "Common",
  RARE: "Rare",
  EPIC: "Epic",
  LEGENDARY: "Legendary",
};

/** Rarity text colors shared by cards and inspectors. */
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
  return capitalizeFirstLetter(value);
};

/** "Unit", "Leader" or "Tactic" for a card; "Card" when its card data is missing. */
export const cardKindLabel = (userItem: Pick<UserItemWithRelations, "item">) => {
  const kind = userItem.item.cardData?.kind;
  return kind ? capitalizeFirstLetter(kind) : "Card";
};

/** The badge that sets Forbidden variants apart from their base cards. */
const cardMarker = (userItem: UserItemWithRelations) =>
  userItem.item.itemType === "CARD" && userItem.item.cardData?.variant === "FORBIDDEN"
    ? "Forbidden"
    : null;

/** Stack size for stacks, remaining wear for gear that wears. */
const itemDetail = (userItem: UserItemWithRelations) => {
  if (userItem.quantity > 1) return `×${userItem.quantity}`;
  if (userItem.item.maxDurability > 0 && !isKessenGood(userItem.item)) {
    return `${Math.round((userItem.durability / userItem.item.maxDurability) * 100)}%`;
  }
  return null;
};

interface ItemCardProps {
  userItem: UserItemWithRelations;
  isSelected: boolean;
  onSelect: (userItemId: string) => void;
  /** Makes the card a drag-to-equip source; the page passes it on devices with a mouse or trackpad. */
  onDragStart?: (userItem: UserItemWithRelations) => void;
  onDragEnd?: () => void;
  /** While selecting, whether the card is ticked; undefined outside select mode. */
  isTicked?: boolean;
  /** While selecting, why the card cannot be ticked. */
  blockReason?: string | null;
  /** A short note beside the name, such as "Surplus" on a card stack. */
  tag?: string;
}

"use client";

import { AlertTriangle } from "lucide-react";
import type React from "react";
import type { ItemRarity, ItemSlot } from "@/drizzle/constants";
import { IMG_EQUIP_SILHOUETTE } from "@/drizzle/constants";
import type { UserItemWithRelations, UserItemWithVariants } from "@/drizzle/schema";
import ContentImage from "@/layout/ContentImage";
import Image from "@/layout/Image";
import { USER_ITEM_DRAG_TYPE } from "@/layout/items/ItemCard";
import { applyActiveVariant, showsItemLevelBadge } from "@/libs/item";
import type { SpriteUser } from "@/libs/lpc/appearance";
import { cn } from "@/libs/shadui";

/**
 * The character silhouette with its 15 equipment slots, in reading order so keyboard focus
 * moves row by row. Tiles accept dropped backpack items while a drag is in progress.
 */
export function EquipmentFigure({
  userItems,
  cosmeticSlots,
  activeSlot,
  dropTargets,
  masteryWarning,
  hotkeys,
  onSlotClick,
  onDropItem,
  wrapTile,
}: EquipmentFigureProps) {
  return (
    <div className="relative flex flex-row items-center justify-center text-center">
      <Image
        className="w-full opacity-50"
        src={IMG_EQUIP_SILHOUETTE}
        alt="background"
        width={290}
        height={461}
      />
      {EQUIPMENT_LAYOUT.map(({ slot, label, pos }) => {
        const userItem = userItems.find((ui) => ui.equipped === slot);
        const cosmetic =
          userItem && cosmeticSlots?.find((entry) => entry.slot === slot);
        const isTarget = dropTargets?.includes(slot) ?? false;
        const isDimmed = !!dropTargets && !isTarget;
        const tile = (
          <button
            key={slot}
            type="button"
            data-slot={slot}
            aria-label={
              userItem
                ? `${label}: ${applyActiveVariant(userItem).name}${cosmetic?.item ? ` · Cosmetic ${cosmetic.variant?.name ?? cosmetic.item.name}` : ""}`
                : `${label} slot, empty`
            }
            aria-current={slot === activeSlot ? "true" : undefined}
            onClick={() => onSlotClick(slot)}
            onDragOver={(event) => {
              if (!isTarget) return;
              event.preventDefault();
              if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
            }}
            onDrop={(event) => {
              if (!isTarget) return;
              event.preventDefault();
              const userItemId = event.dataTransfer?.getData(USER_ITEM_DRAG_TYPE);
              if (userItemId) onDropItem(userItemId, slot);
            }}
            className={cn(
              "absolute flex aspect-square w-1/5 shrink-0 grow-0 cursor-pointer items-center justify-center rounded-xl border-2 font-bold text-xs transition sm:text-sm",
              pos,
              userItem
                ? cn(
                    "border-solid bg-white shadow-sm",
                    rarityBorderClass[userItem.item.rarity],
                  )
                : "border-slate-400 border-dashed bg-white/85 text-slate-600",
              "hover:border-slate-700 hover:bg-white",
              slot === activeSlot && "ring-4 ring-primary/60",
              isTarget && "border-orange-500 bg-orange-100 ring-4 ring-orange-400/60",
              isDimmed && "opacity-40",
            )}
          >
            {userItem ? (
              <EquippedTileContent
                userItem={userItem}
                cosmetic={cosmetic}
                hotkey={hotkeys?.[userItem.itemId]}
                warning={masteryWarning(userItem)}
              />
            ) : (
              <span>{isTarget ? "Drop here" : label}</span>
            )}
          </button>
        );
        return wrapTile ? (
          <span key={slot} className="contents">
            {wrapTile(slot, userItem, tile)}
          </span>
        ) : (
          tile
        );
      })}
    </div>
  );
}

/** Art, hotkey, stack size, level, wear and warnings of an equipped item. */
function EquippedTileContent({
  userItem,
  hotkey,
  warning,
  cosmetic,
}: {
  userItem: UserItemWithRelations;
  hotkey: string | undefined;
  warning: string | undefined;
  cosmetic?: NonNullable<SpriteUser["cosmeticSlots"]>[number];
}) {
  const { item } = userItem;
  const equippedLook = applyActiveVariant(userItem as UserItemWithVariants);
  const look = cosmetic?.item
    ? {
        image: cosmetic.variant?.image ?? cosmetic.item.image,
        name: cosmetic.variant?.name ?? cosmetic.item.name,
      }
    : equippedLook;
  const durability =
    item.maxDurability > 0
      ? Math.round((userItem.durability / item.maxDurability) * 100)
      : null;
  const isWorn = durability !== null && durability < 50;
  return (
    <span className="relative block h-full w-full p-1">
      {/* ContentImage positions its art against this inner box, so the padding above insets it from the slot border. */}
      <span className="relative block h-full w-full">
        <ContentImage
          image={look.image}
          hideBorder={true}
          alt={look.name ?? equippedLook.name}
          rarity={item.rarity}
          className="rounded-lg"
        />
      </span>
      {hotkey && (
        <kbd className="pointer-events-none absolute top-0.5 left-0.5 z-10 rounded-[3px] border border-black/40 bg-white/95 px-[3px] font-bold font-mono text-[10px] text-black leading-[14px] not-any-pointer-fine:hidden">
          {hotkey.toUpperCase()}
        </kbd>
      )}
      {userItem.quantity > 1 && (
        <span className="absolute top-0.5 right-1 z-10 rounded bg-white/90 px-0.5 font-bold text-[10px] text-slate-900 leading-[14px]">
          ×{userItem.quantity}
        </span>
      )}
      {showsItemLevelBadge(item) && (
        <span className="absolute bottom-2 left-0.5 z-10 rounded border border-red-600 bg-white/95 px-0.5 font-bold text-[9px] text-red-700 leading-[12px]">
          Lv {userItem.level}
        </span>
      )}
      {durability !== null && (
        <span className="absolute right-1.5 bottom-1 left-1.5 h-1 overflow-hidden rounded-full bg-slate-300">
          <span
            data-durability
            className={cn(
              "block h-full rounded-full",
              isWorn ? "bg-orange-600" : "bg-lime-600",
            )}
            style={{ width: `${durability}%` }}
          />
        </span>
      )}
      {warning ? (
        <span
          className="absolute -top-2 -right-2 z-20 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-red-600 text-white"
          title={warning}
        >
          <AlertTriangle className="h-3 w-3" aria-label={warning} />
        </span>
      ) : (
        isWorn && (
          <span
            className="absolute -top-2 -right-2 z-20 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-orange-600 font-extrabold text-white text-xs"
            title={`Durability ${durability}%: repair soon`}
          >
            !
          </span>
        )
      )}
    </span>
  );
}

/** Slots in reading order with their place on the silhouette. */
export const EQUIPMENT_LAYOUT: { slot: ItemSlot; label: string; pos: string }[] = [
  { slot: "KEYSTONE", label: "Keystone", pos: "top-2 left-[10%]" },
  { slot: "HEAD", label: "Head", pos: "top-2 left-1/2 -translate-x-1/2" },
  { slot: "THROWN", label: "Thrown", pos: "top-2 right-[10%]" },
  { slot: "ITEM_1", label: "Item", pos: "top-[20%] left-[10%]" },
  { slot: "CHEST", label: "Chest", pos: "top-[20%] left-1/2 -translate-x-1/2" },
  { slot: "ITEM_2", label: "Item", pos: "top-[20%] right-[10%]" },
  { slot: "HAND_1", label: "Hand", pos: "top-[40%] left-[10%]" },
  { slot: "WAIST", label: "Waist", pos: "top-[40%] left-1/2 -translate-x-1/2" },
  { slot: "HAND_2", label: "Hand", pos: "top-[40%] right-[10%]" },
  { slot: "ITEM_3", label: "Item", pos: "top-[60%] left-[10%]" },
  { slot: "LEGS", label: "Legs", pos: "top-[60%] left-1/2 -translate-x-1/2" },
  { slot: "ITEM_4", label: "Item", pos: "top-[60%] right-[10%]" },
  { slot: "ITEM_5", label: "Item", pos: "top-[80%] left-[10%]" },
  { slot: "FEET", label: "Feet", pos: "top-[80%] left-1/2 -translate-x-1/2" },
  { slot: "ITEM_6", label: "Item", pos: "top-[80%] right-[10%]" },
];

const rarityBorderClass: Record<ItemRarity, string> = {
  COMMON: "border-slate-400",
  RARE: "border-blue-500",
  EPIC: "border-violet-500",
  LEGENDARY: "border-amber-500",
};

interface EquipmentFigureProps {
  /** Carried items; the figure shows those equipped. */
  userItems: UserItemWithRelations[];
  cosmeticSlots?: SpriteUser["cosmeticSlots"];
  /** Slot whose picker is open. */
  activeSlot: ItemSlot | undefined;
  /** While an item is dragged: the slots it can be dropped on. */
  dropTargets: ItemSlot[] | undefined;
  /** Why an equipped item does not work in battle, if it does not. */
  masteryWarning: (userItem: UserItemWithRelations) => string | undefined;
  /** Battle keys by item id, shown on devices with a keyboard. */
  hotkeys?: Record<string, string>;
  onSlotClick: (slot: ItemSlot) => void;
  onDropItem: (userItemId: string, slot: ItemSlot) => void;
  /** Wraps each tile, e.g. in a context menu. */
  wrapTile?: (
    slot: ItemSlot,
    userItem: UserItemWithRelations | undefined,
    tile: React.ReactNode,
  ) => React.ReactNode;
}

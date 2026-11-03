"use client";

import { AlertTriangle } from "lucide-react";
import {
  IMG_EQUIP_SILHOUETTE,
  type ItemRarity,
  type ItemSlot,
} from "@/drizzle/constants";
import type { UserItemWithRelations, UserItemWithVariants } from "@/drizzle/schema";
import ContentImage from "@/layout/ContentImage";
import DurabilityBar from "@/layout/DurabilityBar";
import Image from "@/layout/Image";
import { USER_ITEM_DRAG_TYPE } from "@/layout/items/ItemCard";
import { applyActiveVariant } from "@/libs/combat/util";
import { showsItemLevelBadge } from "@/libs/item";
import { cn } from "@/libs/shadui";

interface EquipmentFigureProps {
  /** Carried items; the figure shows those equipped. */
  userItems: UserItemWithRelations[];
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
  /** Called with equipped gear a drag starts on, and with null when it ends. */
  onDragItem?: (userItem: UserItemWithRelations | null) => void;
  /** Wraps each tile, e.g. in a context menu. */
  wrapTile?: (
    slot: ItemSlot,
    userItem: UserItemWithRelations | undefined,
    tile: React.ReactNode,
  ) => React.ReactNode;
}

/**
 * The character silhouette with its 15 equipment slots, in reading order so keyboard focus
 * moves row by row. Tiles accept dropped backpack items while a drag is in progress.
 */
export function EquipmentFigure({
  userItems,
  activeSlot,
  dropTargets,
  masteryWarning,
  hotkeys,
  onSlotClick,
  onDropItem,
  onDragItem,
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
        const isTarget = dropTargets?.includes(slot) ?? false;
        const isDimmed = !!dropTargets && !isTarget;
        const tile = (
          <button
            key={slot}
            type="button"
            data-slot={slot}
            aria-label={
              userItem ? `${label}: ${userItem.item.name}` : `${label} slot, empty`
            }
            aria-current={slot === activeSlot ? "true" : undefined}
            onClick={() => onSlotClick(slot)}
            draggable={!!userItem && !!onDragItem}
            onDragStart={
              userItem && onDragItem
                ? (event) => {
                    event.dataTransfer.setData(USER_ITEM_DRAG_TYPE, userItem.id);
                    event.dataTransfer.effectAllowed = "move";
                    onDragItem(userItem);
                  }
                : undefined
            }
            onDragEnd={onDragItem ? () => onDragItem(null) : undefined}
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
                    "border-solid bg-white/90",
                    rarityBorderClass[userItem.item.rarity],
                  )
                : "border-slate-500 border-dashed bg-slate-200/80 text-slate-700",
              "hover:border-black hover:bg-slate-300",
              slot === activeSlot && "ring-4 ring-primary/60",
              isTarget && "border-orange-500 bg-orange-100 ring-4 ring-orange-400/60",
              isDimmed && "opacity-40",
            )}
          >
            {userItem ? (
              <EquippedTileContent
                userItem={userItem}
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

/** Art, hotkey, wear, mastery warning and stack size or level of an equipped item. */
function EquippedTileContent({
  userItem,
  hotkey,
  warning,
}: {
  userItem: UserItemWithRelations;
  hotkey: string | undefined;
  warning: string | undefined;
}) {
  const { item } = userItem;
  return (
    <span className="relative block h-full w-full">
      <ContentImage
        image={applyActiveVariant(userItem as UserItemWithVariants).image}
        hideBorder={true}
        alt={item.name}
        rarity={item.rarity}
        className=""
      />
      {hotkey && (
        <kbd className="pointer-events-none absolute top-[2px] left-[2px] z-10 rounded-[3px] border border-black/40 bg-white/90 px-[3px] font-bold font-mono text-[10px] text-black leading-[14px] not-any-pointer-fine:hidden">
          {hotkey.toUpperCase()}
        </kbd>
      )}
      {item.maxDurability > 0 && (
        <DurabilityBar
          currentDurability={userItem.durability}
          maxDurability={item.maxDurability}
          position="top-right"
          size="medium"
        />
      )}
      {warning && (
        <span
          className="absolute top-0 left-0 flex h-7 w-7 items-center justify-center rounded-full border-2 border-red-600 bg-slate-300 text-red-600"
          title={warning}
        >
          <AlertTriangle className="h-4 w-4" aria-label={warning} />
        </span>
      )}
      {showsItemLevelBadge(item) ? (
        <span className="absolute bottom-0 left-0 flex h-7 w-7 items-center justify-center rounded-full border-2 border-red-600 bg-slate-300 font-bold text-black">
          {userItem.level}
        </span>
      ) : userItem.quantity > 1 ? (
        <span className="absolute right-0 bottom-0 flex h-7 w-7 items-center justify-center rounded-full border-2 border-amber-300 bg-slate-300 font-bold text-black">
          {userItem.quantity}
        </span>
      ) : null}
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

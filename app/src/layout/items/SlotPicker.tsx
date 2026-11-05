"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ItemSlot } from "@/drizzle/constants";
import type { UserItemWithRelations, UserItemWithVariants } from "@/drizzle/schema";
import ContentImage from "@/layout/ContentImage";
import { EQUIPMENT_LAYOUT } from "@/layout/items/EquipmentFigure";
import { rarityLabel, rarityTextClass } from "@/layout/items/ItemCard";
import { applyActiveVariant } from "@/libs/combat/util";
import { rankSlotCandidates, slotName } from "@/libs/itemsPage";
import { cn } from "@/libs/shadui";

/**
 * Choose gear for one slot: what is worn there now, then every item that fits, rarest and
 * least worn first. Items the server would refuse stay listed, last, with the reason.
 */
export function SlotPicker({
  slot,
  userItems,
  getBlockedReason,
  onEquip,
  onUnequip,
  onInspect,
  onShowInBackpack,
  onClose,
  isPending = false,
}: SlotPickerProps) {
  const label =
    EQUIPMENT_LAYOUT.find((entry) => entry.slot === slot)?.label ?? slotName(slot);
  const current = userItems.find((ui) => ui.equipped === slot);
  const candidates = rankSlotCandidates(userItems, slot, getBlockedReason);
  const title = `${label} slot`;

  return (
    <section
      aria-label={title}
      aria-busy={isPending}
      className="flex flex-col gap-3"
      onKeyDown={(event) => {
        // Escape inside a dialog opened from here belongs to that dialog.
        if (
          event.key === "Escape" &&
          !event.defaultPrevented &&
          event.currentTarget.contains(event.target as Node)
        ) {
          onClose();
        }
      }}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <h2 className="font-bold text-foreground text-xl">{title}</h2>
          <p className="text-muted-foreground text-xs">
            {candidates.length === 1 ? "1 item fits" : `${candidates.length} items fit`}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close slot picker"
          onClick={onClose}
          className="h-9 w-9"
        >
          <X className="h-5 w-5" />
        </Button>
      </div>

      {current && (
        <section
          aria-label="Equipped now"
          className="flex flex-col gap-2 rounded-lg border-2 border-primary/50 bg-primary/5 p-2"
        >
          <div className="flex items-center gap-2">
            <ItemArt userItem={current} />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-muted-foreground text-[11px] uppercase tracking-wide">
                Equipped now
              </p>
              <p className="truncate font-bold text-sm">
                {applyActiveVariant(current).name}
              </p>
              <p className={cn("text-xs", rarityTextClass[current.item.rarity])}>
                {rarityLabel[current.item.rarity]}
                {wearText(current)}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              disabled={isPending}
              onClick={() => onUnequip(current.id, slot)}
            >
              Unequip
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => onInspect(current.id)}
            >
              Inspect
            </Button>
          </div>
        </section>
      )}

      {candidates.length > 0 ? (
        <ul aria-label="Items that fit" className="flex flex-col gap-2">
          {candidates.map(({ userItem, equippedIn, blockedReason }) => (
            <li
              key={userItem.id}
              data-item-name={userItem.item.name}
              className="flex items-center gap-2 rounded-lg border bg-card p-2"
            >
              <button
                type="button"
                aria-label={`Details of ${applyActiveVariant(userItem).name}`}
                onClick={() => onInspect(userItem.id)}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ItemArt userItem={userItem} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold text-sm">
                    {applyActiveVariant(userItem).name}
                  </span>
                  <span
                    className={cn(
                      "block text-xs",
                      rarityTextClass[userItem.item.rarity],
                    )}
                  >
                    {rarityLabel[userItem.item.rarity]}
                    {wearText(userItem)}
                    {equippedIn && ` · Equipped in ${slotName(equippedIn)}`}
                  </span>
                  {blockedReason && (
                    <span className="block font-semibold text-destructive text-xs">
                      {blockedReason}
                    </span>
                  )}
                </span>
              </button>
              <Button
                size="sm"
                aria-label={`Equip ${applyActiveVariant(userItem).name}`}
                disabled={!!blockedReason || isPending}
                onClick={() => onEquip(userItem.id, slot)}
              >
                Equip
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-4 text-center text-muted-foreground text-sm">
          Nothing in your bags fits this slot
        </p>
      )}

      <Button variant="outline" onClick={onShowInBackpack}>
        Show Backpack
      </Button>
    </section>
  );
}

/** Displays the active variant art with the item rarity. */
function ItemArt({ userItem }: { userItem: UserItemWithRelations }) {
  const look = applyActiveVariant(userItem as UserItemWithVariants);
  return (
    <span className="relative h-11 w-11 shrink-0">
      <ContentImage
        image={look.image}
        alt={look.name}
        rarity={userItem.item.rarity}
        className="h-11 w-11"
      />
    </span>
  );
}

/** Adds a remaining-durability label only for items that can wear. */
const wearText = (userItem: UserItemWithRelations) =>
  userItem.item.maxDurability > 0
    ? ` · durability ${Math.round((userItem.durability / userItem.item.maxDurability) * 100)}%`
    : "";

interface SlotPickerProps {
  slot: ItemSlot;
  /** Carried items that can be equipped. */
  userItems: UserItemWithRelations[];
  /** Why the server would refuse to equip an item here, if it would. */
  getBlockedReason: (userItem: UserItemWithRelations, slot: ItemSlot) => string | null;
  onEquip: (userItemId: string, slot: ItemSlot) => void;
  onUnequip: (userItemId: string, slot: ItemSlot) => void;
  onInspect: (userItemId: string) => void;
  onShowInBackpack: () => void;
  onClose: () => void;
  /** An equip or unequip is saving; the buttons wait for it. */
  isPending?: boolean;
}
